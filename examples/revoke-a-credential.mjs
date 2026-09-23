// Scenario: a licence is suspended, a badge is cancelled, an employee leaves. The credential is
// already in someone's pocket and it is still perfectly signed. How does a verifier with no network
// find out?
//
//   npm run build && node examples/revoke-a-credential.mjs
//
// The answer is a Token Status List: one bit per credential, compressed, signed by the issuer,
// published on a schedule. A verifier caches it and reads one bit offline. A million credentials
// fit in a file small enough to ship with the app.

import { issue, present, verify, createStatusList } from '../dist/index.js'

const ISSUER = 'https://id.example.gov'
const STATUS_URI = 'https://id.example.gov/status/3'
const ANA = 48219 // Ana's index in the list. Assigned at issuance and never reused.
const BRUNO = 90210

const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const issuerPrivateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
const issuerPublicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey)

const trust = {
  issuers: { [ISSUER]: { name: 'Example Authority', keys: [{ kid: '2026-a', alg: 'ES256', jwk: issuerPublicJwk }] } },
}

async function licenceFor(name, idx) {
  const { credential } = await issue({
    issuer: ISSUER,
    kid: '2026-a',
    key: issuerPrivateJwk,
    claims: { given_name: name, over_18: true },
    disclose: ['over_18'],
    status: { idx, uri: STATUS_URI },
    expiresIn: '1825d',
  })
  // No holder key in this example, so presentations carry no proof and the verifier has to be told
  // that is expected. Everything about revocation works the same either way.
  return present(credential, { disclose: ['over_18'] })
}

const ana = await licenceFor('Ana', ANA)
const bruno = await licenceFor('Bruno', BRUNO)

// ------------------------------------------------------------------ the issuer publishes the list

const monday = await createStatusList({
  issuer: ISSUER,
  kid: '2026-a',
  key: issuerPrivateJwk,
  uri: STATUS_URI,
  size: 1_000_000,
  revoked: [],
  expiresIn: '14d',
})

console.log(`\na list covering a million credentials is ${monday.length} characters\n`)

const check = async (label, scanned, list, opts = {}) => {
  const result = await verify(scanned, { trust, status: list, acceptWithoutHolderProof: true, ...opts })
  console.log(`  ${label.padEnd(44)} ${result.ok ? 'accepted' : `refused (${result.reason})`}`)
  return result
}

await check('Ana, before anything happens', ana, monday)
await check('Bruno, before anything happens', bruno, monday)

// ------------------------------------------------------------------------- Ana's licence is pulled

const tuesday = await createStatusList({
  issuer: ISSUER,
  kid: '2026-a',
  key: issuerPrivateJwk,
  uri: STATUS_URI,
  size: 1_000_000,
  revoked: [ANA],
  expiresIn: '14d',
})

console.log()
await check("Ana, against Tuesday's list", ana, tuesday)
await check("Bruno, against Tuesday's list", bruno, tuesday)

// Ana's credential did not change. It is still signed, still unexpired, still hers. Only the list
// moved, and that is the whole point: revocation without reaching the issuer at scan time.

// ------------------------------------------------------------------- the failure modes that matter

console.log('\nthe cases where a quieter library would say yes:\n')

// A verifier that never refreshed its copy is not a verifier that knows the credential is good.
// It is a verifier that knows the credential was good a month ago. Ana was revoked on Tuesday, so
// this list would say she is fine, and the age of the list is the only thing that catches it.
const lastMonth = await createStatusList({
  issuer: ISSUER,
  kid: '2026-a',
  key: issuerPrivateJwk,
  uri: STATUS_URI,
  size: 1_000_000,
  revoked: [],
  issuedAt: Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60,
})
await check('a list 30 days old, with maxStatusAge 7d', ana, lastMonth, { maxStatusAge: '7d' })
await check('the same list, with no maxStatusAge asked for', ana, lastMonth)

// No list at all, when the credential says it has one. Ignoring the pointer would mean every
// revoked credential silently passes.
const noList = await verify(ana, { trust, acceptWithoutHolderProof: true })
console.log(`  ${'no cached list at all'.padEnd(44)} ${noList.ok ? 'accepted' : `refused (${noList.reason})`}`)

console.log()
