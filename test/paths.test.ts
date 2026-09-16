import { describe, it, expect } from 'vitest'
import { issue, present, verify, unpack, isQredentialError } from '../src/index.js'
import { b64urlJson } from '../src/bytes.js'
import {
  digest,
  makeDisclosure,
  makeElementDisclosure,
  joinCombined,
  splitCombined,
  disclosureLocations,
} from '../src/sdjwt.js'
import { importPrivateKey, sign } from '../src/crypto.js'
import { b64url } from '../src/bytes.js'
import { makeIssuer } from './helpers.js'
import type { QredentialError } from '../src/errors.js'

/**
 * present() selects by path, so a holder can reveal a claim nested in an object or a single element
 * of an array. Before this the selector was a bare claim name, which cannot address either.
 */

/** Build a credential with nested and array disclosure, the way another issuer would. */
async function nested() {
  const issuer = await makeIssuer('https://id.example')

  const street = makeDisclosure('street_address', 'Rua das Flores 10')
  const locality = makeDisclosure('locality', 'Sao Paulo')
  const address = makeDisclosure('address', {
    country: 'BR',
    _sd: [await digest(street.raw), await digest(locality.raw)],
  })
  const br = makeElementDisclosure('BR')
  const pt = makeElementDisclosure('PT')
  const over18 = makeDisclosure('over_18', true)

  const payload = {
    iss: issuer.iss,
    iat: Math.floor(Date.now() / 1000),
    given_name: 'Ana',
    nationalities: [{ '...': await digest(br.raw) }, { '...': await digest(pt.raw) }],
    _sd: [await digest(address.raw), await digest(over18.raw)],
    _sd_alg: 'sha-256',
  }

  const input = `${b64urlJson({ alg: 'ES256', typ: 'dc+sd-jwt', kid: issuer.kid })}.${b64urlJson(payload)}`
  const key = await importPrivateKey(issuer.privateJwk, 'ES256')
  const jwt = `${input}.${b64url(await sign(input, key, 'ES256'))}`

  return {
    issuer,
    payload,
    credential: joinCombined(jwt, [address.raw, locality.raw, street.raw, over18.raw, br.raw, pt.raw]),
    parts: { address, locality, street, over18, br, pt },
  }
}

const open = { acceptWithoutHolderProof: true } as const

describe('paths name every disclosure', () => {
  it('gives each one the place its value lands', async () => {
    const { payload, credential, parts } = await nested()
    const { disclosures } = splitCombined(credential)
    const where = await disclosureLocations(payload, disclosures)

    expect(where.get(parts.over18.raw)?.path).toBe('over_18')
    expect(where.get(parts.address.raw)?.path).toBe('address')
    expect(where.get(parts.locality.raw)?.path).toBe('address.locality')
    expect(where.get(parts.br.raw)?.path).toBe('nationalities[0]')
    expect(where.get(parts.pt.raw)?.path).toBe('nationalities[1]')
  })

  it('records the ancestors a nested disclosure cannot travel without', async () => {
    const { payload, credential, parts } = await nested()
    const { disclosures } = splitCombined(credential)
    const where = await disclosureLocations(payload, disclosures)

    expect(where.get(parts.address.raw)?.requires).toEqual([])
    expect(where.get(parts.locality.raw)?.requires).toEqual([parts.address.raw])
  })
})

describe('present, by path', () => {
  it('reveals a claim nested inside an object', async () => {
    const { issuer, credential } = await nested()
    const presentation = await present(credential, { disclose: ['address.locality'] })

    const result = await verify(presentation, { trust: issuer.trust, ...open })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.claims['address']).toEqual({ country: 'BR', locality: 'Sao Paulo' })
    expect(result.disclosed).toContain('address.locality')
  })

  it('brings the parent along without being asked, because the RFC requires it', async () => {
    const { issuer, credential, parts } = await nested()
    const presentation = await present(credential, { disclose: ['address.locality'] })

    // The address disclosure travels even though only its child was requested.
    const wire = await unpack(presentation)
    expect(wire).toContain(parts.address.raw)
    expect(wire).toContain(parts.locality.raw)
    // And nothing else does.
    expect(wire).not.toContain(parts.street.raw)
    expect(wire).not.toContain(parts.over18.raw)

    const result = await verify(presentation, { trust: issuer.trust, ...open })
    expect(result.ok).toBe(true)
  })

  it('reveals one element of an array and drops the other', async () => {
    const { issuer, credential } = await nested()
    const presentation = await present(credential, { disclose: ['nationalities[1]'] })

    const result = await verify(presentation, { trust: issuer.trust, ...open })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Only PT survives, and it is the whole array now.
    expect(result.claims['nationalities']).toEqual(['PT'])
  })

  it('indices mean the issued position, not the presented one', async () => {
    const { issuer, credential } = await nested()

    // Ask for the second element only. Had indices meant the presented array, [1] would not exist.
    const second = await present(credential, { disclose: ['nationalities[1]'] })
    const r2 = await verify(second, { trust: issuer.trust, ...open })
    expect(r2.ok && r2.claims['nationalities']).toEqual(['PT'])

    const first = await present(credential, { disclose: ['nationalities[0]'] })
    const r1 = await verify(first, { trust: issuer.trust, ...open })
    expect(r1.ok && r1.claims['nationalities']).toEqual(['BR'])
  })

  it('still takes a bare claim name, which is a one segment path', async () => {
    const { issuer, credential } = await nested()
    const presentation = await present(credential, { disclose: ['over_18'] })

    const result = await verify(presentation, { trust: issuer.trust, ...open })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.claims['over_18']).toBe(true)
    expect(result.claims['address']).toBeUndefined()
  })

  it('combines several paths at once', async () => {
    const { issuer, credential } = await nested()
    const presentation = await present(credential, {
      disclose: ['over_18', 'address.street_address', 'nationalities[0]'],
    })

    const result = await verify(presentation, { trust: issuer.trust, ...open })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.claims['over_18']).toBe(true)
    expect(result.claims['address']).toEqual({ country: 'BR', street_address: 'Rua das Flores 10' })
    expect(result.claims['nationalities']).toEqual(['BR'])
  })

  it('refuses a path the credential does not have', async () => {
    const { credential } = await nested()
    for (const bogus of ['address.postcode', 'nationalities[7]', 'nope', 'address']) {
      if (bogus === 'address') continue
      try {
        await present(credential, { disclose: [bogus] })
        throw new Error(`expected ${bogus} to be refused`)
      } catch (error) {
        expect(isQredentialError(error)).toBe(true)
        expect((error as QredentialError).code).toBe('not_disclosable')
      }
    }
  })

  it('an empty selector reveals nothing and still verifies', async () => {
    const { issuer, credential } = await nested()
    const presentation = await present(credential, { disclose: [] })

    const result = await verify(presentation, { trust: issuer.trust, ...open })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.claims['given_name']).toBe('Ana')
    expect(result.claims['address']).toBeUndefined()
    expect(result.claims['nationalities']).toEqual([])
  })

  it('leaves an ordinary credential working exactly as before', async () => {
    const issuer = await makeIssuer('https://id.example')
    const { credential } = await issue({
      issuer: issuer.iss,
      kid: issuer.kid,
      key: issuer.privateJwk,
      claims: { given_name: 'Ana', birth_date: '1991-04-02', over_18: true },
      disclose: ['birth_date', 'over_18'],
    })

    const result = await verify(await present(credential, { disclose: ['over_18'] }), {
      trust: issuer.trust,
      ...open,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.claims['over_18']).toBe(true)
    expect(result.claims['birth_date']).toBeUndefined()
  })
})
