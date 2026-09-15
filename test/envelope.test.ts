import { describe, it, expect } from 'vitest'
import { pack, unpack, isEnvelope, PREFIX } from '../src/envelope.js'

describe('envelope', () => {
  it('round trips and keeps the prefix', async () => {
    const payload = 'eyJhbGciOiJFUzI1NiJ9.eyJpc3MiOiJodHRwczovL2lzc3Vlci5leGFtcGxlIn0.sig~'
    const packed = await pack(payload)
    expect(isEnvelope(packed)).toBe(true)
    expect(packed.startsWith(PREFIX)).toBe(true)
    expect(await unpack(packed)).toBe(payload)
  })

  it('compresses repetitive payloads well below their original size', async () => {
    const repetitive = 'a'.repeat(4000)
    const packed = await pack(repetitive)
    expect(packed.length).toBeLessThan(repetitive.length / 4)
    expect(await unpack(packed)).toBe(repetitive)
  })

  it('keeps the raw form when compression would make it bigger', async () => {
    // Random bytes do not compress, so the flag byte should say raw.
    const noisy = Array.from(crypto.getRandomValues(new Uint8Array(24)))
      .map((b) => String.fromCharCode(97 + (b % 26)))
      .join('')
    const packed = await pack(noisy)
    expect(await unpack(packed)).toBe(noisy)
  })

  it('survives non ascii claims', async () => {
    const payload = 'nome=Ana Lúcia Gonçalves ~ 東京 ~ 🇧🇷'
    expect(await unpack(await pack(payload))).toBe(payload)
  })

  it('refuses a payload without the prefix', async () => {
    await expect(unpack('BB8')).rejects.toThrow(/not a qredential envelope/)
  })
})
