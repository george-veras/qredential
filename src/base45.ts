/**
 * base45, RFC 9285.
 *
 * The reason this exists instead of base64: QR codes have a dedicated alphanumeric mode that packs
 * 2 characters into 11 bits, but its alphabet is only 45 characters and does not include lowercase.
 * base64 forces the encoder into byte mode, which costs 8 bits per character. Encoding the same
 * payload as base45 and letting the QR encoder use alphanumeric mode is meaningfully smaller in
 * practice, which is why the EU covid certificate used it.
 */

import { QredentialError } from './errors.js'

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:'

const REVERSE: Record<string, number> = {}
for (let i = 0; i < ALPHABET.length; i++) REVERSE[ALPHABET[i]!] = i

export function encodeBase45(bytes: Uint8Array): string {
  let out = ''
  let i = 0
  for (; i + 1 < bytes.length; i += 2) {
    // Two bytes become a number below 65536, which always fits in three base45 digits.
    const n = bytes[i]! * 256 + bytes[i + 1]!
    out += ALPHABET[n % 45]
    out += ALPHABET[Math.floor(n / 45) % 45]
    out += ALPHABET[Math.floor(n / 2025)]
  }
  if (i < bytes.length) {
    // A single trailing byte is below 256 and takes two digits.
    const n = bytes[i]!
    out += ALPHABET[n % 45]
    out += ALPHABET[Math.floor(n / 45)]
  }
  return out
}

export function decodeBase45(text: string): Uint8Array {
  const values: number[] = []
  for (const ch of text) {
    const v = REVERSE[ch]
    if (v === undefined) {
      throw new QredentialError('invalid_encoding', `invalid base45 character: ${JSON.stringify(ch)}`)
    }
    values.push(v)
  }

  const remainder = values.length % 3
  if (remainder === 1) throw new QredentialError('invalid_encoding', 'invalid base45 length')

  const out: number[] = []
  let i = 0
  for (; i + 2 < values.length; i += 3) {
    const n = values[i]! + values[i + 1]! * 45 + values[i + 2]! * 2025
    if (n > 0xffff) {
      throw new QredentialError('invalid_encoding', 'invalid base45 triplet: value exceeds two bytes')
    }
    out.push(n >> 8, n & 0xff)
  }
  if (remainder === 2) {
    const n = values[i]! + values[i + 1]! * 45
    if (n > 0xff) {
      throw new QredentialError('invalid_encoding', 'invalid base45 pair: value exceeds one byte')
    }
    out.push(n)
  }
  return new Uint8Array(out)
}
