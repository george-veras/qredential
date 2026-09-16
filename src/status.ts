import { b64url, b64urlJson, unb64url, unb64urlJson } from './bytes.js'
import { deflate, inflateEither } from './compress.js'
import { importPrivateKey, sign } from './crypto.js'
import { seconds, nowSeconds } from './duration.js'
import { QredentialError } from './errors.js'
import type { Alg, Jwk } from './types.js'

export type StatusValue = 'valid' | 'invalid' | 'suspended' | 'unknown'

export interface StatusListToken {
  issuer: string
  uri?: string
  issuedAt?: number
  expiresAt?: number
  bits: number
  bytes: Uint8Array
}

/**
 * Parse a Token Status List JWT that the verifier already has on disk.
 *
 * Signature checking happens in verify(), against the same trust list as the credential, because a
 * status list from an unverified source is worse than no status list: it lets an attacker clear a
 * revoked credential.
 */
export async function parseStatusList(token: string): Promise<{ payload: Record<string, unknown>; list: StatusListToken }> {
  const parts = token.split('.')
  if (parts.length !== 3) {
    throw new QredentialError('malformed_status_list', 'status list token is not a JWT')
  }
  let payload: Record<string, unknown>
  try {
    payload = unb64urlJson<Record<string, unknown>>(parts[1]!)
  } catch (error) {
    throw new QredentialError('malformed_status_list', 'status list payload is not readable', {
      cause: error,
    })
  }

  const sl = payload['status_list'] as { bits?: number; lst?: string } | undefined
  if (!sl || typeof sl.lst !== 'string') {
    throw new QredentialError('malformed_status_list', 'status list token has no status_list.lst')
  }

  const bits = sl.bits ?? 1
  if (![1, 2, 4, 8].includes(bits)) {
    throw new QredentialError('malformed_status_list', `unsupported status list bit width: ${bits}`)
  }

  return {
    payload,
    list: {
      issuer: String(payload['iss'] ?? ''),
      uri: typeof payload['sub'] === 'string' ? payload['sub'] : undefined,
      issuedAt: typeof payload['iat'] === 'number' ? payload['iat'] : undefined,
      expiresAt: typeof payload['exp'] === 'number' ? payload['exp'] : undefined,
      bits,
      bytes: await inflateEither(unb64url(sl.lst)),
    },
  }
}

/** Read one entry. Values are packed least significant bits first, per the spec. */
export function readStatus(list: StatusListToken, idx: number): StatusValue {
  if (idx < 0 || !Number.isInteger(idx)) {
    throw new QredentialError('invalid_option', `invalid status index: ${idx}`)
  }

  const perByte = 8 / list.bits
  const byteIndex = Math.floor(idx / perByte)
  const byte = list.bytes[byteIndex]
  if (byte === undefined) return 'unknown'

  const shift = (idx % perByte) * list.bits
  const mask = (1 << list.bits) - 1
  const value = (byte >> shift) & mask

  if (value === 0) return 'valid'
  if (value === 1) return 'invalid'
  if (value === 2) return 'suspended'
  return 'unknown'
}

export function isStale(list: StatusListToken, maxAge: number | string | undefined, now = nowSeconds()): boolean {
  if (list.expiresAt !== undefined && now > list.expiresAt) return true
  if (maxAge === undefined) return false
  if (list.issuedAt === undefined) return true
  return now - list.issuedAt > seconds(maxAge)
}

/**
 * Publish a status list.
 *
 * The verifier side of revocation is useless without this, and leaving issuers to hand roll the
 * bitstring is how you end up with lists that disagree about bit order.
 *
 * Size it generously and set it once: a list covering a million credentials is 125 KB before
 * compression and a few KB after, because the bits are nearly all zero.
 */
export async function createStatusList(options: {
  issuer: string
  key: Jwk
  kid: string
  alg?: Alg
  /** Where verifiers refresh this list. Becomes the `sub` claim. */
  uri: string
  /** How many credentials the list covers. */
  size: number
  revoked?: number[]
  suspended?: number[]
  /** Seconds, or a duration string. Verifiers compare this against maxStatusAge. */
  expiresIn?: number | string
  /** Override the issue time. Exists for tests and for republishing a historical list. */
  issuedAt?: number
}): Promise<string> {
  const alg = options.alg ?? 'ES256'
  const iat = options.issuedAt ?? nowSeconds()

  if (!Number.isSafeInteger(options.size) || options.size < 1) {
    throw new QredentialError(
      'invalid_option',
      `status list size must be a positive integer, received ${options.size}`
    )
  }

  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(Math.ceil(options.size / 8))
  } catch (error) {
    // A size large enough to fail allocation is a caller mistake, not a crash to pass upward.
    throw new QredentialError(
      'invalid_option',
      `status list of ${options.size} entries cannot be allocated`,
      { cause: error }
    )
  }
  const set = (indices: number[] | undefined, value: number) => {
    for (const idx of indices ?? []) {
      if (idx < 0 || idx >= options.size || !Number.isInteger(idx)) {
        throw new QredentialError(
          'invalid_option',
          `status index ${idx} is outside a list of ${options.size}`
        )
      }
      bytes[Math.floor(idx / 8)]! |= value << idx % 8
    }
  }
  set(options.revoked, 1)
  set(options.suspended, 2)

  const payload: Record<string, unknown> = {
    iss: options.issuer,
    sub: options.uri,
    iat,
    status_list: { bits: 1, lst: b64url(await deflate(bytes, 'deflate')) },
  }
  if (options.expiresIn !== undefined) payload['exp'] = iat + seconds(options.expiresIn)

  const header = { alg, typ: 'statuslist+jwt', kid: options.kid }
  const input = `${b64urlJson(header)}.${b64urlJson(payload)}`
  const key = await importPrivateKey(options.key, alg)
  return `${input}.${b64url(await sign(input, key, alg))}`
}
