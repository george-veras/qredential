# Support

## Where to go

| you want to | go to |
|---|---|
| ask how something works | [Discussions](https://github.com/george-veras/qredential/discussions) |
| report something broken | [Issues](https://github.com/george-veras/qredential/issues/new/choose) |
| report a vulnerability | [privately](https://github.com/george-veras/qredential/security/advisories/new), never an issue |
| read the docs | [qredential.js.org](https://qredential.js.org/) |
| see it run | [the playground](https://qredential.js.org/playground/) |

Questions belong in Discussions and are not a bother. A question nobody can answer from the
documentation is a documentation bug, and finding those is useful.

## What to expect

This is maintained by one person alongside other work. In practice that means a few days, sometimes
longer. If something looks ignored after a week, a nudge on the thread is welcome rather than rude.

Vulnerability reports are the exception: [SECURITY.md](SECURITY.md) commits to five days for an
acknowledgement, and that is a commitment rather than an average.

## Before opening anything

`npm test` on a clean clone should pass with no setup beyond `npm install`. If it does not, that is
worth reporting on its own.

The [error handling guide](https://qredential.js.org/guide/#errors) lists every
rejection reason and every thrown code with what causes it, which answers most "why did it refuse my
credential" questions faster than waiting for a reply.
