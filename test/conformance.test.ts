import { describe, it, expect } from 'vitest'
import { digest, parseDisclosure, reconstructClaims, sdHash } from '../src/sdjwt.js'
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

  it.each(['sha-384', 'sha-512'] as const)('reconstructs claims with %s', async (alg) => {
    const disclosure = vectors[0]!.disclosure
    const payload = { _sd: [await digest(disclosure, alg)], _sd_alg: alg }
    const result = await reconstructClaims(payload, [disclosure])
    expect(result.claims[vectors[0]!.claim]).toBe(parseDisclosure(disclosure).value)
  })

  it('rejects algorithms outside the named information hash registry', async () => {
    await expect(reconstructClaims({ _sd: [], _sd_alg: 'md5' }, [])).rejects.toThrow('unsupported')
  })

  it('has vectors at all, so a broken extraction cannot pass silently', () => {
    expect(vectors.length).toBe(8)
    for (const v of vectors) {
      expect(v.hash).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(v.disclosure.length).toBeGreaterThan(40)
    }
  })
})
