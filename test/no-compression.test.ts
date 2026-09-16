import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { issue, present, verify, pack, unpack, createStatusList, isQredentialError } from '../src/index.js'
import { makeIssuer } from './helpers.js'
import type { QredentialError } from '../src/errors.js'

/**
 * The React Native path, tested by taking the platform away.
 *
 * React Native has no CompressionStream or DecompressionStream, and the README claims the library
 * runs there. That claim cannot be checked in CI by running React Native, but it can be checked by
 * deleting the two globals the platform is missing and seeing what still works.
 */

const saved: Record<string, unknown> = {}

beforeAll(() => {
  saved['CompressionStream'] = (globalThis as Record<string, unknown>)['CompressionStream']
  saved['DecompressionStream'] = (globalThis as Record<string, unknown>)['DecompressionStream']
  delete (globalThis as Record<string, unknown>)['CompressionStream']
  delete (globalThis as Record<string, unknown>)['DecompressionStream']
})

afterAll(() => {
  ;(globalThis as Record<string, unknown>)['CompressionStream'] = saved['CompressionStream']
  ;(globalThis as Record<string, unknown>)['DecompressionStream'] = saved['DecompressionStream']
})

describe('without CompressionStream, as on React Native', () => {
  it('issues, presents and verifies a credential end to end', async () => {
    const issuer = await makeIssuer('https://detran.example')
    const { credential, qr } = await issue({
      issuer: issuer.iss,
      kid: issuer.kid,
      key: issuer.privateJwk,
      claims: { given_name: 'Ana', birth_date: '1991-04-02', over_18: true },
      disclose: ['birth_date', 'over_18'],
      expiresIn: '365d',
    })

    const presentation = await present(credential, { disclose: ['over_18'] })
    const result = await verify(presentation, { acceptWithoutHolderProof: true, trust: issuer.trust })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.claims['over_18']).toBe(true)
    expect(result.claims['birth_date']).toBeUndefined()

    // The envelope simply stays uncompressed, which the flag byte records.
    expect(qr.startsWith('QC1:')).toBe(true)
    expect(await unpack(qr)).toBe(credential)
  })

  it('costs size, which is the honest trade rather than a hidden one', async () => {
    const repetitive = 'a'.repeat(2000)
    const packed = await pack(repetitive)
    // With compression this shrinks by more than an order of magnitude. Without it, base45 expands.
    expect(packed.length).toBeGreaterThan(repetitive.length)
  })

  it('says plainly that it cannot read a credential compressed elsewhere', async () => {
    // A credential packed by a server that does have compression. Both globals have to come back
    // for the pack, because hasCompression() requires the pair before it will take that path.
    const g = globalThis as Record<string, unknown>
    g['CompressionStream'] = saved['CompressionStream']
    g['DecompressionStream'] = saved['DecompressionStream']
    const compressed = await pack('x'.repeat(3000))
    delete g['CompressionStream']
    delete g['DecompressionStream']

    try {
      await unpack(compressed)
      throw new Error('should have refused')
    } catch (error) {
      expect(isQredentialError(error)).toBe(true)
      expect((error as QredentialError).code).toBe('unsupported_runtime')
    }
  })

  it('cannot check revocation, and refuses rather than passing the credential', async () => {
    const issuer = await makeIssuer('https://detran.example')
    const pointer = { idx: 7, uri: 'https://detran.example/status/1' }

    // Building a status list needs deflate, so the issuer side is unavailable here too. This is a
    // server side operation in practice, and the assertion records that it fails loudly.
    await expect(
      createStatusList({
        issuer: issuer.iss,
        kid: issuer.kid,
        key: issuer.privateJwk,
        uri: pointer.uri,
        size: 128,
      })
    ).rejects.toThrow()

    // And a verifier handed a cached list it cannot inflate refuses, rather than treating an
    // unreadable list as a clean one.
    const { qr } = await issue({
      issuer: issuer.iss,
      kid: issuer.kid,
      key: issuer.privateJwk,
      claims: { over_18: true },
      status: pointer,
    })
    const result = await verify(qr, { acceptWithoutHolderProof: true, trust: issuer.trust, status: 'a.b.c' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('status_unavailable')
  })
})
