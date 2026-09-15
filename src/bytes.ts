/** Encoding helpers. Everything here is platform neutral: no Buffer, no Node imports. */

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
  const clean = s.replace(/[^A-Za-z0-9\-_]/g, '')
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let acc = 0
  let bits = 0
  let n = 0
  for (const ch of clean) {
    const v = B64URL.indexOf(ch)
    if (v < 0) throw new Error(`invalid base64url character: ${ch}`)
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
  return JSON.parse(fromUtf8(unb64url(s))) as T
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

/** Constant time comparison, so digest checks do not leak position through timing. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
