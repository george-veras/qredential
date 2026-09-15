import { describe, it, expect } from 'vitest'
import { encodeBase45, decodeBase45 } from '../src/base45.js'
import { utf8, fromUtf8 } from '../src/bytes.js'

describe('base45', () => {
  // Test vectors straight out of RFC 9285.
  it.each([
    ['AB', 'BB8'],
    ['Hello!!', '%69 VD92EX0'],
    ['base-45', 'UJCLQE7W581'],
    ['ietf!', 'QED8WEX0'],
  ])('encodes %j as %j', (plain, encoded) => {
    expect(encodeBase45(utf8(plain))).toBe(encoded)
    expect(fromUtf8(decodeBase45(encoded))).toBe(plain)
  })

  it('round trips arbitrary bytes, including the odd length case', () => {
    for (const size of [0, 1, 2, 3, 17, 256, 1024]) {
      const bytes = crypto.getRandomValues(new Uint8Array(size))
      expect(Array.from(decodeBase45(encodeBase45(bytes)))).toEqual(Array.from(bytes))
    }
  })

  it('rejects a length that cannot be produced by the encoder', () => {
    expect(() => decodeBase45('BB8B')).toThrow(/invalid base45 length/)
  })

  it('rejects characters outside the alphabet', () => {
    expect(() => decodeBase45('bb8')).toThrow(/invalid base45 character/)
  })

  it('rejects a triplet that decodes above two bytes', () => {
    // 'GGW' is 16 + 16*45 + 32*2025 = 65536, one past the maximum a two byte group can hold.
    expect(() => decodeBase45('GGW')).toThrow(/exceeds two bytes/)
  })
})
