// Scenario: a door, a bar, a vending machine. Something that has to decide whether a person is
// over 18 and has no reason to learn anything else about them, often with no network.
//
//   npm run build && node examples/age-check-at-the-door.mjs
//
// This is the verifier's side. In a real deployment the issuer and the wallet are somebody else's
// problem, so the first half of this file is scaffolding standing in for them, and the part worth
// reading starts at "THE DOOR".

import { issue, present, verify } from '../dist/index.js'
import { randomUUID } from 'node:crypto'

const ISSUER = 'https://id.example.gov'

// ---------------------------------------------------------------- scaffolding: issuer and wallet

const issuerPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const holderPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])

const issuerPrivateJwk = await crypto.subtle.exportKey('jwk', issuerPair.privateKey)
const issuerPublicJwk = await crypto.subtle.exportKey('jwk', issuerPair.publicKey)
const holderPrivateJwk = await crypto.subtle.exportKey('jwk', holderPair.privateKey)
const holderPublicJwk = await crypto.subtle.exportKey('jwk', holderPair.publicKey)

const { credential } = await issue({
  issuer: ISSUER,
  kid: '2026-a',
  key: issuerPrivateJwk,
  claims: {
    given_name: 'Ana',
    family_name: 'Goncalves',
    birth_date: '1991-04-02',
    document_number: 'AR-4471-2298',
    address: 'Rua das Flores 128, Arcadia',
    over_18: true,
  },
  // Everything is disclosable, so the wallet can choose. A claim the issuer does not mark here can
  // never be withheld by anyone, which is the decision that actually protects the holder.
  disclose: ['given_name', 'family_name', 'birth_date', 'document_number', 'address', 'over_18'],
  holderKey: holderPublicJwk,
  expiresIn: '1825d',
})

// ------------------------------------------------------------------------------------- THE DOOR

// 1. The trust list. This is the only thing the door needs from the outside world, and it changes
//    about never, so ship it with the app and refresh it on whatever schedule you like.
const trust = {
  issuers: {
    [ISSUER]: {
      name: 'Example Motor Vehicle Authority',
      keys: [{ kid: '2026-a', alg: 'ES256', jwk: issuerPublicJwk }],
    },
  },
}

// 2. A fresh challenge per scan. This is what stops a photograph of somebody else's screen: the
//    wallet has to sign this exact value, now, with a key it holds. Any unpredictable value works.
const nonce = randomUUID()
const audience = 'https://bar.example/door-3'

// 3. The wallet answers. On a real door this arrives over NFC, BLE, or as a QR the door scans.
const scanned = await present(credential, {
  disclose: ['over_18'],
  keyBinding: { key: holderPrivateJwk, audience, nonce },
})

// 4. The decision. No network, no server, no account.
const started = performance.now()
const result = await verify(scanned, { trust, nonce, audience })
const took = performance.now() - started

if (result.ok && result.claims.over_18 === true) {
  console.log(`\nopen the door  (${took.toFixed(1)} ms)`)
} else {
  // Never just "invalid". The reason is what you log, what you show, and what you act on: an
  // expired licence is a different conversation with the person than a forged one.
  console.log(`\nrefuse  (${result.reason})`)
}

console.log('\nwhat the door learned:', JSON.stringify(result.claims))
console.log('what it did not learn :', ['given_name', 'family_name', 'birth_date', 'document_number', 'address']
  .filter((c) => result.claims[c] === undefined)
  .join(', '))
console.log('holder proved the credential is theirs:', result.holderVerified)

// 5. The same presentation, replayed at a different door. This is the attack the nonce and the
//    audience exist for, and it has to fail.
const elsewhere = await verify(scanned, { trust, nonce, audience: 'https://other.example/door-1' })
console.log('\nsame scan replayed at another door:', elsewhere.ok ? 'ACCEPTED, which is a bug' : `refused (${elsewhere.reason})`)

const later = await verify(scanned, { trust, nonce: randomUUID(), audience })
console.log('same scan replayed with a new challenge:', later.ok ? 'ACCEPTED, which is a bug' : `refused (${later.reason})`)
console.log()
