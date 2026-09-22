# qredential

[![ci](https://github.com/george-veras/qredential/actions/workflows/ci.yml/badge.svg)](https://github.com/george-veras/qredential/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/qredential)](https://www.npmjs.com/package/qredential)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/george-veras/qredential/badge)](https://scorecard.dev/viewer/?uri=github.com/george-veras/qredential)

[English](https://qredential.js.org/) · [Português](https://qredential.js.org/pt/) · [Español](https://qredential.js.org/es/) · [Français](https://qredential.js.org/fr/) · [Deutsch](https://qredential.js.org/de/) · [日本語](https://qredential.js.org/ja/) · [한국어](https://qredential.js.org/ko/) · [简体中文](https://qredential.js.org/zh-Hans/) · [繁體中文](https://qredential.js.org/zh-Hant/)

Verify a digital credential from a QR code with **no network connection**.

Someone shows you a code. You need to know one thing about them, and you need to know it is true.
This library reads the code, checks the signature, and answers, without asking anybody.

```ts
import { verify } from 'qredential'

const result = await verify(scannedText, { trust })
// result.ok === true, result.claims.given_name === 'Ana'
```

No server call. No lookup. No account. The proof travels inside the QR code itself.

---

## What this actually does

If you have not worked with digital credentials before, this section is for you. Nothing here
assumes you have.

A credential is a statement somebody signed. "This person is over 18." "This person may drive a
car." The signature is what makes it worth anything: it says an authority stands behind the
statement, and that nobody edited it afterwards.

On paper, and in a PDF, one signature covers the whole document. To prove a single line of it you
hand over all of it. Show a driving licence to prove your age and the other person also learns your
address, your licence number and your exact date of birth. They never asked for any of that. They
have it now anyway.

Selective disclosure breaks that trade. The issuer signs each fact separately, and the credential
carries only a fingerprint of each one. You choose which facts to reveal, and the rest stay
fingerprints that say nothing about their contents. The signature still checks out, because it was
never a signature over one indivisible blob.

All of it fits inside the code the verifier scans: the signature, the fingerprints, and the facts
you chose to share. Nothing is fetched while verifying, so a door, a bus, a rural clinic or an
aeroplane at cruising altitude can check a credential with no network at all.

There is one last piece, and it is the one people forget. Anything you can scan, you can photograph.
So the person presenting also has to sign a fresh challenge with a private key that never leaves
their device. Without that step, a screenshot of somebody else's credential would pass. This library
refuses any presentation that lacks it, and the section on [proving the
holder](#proving-the-holder-not-just-the-credential) explains how.

The format is SD-JWT, standardised as [RFC 9901](https://www.rfc-editor.org/rfc/rfc9901.html) in
November 2025. It is what the European digital identity wallets and the OpenID specifications use.

## Why this exists

I built the eCNH, Brazil's digital driver's licence, used by more than 40 million people. The part
that taught me the most was not the app. It was the roadside: a police officer scanning a licence on
a highway with one bar of signal, or none, and needing a yes or no in under a second.

Everything you actually need for that answer can fit in the QR code. The signature proves the
issuer. The claims are right there. The only thing you need from the outside world is the issuer's
public key, and that changes so rarely that you can ship it and refresh it once a week.

The libraries for this exist, but they are enterprise SDKs: heavy, tied to one country's profile,
and documented as if you already work in the identity industry. I wanted the version that a normal
product engineer can add on a Tuesday.

## Install

```sh
npm i qredential
```

Runs on Node 20+, browsers, and React Native. It uses WebCrypto and nothing Node specific, because
the verifier is usually a phone. The suite runs on Node 20, 22 and 24 across Linux, macOS and
Windows, and in Chromium, Firefox and WebKit, on every commit.

**One caveat on React Native:** it has no `CompressionStream`. Issuing, presenting and verifying all
work without it, the envelope just stays uncompressed. Offline revocation does not, because reading
a status list means inflating a bitstring, so polyfill `DecompressionStream` if you need it. A
verifier that cannot inflate a cached list refuses rather than treating it as clean. A test runs the
whole flow with both globals deleted, so this is checked rather than assumed.

## Proving the holder, not just the credential

Selective disclosure proves the issuer signed these claims. On its own it does not prove the person
presenting them is the subject, and the gap is not theoretical: a photograph of someone else's code
carries the same signature.

Key binding closes it. The issuer binds the holder's public key; at scan time the wallet signs the
verifier's fresh challenge with the matching private key. A picture cannot do that.

```ts
const { credential } = await issue({ ..., holderKey: holderPublicJwk })

const presentation = await present(credential, {
  disclose: ['over_18'],
  keyBinding: { key: holderPrivateJwk, audience: 'https://bar.example/door', nonce: challenge },
})

const result = await verify(scanned, { trust, nonce: challenge, audience: 'https://bar.example/door' })
result.holderVerified   // true
```

The proof commits to the nonce (stops replay), the audience (stops reuse at another verifier), the
bound key, and a hash of the exact disclosure set (stops a relay adding or stripping one). It
expires after five minutes by default.

**A printed card cannot do this**, and that is a real situation rather than a mistake. Pass
`acceptWithoutHolderProof: true` to accept one, and the result still reports
`holderVerified: false`, so the fact never disappears. Without the flag, a presentation with no
proof is refused: the dangerous case is someone building a door scanner, never hearing of key
binding, and shipping something a screenshot defeats.

## The 2026 problem it solves

Age verification laws are arriving faster than the tooling. The usual implementation asks the user
to upload a photo of their ID to a third party, which is a privacy disaster and a breach waiting to
happen.

Selective disclosure does it properly. The issuer signs every claim once. The holder chooses which
ones to reveal, and the signature still checks out on what is left:

```ts
// The credential contains name, address, birth date, document number.
// The bar only gets to see one thing.
const presentation = await present(credential, { disclose: ['over_18'] })

const result = await verify(presentation, { trust })
result.claims          // { over_18: true }
result.claims.address  // undefined, and it was never transmitted
```

The verifier cannot learn the birth date even if it wants to. That property is cryptographic, not a
promise in a privacy policy.

## What is actually inside

Boring, published standards, not an invention of mine:

- **SD-JWT** ([RFC 9901](https://www.rfc-editor.org/rfc/rfc9901.html)) for selective disclosure and
  key binding, including nested, array element and recursive disclosure, checked against the
  specification's own test vectors and against an independent implementation
- **SD-JWT VC** for the credential shape
- **Token Status List** for revocation that works from a cached copy
- **base45 plus deflate** for the QR envelope, the same envelope trick the EU covid certificate
  used, chosen for scanner compatibility rather than for raw density

If you already speak these, `qredential` is a small ergonomic layer over them. If you do not, you
should not have to learn them to check whether a ticket is real.

## Size, because this is where naive implementations die

A QR code holds about 4300 alphanumeric characters at the largest version, but a code that big is
unreadable on a cracked phone screen in the sun. The real budget is a QR version around 20 or below.

`qredential` compresses before encoding and tells you what you spent:

```ts
const { qr, bytes } = await issue({ ... })
bytes // 738
```

Here is what a realistic driving licence actually costs. Eight claims, a five year expiry, a status
list pointer, measured by `examples/sizes.mjs`:

| credential | characters | QR version |
|---|---|---|
| everything visible, nothing withheld | ~740 | 18, scans fine |
| all eight claims made disclosable | ~1590 | 27, too dense |
| presenting only `over_18` from that credential | ~1115 | 22, still dense |

The uncomfortable row is the middle one, and I would rather you learn it here than after printing
cards. Selective disclosure roughly doubles the credential, because every disclosable claim costs a
128 bit salt plus a digest the issuer has to sign, and the digests stay in the payload whether the
holder reveals the claim or not. That last part is the whole point, since a digest count that
changed with what you reveal would leak what you withheld, but it does mean the savings at
presentation time are smaller than people expect: 30% here, not 80%.

The practical advice, which is why `fits()` exists: make disclosable only the claims that a verifier
might genuinely need to see alone. Two or three, not all of them.

```ts
fits(qr).advice
// 'Fits QR version 18 at level M, with 78 characters to spare.'
```

## Offline revocation

Revocation is the part everyone skips, and then a stolen credential works forever.

A status list is a compressed bitstring: one bit per credential, hundreds of thousands of
credentials in a few kilobytes. Fetch it when you have signal, check it when you do not.

```ts
const result = await verify(scanned, {
  trust,
  status: cachedStatusList,
  maxStatusAge: '7d'   // refuse to answer from a list older than this
})
```

If the cached list is too old, you get `result.ok === false` with
`result.reason === 'status_list_stale'` rather than a false yes. Deciding what to do when you cannot
be sure is your call, and the library refuses to make it quietly for you.

## API

Four functions. That is the whole surface.

| function | who calls it |
|---|---|
| `issue()` | the issuer, once per credential |
| `present()` | the holder's wallet, at scan time |
| `verify()` | the verifier |
| `fits()` | you, while designing the credential |

## What this is not

- Not a wallet. It has no UI and no storage.
- Not a key management system. You bring your own keys and your own trust list distribution.
- Not ISO 18013-5 mDL yet. That is CBOR and COSE rather than JWT, and it is on the roadmap, but
  claiming half of a compliance standard is worse than not claiming it.
- Not audited. It is new. Read the code before you put it between a person and a right they hold.

## Website

[**qredential.js.org**](https://qredential.js.org/)

- [Documentation](https://qredential.js.org/guide/), including the full API and
  every rejection reason
- [Playground](https://qredential.js.org/playground/), which runs the whole library
  in your browser. The part worth your time is the attack bench: eight things an attacker would
  actually try, each printing the rejection code it expects, so you can check the library against
  its own claims rather than taking my word for it.

The site is built from `docs/` by `npm run build:site` and deployed by GitHub Actions on every push
to main.

## Errors

Two contracts, and that is the whole model:

1. **`verify()` never throws.** For any input at all. It returns a discriminated union, and a
   failure carries a typed `reason`.
2. **Everything else throws only `QredentialError`**, which carries a stable `code`.

Both are held to by property based tests that generate random strings, malformed keys, corrupt
envelopes and hostile options and assert that nothing else escapes: no `SyntaxError` from a JSON
parse, no `DOMException` from WebCrypto, no `RangeError` from an allocation.

```ts
import { verify, assertVerified, isQredentialError } from 'qredential'

// Style 1: look at the result.
const result = await verify(scanned, { trust })
if (!result.ok) return refuse(result.reason)

// Style 2: let it throw, if that suits your codebase better.
try {
  const credential = assertVerified(await verify(scanned, { trust }))
} catch (error) {
  if (isQredentialError(error)) refuse(error.reason ?? error.code)
}
```

Codes and reasons are covered by semver; message text is not. Branch on the code, print the
message. The full tables are in the
[error handling guide](https://qredential.js.org/guide/#errors).

## Security

Report vulnerabilities privately through the Security tab. Scope, response times and an honest
account of what this library has not had are in [SECURITY.md](SECURITY.md).

## Translations

The whole site is in nine languages: the landing page, the guide and the playground, including the
live demo, which answers in the language of the page it is on. Most translations have **not been
read by a native speaker**, and each guide page says so at the top rather than pretending
otherwise.

| Language | Code | Status |
|---|---|---|
| [English](https://qredential.js.org/guide/) | `en` | source |
| [Português](https://qredential.js.org/pt/guide/) | `pt` | **needs a reviewer** |
| [Español](https://qredential.js.org/es/guide/) | `es` | **needs a reviewer** |
| [Français](https://qredential.js.org/fr/guide/) | `fr` | **needs a reviewer** |
| [Deutsch](https://qredential.js.org/de/guide/) | `de` | **needs a reviewer** |
| [日本語](https://qredential.js.org/ja/guide/) | `ja` | **needs a reviewer** |
| [한국어](https://qredential.js.org/ko/guide/) | `ko` | **needs a reviewer** |
| [简体中文](https://qredential.js.org/zh-Hans/guide/) | `zh-Hans` | **needs a reviewer** |
| [繁體中文](https://qredential.js.org/zh-Hant/guide/) | `zh-Hant` | **needs a reviewer** |

If you speak one of the languages marked as needing a reviewer, you know something I cannot. Reading
one page and saying whether it is sound is the most useful thing a speaker of that language can do
here, and there is an
[issue template](https://github.com/george-veras/qredential/issues/new/choose) for reporting a
sentence that is wrong, awkward, or uses a term nobody actually uses. Rough reports are welcome; you
do not need to propose the fix.

Anyone who reviews a language is credited on the page and in the release notes, and that language
stops being marked unreviewed.

Translations live in `content/`: the guide as Markdown in `guide/<code>.md`, the landing and the
playground as key catalogues in `landing/<code>.json` and `playground/<code>.json`. Each guide
translation records the hash of the English it was made from, so when the English moves and a
translation does not, the build says so, the page shows a warning, and CI reports it. A catalogue
missing a key fails the build outright, because a page half in one language is worse than one that
is simply not translated. Nothing rots quietly.

## Contributing

The most useful thing you can do is point this library at a credential from somewhere else and tell
me what happened. Every test here verifies something this library itself produced, so none of them
can find a place where it is self-consistent and still wrong. Your credential can, and there is an
[issue template](https://github.com/george-veras/qredential/issues/new/choose) for exactly that.

Setup is `npm install && npm test`, with no services, no environment variables and no runtime
dependencies. [CONTRIBUTING.md](CONTRIBUTING.md) has the architecture map, the two invariants the
design rests on, what changes to the verification path need, and a section called **what this
project will say no to**, which is there so a no reaches you before you build something rather than
after.

There are [good first issues](https://github.com/george-veras/qredential/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22)
open, each one written with enough context to start without asking me anything: what to change,
which file, how to know it worked, and which section of the RFC settles the question.

Questions go in [Discussions](https://github.com/george-veras/qredential/discussions) and are not a
bother. A question the documentation cannot answer is a documentation bug.

## Status

Early. The API above is implemented and tested, the shape may still move before 1.0, and I would
rather hear that a design is wrong now than after people depend on it. Issues welcome.

## License

MIT
