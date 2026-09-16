/** Encoding helpers. Everything here is platform neutral: no Buffer, no Node imports. */

import { QredentialError } from './errors.js'

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

export function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

export function fromUtf8(b: Uint8Array): string {
  return new TextDecoder().decode(b)
}

export function b64url(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    out += B64URL[a >> 2]
    out += B64URL[((a & 3) << 4) | ((b ?? 0) >> 4)]
    if (b === undefined) break
    out += B64URL[((b & 15) << 2) | ((c ?? 0) >> 6)]
    if (c === undefined) break
    out += B64URL[c & 63]
  }
  return out
}

export function unb64url(s: string): Uint8Array {
  const out = new Uint8Array(Math.floor((s.length * 3) / 4))
  let acc = 0
  let bits = 0
  let n = 0
  for (const ch of s) {
    const v = B64URL.indexOf(ch)
    if (v < 0) throw new QredentialError('invalid_encoding', `invalid base64url character: ${ch}`)
    acc = (acc << 6) | v
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[n++] = (acc >> bits) & 0xff
    }
  }
  return out.subarray(0, n)
}

/** JSON in, base64url out. Used for JWT segments and SD-JWT disclosures. */
export function b64urlJson(value: unknown): string {
  return b64url(utf8(JSON.stringify(value)))
}

export function unb64urlJson<T = unknown>(s: string): T {
  const text = fromUtf8(unb64url(s))
  try {
    return JSON.parse(text) as T
  } catch (error) {
    // JSON.parse throws SyntaxError, which is not this library's error and is documented nowhere.
    throw new QredentialError('invalid_encoding', 'segment is not valid JSON', { cause: error })
  }
}

export function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n)
  crypto.getRandomValues(b)
  return b
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/**
 * Length-independent comparison for the digest checks.
 *
 * Being honest about what this buys: the caller scans a list with `.some`, which short-circuits, so
 * the search as a whole is not constant time. Digests are public values and there is no secret to
 * leak here, but comparing them without an early return costs nothing and keeps the habit.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
