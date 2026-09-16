# Changelog

Notable changes, newest first. The format follows [Keep a Changelog](https://keepachangelog.com),
and this project follows [semantic versioning](https://semver.org).

Two things are covered by semver and one is not. Error `code` values and rejection `reason` values
are API: they are never repurposed, and new ones arrive only in a minor version. Message text is
not: branch on the code, print the message.

## [Unreleased]

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
