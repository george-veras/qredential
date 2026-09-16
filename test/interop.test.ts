import { describe, it, expect, beforeAll } from 'vitest'
import { SDJwtInstance } from '@sd-jwt/core'
import { issue, present, verify } from '../src/index.js'
import { digest } from '../src/sdjwt.js'
import { b64url, unb64url, utf8 } from '../src/bytes.js'
import { sha256 } from '../src/crypto.js'
import type { Jwk, TrustList } from '../src/types.js'

/**
 * Differential testing against an independent implementation of RFC 9901.
 *
 * Every other test in this repository verifies something this library produced, which means none of
 * them can find a place where this library is self consistent and wrong. The reference
 * implementation here was written by other people from the same specification, so a disagreement is
 * a bug in one of the two.
 *
 * Their crypto adapter is bypassed on purpose: signing is bridged to the same WebCrypto this
 * library uses, so what is being compared is the SD-JWT layer and nothing else.
 */

const ISSUER = 'https://ref.example'
const KID = 'ref-1'

let theirs: SDJwtInstance<Record<string, unknown>>
let trust: TrustList
let privateJwk: Jwk

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair
  privateJwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as Jwk
  const publicJwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as Jwk
  trust = { issuers: { [ISSUER]: { keys: [{ kid: KID, alg: 'ES256', jwk: publicJwk }] } } }

  theirs = new SDJwtInstance({
    signer: async (data: string) =>
      b64url(
        new Uint8Array(
          await crypto.subtle.sign(
            { name: 'ECDSA', hash: 'SHA-256' },
            pair.privateKey,
            utf8(data) as BufferSource
          )
        )
      ),
    verifier: async (data: string, sig: string) =>
      crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        pair.publicKey,
        unb64url(sig) as BufferSource,
        utf8(data) as BufferSource
      ),
    signAlg: 'ES256',
    hasher: async (data: string | ArrayBuffer) =>
      sha256(typeof data === 'string' ? utf8(data) : new Uint8Array(data)),
    saltGenerator: () => b64url(crypto.getRandomValues(new Uint8Array(16))),
    hashAlg: 'sha-256',
  })
})

const CLAIMS = {
  iss: ISSUER,
  iat: Math.floor(Date.now() / 1000),
  given_name: 'Ana',
  family_name: 'Gonçalves',
  birth_date: '1991-04-02',
  over_18: true,
}

describe('their credential, our verifier', () => {
  it('verifies, with the claims they put in', async () => {
    const credential = await theirs.issue(CLAIMS, { _sd: ['birth_date', 'over_18'] })

    const result = await verify(credential, { trust, acceptWithoutHolderProof: true })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.claims['given_name']).toBe('Ana')
    expect(result.claims['family_name']).toBe('Gonçalves')
    expect(result.claims['birth_date']).toBe('1991-04-02')
    expect(result.claims['over_18']).toBe(true)
    expect(result.withheld).toBe(0)
  })

  it('verifies a narrowed presentation they produced, and counts what is missing', async () => {
    const credential = await theirs.issue(CLAIMS, { _sd: ['birth_date', 'over_18'] })
    const presentation = await theirs.present(credential, { over_18: true })

    const result = await verify(presentation, { trust, acceptWithoutHolderProof: true })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.claims['over_18']).toBe(true)
    expect(result.claims['birth_date']).toBeUndefined()
    expect(result.disclosed).toEqual(['over_18'])
    expect(result.withheld).toBe(1)
  })

  it('refuses one of their credentials when a disclosure is tampered with', async () => {
    const credential = await theirs.issue(CLAIMS, { _sd: ['over_18'] })
    const parts = credential.split('~')
    const forged = b64url(utf8(JSON.stringify(['saltsaltsalt', 'over_18', true])))
    const tampered = [parts[0], forged, ''].join('~')

    const result = await verify(tampered, { trust, acceptWithoutHolderProof: true })
    expect(result.ok).toBe(false)
  })
})

describe('our credential, their verifier', () => {
  it('verifies, with the claims we put in', async () => {
    const { credential } = await issue({
      issuer: ISSUER,
      kid: KID,
      key: privateJwk,
      claims: { given_name: 'Ana', family_name: 'Gonçalves', birth_date: '1991-04-02', over_18: true },
      disclose: ['birth_date', 'over_18'],
    })

    const decoded = (await theirs.verify(credential)) as { payload: Record<string, unknown> }
    expect(decoded.payload['given_name']).toBe('Ana')
    expect(decoded.payload['family_name']).toBe('Gonçalves')
    expect(decoded.payload['birth_date']).toBe('1991-04-02')
    expect(decoded.payload['over_18']).toBe(true)
  })

  it('verifies a narrowed presentation we produced', async () => {
    const { credential } = await issue({
      issuer: ISSUER,
      kid: KID,
      key: privateJwk,
      claims: { given_name: 'Ana', birth_date: '1991-04-02', over_18: true },
      disclose: ['birth_date', 'over_18'],
    })
    const presentation = await present(credential, { disclose: ['over_18'] })
    const raw = await import('../src/envelope.js').then((m) => m.unpack(presentation))

    const decoded = (await theirs.verify(raw)) as { payload: Record<string, unknown> }
    expect(decoded.payload['over_18']).toBe(true)
    expect(decoded.payload['birth_date']).toBeUndefined()
    expect(decoded.payload['given_name']).toBe('Ana')
  })

  it('rejects one of ours after we tamper with it', async () => {
    const { credential } = await issue({
      issuer: ISSUER,
      kid: KID,
      key: privateJwk,
      claims: { over_18: true },
    })
    const parts = credential.split('.')
    const forged = b64url(utf8(JSON.stringify({ iss: ISSUER, over_18: true, extra: 'injected' })))

    await expect(theirs.verify(`${parts[0]}.${forged}.${parts[2]}`)).rejects.toThrow()
  })
})

describe('the two implementations agree on the primitives', () => {
  it('computes the same digest for the same disclosure string', async () => {
    const credential = await theirs.issue(CLAIMS, { _sd: ['birth_date', 'over_18'] })
    const [jwt, ...rest] = credential.split('~')
    const disclosures = rest.filter((d) => d !== '')

    const payload = JSON.parse(new TextDecoder().decode(unb64url(jwt!.split('.')[1]!))) as {
      _sd: string[]
    }

    // Their issuer put these digests in the payload. Ours has to arrive at the same values from the
    // same disclosure strings, or nothing else in this file could have passed.
    for (const raw of disclosures) {
      expect(payload._sd).toContain(await digest(raw))
    }
    expect(disclosures.length).toBe(2)
  })

  it('agrees on the shape of the combined form', async () => {
    const credential = await theirs.issue(CLAIMS, { _sd: ['over_18'] })
    const { credential: ours } = await issue({
      issuer: ISSUER,
      kid: KID,
      key: privateJwk,
      claims: { over_18: true },
      disclose: ['over_18'],
    })

    for (const c of [credential, ours]) {
      expect(c.endsWith('~')).toBe(true)
      expect(c.split('~').length).toBe(3)
      expect(c.split('~')[0]!.split('.').length).toBe(3)
    }
  })
})

describe('nested and array selective disclosure, across implementations', () => {
  const NESTED = {
    iss: ISSUER,
    iat: Math.floor(Date.now() / 1000),
    given_name: 'Ana',
    address: {
      street_address: 'Rua das Flores 10',
      locality: 'Sao Paulo',
      country: 'BR',
    },
    nationalities: ['BR', 'PT'],
  }

  it('reads a credential where they hid a property inside an object', async () => {
    const credential = await theirs.issue(NESTED, {
      address: { _sd: ['street_address', 'locality'] },
    })

    const result = await verify(credential, { trust, acceptWithoutHolderProof: true })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.claims['address']).toEqual({
      street_address: 'Rua das Flores 10',
      locality: 'Sao Paulo',
      country: 'BR',
    })
    // And no _sd leaks into what the caller sees.
    expect(JSON.stringify(result.claims)).not.toContain('_sd')
  })

  it('reads a narrowed presentation of that nested credential', async () => {
    const credential = await theirs.issue(NESTED, {
      address: { _sd: ['street_address', 'locality'] },
    })
    const presentation = await theirs.present(credential, {
      address: { locality: true },
    })

    const result = await verify(presentation, { trust, acceptWithoutHolderProof: true })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.claims['address']).toEqual({ locality: 'Sao Paulo', country: 'BR' })
    expect(result.disclosed).toContain('address.locality')
    expect(result.withheld).toBe(1)
  })

  it('reads array element disclosures they produced', async () => {
    const credential = await theirs.issue(NESTED, {
      nationalities: { _sd: [0, 1] },
    })

    const result = await verify(credential, { trust, acceptWithoutHolderProof: true })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.claims['nationalities']).toEqual(['BR', 'PT'])
    expect(JSON.stringify(result.claims)).not.toContain('...')
  })

  it('drops the array elements the holder withheld, and keeps the order of the rest', async () => {
    const credential = await theirs.issue(NESTED, {
      nationalities: { _sd: [0, 1] },
    })
    const presentation = await theirs.present(credential, {
      nationalities: [true, false],
    })

    const result = await verify(presentation, { trust, acceptWithoutHolderProof: true })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.claims['nationalities']).toEqual(['BR'])
    expect(result.withheld).toBe(1)
  })

  it('reads a recursive disclosure, where revealing one value uncovers another', async () => {
    const credential = await theirs.issue(NESTED, {
      _sd: ['address'],
      address: { _sd: ['street_address'] },
    })

    const result = await verify(credential, { trust, acceptWithoutHolderProof: true })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.claims['address']).toEqual({
      street_address: 'Rua das Flores 10',
      locality: 'Sao Paulo',
      country: 'BR',
    })
  })
})

describe('path selection works on their credentials too', () => {
  it('reveals one element of an array they issued, and they verify the result', async () => {
    const credential = await theirs.issue(
      {
        iss: ISSUER,
        iat: Math.floor(Date.now() / 1000),
        given_name: 'Ana',
        nationalities: ['BR', 'PT', 'JP'],
      },
      { nationalities: { _sd: [0, 1, 2] } }
    )

    const presentation = await present(credential, { disclose: ['nationalities[1]'] })
    const raw = await import('../src/envelope.js').then((m) => m.unpack(presentation))

    // Ours narrowed it. Theirs reads it back.
    const decoded = (await theirs.verify(raw)) as { payload: Record<string, unknown> }
    expect(decoded.payload['nationalities']).toEqual(['PT'])

    const mine = await verify(presentation, { trust, acceptWithoutHolderProof: true })
    expect(mine.ok).toBe(true)
    if (!mine.ok) return
    expect(mine.claims['nationalities']).toEqual(['PT'])
  })

  it('reveals a claim nested in an object they issued, parent included automatically', async () => {
    const credential = await theirs.issue(
      {
        iss: ISSUER,
        iat: Math.floor(Date.now() / 1000),
        given_name: 'Ana',
        address: { street_address: 'Rua das Flores 10', locality: 'Sao Paulo', country: 'BR' },
      },
      { _sd: ['address'], address: { _sd: ['street_address', 'locality'] } }
    )

    const presentation = await present(credential, { disclose: ['address.locality'] })
    const raw = await import('../src/envelope.js').then((m) => m.unpack(presentation))

    const decoded = (await theirs.verify(raw)) as { payload: Record<string, unknown> }
    expect(decoded.payload['address']).toEqual({ locality: 'Sao Paulo', country: 'BR' })

    const mine = await verify(presentation, { trust, acceptWithoutHolderProof: true })
    expect(mine.ok).toBe(true)
    if (!mine.ok) return
    expect(mine.claims['address']).toEqual({ locality: 'Sao Paulo', country: 'BR' })
  })
})
