import { describe, it, expect } from 'vitest'
import { issue, present, verify, fits } from '../src/index.js'
import { unpack, pack } from '../src/envelope.js'
import { splitCombined, joinCombined, makeDisclosure } from '../src/sdjwt.js'
import { makeIssuer, makeStatusList } from './helpers.js'

const CLAIMS = {
  given_name: 'Ana',
  family_name: 'Gonçalves',
  birth_date: '1991-04-02',
  over_18: true,
  document_number: 'BR-4471-22',
}

describe('issue and verify', () => {
  it('verifies a credential with no network access at all', async () => {
    const issuer = await makeIssuer('https://detran.example')
    const { qr } = await issue({
      issuer: issuer.iss,
      kid: issuer.kid,
      key: issuer.privateJwk,
      claims: CLAIMS,
      vct: 'https://detran.example/licence',
      expiresIn: '365d',
    })

    const result = await verify(qr, { trust: issuer.trust })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.claims['given_name']).toBe('Ana')
    expect(result.issuer).toBe('https://detran.example')
    expect(result.revocationChecked).toBe(false)
  })

  it('accepts the raw credential as well as the packed envelope', async () => {
    const issuer = await makeIssuer('https://detran.example')
    const { credential, qr } = await issue({
      issuer: issuer.iss,
      kid: issuer.kid,
      key: issuer.privateJwk,
      claims: CLAIMS,
    })
    expect((await verify(credential, { trust: issuer.trust })).ok).toBe(true)
    expect((await verify(qr, { trust: issuer.trust })).ok).toBe(true)
  })

  it('works with Ed25519 as well as P-256', async () => {
    const issuer = await makeIssuer('https://detran.example', 'ed1', 'EdDSA')
    const { qr } = await issue({
      issuer: issuer.iss,
      kid: issuer.kid,
      alg: 'EdDSA',
      key: issuer.privateJwk,
      claims: CLAIMS,
    })
    expect((await verify(qr, { trust: issuer.trust })).ok).toBe(true)
  })
})

describe('selective disclosure', () => {
  it('reveals only what the holder chose, and hides the rest completely', async () => {
    const issuer = await makeIssuer('https://detran.example')
    const { credential, disclosable } = await issue({
      issuer: issuer.iss,
      kid: issuer.kid,
      key: issuer.privateJwk,
      claims: CLAIMS,
      disclose: ['given_name', 'family_name', 'birth_date', 'over_18', 'document_number'],
    })
    expect(disclosable).toHaveLength(5)

    const presentation = await present(credential, { disclose: ['over_18'] })
    const result = await verify(presentation, { trust: issuer.trust })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.claims['over_18']).toBe(true)
    expect(result.claims['birth_date']).toBeUndefined()
    expect(result.claims['document_number']).toBeUndefined()
    expect(result.disclosed).toEqual(['over_18'])
    expect(result.withheld).toBe(4)

    // The withheld values must not survive anywhere in the transmitted bytes.
    const wire = await unpack(presentation)
    expect(wire).not.toContain('1991-04-02')
    expect(wire).not.toContain('BR-4471-22')
    expect(wire).not.toContain('Gonçalves')
  })

  it('a presentation is smaller than the full credential', async () => {
    const issuer = await makeIssuer('https://detran.example')
    const { credential, qr } = await issue({
      issuer: issuer.iss,
      kid: issuer.kid,
      key: issuer.privateJwk,
      claims: CLAIMS,
      disclose: Object.keys(CLAIMS),
    })
    const presentation = await present(credential, { disclose: ['over_18'] })
    expect(presentation.length).toBeLessThan(qr.length)
  })

  it('refuses to disclose a claim the issuer never made disclosable', async () => {
    const issuer = await makeIssuer('https://detran.example')
    const { credential } = await issue({
      issuer: issuer.iss,
      kid: issuer.kid,
      key: issuer.privateJwk,
      claims: CLAIMS,
      disclose: ['over_18'],
    })
    await expect(present(credential, { disclose: ['birth_date'] })).rejects.toThrow(/cannot disclose/)
  })

  it('refuses to issue with a disclose list naming claims that do not exist', async () => {
    const issuer = await makeIssuer('https://detran.example')
    await expect(
      issue({
        issuer: issuer.iss,
        kid: issuer.kid,
        key: issuer.privateJwk,
        claims: CLAIMS,
        disclose: ['nationality'],
      })
    ).rejects.toThrow(/not in the credential/)
  })
})

describe('attacks', () => {
  it('rejects a tampered payload', async () => {
    const issuer = await makeIssuer('https://detran.example')
    const { credential } = await issue({
      issuer: issuer.iss,
      kid: issuer.kid,
      key: issuer.privateJwk,
      claims: { ...CLAIMS, over_18: false },
    })
    const { jwt, disclosures } = splitCombined(credential)
    const [header, payload, signature] = jwt.split('.')
    const forged = JSON.parse(Buffer.from(payload!, 'base64url').toString())
    forged.over_18 = true
    const tampered = joinCombined(
      `${header}.${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${signature}`,
      disclosures
    )

    const result = await verify(tampered, { trust: issuer.trust })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('bad_signature')
  })

  it('rejects a disclosure the issuer never signed', async () => {
    const issuer = await makeIssuer('https://detran.example')
    const { credential } = await issue({
      issuer: issuer.iss,
      kid: issuer.kid,
      key: issuer.privateJwk,
      claims: CLAIMS,
      disclose: ['over_18'],
    })
    const { jwt, disclosures } = splitCombined(credential)
    const injected = makeDisclosure('security_clearance', 'top-secret')

    const result = await verify(joinCombined(jwt, [...disclosures, injected.raw]), {
      trust: issuer.trust,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('digest_mismatch')
    expect(result.message).toContain('security_clearance')
  })

  it('rejects a credential signed by an issuer that is not on the trust list', async () => {
    const real = await makeIssuer('https://detran.example')
    const impostor = await makeIssuer('https://detran.example')
    const { qr } = await issue({
      issuer: impostor.iss,
      kid: impostor.kid,
      key: impostor.privateJwk,
      claims: CLAIMS,
    })
    const result = await verify(qr, { trust: real.trust })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('bad_signature')
  })

  it('rejects an unknown issuer outright', async () => {
    const issuer = await makeIssuer('https://somewhere-else.example')
    const known = await makeIssuer('https://detran.example')
    const { qr } = await issue({
      issuer: issuer.iss,
      kid: issuer.kid,
      key: issuer.privateJwk,
      claims: CLAIMS,
    })
    const result = await verify(qr, { trust: known.trust })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('unknown_issuer')
  })

  it('does not let the header choose the algorithm', async () => {
    const issuer = await makeIssuer('https://detran.example')
    const { credential } = await issue({
      issuer: issuer.iss,
      kid: issuer.kid,
      key: issuer.privateJwk,
      claims: CLAIMS,
    })
    const { jwt, disclosures } = splitCombined(credential)
    const [header, payload, signature] = jwt.split('.')
    const swapped = { ...JSON.parse(Buffer.from(header!, 'base64url').toString()), alg: 'EdDSA' }
    const result = await verify(
      joinCombined(
        `${Buffer.from(JSON.stringify(swapped)).toString('base64url')}.${payload}.${signature}`,
        disclosures
      ),
      { trust: issuer.trust }
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('unsupported_alg')
  })

  it('rejects an expired credential and honours clock skew', async () => {
    const issuer = await makeIssuer('https://detran.example')
    const { qr } = await issue({
      issuer: issuer.iss,
      kid: issuer.kid,
      key: issuer.privateJwk,
      claims: CLAIMS,
      expiresIn: 10,
    })
    const future = Math.floor(Date.now() / 1000) + 3600
    const late = await verify(qr, { trust: issuer.trust, now: future })
    expect(late.ok).toBe(false)
    if (!late.ok) expect(late.reason).toBe('expired')

    // Just past expiry but inside the skew allowance is still accepted.
    const barely = await verify(qr, { trust: issuer.trust, now: Math.floor(Date.now() / 1000) + 40 })
    expect(barely.ok).toBe(true)
  })

  it('refuses to silently ignore a key binding JWT it cannot check', async () => {
    const issuer = await makeIssuer('https://detran.example')
    const { credential } = await issue({
      issuer: issuer.iss,
      kid: issuer.kid,
      key: issuer.privateJwk,
      claims: CLAIMS,
    })
    const { jwt, disclosures } = splitCombined(credential)
    const withKb = joinCombined(jwt, disclosures, 'aaa.bbb.ccc')
    const result = await verify(withKb, { trust: issuer.trust })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('unsupported_feature')
  })

  it('rejects a replayed disclosure sent twice', async () => {
    const issuer = await makeIssuer('https://detran.example')
    const { credential } = await issue({
      issuer: issuer.iss,
      kid: issuer.kid,
      key: issuer.privateJwk,
      claims: CLAIMS,
      disclose: ['over_18'],
    })
    const { jwt, disclosures } = splitCombined(credential)
    const result = await verify(joinCombined(jwt, [...disclosures, ...disclosures]), {
      trust: issuer.trust,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('digest_mismatch')
  })

  it('rejects a corrupted envelope instead of throwing', async () => {
    const result = await verify('QC1:NOTVALID%%%', { trust: { issuers: {} } })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('malformed')
  })
})

describe('offline revocation', () => {
  const pointer = { idx: 42, uri: 'https://detran.example/status/1' }

  async function issueWithStatus(issuer: Awaited<ReturnType<typeof makeIssuer>>) {
    return issue({
      issuer: issuer.iss,
      kid: issuer.kid,
      key: issuer.privateJwk,
      claims: CLAIMS,
      status: pointer,
    })
  }

  it('clears a credential whose bit is not set', async () => {
    const issuer = await makeIssuer('https://detran.example')
    const { qr } = await issueWithStatus(issuer)
    const status = await makeStatusList(issuer, { size: 1024, revoked: [7, 99], uri: pointer.uri })

    const result = await verify(qr, { trust: issuer.trust, status })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.revocationChecked).toBe(true)
  })

  it('blocks a revoked credential', async () => {
    const issuer = await makeIssuer('https://detran.example')
    const { qr } = await issueWithStatus(issuer)
    const status = await makeStatusList(issuer, { size: 1024, revoked: [42], uri: pointer.uri })

    const result = await verify(qr, { trust: issuer.trust, status })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('revoked')
  })

  it('refuses to answer when no cached list was provided', async () => {
    const issuer = await makeIssuer('https://detran.example')
    const { qr } = await issueWithStatus(issuer)
    const result = await verify(qr, { trust: issuer.trust })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('status_unavailable')
  })

  it('refuses a cached list older than maxStatusAge rather than guessing', async () => {
    const issuer = await makeIssuer('https://detran.example')
    const { qr } = await issueWithStatus(issuer)
    const old = Math.floor(Date.now() / 1000) - 30 * 86400
    const status = await makeStatusList(issuer, { size: 1024, revoked: [], iat: old, uri: pointer.uri })

    const result = await verify(qr, { trust: issuer.trust, status, maxStatusAge: '7d' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('status_list_stale')
  })

  it('rejects a status list signed by someone else', async () => {
    const issuer = await makeIssuer('https://detran.example')
    const forger = await makeIssuer('https://detran.example')
    const { qr } = await issueWithStatus(issuer)
    const status = await makeStatusList(forger, { size: 1024, revoked: [], uri: pointer.uri })

    const result = await verify(qr, { trust: issuer.trust, status })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('bad_signature')
  })
})

describe('fits', () => {
  it('reports a real driving licence as comfortably scannable', async () => {
    const issuer = await makeIssuer('https://detran.example')
    const { qr, bytes } = await issue({
      issuer: issuer.iss,
      kid: issuer.kid,
      key: issuer.privateJwk,
      claims: CLAIMS,
      vct: 'https://detran.example/licence',
      expiresIn: '365d',
      disclose: ['birth_date', 'document_number'],
    })

    const fit = fits(qr)
    expect(bytes).toBe(qr.length)
    expect(fit.version).not.toBeNull()
    expect(fit.comfortable).toBe(true)
  })

  it('says so plainly when nothing will hold the payload', () => {
    const fit = fits('A'.repeat(9000))
    expect(fit.version).toBeNull()
    expect(fit.advice).toContain('does not fit')
  })
})

describe('createStatusList', () => {
  it('produces a list the verifier agrees with, in both directions', async () => {
    const issuer = await makeIssuer('https://detran.example')
    const { createStatusList } = await import('../src/index.js')
    const { qr } = await issue({
      issuer: issuer.iss,
      kid: issuer.kid,
      key: issuer.privateJwk,
      claims: CLAIMS,
      status: { idx: 700, uri: 'https://detran.example/status/1' },
    })

    const clean = await createStatusList({
      issuer: issuer.iss,
      kid: issuer.kid,
      key: issuer.privateJwk,
      uri: 'https://detran.example/status/1',
      size: 1024,
      revoked: [12, 999],
    })
    expect((await verify(qr, { trust: issuer.trust, status: clean })).ok).toBe(true)

    const revoked = await createStatusList({
      issuer: issuer.iss,
      kid: issuer.kid,
      key: issuer.privateJwk,
      uri: 'https://detran.example/status/1',
      size: 1024,
      revoked: [700],
    })
    const blocked = await verify(qr, { trust: issuer.trust, status: revoked })
    expect(blocked.ok).toBe(false)
    if (blocked.ok) return
    expect(blocked.reason).toBe('revoked')
  })

  it('stays small for a list covering a million credentials', async () => {
    const issuer = await makeIssuer('https://detran.example')
    const { createStatusList } = await import('../src/index.js')
    const token = await createStatusList({
      issuer: issuer.iss,
      kid: issuer.kid,
      key: issuer.privateJwk,
      uri: 'https://detran.example/status/1',
      size: 1_000_000,
      revoked: [1, 5000, 999_999],
    })
    // 125 KB of mostly zero bits, so deflate should leave a few KB at most.
    expect(token.length).toBeLessThan(6000)
  })

  it('refuses an index outside the list rather than corrupting a neighbour', async () => {
    const issuer = await makeIssuer('https://detran.example')
    const { createStatusList } = await import('../src/index.js')
    await expect(
      createStatusList({
        issuer: issuer.iss,
        kid: issuer.kid,
        key: issuer.privateJwk,
        uri: 'https://detran.example/status/1',
        size: 100,
        revoked: [500],
      })
    ).rejects.toThrow(/outside a list of 100/)
  })
})

describe('claims are the subject, not the token', () => {
  it('keeps registered claims out of claims and surfaces them as fields', async () => {
    const issuer = await makeIssuer('https://detran.example')
    const { qr } = await issue({
      issuer: issuer.iss,
      kid: issuer.kid,
      key: issuer.privateJwk,
      claims: CLAIMS,
      vct: 'https://detran.example/licence',
      subject: 'did:example:ana',
      expiresIn: '365d',
    })

    const result = await verify(qr, { trust: issuer.trust })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    // Everything in claims belongs to the person, so looping over it is safe.
    expect(Object.keys(result.claims).sort()).toEqual(Object.keys(CLAIMS).sort())
    for (const registered of ['iss', 'iat', 'exp', 'vct', 'sub', 'status', '_sd', '_sd_alg']) {
      expect(result.claims[registered]).toBeUndefined()
    }

    // And none of it is lost: each one has a typed home.
    expect(result.issuer).toBe('https://detran.example')
    expect(result.vct).toBe('https://detran.example/licence')
    expect(result.subject).toBe('did:example:ana')
    expect(typeof result.issuedAt).toBe('number')
    expect(typeof result.expiresAt).toBe('number')
  })
})
