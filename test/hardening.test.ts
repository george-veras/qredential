import { describe, it, expect } from 'vitest'
import { issue, present, verify, createStatusList, unpack } from '../src/index.js'
import { unb64url, b64urlJson } from '../src/bytes.js'
import { digest, makeDisclosure, reconstructClaims, splitCombined, joinCombined } from '../src/sdjwt.js'
import { makeIssuer } from './helpers.js'
import type { QredentialError } from '../src/errors.js'

const CLAIMS = { given_name: 'Ana', birth_date: '1991-04-02', over_18: true }
const POINTER = { idx: 42, uri: 'https://detran.example/status/1' }

async function issuerWithStatus() {
  const issuer = await makeIssuer('https://detran.example')
  const { qr } = await issue({
    issuer: issuer.iss,
    kid: issuer.kid,
    key: issuer.privateJwk,
    claims: CLAIMS,
    status: POINTER,
  })
  return { issuer, qr }
}

describe('the cached status list has to be the right one', () => {
  it('refuses an index that falls outside the list instead of calling it checked', async () => {
    const issuer = await makeIssuer('https://detran.example')
    const { qr } = await issue({
      issuer: issuer.iss,
      kid: issuer.kid,
      key: issuer.privateJwk,
      claims: CLAIMS,
      status: { idx: 900_000, uri: POINTER.uri },
    })
    const short = await createStatusList({
      issuer: issuer.iss,
      kid: issuer.kid,
      key: issuer.privateJwk,
      uri: POINTER.uri,
      size: 1024,
    })

    const result = await verify(qr, { acceptWithoutHolderProof: true, trust: issuer.trust, status: short })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('status_unavailable')
    expect(result.message).toContain('outside')
  })

  it('refuses a list published by a different issuer, even a trusted one', async () => {
    const { issuer, qr } = await issuerWithStatus()
    const other = await makeIssuer('https://elsewhere.example')

    // Both issuers are trusted. Without binding, either list would clear either credential.
    const trust = {
      issuers: { ...issuer.trust.issuers, ...other.trust.issuers },
    }
    const foreign = await createStatusList({
      issuer: other.iss,
      kid: other.kid,
      key: other.privateJwk,
      uri: POINTER.uri,
      size: 1024,
    })

    const result = await verify(qr, { acceptWithoutHolderProof: true, trust, status: foreign })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('status_unavailable')
    expect(result.message).toContain('elsewhere.example')
  })

  it('refuses a list for a different uri, because index 42 means something else in each one', async () => {
    const { issuer, qr } = await issuerWithStatus()
    const wrongList = await createStatusList({
      issuer: issuer.iss,
      kid: issuer.kid,
      key: issuer.privateJwk,
      uri: 'https://detran.example/status/9',
      size: 1024,
      revoked: [],
    })

    const result = await verify(qr, { acceptWithoutHolderProof: true, trust: issuer.trust, status: wrongList })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('status_unavailable')
    expect(result.message).toContain('status/9')
  })
})

describe('a disclosure describes the subject, never the token', () => {
  it('rejects a disclosure that names a registered claim, even correctly signed', async () => {
    const issuer = await makeIssuer('https://detran.example')
    // issue() will happily sign this: `iss` is in claims and listed as disclosable, so it ends up
    // as a signed digest rather than in the payload. The verifier is what must refuse it.
    const { qr } = await issue({
      issuer: issuer.iss,
      kid: issuer.kid,
      key: issuer.privateJwk,
      claims: { ...CLAIMS, iss: 'https://impostor.example' },
      disclose: ['iss'],
    })

    const result = await verify(qr, { acceptWithoutHolderProof: true, trust: issuer.trust })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('digest_mismatch')
    expect(result.message).toContain('registered claim')
  })

  it('rejects a disclosure that collides with a claim already in the payload', async () => {
    const d = makeDisclosure('given_name', 'Someone Else')
    const payload = { given_name: 'Ana', _sd: [await digest(d.raw)], _sd_alg: 'sha-256' }

    await expect(reconstructClaims(payload, [d.raw])).rejects.toThrow(/collides/)
  })
})

describe('the combined form is parsed strictly', () => {
  it('rejects a bare JWT with no separator', async () => {
    const issuer = await makeIssuer('https://detran.example')
    const { credential } = await issue({
      issuer: issuer.iss,
      kid: issuer.kid,
      key: issuer.privateJwk,
      claims: CLAIMS,
    })
    const bare = credential.replace(/~+$/, '')
    expect(bare).not.toContain('~')

    const result = await verify(bare, { acceptWithoutHolderProof: true, trust: issuer.trust })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('malformed')
    expect(result.message).toContain('separator')
  })

  it('still accepts the same credential with its separator', async () => {
    const issuer = await makeIssuer('https://detran.example')
    const { credential } = await issue({
      issuer: issuer.iss,
      kid: issuer.kid,
      key: issuer.privateJwk,
      claims: CLAIMS,
    })
    expect((await verify(credential, { acceptWithoutHolderProof: true, trust: issuer.trust })).ok).toBe(true)
  })
})

describe('base64url is decoded strictly', () => {
  it('rejects characters outside the alphabet rather than dropping them', () => {
    // Before this was fixed the invalid characters were stripped first, so this decoded as "abcd"
    // and the validation below it was unreachable.
    expect(() => unb64url('ab!!cd')).toThrow(/invalid base64url character/)
    expect(() => unb64url('ab cd')).toThrow(/invalid base64url character/)
    expect(() => unb64url('ab+cd')).toThrow(/invalid base64url character/)
  })

  it('still decodes clean input', () => {
    expect(Array.from(unb64url('AAEC'))).toEqual([0, 1, 2])
  })
})

describe('the digest order is shuffled with a cryptographic source', () => {
  it('does not reproduce the claim order, across repeated issuance', async () => {
    const issuer = await makeIssuer('https://detran.example')
    const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    const claims = Object.fromEntries(names.map((n, i) => [n, i]))

    // Map each credential's _sd order back to claim names, then count distinct permutations.
    const orders = new Set<string>()
    for (let run = 0; run < 12; run++) {
      const { credential } = await issue({
        issuer: issuer.iss,
        kid: issuer.kid,
        key: issuer.privateJwk,
        claims,
        disclose: names,
      })
      const { jwt, disclosures } = splitCombined(credential)
      const payload = JSON.parse(
        new TextDecoder().decode(unb64url(jwt.split('.')[1]!))
      ) as { _sd: string[] }

      const byDigest = new Map<string, string>()
      for (const raw of disclosures) {
        byDigest.set(await digest(raw), JSON.parse(new TextDecoder().decode(unb64url(raw)))[1])
      }
      orders.add(payload._sd.map((d) => byDigest.get(d)).join(''))
    }

    // Twelve draws from 8! permutations landing on one value would mean the shuffle is not running.
    expect(orders.size).toBeGreaterThan(6)
  })
})

describe('selective disclosure this version cannot resolve is refused, not ignored', () => {
  /** Build a credential by hand, the way another implementation would shape one. */
  async function handBuilt(payloadExtra: Record<string, unknown>, disclosures: string[]) {
    const issuer = await makeIssuer('https://eu.example')
    const header = { alg: 'ES256', typ: 'dc+sd-jwt', kid: issuer.kid }
    const payload = {
      iss: issuer.iss,
      iat: Math.floor(Date.now() / 1000),
      given_name: 'Ana',
      _sd_alg: 'sha-256',
      ...payloadExtra,
    }
    const { importPrivateKey, sign } = await import('../src/crypto.js')
    const { b64url } = await import('../src/bytes.js')
    const input = `${b64urlJson(header)}.${b64urlJson(payload)}`
    const key = await importPrivateKey(issuer.privateJwk, 'ES256')
    const jwt = `${input}.${b64url(await sign(input, key, 'ES256'))}`
    return { issuer, credential: joinCombined(jwt, disclosures) }
  }

  it('refuses nested _sd rather than handing back a digest blob to display', async () => {
    const street = makeDisclosure('street_address', 'Rua das Flores 10')
    const top = makeDisclosure('over_18', true)
    const { issuer, credential } = await handBuilt(
      {
        address: { country: 'BR', _sd: [await digest(street.raw)] },
        _sd: [await digest(top.raw)],
      },
      [top.raw]
    )

    const result = await verify(credential, { acceptWithoutHolderProof: true, trust: issuer.trust })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('unsupported_feature')
    expect(result.message).toContain('address._sd')
  })

  it('refuses array element disclosure for the same reason', async () => {
    const tag = makeDisclosure('nationality', 'BR')
    const top = makeDisclosure('over_18', true)
    const { issuer, credential } = await handBuilt(
      {
        nationalities: [{ '...': await digest(tag.raw) }],
        _sd: [await digest(top.raw)],
      },
      [top.raw]
    )

    const result = await verify(credential, { acceptWithoutHolderProof: true, trust: issuer.trust })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('unsupported_feature')
    expect(result.message).toContain('nationalities')
  })

  it('leaves ordinary nested objects and arrays alone', async () => {
    const issuer = await makeIssuer('https://detran.example')
    const { qr } = await issue({
      issuer: issuer.iss,
      kid: issuer.kid,
      key: issuer.privateJwk,
      claims: {
        given_name: 'Ana',
        address: { country: 'BR', city: 'Sao Paulo' },
        categories: ['A', 'B'],
      },
    })

    const result = await verify(qr, { acceptWithoutHolderProof: true, trust: issuer.trust })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.claims['address']).toEqual({ country: 'BR', city: 'Sao Paulo' })
    expect(result.claims['categories']).toEqual(['A', 'B'])
  })
})
