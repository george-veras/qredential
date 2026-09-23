<!-- section: top -->

<!-- eyebrow -->
_Documentation_

# Credentials that verify with the network off

<!-- lede -->
A QR code carries its own proof. `qredential` checks the signature, the expiry, the revocation status and the claims without a single request leaving the device.

<!-- cta --> [Open the playground](../playground/)

<!-- cta --> [Read the source](https://github.com/george-veras/qredential)

<!-- section: start -->

## Getting started

```ts
npm i qredential
```

Node 20 or newer, every current browser, and React Native. It uses WebCrypto and nothing Node specific, because the device doing the verifying is usually a phone. There are no runtime dependencies.

The full test suite runs on Node 20, 22 and 24 across Linux, macOS and Windows, and in Chromium, Firefox and WebKit on every commit. Ed25519 is exercised in all four.

> **One caveat on React Native.** It has no `CompressionStream`, and issuing, presenting and verifying all work without it: the envelope simply stays uncompressed, which costs size and nothing else. *Offline revocation does not work*, because reading a status list means inflating a bitstring. A verifier that cannot inflate the cached list refuses with `status_unavailable` rather than treating an unreadable list as a clean one. If you need revocation on React Native, polyfill `DecompressionStream`. There is a test that runs the whole flow with both globals deleted, so this description is checked rather than assumed.

### Verify something

```ts
import { verify } from 'qredential'

const result = await verify(scannedText, { trust })

if (result.ok) {
  console.log(result.claims.given_name)   // 'Ana'
} else {
  console.log(result.reason)              // 'expired', 'revoked', 'bad_signature'…
}
```

### The whole round trip

Three parties, three calls. The issuer signs once, the holder narrows what travels, the verifier decides.

```ts
import { issue, present, verify } from 'qredential'

// 1. The issuer, once, when the licence is granted. holderKey binds it to the wallet.
const { credential, qr } = await issue({
  issuer: 'https://id.example.gov',
  kid: '2026-a',
  key: issuerPrivateJwk,
  claims: {
    given_name: 'Ana',
    family_name: 'Goncalves',
    birth_date: '1991-04-02',
    over_18: true,
  },
  disclose: ['birth_date', 'over_18'],
  holderKey: holderPublicJwk,
  expiresIn: '1825d',
})

// 2. The holder's wallet, at scan time. Reveals age, keeps the birth date, and signs the
//    door's fresh challenge, so a photograph of this code is worth nothing.
const presentation = await present(credential, {
  disclose: ['over_18'],
  keyBinding: { key: holderPrivateJwk, audience: 'https://bar.example/door', nonce: challenge },
})

// 3. The verifier, offline.
const result = await verify(presentation, {
  trust,
  nonce: challenge,
  audience: 'https://bar.example/door',
})
result.claims       // { given_name: 'Ana', family_name: 'Goncalves', over_18: true }
result.claims.birth_date  // undefined, and it never left the wallet
```

<!-- section: disclosure -->

## Selective disclosure

Two separate parties make two separate decisions, and conflating them is the usual design mistake. The **issuer** decides which claims *may* be withheld, at signing time, with `disclose`. The **holder** then decides which of those to actually show, at scan time, also with `disclose`. A claim the issuer never marked cannot be withheld by anyone.

The mechanism is ordinary hashing. Each disclosable claim is serialised with a random 128 bit salt, and only the digest of that string is signed into the credential. Revealing a claim means sending the original string so the verifier can hash it and find the digest. Withholding it means the verifier is left holding a digest it can never open.

### Nested, array, and recursive disclosure

RFC 9901 allows all three, and the European wallet ecosystem uses all three. Verification here resolves them at any depth, following the processing model in Section 7.1:

- An `_sd` array inside a nested object hides properties of that object.
- An array element shaped `{"...": digest}` hides the element itself. A withheld one is *removed* from the array rather than left as a placeholder, so what you receive is a clean value you can render.
- A disclosed value can itself contain either shape, so resolving one uncovers more.

None of that leaks into `claims`: no `_sd` key and no `"..."` element ever reaches the caller. Disclosed names come back as paths, such as `address.locality`, and the whole thing is checked both ways against an independent implementation of the same RFC.

> **Why this matters for age checks.** The usual implementation has the customer upload a photo of their ID to a third party, which creates a breach waiting to happen. Here the bar learns one boolean and cannot learn the birth date even if it wants to. That property is cryptographic, not a promise in a privacy policy.

Asking for a claim the issuer did not make disclosable throws rather than silently returning less than you asked for.

<!-- section: holder -->

## Proving the holder

Selective disclosure proves the issuer signed these claims. On its own it does not prove that the person presenting them is the subject, and the gap is not theoretical: a photograph of someone else's code carries the same signature and verifies just as well.

Key binding closes it. The issuer writes the holder's public key into the credential, and at scan time the holder's wallet signs a fresh challenge with the matching private key. A picture cannot do that.

### The three steps

```ts
// 1. The issuer binds the holder's public key.
const { credential } = await issue({
  ...,
  holderKey: holderPublicJwk,
})

// 2. The wallet signs this verifier's challenge, at scan time.
const presentation = await present(credential, {
  disclose: ['over_18'],
  keyBinding: {
    key: holderPrivateJwk,
    audience: 'https://bar.example/door',
    nonce: challengeFromTheVerifier,
  },
})

// 3. The verifier checks the proof answers its own challenge.
const result = await verify(scanned, {
  trust,
  nonce: challengeIIssued,
  audience: 'https://bar.example/door',
})
result.holderVerified   // true
```

The proof commits to four things, and each one closes a specific attack: the **nonce** stops a recorded presentation being replayed, the **audience** stops a proof made for one verifier being used at another, the **signature** ties it to the key the issuer bound, and `sd_hash` covers the exact set of disclosures, so a relay cannot add or strip one after the holder signed. It also expires, five minutes by default, tunable with `maxKeyBindingAge`.

### Static credentials, and why the choice is yours to make out loud

A code printed on a card cannot do any of this. There is no device to sign at scan time, so a static credential is inherently copyable. That is a real and common situation, not a mistake, but it is a decision a verifier should make knowingly:

```ts
const result = await verify(scanned, { trust, acceptWithoutHolderProof: true })
result.holderVerified   // false, and it says so whichever way you chose
```

Without that flag, a presentation with no proof is refused with `holder_proof_missing`. The default is the strict one on purpose: the dangerous case is someone building a door scanner, never hearing of key binding, and shipping something a screenshot defeats. A loud failure that names the problem is worth more than a quiet default that hides it.

> **Opting out never waves through a broken proof.** `acceptWithoutHolderProof` covers the case where no proof was offered. If one is present and fails, the credential is refused regardless of the flag.

### What it costs

Binding is not free in QR terms. The holder's public key lives in the credential and the proof rides along with the presentation:

| Presentation | Characters | QR version |
|---|---|---|
| static, everything visible | ~740 | 18, scans fine |
| age only, bound but unproved | ~1320 | 24, dense |
| age only, with holder proof | ~1605 | 27, too dense |

The proof itself is about 285 characters. That matters less than it looks, because a credential that can do key binding is by definition being shown on a screen, where the code can be large and bright. The density limit is a problem for worn printed cards, and a printed card was never going to do key binding anyway.

<!-- section: size -->

## The size budget

A QR code holds roughly 4300 alphanumeric characters at its largest, but a code that big is unreadable on a scuffed card or a cracked screen. The practical ceiling is around version 20.

Here is what a realistic driving licence costs. Eight claims, a five year expiry, a status list pointer, measured by `examples/sizes.mjs` in the repository:

| Credential | Characters | QR version |
|---|---|---|
| everything visible | ~740 | 18, scans fine |
| all eight claims disclosable | ~1590 | 27, too dense |
| presenting only `over_18` | ~1115 | 22, still dense |

The middle row is the uncomfortable one, and it is better learned here than after printing cards. Selective disclosure roughly doubles the credential, because every disclosable claim costs a salt plus a signed digest, and **the digests stay in the payload whether the holder reveals the claim or not**. That is deliberate: a digest count that shrank with what you revealed would leak what you withheld. The practical consequence is that savings at presentation time are smaller than intuition promises. Thirty percent here, not eighty.

So make disclosable only the claims a verifier might genuinely need to see alone. Two or three, not all of them. `fits()` tells you where you stand before you commit.

> **On base45.** The folklore says it is chosen for compactness. It is not. base45 in QR alphanumeric mode costs about 8.25 bits per original byte, against 10.67 for base64 in byte mode and 8 flat for raw binary. It beats base64 clearly and loses slightly to raw bytes. Raw bytes are given up on purpose, because byte mode carries charset ambiguity and plenty of scanners hand back a mangled string. A credential that survives being copied, pasted and logged is worth a three percent penalty.

<!-- section: revocation -->

## Offline revocation

Revocation is the part implementations skip, and then a stolen credential works forever.

A status list is a compressed bitstring with one bit per credential. A list covering a million credentials is 125 KB of mostly zeroes, which deflates to a few kilobytes. Fetch it when you have signal, check it when you do not.

```ts
// The issuer publishes this, on whatever schedule suits them.
const statusList = await createStatusList({
  issuer: 'https://id.example.gov',
  kid: '2026-a',
  key: issuerPrivateJwk,
  uri: 'https://id.example.gov/status/3',
  size: 1_000_000,
  revoked: [48219],
  expiresIn: '14d',
})

// The verifier checks against its cached copy.
const result = await verify(scanned, {
  trust,
  status: cachedStatusList,
  maxStatusAge: '7d',
})
```

The refusals are worth reading, because each one is a place where a quieter library would hand back a false yes:

- You passed no list, so revocation was never checked: `status_unavailable`
- Your cached list is older than `maxStatusAge`, so revocation cannot be ruled out: `status_list_stale`
- The list is signed by a key that is not on your trust list, which is how an attacker would clear a revoked credential: `bad_signature`
- The list was published by a different issuer than the credential, or for a different `uri`. A given index means something different in every list, so an unbound list is not an answer: `status_unavailable`
- The credential's index falls outside the list you cached, so nothing was actually read: `status_unavailable`

> **A clean result is never silent about this.** When revocation did get checked the result says `revocationChecked: true`. If the library cannot reach a real answer it refuses rather than passing the credential with that flag set, because a false assurance is worse than no answer.

What to do when you cannot be sure is a policy question about your deployment, not a library question, so `qredential` refuses to decide it quietly on your behalf. When revocation did get checked, the successful result says so with `revocationChecked: true`.

<!-- section: trust -->

## Trust lists

The one thing that has to reach the device out of band is the set of issuer public keys you are willing to believe. It changes rarely, so shipping it with the app and refreshing it weekly is a perfectly reasonable distribution strategy.

```ts
const trust = {
  issuers: {
    'https://id.example.gov': {
      name: 'Example Motor Vehicle Authority',
      keys: [{ kid: '2026-a', alg: 'ES256', jwk: publicJwk }],
    },
  },
}
```

The trusted key decides which algorithm is used, never the algorithm named in the credential's own header. That is the whole defence against algorithm substitution, and it is why `alg` lives on the key in your trust list rather than being inferred.

How the list reaches the device, how keys rotate, and where the private key lives are out of scope. The library takes them as inputs.

<!-- section: api -->

## API reference

Four functions cover the credential lifecycle, plus one for issuers publishing revocation.

### issue(options)

```sig
issue(options: IssueOptions): Promise<IssueResult>
```

| Option | Type | Meaning |
|---|---|---|
| `issuer` | `string` | Identifier that must match a key in the verifier's trust list. |
| `key` | `Jwk` | Private key. Never leaves the call. |
| `kid` | `string` | Key id, written into the header so verifiers can pick the right key during rotation. |
| `alg` | `'ES256' \| 'EdDSA'` | Defaults to `ES256`, which every platform supports. |
| `claims` | `object` | What the credential asserts. |
| `disclose` | `string[]` | Claim names the holder may withhold. Everything else is always visible. Naming a claim that does not exist throws. |
| `vct` | `string` | Credential type, the `vct` of SD-JWT VC. |
| `subject` | `string` | Optional subject identifier. |
| `expiresIn` | `number \| string` | Seconds, or a duration like `'1825d'`. |
| `notBefore` | `number \| string` | Same forms, for credentials that start later. |
| `status` | `{ idx, uri }` | This credential's slot in a status list. |
| `holderKey` | `Jwk` | The holder's **public** key, written into `cnf`. Omit only for static credentials. A key carrying a private component is refused. |

Returns `credential` (the SD-JWT combined form, store this in the wallet), `qr` (the scannable envelope), `bytes` (characters in `qr`), and `disclosable` (the claim names the holder can withhold).

### present(credential, options)

```sig
present(credential: string, options: { disclose: string[]; keyBinding?: KeyBindingRequest }): Promise<string>
```

Narrows a credential to the listed claims and returns a scannable envelope. The signed JWT is never touched, so the issuer's signature still verifies on what is left. Accepts either the combined form or an envelope. Asking for a claim the issuer did not make disclosable throws.

`disclose` takes paths, the same ones `verify()` reports back in `disclosed`:

```ts
await present(credential, {
  disclose: ['over_18', 'address.locality', 'nationalities[1]'],
})
```

A bare name is a one segment path, so `'over_18'` means what it always meant. **Array indices are positions in the credential as issued**, not in the presentation, so a selector keeps meaning what it said whatever else the holder withholds. And a nested disclosure cannot legally travel without the one containing it, so asking for `address.locality` sends `address` too, worked out for you rather than left to the caller.

### verify(input, options)

```sig
verify(input: string, options: VerifyOptions): Promise<VerifyResult>
```

| Option | Type | Meaning |
|---|---|---|
| `trust` | `TrustList` | Required. Issuers and keys you are willing to believe. |
| `status` | `string` | A cached status list token. Without it, a credential pointing at one cannot be cleared. |
| `maxStatusAge` | `number \| string` | Refuse to answer from a list older than this. |
| `clockSkew` | `number` | Tolerance in seconds for drift between issuer and verifier. Defaults to 60. |
| `nonce` | `string` | The challenge this verifier issued for this scan. Required to accept a holder proof. |
| `audience` | `string` | This verifier's identifier, checked against the proof's `aud`. |
| `acceptWithoutHolderProof` | `boolean` | Accept a presentation carrying no proof. Necessary for static credentials, and never waves through a proof that is present and broken. |
| `maxKeyBindingAge` | `number \| string` | How old a holder proof may be. Defaults to 5 minutes. |
| `now` | `number` | Override the current time. For tests and replay analysis. |

Never throws on hostile input. It returns a discriminated union: on success `{ ok: true, claims, issuer, subject, issuedAt, expiresAt, disclosed, withheld, revocationChecked }`, and on failure `{ ok: false, reason, message }` with `reason` drawn from the table below.

`withheld` counts the disclosable claims that did not travel. It is useful for policy, and by construction it cannot tell you which ones they were.

**Everything in `claims` describes the subject.** Registered claims that describe the token, such as `iss`, `iat`, `exp` and `status`, are surfaced as typed fields instead, and a disclosure that tries to set one, or to overwrite a claim the payload already settled, fails the whole credential. So looping over `claims` is safe.

### fits(payload, errorCorrection)

```sig
fits(payload: string, errorCorrection?: 'L' | 'M' | 'Q' | 'H'): FitResult
```

Synchronous. Returns `{ chars, version, capacity, comfortable, errorCorrection, advice }`. Error correction defaults to `M`, because `L` looks generous on paper and then fails on a scuffed printed card. `version` is `null` when nothing holds the payload, and `advice` is a sentence you can print straight into a build log.

### createStatusList(options)

```sig
createStatusList(options): Promise<string>
```

For issuers. Takes `issuer`, `key`, `kid`, `alg`, `uri`, `size`, `revoked`, `suspended`, `expiresIn` and `issuedAt`, and returns a signed status list token. An index outside the list throws rather than corrupting a neighbouring credential's bit.

### Also exported

`pack`, `unpack` and `isEnvelope` for the QR envelope, and `encodeBase45` and `decodeBase45` for the codec on its own. Useful for tooling; not needed for ordinary use.

<!-- section: errors -->

## Error handling

There are exactly two contracts, and the split is deliberate rather than accidental. Learn these two sentences and you can write one catch block and know what can land in it.

```sig
1. verify() never throws. For any input at all.
2. Everything else throws only QredentialError.
```

The reason they differ: `verify()` exists to be pointed at hostile input, and a verifier that throws is one somebody wraps in a `try/catch` that waves people through. So it returns a result you have to look at. Everything else fails on conditions a caller fixes in code, where throwing is the right shape.

Both rules are held to by property based tests that generate random strings, malformed keys, corrupt envelopes and hostile options and assert that nothing else escapes. No `SyntaxError` from a JSON parse, no `DOMException` from WebCrypto, no `RangeError` from an allocation.

### Handling a verification result

The result is a discriminated union, so TypeScript narrows it for you:

```ts
const result = await verify(scanned, { trust })

if (result.ok) {
  result.claims          // narrowed: the subject's attributes
  result.withheld        // how many disclosable claims did not travel
} else {
  switch (result.reason) {
    case 'expired':            return askForARenewal()
    case 'revoked':            return refuseAndLog()
    case 'status_list_stale':  return retryWhenOnline()
    default:                   return refuse(result.reason)
  }
}
```

If your codebase is built around `try/catch`, take the same result through `assertVerified()` instead. Nothing is lost: the thrown error carries the original reason.

```ts
import { verify, assertVerified, isQredentialError } from 'qredential'

try {
  const credential = assertVerified(await verify(scanned, { trust }))
  admit(credential.claims)
} catch (error) {
  if (isQredentialError(error) && error.code === 'verification_failed') {
    refuse(error.reason)   // the same FailReason as above
  } else {
    throw error
  }
}
```

### Rejection reasons

Returned by `verify()` as `result.reason`. The playground fires each of these at the verifier so you can watch them land.

| Reason | What happened |
|---|---|
| `malformed` | Not a credential at all, a corrupt envelope, or a combined form missing its trailing separator. |
| `unknown_issuer` | The `iss` claim is not in your trust list. |
| `unknown_key` | The issuer is trusted but has no key with that `kid`. |
| `unsupported_alg` | The header asks for an algorithm the trusted key does not use. |
| `bad_signature` | The signature does not check out. Also covers a forged status list. |
| `expired` | Past `exp`, beyond the clock skew allowance. |
| `not_yet_valid` | Before `nbf`. |
| `digest_mismatch` | A disclosure the issuer never signed, one sent twice, one naming a registered claim, or one colliding with a claim already in the payload. |
| `revoked` | The issuer set this credential's bit. Covers suspended too. |
| `status_unavailable` | Revocation could not be determined: no list supplied, unreadable, bound to a different issuer or uri, or the index falls outside it. |
| `status_list_stale` | Your cached list is older than `maxStatusAge`. |
| `holder_proof_missing` | No holder proof was offered and the caller did not pass `acceptWithoutHolderProof`. |
| `holder_proof_invalid` | A proof was offered and failed: wrong key, wrong nonce, wrong audience, a different disclosure set, stale, or attached to a credential with no bound key. |

### Thrown errors

Everything except `verify()` throws `QredentialError`, which carries a `code`. Use `isQredentialError()` rather than `instanceof`: it checks the shape, so it keeps working when two copies of the package end up in one dependency tree, which is the usual reason `instanceof` quietly stops matching.

| Code | Thrown by | What happened |
|---|---|---|
| `invalid_option` | `issue`, `createStatusList` | An argument the API cannot use: an unknown claim name, a bad duration, a status index outside the list. |
| `not_disclosable` | `present` | You asked to reveal a claim the issuer never made disclosable. |
| `malformed_credential` | `present` | The SD-JWT combined form is not well formed. |
| `malformed_envelope` | `unpack`, `present` | The QR envelope is not well formed. Check `cause` for the codec error underneath. |
| `malformed_status_list` | status list parsing | The token is not a readable status list. |
| `invalid_encoding` | `decodeBase45` | Text that should have been base45 or base64url is not, or a segment is not JSON. |
| `unsupported_alg` | `issue` | An algorithm this version does not implement. |
| `unsupported_runtime` | `unpack` | The platform lacks something required, such as `DecompressionStream` on older React Native. |
| `crypto_failure` | `issue`, `createStatusList` | WebCrypto refused a key or an operation. The original `DOMException` is on `cause`. |
| `verification_failed` | `assertVerified` | Only from that helper. Carries the original `reason`. |

### Reading what is underneath

Where this library wraps someone else's failure it keeps the original on the standard `cause` property, so a specific code never costs you the detail:

```ts
try {
  await unpack(scanned)
} catch (error) {
  if (isQredentialError(error)) {
    error.code           // 'malformed_envelope'
    error.cause          // the invalid_encoding error from the base45 decoder
  }
}
```

> **Codes are API, messages are not.** Every `code` and every `reason` value is covered by semver: a value is never repurposed, and new ones arrive only in minor versions. Message text is free to change in a patch, so branch on the code and print the message. A test in the repository pins the full set of codes, so adding or removing one has to be a deliberate act rather than a side effect.

<!-- section: limits -->

## What this is not

- **Not a wallet.** No UI, no storage.
- **Not key management.** You bring your own keys and your own trust list distribution.
- **Not ISO 18013-5 mDL yet.** That is CBOR and COSE rather than JWT. It is on the roadmap, and claiming half of a compliance standard is worse than not claiming it.
- **Not audited.** It implements published standards and is tested against the attacks in the playground, but tests prove the presence of defences, never their completeness.

The source is about 1,300 lines with no runtime dependencies, specifically so that reading it before you trust it is realistic. Vulnerabilities go through the Security tab on GitHub, and [SECURITY.md](https://github.com/george-veras/qredential/blob/main/SECURITY.md) sets out scope and response times.
