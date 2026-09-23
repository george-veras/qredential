import { describe, it, expect } from 'vitest'
import {
  algForJwk,
  importPrivateKey,
  importPublicKey,
  sign,
  verifySignature,
  webCryptoDigestAlg,
  digestHash,
} from '../src/crypto.js'
import { QredentialError, isQredentialError } from '../src/errors.js'
import { makeIssuer } from './helpers.js'
import type { Jwk } from '../src/types.js'

/**
 * The failure paths in src/crypto.ts.
 *
 * Every other suite drives this file through its happy path, because every signature this library
 * makes and checks goes through it. What none of them reach is what happens when WebCrypto itself
 * says no: a key the platform will not import, a key asked to do the one operation it was not
 * imported for, an algorithm nobody supports.
 *
 * Those paths matter more than their line count suggests. They are the boundary where a raw
 * platform exception either becomes a typed QredentialError or escapes as whatever the browser
 * felt like throwing, and the second outcome breaks the promise the whole library rests on.
 */

/** Assert the call throws a QredentialError, and return its code. */
async function codeOf(fn: () => unknown | Promise<unknown>): Promise<string> {
  try {
    await fn()
  } catch (error) {
    expect(isQredentialError(error)).toBe(true)
    expect(error).toBeInstanceOf(QredentialError)
    const err = error as QredentialError
    expect(err.message.length).toBeGreaterThan(0)
    return err.code
  }
  throw new Error('expected the call to throw and it did not')
}

describe('a key the platform cannot make sense of', () => {
  it('rejects a public JWK with the wrong curve for the algorithm', async () => {
    const wrongCurve = { kty: 'EC', crv: 'P-384', x: 'nope', y: 'nope' } as unknown as Jwk
    expect(await codeOf(() => importPublicKey(wrongCurve, 'ES256'))).toBe('crypto_failure')
  })

  it('rejects a private JWK that is missing the private component', async () => {
    const issuer = await makeIssuer('https://a.example')
    const { d: _d, ...withoutD } = issuer.privateJwk as Jwk & { d?: string }
    expect(await codeOf(() => importPrivateKey(withoutD as Jwk, 'ES256'))).toBe('crypto_failure')
  })

  it('names the algorithm it was trying to use, so the message is actionable', async () => {
    try {
      await importPublicKey({ kty: 'oct' } as unknown as Jwk, 'EdDSA')
      throw new Error('expected a throw')
    } catch (error) {
      expect((error as QredentialError).message).toContain('EdDSA')
    }
  })

  it('carries the platform error as the cause rather than discarding it', async () => {
    try {
      await importPublicKey({ kty: 'EC', crv: 'P-256' } as unknown as Jwk, 'ES256')
      throw new Error('expected a throw')
    } catch (error) {
      expect((error as QredentialError).cause).toBeDefined()
    }
  })
})

describe('a key asked to do something it was not imported for', () => {
  it('turns a signing failure into a typed rejection', async () => {
    const issuer = await makeIssuer('https://a.example')
    // Imported for verification, so the platform refuses to sign with it. A verifier holding only
    // public keys is the normal case, which makes this the realistic way to reach the path.
    const publicKey = await importPublicKey(issuer.publicJwk, 'ES256')
    expect(await codeOf(() => sign('anything', publicKey, 'ES256'))).toBe('crypto_failure')
  })

  it('verifySignature returns false instead of throwing, for any input at all', async () => {
    const issuer = await makeIssuer('https://a.example')
    const publicKey = await importPublicKey(issuer.publicJwk, 'ES256')
    // A signature of the wrong length for the curve makes WebCrypto throw rather than return false.
    // The library has to absorb that: a verifier deciding whether a credential is real must get an
    // answer, never an exception, or the caller ends up wrapping it in a catch that waves people
    // through.
    await expect(verifySignature('data', 'AAAA', publicKey, 'ES256')).resolves.toBe(false)
    await expect(verifySignature('data', '', publicKey, 'ES256')).resolves.toBe(false)
    await expect(verifySignature('data', '!!! not base64url !!!', publicKey, 'ES256')).resolves.toBe(false)
  })
})

describe('algorithms nobody supports', () => {
  it('refuses a JWK whose algorithm cannot be determined', () => {
    expect(() => algForJwk({ kty: 'RSA', n: 'x', e: 'AQAB' } as unknown as Jwk)).toThrow(
      QredentialError
    )
  })

  it('says what it saw, because the fix depends on which field was wrong', () => {
    try {
      algForJwk({ kty: 'EC', crv: 'P-521' } as unknown as Jwk)
      throw new Error('expected a throw')
    } catch (error) {
      const err = error as QredentialError
      expect(err.code).toBe('unsupported_alg')
      expect(err.message).toContain('P-521')
    }
  })

  it('reads the algorithm off an explicit alg field before guessing from the curve', () => {
    expect(algForJwk({ kty: 'OKP', crv: 'Ed25519', alg: 'EdDSA' } as unknown as Jwk)).toBe('EdDSA')
    expect(algForJwk({ kty: 'EC', crv: 'P-256' } as unknown as Jwk)).toBe('ES256')
  })

  it('refuses an _sd_alg outside the three the RFC registry allows', () => {
    expect(() => webCryptoDigestAlg('sha-1')).toThrow(QredentialError)
    expect(() => webCryptoDigestAlg('md5')).toThrow(QredentialError)
    expect(() => webCryptoDigestAlg('')).toThrow(QredentialError)
  })

  it('accepts all three that it does allow, and they produce different digests', async () => {
    const data = new Uint8Array([1, 2, 3])
    const lengths = await Promise.all(
      (['sha-256', 'sha-384', 'sha-512'] as const).map(async (a) => (await digestHash(data, a)).length)
    )
    expect(lengths).toEqual([32, 48, 64])
  })
})
