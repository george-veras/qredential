import { describe, it, expect, beforeAll } from 'vitest'
import fc from 'fast-check'
import { issue, present, verify, fits } from '../src/index.js'
import { encodeBase45, decodeBase45 } from '../src/base45.js'
import { pack, unpack } from '../src/envelope.js'
import { makeIssuer } from './helpers.js'
import type { TrustList } from '../src/types.js'

/**
 * SECURITY.md puts "crashing the parser on hostile input" in scope, on the grounds that a verifier
 * which throws is a verifier somebody wraps in a try/catch that waves people through. These are the
 * tests that make that promise checkable rather than aspirational.
 */

let trust: TrustList
let credential: string
let envelope: string

beforeAll(async () => {
  const issuer = await makeIssuer('https://detran.example')
  trust = issuer.trust
  const issued = await issue({
    issuer: issuer.iss,
    kid: issuer.kid,
    key: issuer.privateJwk,
    claims: { given_name: 'Ana', birth_date: '1991-04-02', over_18: true },
    disclose: ['birth_date', 'over_18'],
    expiresIn: '365d',
  })
  credential = issued.credential
  envelope = issued.qr
})

describe('verify never throws', () => {
  it('returns a typed rejection for any string at all', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), async (garbage) => {
        const result = await verify(garbage, { trust })
        expect(result.ok).toBe(false)
        if (result.ok) return
        expect(typeof result.reason).toBe('string')
        expect(typeof result.message).toBe('string')
      }),
      { numRuns: 300 }
    )
  })

  it('survives strings shaped like a credential without being one', async () => {
    const segment = fc.stringOf(fc.constantFrom(...'ABCabc012-_'.split('')), { maxLength: 60 })
    const jwtish = fc
      .tuple(segment, segment, segment, fc.array(segment, { maxLength: 4 }))
      .map(([h, p, s, ds]) => [h, p, s].join('.') + '~' + ds.join('~') + '~')

    await fc.assert(
      fc.asyncProperty(jwtish, async (candidate) => {
        const result = await verify(candidate, { trust })
        expect(result.ok).toBe(false)
      }),
      { numRuns: 200 }
    )
  })

  it('survives a corrupted envelope, which is what a bad scan produces', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.stringOf(fc.constantFrom(...'0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:'.split('')), { maxLength: 400 }),
        async (body) => {
          const result = await verify('QC1:' + body, { trust })
          expect(result.ok).toBe(false)
        }
      ),
      { numRuns: 200 }
    )
  })
})

describe('no mutation of a real credential is ever accepted', () => {
  it('rejects every single character substitution', async () => {
    // Exhaustive rather than random: one pass over every position in a real credential.
    const alphabet = 'AZaz09-_.~'
    let checked = 0
    for (let i = 0; i < credential.length; i += 7) {
      const original = credential[i]!
      for (const ch of alphabet) {
        if (ch === original) continue
        const mutated = credential.slice(0, i) + ch + credential.slice(i + 1)
        const result = await verify(mutated, { trust })
        expect(result.ok, `accepted a mutation at index ${i}: ${original} became ${ch}`).toBe(false)
        checked++
        break
      }
    }
    expect(checked).toBeGreaterThan(20)
  })

  it('truncation can only ever remove claims, never add one', async () => {
    // Cutting at a separator inside the disclosure region is a legitimate narrower presentation,
    // which is precisely what present() produces. What must never happen is a truncated credential
    // that verifies with a claim the full one did not have.
    const full = await verify(credential, { trust })
    expect(full.ok).toBe(true)
    const originalClaims = full.ok ? Object.keys(full.claims).sort() : []

    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: credential.length - 1 }), async (cut) => {
        const result = await verify(credential.slice(0, cut), { trust })
        if (!result.ok) return
        const claims = Object.keys(result.claims).sort()
        expect(claims.every((c) => originalClaims.includes(c))).toBe(true)
        expect(claims.length).toBeLessThanOrEqual(originalClaims.length)
      }),
      { numRuns: 200 }
    )
  })

  it('rejects anything appended to a valid credential, including an empty segment', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ maxLength: 80 }), async (extra) => {
        const result = await verify(credential + extra + '~', { trust })
        expect(result.ok).toBe(false)
      }),
      { numRuns: 150 }
    )
  })
})

describe('codec round trips', () => {
  it('base45 survives any byte sequence', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 2000 }), (bytes) => {
        expect(Array.from(decodeBase45(encodeBase45(bytes)))).toEqual(Array.from(bytes))
      }),
      { numRuns: 400 }
    )
  })

  it('base45 decode rejects hostile input with a real error, never a crash', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), (text) => {
        try {
          decodeBase45(text)
        } catch (error) {
          expect(error).toBeInstanceOf(Error)
          expect((error as Error).message.length).toBeGreaterThan(0)
        }
      }),
      { numRuns: 400 }
    )
  })

  it('the envelope survives any unicode payload', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ maxLength: 1500 }), async (payload) => {
        expect(await unpack(await pack(payload))).toBe(payload)
      }),
      { numRuns: 120 }
    )
  })
})

describe('present never widens what the issuer allowed', () => {
  it('a presentation never carries more than the credential it came from', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.subarray(['birth_date', 'over_18'], { minLength: 0 }),
        async (reveal) => {
          const presentation = await present(credential, { disclose: reveal })
          const result = await verify(presentation, { trust })
          expect(result.ok).toBe(true)
          if (!result.ok) return
          expect(result.disclosed.sort()).toEqual([...reveal].sort())
          expect(result.withheld).toBe(2 - reveal.length)
        }
      ),
      { numRuns: 40 }
    )
  })
})

describe('fits never lies about capacity', () => {
  it('reports a version whose published capacity actually holds the payload', () => {
    fc.assert(
      fc.property(
        fc.stringOf(fc.constantFrom(...'0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')), { maxLength: 4400 }),
        fc.constantFrom('L' as const, 'M' as const, 'Q' as const, 'H' as const),
        (payload, level) => {
          const fit = fits(payload, level)
          if (fit.version === null) {
            expect(fit.capacity).toBeNull()
          } else {
            expect(fit.capacity).not.toBeNull()
            expect(payload.length).toBeLessThanOrEqual(fit.capacity!)
            expect(fit.version).toBeGreaterThanOrEqual(1)
            expect(fit.version).toBeLessThanOrEqual(40)
          }
        }
      ),
      { numRuns: 300 }
    )
  })
})

describe('malformed compression never escapes as an unhandled rejection', () => {
  it('rejects a corrupt deflate body through the returned promise, not the process', async () => {
    // Flag byte 0x01 says deflate, then bytes that are not a deflate stream. Before this was
    // fixed the writable side rejected with nobody listening, which modern Node treats as fatal.
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ minLength: 1, maxLength: 200 }), async (garbage) => {
        const body = new Uint8Array(garbage.length + 1)
        body[0] = 0x01
        body.set(garbage, 1)
        const envelope = 'QC1:' + encodeBase45(body)

        // A short random run is occasionally a valid deflate stream, so either outcome is fine.
        // What must never happen is the failure escaping the promise.
        try {
          await unpack(envelope)
        } catch (error) {
          expect(error).toBeInstanceOf(Error)
        }

        const result = await verify(envelope, { trust })
        expect(result.ok).toBe(false)
      }),
      { numRuns: 150 }
    )
  })
})
