## What this changes, and why

<!-- Why more than what. The diff already says what. -->

## Does it change what gets accepted?

<!--
Would this make the library accept something it rejects today, or skip a check it performs today?

"No" is a perfectly good answer and most changes are a no. Say it explicitly, because knowing which
pull requests are security relevant is what lets the rest be reviewed quickly.

If yes, say what an attacker gains, and make sure a test carries it out.
-->

## Checks

- [ ] `npm test` passes
- [ ] `npm run typecheck` passes
- [ ] If `src/` changed, `npm run build:site` was run (the playground embeds a copy of the library
      and CI fails when the committed page disagrees with the source)
- [ ] If this fixes a bug, a test reproduces it and fails without the change
- [ ] If this touches interoperability, `test/interop.test.ts` covers it in both directions
- [ ] If this implements something the specification defines, the section is quoted above

## Anything you are unsure about

<!--
Genuinely optional, and genuinely useful. "I could not decide between these two shapes" or "I think
this is right but the spec is ambiguous here" gets you a better review than silence.
-->
