# Contributing

Thanks for looking. This is a small library and the bar for helping is low: if you read some of it
and something seemed wrong, that is already worth an issue.

## The fastest useful thing you can do

Point this library at a credential from somewhere else and tell me what happened.

The hardest bugs in an implementation of a specification are the places where it is perfectly
self-consistent and still wrong, and no test written by the author can find those. If you have an
SD-JWT from another issuer, another library, or a wallet, and `verify()` rejects it when it should
not, that is the most valuable report this project can receive. There is an issue template for it.

## Getting set up

```sh
git clone https://github.com/george-veras/qredential
cd qredential
npm install
npm test
```

That should be all of it. There are no runtime dependencies, no build step needed for tests, no
services to start, no environment variables. If `npm test` does not pass on a clean clone, that is a
bug in the project and worth an issue on its own.

| command | what it does |
|---|---|
| `npm test` | the suite, in Node |
| `npm run test:browser` | the same suite in a real browser (`BROWSER=chromium\|firefox\|webkit`) |
| `npm run coverage` | the suite with coverage, and the thresholds CI enforces |
| `npm run lint` | oxlint over `src`, `test` and `scripts` |
| `npm run typecheck` | types, without emitting |
| `npm run build` | compiles `src` to `dist` |
| `npm run build:site` | regenerates `docs/` from its templates |
| `npm run check:docs` | runs the documentation samples and every example, for real |
| `node examples/sizes.mjs` | prints the real QR size budget |

## How the code is laid out

About 1,300 lines, no dependencies, deliberately readable end to end.

| file | what lives there |
|---|---|
| `src/index.ts` | the public API: `issue`, `present`, `verify`, `createStatusList` |
| `src/sdjwt.ts` | disclosures, digests, and the RFC 9901 reconstruction algorithm |
| `src/crypto.ts` | every call into WebCrypto, and nothing else |
| `src/envelope.ts` | the `QC1:` QR envelope |
| `src/base45.ts` | RFC 9285 codec |
| `src/status.ts` | Token Status List, both publishing and reading |
| `src/errors.ts` | the error model |
| `src/qr.ts` | QR capacity, so `fits()` can tell you the truth |

## Two rules that are not negotiable

These are the invariants the whole design rests on, and a change that breaks either one will be
asked to change rather than merged.

**1. `verify()` never throws.** For any input at all. Its job is hostile input, and a verifier that
throws is one somebody wraps in a `try/catch` that waves people through. Everything else throws only
`QredentialError`. Both rules are enforced by property based tests in `test/contract.test.ts` that
generate random and malformed input against every public entry point.

**2. Nothing is accepted half understood.** If the library meets something it cannot fully process,
it refuses and says why. It never ignores the part it did not understand and returns the rest, and
it never reports a check as done when it was skipped. Most of the rejection paths exist because
quietly accepting would be the more convenient behaviour.

## If your change touches verification

Changing `verify()`, `reconstructClaims`, the signature path, key binding or status lists means
changing the part of the library that decides whether a person's credential is real. Those changes
need a little more than usual, and the extra is small:

- **A test that fails without your change.** If you fixed a bug, the test should reproduce it. If
  you closed an attack, the test should carry it out.
- **Say what an attacker gains.** One sentence in the pull request. If the answer is nothing, say
  that too; plenty of good changes are not security relevant and it helps to know which.
- **Prefer refusing over guessing.** When the correct behaviour is unclear, returning a typed
  rejection is nearly always better than accepting.

If a change makes the library accept something it used to reject, that is worth extra care and
extra explanation. It might be exactly right, and it is the direction that goes wrong quietly.

## If your change touches interoperability

Add a case to `test/interop.test.ts`, which runs this library against `@sd-jwt/core`, an independent
implementation of the same RFC. Credentials should cross in both directions. That file has caught
things no other test could.

If you are implementing something the specification defines, quote the section in the pull request.
`test/conformance.test.ts` holds the RFC's own published vectors and is a good place for more.

## If your change touches the site, or adds a language

Nothing on the site is written by hand twice. The pages are generated from `content/`, so a fix to a
sentence is one edit, and `npm run build:site` rewrites all thirty six pages.

To fix a translation, edit `content/guide/<locale>.md` for the guide, or the key in
`content/landing/<locale>.json` or `content/playground/<locale>.json` for the other two. You do not
need to speak the other eight languages, and you do not need to touch the English. Every page says
at the top whether it has been reviewed by a native speaker, and most have not: telling us a
sentence is wrong is a contribution, even without a suggested replacement.

To add a language, copy an existing locale through all of it:

| where | what to add |
|---|---|
| `content/locales.json` | the block: `native`, `name`, `dir`, `ui`, `provenance`, `seo` |
| `content/locales.json` | `ogLocale`, which must be a `language_TERRITORY` pair such as `pt_BR`, because that is the only form the share card readers resolve |
| `content/locales.json` | `htmlLang` and `alsoHreflang`, only if the language needs a regional tag, as Chinese does |
| `content/guide/<locale>.md` | the guide, keeping the `translated-from` stamp on line one |
| `content/landing/<locale>.json` | every key, or the build fails and names the missing ones |
| `content/playground/<locale>.json` | the same |
| `npm run build:og` | renders the share card for the new language from the headline you just wrote |

Then `npm run build:site && npm run check:seo`. The second one is the one that matters: it checks
that the new language has its own title and description rather than English ones, that it joined the
hreflang group in both directions, that it reached the sitemap, that its share card exists, and that
a browser set to that language is actually offered the new pages. A language that is half added
looks completely fine in a browser, which is exactly why it is checked by a script.

Code and comments stay in English, in every file, including files that only exist to hold
translations.

## Opening a pull request

Small and focused beats large and complete. A pull request that fixes one thing and explains it gets
read the same day; one that changes six things waits for an afternoon I do not always have.

- Branch from `main`
- `npm test` and `npm run typecheck` pass
- If you changed `src/`, run `npm run build:site` too, because the playground embeds a copy of the
  library and CI fails when the committed page disagrees with the source
- Commit messages in plain sentences, explaining why rather than what
- No need to update `CHANGELOG.md`; that happens at release

`main` is protected, so everything lands through a pull request and ten checks have to be green
before the merge button works: the test suite on Node 20, 22 and 24, on Linux, macOS and Windows,
the same suite in Chromium, Firefox and WebKit, the playground consistency check, and CodeQL. They
all run automatically when you open the pull request. If one fails for a reason that looks like it
has nothing to do with your change, say so in the thread rather than assuming it is your fault,
because sometimes it is not.

You do not need to ask before opening one. For something large, an issue first saves you the risk of
building something I would ask you to change.

## What this project will say no to

Saying this in advance is more respectful than saying it to a finished pull request.

- **Runtime dependencies.** There are none and there will not be. The point is that reading the
  whole thing before trusting it is realistic.
- **Node specific code in `src/`.** The verifier is usually a phone. WebCrypto and standard web APIs
  only, which is why the suite runs in three browsers.
- **Half of a compliance standard.** Partial mDL, partial anything. Claiming half is worse than not
  claiming it. Complete implementations behind a clear boundary are very welcome.
- **Convenience that hides a security decision.** A default that accepts a credential without
  proving the holder, an option that turns a rejection into a warning, a helper that swallows an
  error. If the caller is giving something up, the API should make them say so.
- **Wallet, storage, key management or trust list distribution.** Real problems, out of scope, and
  the README says so. Build them on top.

## Asking questions

Use [Discussions](https://github.com/george-veras/qredential/discussions) rather than an issue.
Questions are welcome and not a bother; an unanswerable question usually means the documentation is
wrong, which is a bug worth knowing about.

## Reporting a vulnerability

Not here. [SECURITY.md](SECURITY.md) has the private channel and what is in scope.

## Credit

Anyone whose change is merged is named in the release notes. If you would rather not be, say so and
you will not be.

## Behaviour

[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), which is Contributor Covenant 3.0. The short version is
that good faith is assumed and bad faith is not tolerated.
