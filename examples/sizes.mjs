// What a realistic credential actually costs in QR characters.
//
// Run it with:  npm run build && node examples/sizes.mjs
//
// The numbers quoted in the README and on the website come from this file, so if you change the
// claim set below you get your own budget rather than mine.

import { issue, present, verify, fits, createStatusList } from '../dist/index.js'

const ISSUER = 'https://id.arcadia.example'
const STATUS_URI = 'https://id.arcadia.example/status/3'
const STATUS_IDX = 48219

const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
  'sign',
  'verify',
])
const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey)

const trust = {
  issuers: {
    [ISSUER]: {
      name: 'Arcadia Motor Vehicle Authority',
      keys: [{ kid: 'arc-2026', alg: 'ES256', jwk: publicJwk }],
    },
  },
}

const claims = {
  given_name: 'ANA LUCIA',
  family_name: 'GONCALVES',
  birth_date: '1991-04-02',
  over_18: true,
  licence_number: 'AR-4471-2298',
  categories: 'AB',
  issued_place: 'ARCADIA CITY',
  issuing_authority: 'AMVA',
}

const base = {
  issuer: ISSUER,
  kid: 'arc-2026',
  key: privateJwk,
  claims,
  vct: 'https://id.arcadia.example/driving-licence',
  expiresIn: '1825d',
  status: { idx: STATUS_IDX, uri: STATUS_URI },
}

const plain = await issue(base)
const selective = await issue({ ...base, disclose: Object.keys(claims) })
const ageOnly = await present(selective.credential, { disclose: ['over_18'] })

const rows = [
  ['everything visible', plain.qr],
  ['all eight claims disclosable', selective.qr],
  ['presenting only over_18', ageOnly],
]

for (const [label, payload] of rows) {
  const fit = fits(payload)
  console.log(
    label.padEnd(30),
    String(payload.length).padStart(5),
    'chars',
    ` QR v${fit.version}`.padEnd(8),
    fit.comfortable ? 'scans fine' : 'too dense'
  )
}

const saved = 100 - (ageOnly.length / selective.qr.length) * 100
console.log(`\nselective disclosure saves ${saved.toFixed(0)}% at presentation time,`)
console.log('because the digests stay in the payload whether the claim is revealed or not.\n')

// Prove the smallest one still verifies, so the numbers above are not measuring something broken.
const statusList = await createStatusList({
  issuer: ISSUER,
  kid: 'arc-2026',
  key: privateJwk,
  uri: STATUS_URI,
  size: 262144,
  revoked: [12, 9001],
})

// This credential is static: no holder key, so nothing can sign at scan time. Saying so is
// required, and the result reports holderVerified: false either way.
const result = await verify(ageOnly, {
  trust,
  status: statusList,
  maxStatusAge: '7d',
  acceptWithoutHolderProof: true,
})
console.log(
  result.ok
    ? `verified offline: ${JSON.stringify(result.claims)}, ${result.withheld} withheld, holder proved: ${result.holderVerified}`
    : `rejected: ${result.reason}`
)
