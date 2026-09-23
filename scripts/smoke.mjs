// The whole flow, once, on whichever runtime is running this file.
//
//   node scripts/smoke.mjs
//   deno run --allow-read scripts/smoke.mjs
//   bun scripts/smoke.mjs
//
// The README says this library runs on Node, Deno, Bun, browsers and React Native. CI proves the
// Node and browser halves of that with the real suite. This file exists so the other two stop
// being an assertion: it imports the built package and drives issue, present and verify end to
// end, with key binding, which is the path that touches every part of the platform this library
// depends on.
//
// Deliberately no status list. Revocation needs DecompressionStream, which not every runtime has,
// and the README already documents that separately. A failure here should mean the core is broken
// on this runtime, not that one optional global is missing.

import { issue, present, verify } from '../dist/index.js'

const ISSUER = 'https://smoke.example'
const AUDIENCE = 'https://door.example'
const NONCE = 'a-fresh-challenge-from-the-verifier'

const runtime = globalThis.Deno
  ? `Deno ${globalThis.Deno.version.deno}`
  : globalThis.Bun
    ? `Bun ${globalThis.Bun.version}`
    : `Node ${globalThis.process?.versions?.node ?? '?'}`

function check(what, condition) {
  if (!condition) {
    console.error(`FAIL on ${runtime}: ${what}`)
    throw new Error(what)
  }
  console.log(`  ok  ${what}`)
}

const issuerPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
  'sign',
  'verify',
])
const holderPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
  'sign',
  'verify',
])

const issuerPrivate = await crypto.subtle.exportKey('jwk', issuerPair.privateKey)
const issuerPublic = await crypto.subtle.exportKey('jwk', issuerPair.publicKey)
const holderPrivate = await crypto.subtle.exportKey('jwk', holderPair.privateKey)
const holderPublic = await crypto.subtle.exportKey('jwk', holderPair.publicKey)

const trust = {
  issuers: {
    [ISSUER]: { name: 'Smoke Test Authority', keys: [{ kid: 'k1', alg: 'ES256', jwk: issuerPublic }] },
  },
}

console.log(`\nqredential smoke test on ${runtime}\n`)

const { credential } = await issue({
  issuer: ISSUER,
  kid: 'k1',
  key: issuerPrivate,
  claims: { given_name: 'Ana', birth_date: '1991-04-02', over_18: true },
  disclose: ['given_name', 'birth_date', 'over_18'],
  holderKey: holderPublic,
  expiresIn: '365d',
})
check('issued a credential', typeof credential === 'string' && credential.length > 0)

const presentation = await present(credential, {
  disclose: ['over_18'],
  keyBinding: { key: holderPrivate, audience: AUDIENCE, nonce: NONCE },
})
check('presented, disclosing one claim', typeof presentation === 'string')

const result = await verify(presentation, { trust, nonce: NONCE, audience: AUDIENCE })
check('verified', result.ok === true)
check('the disclosed claim is readable', result.claims.over_18 === true)
check('the withheld claims stayed withheld', result.claims.given_name === undefined)
check('the holder proved the credential is theirs', result.holderVerified === true)

// The other half of the promise: it has to refuse, not just accept.
const replayed = await verify(presentation, { trust, nonce: 'a different challenge', audience: AUDIENCE })
check('a replayed presentation is refused', replayed.ok === false)

const wrongDoor = await verify(presentation, { trust, nonce: NONCE, audience: 'https://other.example' })
check('a presentation reused at another verifier is refused', wrongDoor.ok === false)

console.log(`\nall good on ${runtime}\n`)
