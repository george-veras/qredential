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
the verifier is usually a phone.

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

- **SD-JWT** for selective disclosure, the same mechanism the European digital identity wallet uses
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

[**george-veras.github.io/qredential**](https://george-veras.github.io/qredential/)

- [Documentation](https://george-veras.github.io/qredential/guide/), including the full API and
  every rejection reason
- [Playground](https://george-veras.github.io/qredential/playground/), which runs the whole library
  in your browser. The part worth your time is the attack bench: eight things an attacker would
  actually try, each printing the rejection code it expects, so you can check the library against
  its own claims rather than taking my word for it.

The site is built from `docs/` by `npm run build:site` and deployed by GitHub Actions on every push
to main.

## Security

Report vulnerabilities privately through the Security tab. Scope, response times and an honest
account of what this library has not had are in [SECURITY.md](SECURITY.md).

## Status

Early. The API above is implemented and tested, the shape may still move before 1.0, and I would
rather hear that a design is wrong now than after people depend on it. Issues welcome.

## License

MIT
