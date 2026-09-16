# qredential

[![ci](https://github.com/george-veras/qredential/actions/workflows/ci.yml/badge.svg)](https://github.com/george-veras/qredential/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/qredential)](https://www.npmjs.com/package/qredential)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/george-veras/qredential/badge)](https://scorecard.dev/viewer/?uri=github.com/george-veras/qredential)

Verify a digital credential from a QR code with **no network connection**.

```ts
import { verify } from 'qredential'

const result = await verify(scannedText, { trust })
// result.ok === true, result.claims.given_name === 'Ana'
```

No server call. No lookup. No account. The proof travels inside the QR code itself.

---

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
- Presenting individual array elements. Verification resolves them at any depth; `present()`
  selects by claim name and an array element has none, so this version withholds them. The
  credential still verifies, with those elements removed.
- Not ISO 18013-5 mDL yet. That is CBOR and COSE rather than JWT, and it is on the roadmap, but
  claiming half of a compliance standard is worse than not claiming it.
- Not audited. It is new. Read the code before you put it between a person and a right they hold.

## Website

[**george-veras.github.io/qredential**](https://george-veras.github.io/qredential/)

- [Documentation](https://george-veras.github.io/qredential/guide/), including the full API and
  every rejection reason
- [Playground](https://george-veras.github.io/qredential/playground/), which runs the whole library
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
[error handling guide](https://george-veras.github.io/qredential/guide/#errors).

## Security

Report vulnerabilities privately through the Security tab. Scope, response times and an honest
account of what this library has not had are in [SECURITY.md](SECURITY.md).

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

Questions go in [Discussions](https://github.com/george-veras/qredential/discussions) and are not a
bother. A question the documentation cannot answer is a documentation bug.

## Status

Early. The API above is implemented and tested, the shape may still move before 1.0, and I would
rather hear that a design is wrong now than after people depend on it. Issues welcome.

## License

MIT
