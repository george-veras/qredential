import { unb64url, unb64urlJson } from './bytes.js'
import { inflateEither } from './compress.js'
import { seconds, nowSeconds } from './duration.js'

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
  if (parts.length !== 3) throw new Error('status list token is not a JWT')
  const payload = unb64urlJson<Record<string, unknown>>(parts[1]!)

  const sl = payload['status_list'] as { bits?: number; lst?: string } | undefined
  if (!sl || typeof sl.lst !== 'string') throw new Error('status list token has no status_list.lst')

  const bits = sl.bits ?? 1
  if (![1, 2, 4, 8].includes(bits)) throw new Error(`unsupported status list bit width: ${bits}`)

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
  if (idx < 0 || !Number.isInteger(idx)) throw new Error(`invalid status index: ${idx}`)

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
