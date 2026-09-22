import { describe, it, expect } from 'vitest'
import { digest, parseDisclosure, sdHash } from '../src/sdjwt.js'
import vectors from './rfc9901-vectors.json'

/**
 * Conformance against RFC 9901, "Selective Disclosure for JSON Web Tokens", November 2025.
 *
 * Every vector here is lifted from the specification's own worked example in Section 5, extracted
 * from the RFC text rather than retyped, because a transcription slip would turn a conformance test
 * into a test that this implementation agrees with itself.
 *
 * This is the strongest evidence available short of an audit that the digest function is right: the
 * disclosures and their hashes were published by the specification authors, and nothing here was
 * produced by this library.
 */

describe('RFC 9901 Section 5 vectors', () => {
  it.each(vectors)('reproduces the published hash for $claim', async ({ disclosure, hash }) => {
    expect(await digest(disclosure)).toBe(hash)
  })

  it.each(vectors)('parses the published disclosure for $claim', ({ disclosure, claim }) => {
    const parsed = parseDisclosure(disclosure)
    expect(parsed.name).toBe(claim)
    expect(parsed.salt.length).toBeGreaterThan(0)
  })

  it('reads a value the issuer serialised with different whitespace than we would', () => {
    // Section 4.2.1 is explicit that no canonicalisation happens, because the digest covers the
    // base64url string itself. The RFC's own encoder puts a space after each comma; ours does not.
    // Both are valid, and a verifier has to read either.
    const theirs = parseDisclosure(vectors[0]!.disclosure)
    expect(theirs.value).toBe('John')

    const objectValued = vectors.find((v) => v.claim === 'address')!
    expect(parseDisclosure(objectValued.disclosure).value).toEqual({
      street_address: '123 Main St',
      locality: 'Anytown',
      region: 'Anystate',
      country: 'US',
    })
  })

  it('handles the non-ASCII example from Section 4.2.1', () => {
    // ["_26bc4LT-ac6q2KI6cBW5es", "family_name", "Möbius"]
    const parsed = parseDisclosure(
      'WyJfMjZiYzRMVC1hYzZxMktJNmNCVzVlcyIsICJmYW1pbHlfbmFtZSIsICJNw7ZiaXVzIl0'
    )
    expect(parsed.name).toBe('family_name')
    expect(parsed.value).toBe('Möbius')
  })

  it('computes sd_hash over the presentation exactly as Section 4.3.1 defines it', async () => {
    // "the Issuer-signed JWT, a tilde character, and zero or more Disclosures selected for
    // presentation to the Verifier, each followed by a tilde character"
    const jwt = 'eyJhbGciOiJFUzI1NiJ9.eyJpc3MiOiJodHRwczovL2lzc3Vlci5leGFtcGxlIn0.sig'
    const chosen = [vectors[0]!.disclosure, vectors[1]!.disclosure]

    const { sha256 } = await import('../src/crypto.js')
    const { b64url, utf8 } = await import('../src/bytes.js')
    const byHand = b64url(await sha256(utf8(`${jwt}~${chosen[0]}~${chosen[1]}~`)))

    expect(await sdHash(jwt, chosen)).toBe(byHand)
  })

  it('has vectors at all, so a broken extraction cannot pass silently', () => {
    expect(vectors.length).toBe(8)
    for (const v of vectors) {
      expect(v.hash).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(v.disclosure.length).toBeGreaterThan(40)
    }
  })

  describe('RFC 9901 Section 4.1.1 hash algorithms (sha-384 and sha-512)', () => {
    it('computes sha-384 and sha-512 digests of disclosures with correct lengths', async () => {
      const sample = vectors[0]!.disclosure
      const d384 = await digest(sample, 'sha-384')
      const d512 = await digest(sample, 'sha-512')

      // SHA-384: 48 bytes -> 64 chars in base64url
      expect(d384).toMatch(/^[A-Za-z0-9_-]{64}$/)
      // SHA-512: 64 bytes -> 86 chars in base64url
      expect(d512).toMatch(/^[A-Za-z0-9_-]{86}$/)

      // Verify against WebCrypto directly
      const { b64url, utf8 } = await import('../src/bytes.js')
      const expected384 = b64url(
        new Uint8Array(await crypto.subtle.digest('SHA-384', utf8(sample) as BufferSource))
      )
      const expected512 = b64url(
        new Uint8Array(await crypto.subtle.digest('SHA-512', utf8(sample) as BufferSource))
      )
      expect(d384).toBe(expected384)
      expect(d512).toBe(expected512)
    })

    it('computes sd_hash for key binding using sha-384 and sha-512', async () => {
      const jwt = 'eyJhbGciOiJFUzI1NiJ9.eyJpc3MiOiJodHRwczovL2lzc3Vlci5leGFtcGxlIn0.sig'
      const chosen = [vectors[0]!.disclosure, vectors[1]!.disclosure]

      const { b64url, utf8 } = await import('../src/bytes.js')
      const data = utf8(`${jwt}~${chosen[0]}~${chosen[1]}~`)
      const expected384 = b64url(
        new Uint8Array(await crypto.subtle.digest('SHA-384', data as BufferSource))
      )
      const expected512 = b64url(
        new Uint8Array(await crypto.subtle.digest('SHA-512', data as BufferSource))
      )

      expect(await sdHash(jwt, chosen, 'sha-384')).toBe(expected384)
      expect(await sdHash(jwt, chosen, 'sha-512')).toBe(expected512)
    })

    it('reconstructs claims using sha-384 and sha-512', async () => {
      const { reconstructClaims, makeDisclosure } = await import('../src/sdjwt.js')

      for (const alg of ['sha-384', 'sha-512'] as const) {
        const d1 = makeDisclosure('given_name', 'Alice')
        const d2 = makeDisclosure('family_name', 'Smith')
        const dig1 = await digest(d1.raw, alg)
        const dig2 = await digest(d2.raw, alg)

        const payload = {
          iss: 'https://issuer.example',
          _sd: [dig1, dig2],
          _sd_alg: alg,
        }

        const rebuilt = await reconstructClaims(payload, [d1.raw, d2.raw])
        expect(rebuilt.claims['given_name']).toBe('Alice')
        expect(rebuilt.claims['family_name']).toBe('Smith')
        expect(rebuilt.disclosed).toEqual(['given_name', 'family_name'])
        expect(rebuilt.withheld).toBe(0)
      }
    })

    it('refuses an unknown algorithm not in the registry allowed set', async () => {
      const { reconstructClaims } = await import('../src/sdjwt.js')
      await expect(
        reconstructClaims({ _sd: [], _sd_alg: 'md5' }, [])
      ).rejects.toThrow('unsupported _sd_alg: md5')
    })
  })
})

