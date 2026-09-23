import { describe, it, expect } from 'vitest'
import { parseStatusList, readStatus } from '../src/status.js'
import type { StatusListToken } from '../src/status.js'
import { deflate } from '../src/compress.js'
import { QredentialError, isQredentialError } from '../src/errors.js'
import { b64url, b64urlJson } from '../src/bytes.js'

/**
 * The rejection paths in the Token Status List reader.
 *
 * Revocation is the one check in this library that reads something the verifier did not receive
 * from the holder. That makes the status list the most attacker-reachable input in the whole flow:
 * whoever can hand the verifier a list of their choosing can try to clear a credential that was
 * revoked. The signature check in verify() is what stops that, but the parser sits in front of it
 * and has to refuse anything it cannot read rather than guessing.
 *
 * The suspended and unknown values get tested here too. They are not error paths, they are answers,
 * and an implementation that collapses them into "valid" fails open in exactly the way that matters.
 */

async function codeOf(fn: () => unknown | Promise<unknown>): Promise<string> {
  try {
    await fn()
  } catch (error) {
    expect(isQredentialError(error)).toBe(true)
    return (error as QredentialError).code
  }
  throw new Error('expected the call to throw and it did not')
}

/** A status list token carrying exactly these bytes, unsigned: the parser runs before verify(). */
async function tokenWith(statusList: unknown, extra: Record<string, unknown> = {}): Promise<string> {
  const payload = { iss: 'https://issuer.example', sub: 'https://issuer.example/s/1', ...extra, status_list: statusList }
  return `${b64urlJson({ alg: 'ES256', typ: 'statuslist+jwt' })}.${b64urlJson(payload)}.signature`
}

describe('a status list the parser cannot read', () => {
  it('refuses something that is not three dot separated parts', async () => {
    expect(await codeOf(() => parseStatusList('not.ajwt'))).toBe('malformed_status_list')
    expect(await codeOf(() => parseStatusList(''))).toBe('malformed_status_list')
    expect(await codeOf(() => parseStatusList('a.b.c.d'))).toBe('malformed_status_list')
  })

  it('refuses a payload that is not readable JSON', async () => {
    const token = `${b64urlJson({ alg: 'ES256' })}.${b64url(new Uint8Array([0xff, 0xfe, 0xfd]))}.sig`
    expect(await codeOf(() => parseStatusList(token))).toBe('malformed_status_list')
  })

  it('refuses a token with no status_list claim at all', async () => {
    const token = await tokenWith(undefined)
    expect(await codeOf(() => parseStatusList(token))).toBe('malformed_status_list')
  })

  it('refuses a status_list whose lst is missing or not a string', async () => {
    const noLst = await tokenWith({ bits: 1 })
    const numericLst = await tokenWith({ bits: 1, lst: 42 })
    expect(await codeOf(() => parseStatusList(noLst))).toBe('malformed_status_list')
    expect(await codeOf(() => parseStatusList(numericLst))).toBe('malformed_status_list')
  })

  it('refuses a bit width outside the four the specification defines', async () => {
    const lst = b64url(await deflate(new Uint8Array([0]), 'deflate'))
    for (const bits of [0, 3, 5, 16, -1]) {
      const token = await tokenWith({ bits, lst })
      expect(await codeOf(() => parseStatusList(token))).toBe('malformed_status_list')
    }
  })

  it('accepts all four widths the specification does define', async () => {
    const lst = b64url(await deflate(new Uint8Array([0]), 'deflate'))
    for (const bits of [1, 2, 4, 8]) {
      const { list } = await parseStatusList(await tokenWith({ bits, lst }))
      expect(list.bits).toBe(bits)
    }
  })

  it('defaults to one bit per entry when the width is not stated', async () => {
    const lst = b64url(await deflate(new Uint8Array([0]), 'deflate'))
    const { list } = await parseStatusList(await tokenWith({ lst }))
    expect(list.bits).toBe(1)
  })
})

describe('reading an entry', () => {
  /** Two bits per entry, packed least significant first: entry 0 valid, 1 invalid, 2 suspended, 3 reserved. */
  const twoBit: StatusListToken = {
    issuer: 'https://issuer.example',
    bits: 2,
    bytes: new Uint8Array([0b11_10_01_00]),
  }

  it('reads valid, invalid and suspended as distinct answers', () => {
    expect(readStatus(twoBit, 0)).toBe('valid')
    expect(readStatus(twoBit, 1)).toBe('invalid')
    expect(readStatus(twoBit, 2)).toBe('suspended')
  })

  it('reports a reserved value as unknown rather than guessing', () => {
    // 0b11 is not a status this specification assigns. Reporting it as valid would be the
    // convenient reading and the wrong one.
    expect(readStatus(twoBit, 3)).toBe('unknown')
  })

  it('reports an index past the end of the list as unknown, not valid', () => {
    expect(readStatus(twoBit, 999)).toBe('unknown')
  })

  it('refuses an index that is negative or not a whole number', () => {
    for (const idx of [-1, 1.5, NaN, Infinity]) {
      expect(() => readStatus(twoBit, idx)).toThrow(QredentialError)
    }
  })
})
