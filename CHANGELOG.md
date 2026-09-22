# Changelog

Notable changes, newest first. The format follows [Keep a Changelog](https://keepachangelog.com),
and this project follows [semantic versioning](https://semver.org).

Two things are covered by semver and one is not. Error `code` values and rejection `reason` values
are API: they are never repurposed, and new ones arrive only in a minor version. Message text is
not: branch on the code, print the message.

## [Unreleased]

## [0.3.0]

### Added

- `sha-384` and `sha-512` as `_sd_alg` values, per RFC 9901 section 4.1.1 and the IANA Named
  Information Hash Algorithm Registry. `issue()` takes an `sdAlg` option; the verifier reads the
  algorithm the credential declares and uses the same one for the key binding `sd_hash`. Anything
  outside those three is still refused by name.

  Contributed by [@DYNOSuprovo](https://github.com/DYNOSuprovo) in #19 and
  [@vjymisal0](https://github.com/vjymisal0) in #18, who reached the same issue on the same day.
  The public option, the WebCrypto cross checks and the interoperability tests against
  `@sd-jwt/core` are #19. The `resolveSdAlg()` helper, which is what keeps the digest map, the claim
  reconstruction and the path resolver from disagreeing about a credential's hash, is #18.

### Fixed

- `present()` could not narrow a credential whose `_sd_alg` was not `sha-256`: the path resolver
  hashed with sha-256 regardless, matched nothing, and reported every claim as not disclosable.
  Found by the interoperability tests in #19 when they were run against current main.


## [0.2.0]

First release intended for publication. 0.1.0 was tagged in development and never published, so
nothing here breaks anybody.

### Added

- Key binding, per RFC 9901 section 4.3. The issuer binds the holder's public key, the wallet signs
  the verifier's challenge at scan time, and the proof commits to the nonce, the audience, the bound
  key and the exact disclosure set.
- Nested, array element and recursive selective disclosure, resolved at any depth following the
  processing model in RFC 9901 section 7.1.
- `createStatusList()`, so an issuer can publish revocation rather than hand rolling a bitstring.
- `assertVerified()` for callers who prefer `try/catch` over branching on the result.
- `QredentialError` with stable `code` values, and `isQredentialError()`.
- `holderVerified` and `revocationChecked` on a successful result, so a caller always knows which
  checks actually ran.

### Changed

- **Key binding is required by default.** A presentation carrying no holder proof is rejected with
  `holder_proof_missing`. Accepting a static credential, such as one printed on a card, means
  passing `acceptWithoutHolderProof`, which names what is being given up.
- `claims` now contains only the subject's attributes. Registered claims that describe the token are
  surfaced as typed fields instead.
- The cached status list must be bound to the credential: same issuer, same `uri`. An index outside
  the list is refused rather than reported as checked.
- Disclosed claim names come back as paths, such as `address.locality`.
- `present({ disclose })` selects by path: `address.locality` for a claim nested in an object,
  `nationalities[0]` for an array element. Ancestors travel automatically, since RFC 9901 section
  4.2.6 makes a nested disclosure meaningless without the one containing it, and array indices are
  positions in the credential as issued, so a selector does not shift when the holder withholds
  something else. Plain claim names behave as before. (Documented after the fact: it shipped in
  this version and the entry was missing.)
- The combined form is parsed strictly: no empty segments, and the trailing separator is required.

### Fixed

- The digest shuffle used `Math.random()`. It hides which claims an issuer considered sensitive, so
  it is a privacy property and now uses `crypto.getRandomValues` with rejection sampling.
- Malformed input could escape as an unhandled rejection from a compression stream, which modern
  Node treats as fatal.
- `SyntaxError`, `DOMException` and `RangeError` could escape to callers. Only `QredentialError`
  does now.
- `unb64url` silently stripped characters outside the alphabet instead of rejecting them.
- An empty payload packed to an envelope that `unpack` then called truncated.

[Unreleased]: https://github.com/george-veras/qredential/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/george-veras/qredential/releases/tag/v0.2.0
