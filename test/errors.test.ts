import { describe, it, expect } from 'vitest'
import {
  issue,
  present,
  verify,
  assertVerified,
  QredentialError,
  isQredentialError,
  createStatusList,
  unpack,
  decodeBase45,
} from '../src/index.js'
import { parseStatusList } from '../src/status.js'
import { reconstructClaims } from '../src/sdjwt.js'
import { makeIssuer } from './helpers.js'
import type { ErrorCode } from '../src/errors.js'

const CLAIMS = { given_name: 'Ana', birth_date: '1991-04-02', over_18: true }

/** Assert a call fails with exactly this code, and that the thrown value is a QredentialError. */
async function codeOf(fn: () => unknown | Promise<unknown>): Promise<ErrorCode> {
  try {
    await fn()
  } catch (error) {
    expect(isQredentialError(error)).toBe(true)
    expect(error).toBeInstanceOf(QredentialError)
    const err = error as QredentialError
    expect(err.name).toBe('QredentialError')
    expect(err.message.length).toBeGreaterThan(0)
    return err.code
  }
  throw new Error('expected the call to throw and it did not')
}

describe('every documented error code is reachable', () => {
  it('invalid_option: a disclose list naming a claim that does not exist', async () => {
    const issuer = await makeIssuer('https://a.example')
    expect(
      await codeOf(() =>
        issue({ issuer: issuer.iss, kid: issuer.kid, key: issuer.privateJwk, claims: CLAIMS, disclose: ['nope'] })
      )
    ).toBe('invalid_option')
  })

  it('invalid_option: a duration the parser cannot read', async () => {
    const issuer = await makeIssuer('https://a.example')
    expect(
      await codeOf(() =>
        issue({ issuer: issuer.iss, kid: issuer.kid, key: issuer.privateJwk, claims: CLAIMS, expiresIn: 'soon' })
      )
    ).toBe('invalid_option')
  })

  it('invalid_option: a status index outside the list it is written into', async () => {
    const issuer = await makeIssuer('https://a.example')
    expect(
      await codeOf(() =>
        createStatusList({
          issuer: issuer.iss,
          kid: issuer.kid,
          key: issuer.privateJwk,
          uri: 'https://a.example/s/1',
          size: 64,
          revoked: [500],
        })
      )
    ).toBe('invalid_option')
  })

  it('not_disclosable: asking to reveal what the issuer never made optional', async () => {
    const issuer = await makeIssuer('https://a.example')
    const { credential } = await issue({
      issuer: issuer.iss,
      kid: issuer.kid,
      key: issuer.privateJwk,
      claims: CLAIMS,
      disclose: ['over_18'],
    })
    expect(await codeOf(() => present(credential, { disclose: ['birth_date'] }))).toBe('not_disclosable')
  })

  it('malformed_credential: an empty disclosure segment', async () => {
    const issuer = await makeIssuer('https://a.example')
    const { credential } = await issue({
      issuer: issuer.iss,
      kid: issuer.kid,
      key: issuer.privateJwk,
      claims: CLAIMS,
      disclose: ['over_18'],
    })
    expect(await codeOf(() => present(credential + '~', { disclose: [] }))).toBe('malformed_credential')
  })

  it('malformed_envelope: text without the prefix', async () => {
    expect(await codeOf(() => unpack('hello'))).toBe('malformed_envelope')
  })

  it('malformed_envelope: bad base45 inside, with the codec error kept as cause', async () => {
    try {
      await unpack('QC1:!!!!')
      throw new Error('should have thrown')
    } catch (error) {
      const err = error as QredentialError
      expect(err.code).toBe('malformed_envelope')
      // The detail is not lost: the caller can still reach the encoding error underneath.
      expect(isQredentialError(err.cause)).toBe(true)
      expect((err.cause as QredentialError).code).toBe('invalid_encoding')
    }
  })

  it('malformed_status_list: a token that is not a status list', async () => {
    expect(await codeOf(() => parseStatusList('not.a.jwt'))).toBe('malformed_status_list')
  })

  it('invalid_encoding: base45 with a character outside the alphabet', async () => {
    expect(await codeOf(() => decodeBase45('abc'))).toBe('invalid_encoding')
  })

  it('unsupported_alg: a digest algorithm outside the named information hash registry', async () => {
    expect(
      await codeOf(() => reconstructClaims({ _sd: [], _sd_alg: 'md5' }, []))
    ).toBe('unsupported_alg')
  })

  it('crypto_failure: a malformed key, wrapped instead of leaking a DOMException', async () => {
    const broken = { kty: 'EC', crv: 'P-256', x: 'not-base64url!!', y: 'also-broken', d: 'nope' }
    const code = await codeOf(() =>
      issue({ issuer: 'https://a.example', kid: 'k1', key: broken, claims: CLAIMS })
    )
    expect(code).toBe('crypto_failure')
  })

  it('verification_failed: only from assertVerified, carrying the original reason', async () => {
    const issuer = await makeIssuer('https://a.example')
    const other = await makeIssuer('https://b.example')
    const { qr } = await issue({ issuer: other.iss, kid: other.kid, key: other.privateJwk, claims: CLAIMS })

    const result = await verify(qr, { acceptWithoutHolderProof: true, trust: issuer.trust })
    expect(result.ok).toBe(false)

    try {
      assertVerified(result)
      throw new Error('should have thrown')
    } catch (error) {
      const err = error as QredentialError
      expect(err.code).toBe('verification_failed')
      expect(err.reason).toBe('unknown_issuer')
    }
  })
})

describe('the two contracts hold', () => {
  it('verify returns rather than throwing, for input that makes everything else throw', async () => {
    const issuer = await makeIssuer('https://a.example')
    for (const hostile of ['', 'hello', 'QC1:!!!!', 'a.b.c~~', '~~~', 'QC1:' + 'A'.repeat(500)]) {
      const result = await verify(hostile, { acceptWithoutHolderProof: true, trust: issuer.trust })
      expect(result.ok).toBe(false)
    }
  })

  it('assertVerified passes a good credential straight through', async () => {
    const issuer = await makeIssuer('https://a.example')
    const { qr } = await issue({ issuer: issuer.iss, kid: issuer.kid, key: issuer.privateJwk, claims: CLAIMS })
    const credential = assertVerified(await verify(qr, { acceptWithoutHolderProof: true, trust: issuer.trust }))
    expect(credential.claims['given_name']).toBe('Ana')
  })

  it('isQredentialError says no to everything else', () => {
    for (const other of [new Error('plain'), new TypeError('nope'), 'string', null, undefined, {}]) {
      expect(isQredentialError(other)).toBe(false)
    }
  })
})
