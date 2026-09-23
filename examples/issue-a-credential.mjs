// Scenario: you are the authority. You sign the thing. The decisions you make here are the ones
// nobody can change later, so they are worth more thought than the verifier's side.
//
//   npm run build && node examples/issue-a-credential.mjs
//
// Four decisions, in the order they matter: what may be withheld, whose device the credential is
// tied to, how you will revoke it, and whether the result still fits in a code somebody can scan.

import { issue, present, verify, fits, createStatusList } from '../dist/index.js'

const ISSUER = 'https://id.example.gov'

const key2026 = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const key2027 = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const holder = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])

const jwk = async (k) => crypto.subtle.exportKey('jwk', k)

// ------------------------------------------------------- decision 1: what the holder may withhold

const claims = {
  given_name: 'Ana',
  family_name: 'Goncalves',
  birth_date: '1991-04-02',
  document_number: 'AR-4471-2298',
  categories: 'AB',
  over_18: true,
}

// A claim you leave out of `disclose` is permanently visible in every presentation. A claim you put
// in can be withheld by the holder, at the cost of a digest and a salt in the payload. This is the
// privacy decision, and it is yours, not the wallet's: the wallet can only choose among what you
// allowed.
const disclosable = ['birth_date', 'document_number', 'categories', 'over_18']

// ---------------------------------------------- decisions 2 and 3: holder binding, and revocation

const { credential, qr } = await issue({
  issuer: ISSUER,
  kid: '2026-a',
  key: await jwk(key2026.privateKey),
  claims,
  disclose: disclosable,

  // Ties the credential to a key that lives in the holder's device and never leaves it. Without
  // this, a photograph of the code is as good as the code. Leave it out only for something printed
  // on paper, where nothing can sign at scan time and you have accepted what that costs.
  holderKey: await jwk(holder.publicKey),

  // Where the verifier will look to find out if you pulled it. The index is this credential's
  // position in your published list. Assign it now, keep it forever, never reuse it.
  status: { idx: 48219, uri: 'https://id.example.gov/status/3' },

  expiresIn: '1825d',
})

// ------------------------------------------------ decision 4: does it fit in something scannable?

const budget = fits(qr)
console.log(`\nthe issued credential is ${qr.length} characters, QR version ${budget.version}`)
console.log(budget.comfortable
  ? 'that scans comfortably on a phone camera'
  : 'that is dense: expect slow scans in poor light, and consider fewer disclosable claims')

const presentation = await present(credential, {
  disclose: ['over_18'],
  keyBinding: { key: await jwk(holder.privateKey), audience: 'https://bar.example/door', nonce: 'n-1' },
})
console.log(`a presentation showing one claim is ${presentation.length} characters, QR version ${fits(presentation).version}`)

// --------------------------------------------------------------- rotating your signing key safely

// You will change signing keys. The credentials you already issued are still out there, signed by
// the old one, and they have to keep working until they expire. The trust list is what makes that
// a non-event: it holds every key that is still allowed to be trusted, and the credential names
// which one signed it in `kid`.
const trust = {
  issuers: {
    [ISSUER]: {
      name: 'Example Motor Vehicle Authority',
      keys: [
        { kid: '2026-a', alg: 'ES256', jwk: await jwk(key2026.publicKey) },
        { kid: '2027-a', alg: 'ES256', jwk: await jwk(key2027.publicKey) },
      ],
    },
  },
}

// The credential carries a status pointer, so the verifier needs the published list too. Leaving
// it out is not a shortcut: verification refuses with status_unavailable rather than skipping a
// check the credential asked for.
const statusList = await createStatusList({
  issuer: ISSUER,
  kid: '2026-a',
  key: await jwk(key2026.privateKey),
  uri: 'https://id.example.gov/status/3',
  size: 1_000_000,
  revoked: [],
  expiresIn: '14d',
})

const at = { trust, status: statusList, nonce: 'n-1', audience: 'https://bar.example/door' }
const stillGood = await verify(presentation, at)
console.log(`\ncredential signed with the 2026 key, verified against a trust list holding both: ${stillGood.ok ? 'accepted' : `refused (${stillGood.reason})`}`)

// And what retiring the old key actually means: drop it from the published trust list, and every
// credential it signed stops verifying the moment verifiers pick up the new list. That is the
// emergency lever if a signing key is ever compromised, and it is blunt on purpose.
const rotated = {
  issuers: {
    [ISSUER]: { name: 'Example Motor Vehicle Authority', keys: [{ kid: '2027-a', alg: 'ES256', jwk: await jwk(key2027.publicKey) }] },
  },
}
const afterRetiring = await verify(presentation, { ...at, trust: rotated })
console.log(`the same credential, after the 2026 key is retired from the list: ${afterRetiring.ok ? 'accepted' : `refused (${afterRetiring.reason})`}`)
console.log()
