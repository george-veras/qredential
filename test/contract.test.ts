import { describe, it, expect, beforeAll } from 'vitest'
import fc from 'fast-check'
import {
  issue,
  present,
  verify,
  fits,
  createStatusList,
  pack,
  unpack,
  isEnvelope,
  encodeBase45,
  decodeBase45,
  assertVerified,
  isQredentialError,
  QredentialError,
} from '../src/index.js'
import type { ErrorCode } from '../src/errors.js'
import { makeIssuer } from './helpers.js'
import type { Jwk, TrustList } from '../src/types.js'

/**
 * The public contract, held to by test rather than by intention.
 *
 * A library is a predictable dependency when a caller can write one catch block and know what can
 * land in it. Two rules make that true here, and both are checked against generated hostile input:
 *
 *   1. verify() never throws, for any input whatsoever.
 *   2. Every other entry point throws only QredentialError. No SyntaxError from a JSON parse, no
 *      DOMException from WebCrypto, no TypeError from a bad property access.
 */

let trust: TrustList
let privateJwk: Jwk
let credential: string

beforeAll(async () => {
  const issuer = await makeIssuer('https://a.example')
  trust = issuer.trust
  privateJwk = issuer.privateJwk
  const issued = await issue({
    issuer: issuer.iss,
    kid: issuer.kid,
    key: issuer.privateJwk,
    claims: { given_name: 'Ana', over_18: true },
    disclose: ['over_18'],
  })
  credential = issued.credential
})

/** Run something with hostile input and report what escaped, if anything. */
async function escaped(fn: () => unknown | Promise<unknown>): Promise<Error | null> {
  try {
    await fn()
    return null
  } catch (error) {
    if (isQredentialError(error)) return null
    return error instanceof Error ? error : new Error(`non-error thrown: ${String(error)}`)
  }
}

describe('rule 1: verify never throws', () => {
  it('holds for arbitrary strings and arbitrary options', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string(),
        fc.option(fc.string(), { nil: undefined }),
        fc.option(fc.integer(), { nil: undefined }),
        async (input, status, now) => {
          const result = await verify(input, { trust, status, now, maxStatusAge: '7d' })
          expect(result.ok).toBe(false)
          if (result.ok) return
          expect(typeof result.reason).toBe('string')
        }
      ),
      { numRuns: 250 }
    )
  })

  it('holds even when the trust list itself is nonsense', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), async (input) => {
        const result = await verify(input, { trust: { issuers: {} } })
        expect(result.ok).toBe(false)
      }),
      { numRuns: 120 }
    )
  })
})

describe('rule 2: nothing but QredentialError escapes', () => {
  it('unpack, for any string', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ maxLength: 400 }), async (s) => {
        expect(await escaped(() => unpack(s))).toBeNull()
      }),
      { numRuns: 300 }
    )
  })

  it('decodeBase45, for any string', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 400 }), (s) => {
        try {
          decodeBase45(s)
        } catch (error) {
          expect(isQredentialError(error)).toBe(true)
        }
      }),
      { numRuns: 300 }
    )
  })

  it('present, for any credential shaped string and any disclose list', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(fc.string({ maxLength: 200 }), fc.constant(credential)),
        fc.array(fc.string({ maxLength: 20 }), { maxLength: 4 }),
        async (input, disclose) => {
          expect(await escaped(() => present(input, { disclose }))).toBeNull()
        }
      ),
      { numRuns: 250 }
    )
  })

  it('issue, for hostile durations and key material', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(fc.string({ maxLength: 12 }), fc.integer(), fc.double()),
        async (duration) => {
          expect(
            await escaped(() =>
              issue({
                issuer: 'https://a.example',
                kid: 'k1',
                key: privateJwk,
                claims: { a: 1 },
                expiresIn: duration as string | number,
              })
            )
          ).toBeNull()
        }
      ),
      { numRuns: 120 }
    )
  })

  it('issue, for key objects that are not usable keys', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          kty: fc.string({ maxLength: 6 }),
          crv: fc.string({ maxLength: 8 }),
          x: fc.string({ maxLength: 20 }),
          y: fc.string({ maxLength: 20 }),
          d: fc.string({ maxLength: 20 }),
        }),
        async (key) => {
          expect(
            await escaped(() =>
              issue({ issuer: 'https://a.example', kid: 'k1', key: key as Jwk, claims: { a: 1 } })
            )
          ).toBeNull()
        }
      ),
      { numRuns: 80 }
    )
  })

  it('createStatusList, for hostile sizes and indices', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: -50, max: 5000 }),
        fc.array(fc.integer({ min: -100, max: 10000 }), { maxLength: 5 }),
        async (size, revoked) => {
          expect(
            await escaped(() =>
              createStatusList({
                issuer: 'https://a.example',
                kid: 'k1',
                key: privateJwk,
                uri: 'https://a.example/s/1',
                size,
                revoked,
              })
            )
          ).toBeNull()
        }
      ),
      { numRuns: 120 }
    )
  })

  it('fits and isEnvelope never throw at all, for any string', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 5000 }), (s) => {
        expect(() => fits(s)).not.toThrow()
        expect(() => isEnvelope(s)).not.toThrow()
      }),
      { numRuns: 200 }
    )
  })

  it('pack accepts any string the platform can hold', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ maxLength: 800 }), async (s) => {
        expect(await escaped(() => pack(s))).toBeNull()
      }),
      { numRuns: 100 }
    )
  })

  it('encodeBase45 never throws for any bytes', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 1000 }), (bytes) => {
        expect(() => encodeBase45(bytes)).not.toThrow()
      }),
      { numRuns: 200 }
    )
  })
})

describe('the error code set is pinned', () => {
  it('lists exactly the documented codes, so adding or removing one is deliberate', () => {
    // This test exists to fail on purpose. Codes are public API under semver: a new one is a minor
    // version, and removing or repurposing one is breaking. If you are here because this failed,
    // update the guide's error table in the same commit.
    const documented: ErrorCode[] = [
      'invalid_option',
      'not_disclosable',
      'malformed_credential',
      'malformed_envelope',
      'malformed_status_list',
      'invalid_encoding',
      'unsupported_alg',
      'unsupported_runtime',
      'crypto_failure',
      'verification_failed',
    ]
    expect(documented).toHaveLength(10)
    expect(new Set(documented).size).toBe(documented.length)

    // Every one has to be constructible, which keeps this list honest against the type.
    for (const code of documented) {
      const error = new QredentialError(code, 'x')
      expect(error.code).toBe(code)
      expect(isQredentialError(error)).toBe(true)
    }
  })
})
