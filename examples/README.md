# Examples

Every file here runs on its own. Build once, then run any of them:

```sh
npm install
npm run build
node examples/age-check-at-the-door.mjs
```

They are also checked by CI, so if one of them stops telling the truth the build fails rather than
somebody finding out by pasting it.

| file | the scenario |
|---|---|
| [`age-check-at-the-door.mjs`](age-check-at-the-door.mjs) | A door, a bar, a vending machine. Decide whether somebody is over 18, learn nothing else, with no network. This is the verifier's side and the one most people need first. |
| [`issue-a-credential.mjs`](issue-a-credential.mjs) | You are the authority. The four decisions you make at signing time that nobody can change afterwards, plus rotating your signing key without breaking the credentials already in people's pockets. |
| [`revoke-a-credential.mjs`](revoke-a-credential.mjs) | A licence is pulled while the credential is already in somebody's pocket. How an offline verifier finds out, and the three ways a quieter implementation would fail open instead. |
| [`sizes.mjs`](sizes.mjs) | What a realistic credential actually costs in QR characters. The numbers quoted in the README and on the website come from this file. |

## Two things the numbers show that the prose does not

**A presentation with key binding is bigger than the credential it came from.** Selective disclosure
saves you the claims you withhold, and then the holder's proof adds a signed JWT of its own. In
`issue-a-credential.mjs` the credential is 1245 characters and the presentation showing a single
claim is 1315. That is the price of a photograph of the code being worthless, and it is worth
knowing before you design around a QR version.

**A revocation list covering a million credentials is about 600 characters.** One bit each,
compressed. That is why offline revocation is practical at all, and `revoke-a-credential.mjs`
prints the real number rather than asserting it.

## Missing one?

There is no Deno or Bun example yet, and [issue #24](https://github.com/george-veras/qredential/issues/24)
is open for exactly that. CI proves both runtimes work by running `scripts/smoke.mjs` on them, so
what is missing is the readable version, which is a good first contribution.

If the scenario you need is not here, open an issue describing it. A missing example is usually a
sign the documentation assumed something it should have shown.
