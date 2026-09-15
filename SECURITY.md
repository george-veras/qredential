# Security policy

## Reporting a vulnerability

Report privately through GitHub's private vulnerability reporting on this repository: the Security
tab, then "Report a vulnerability". That opens a channel only the maintainers can read.

Please do not open a public issue for anything that lets an attacker forge, alter or replay a
credential.

I will acknowledge a report within 5 days and tell you what I think it is. If I disagree that it is
a vulnerability I will say why rather than letting the thread go quiet.

## What counts

The whole point of this library is that a verifier reaches the right answer offline. Anything that
breaks that is in scope:

- making `verify()` return `ok: true` for a credential the issuer did not sign
- getting a claim accepted that the issuer never signed a digest for
- recovering a withheld claim from a presentation
- clearing a revoked credential, including by feeding a stale or forged status list
- crashing the parser on hostile input, since a verifier that throws is a verifier that gets
  wrapped in a try/catch that waves people through

Out of scope: key management, key distribution, and how your trust list reaches the device. The
library takes those as inputs and says so in the README.

## Supported versions

The latest published minor. This is a young project and there is no long term support branch yet.

## What this library has not had

No third party audit. No formal verification. It implements published standards (SD-JWT,
SD-JWT VC, Token Status List, base45) and is tested against the attacks listed above, but tests
prove the presence of defences, never their completeness.

If you are deciding whether to put this between a person and a right they hold, read the source
first. It is about 700 lines and has no runtime dependencies precisely so that reading it is
realistic.
