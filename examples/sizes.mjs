import { issue, present, verify, fits } from '../dist/index.js'

const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const priv = await crypto.subtle.exportKey('jwk', pair.privateKey)
const pub = await crypto.subtle.exportKey('jwk', pair.publicKey)
const iss = 'https://detran.sp.gov.br'
const trust = { issuers: { [iss]: { keys: [{ kid: 'k1', alg: 'ES256', jwk: pub }] } } }

const claims = {
  vct: undefined,
  given_name: 'Ana Lucia',
  family_name: 'Goncalves',
  birth_date: '1991-04-02',
  over_18: true,
  document_number: 'SP-4471-2298',
  categories: 'AB',
  issued_place: 'Sao Paulo',
}
delete claims.vct

const full = await issue({
  issuer: iss, kid: 'k1', key: priv, claims,
  vct: 'https://detran.sp.gov.br/cnh', expiresIn: '1825d',
  status: { idx: 991_220, uri: 'https://detran.sp.gov.br/status/3' },
})

const sd = await issue({
  issuer: iss, kid: 'k1', key: priv, claims,
  vct: 'https://detran.sp.gov.br/cnh', expiresIn: '1825d',
  disclose: Object.keys(claims),
  status: { idx: 991_220, uri: 'https://detran.sp.gov.br/status/3' },
})
const age = await present(sd.credential, { disclose: ['over_18'] })

const rows = [
  ['licenca completa, tudo visivel', full.qr],
  ['licenca completa com disclosure', sd.qr],
  ['so prova de maioridade', age],
]
for (const [label, s] of rows) {
  const f = fits(s)
  console.log(`${label.padEnd(34)} ${String(s.length).padStart(5)} chars  QR v${f.version} (${f.errorCorrection})  ${f.comfortable ? 'ok' : 'DENSO'}`)
}
console.log()
console.log('ganho da divulgacao seletiva:', (100 - (age.length / sd.qr.length) * 100).toFixed(0) + '% menor')
const r = await verify(age, { trust })
console.log('verifica offline sem lista de status:', r.ok === false ? r.reason : 'ok')
