import { concat } from './bytes.js'

export function hasCompression(): boolean {
  return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined'
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) chunks.push(value)
  }
  return concat(...chunks)
}

export async function deflate(bytes: Uint8Array, format: CompressionFormat = 'deflate-raw'): Promise<Uint8Array> {
  const cs = new CompressionStream(format)
  const writer = cs.writable.getWriter()
  void writer.write(bytes as BufferSource)
  void writer.close()
  return drain(cs.readable)
}

export async function inflate(bytes: Uint8Array, format: CompressionFormat = 'deflate-raw'): Promise<Uint8Array> {
  const ds = new DecompressionStream(format)
  const writer = ds.writable.getWriter()
  void writer.write(bytes as BufferSource)
  void writer.close()
  return drain(ds.readable)
}

/**
 * Status list publishers are inconsistent about whether the bitstring carries a zlib header, so
 * try both rather than failing on a credential that is actually fine.
 */
export async function inflateEither(bytes: Uint8Array): Promise<Uint8Array> {
  try {
    return await inflate(bytes, 'deflate')
  } catch {
    return await inflate(bytes, 'deflate-raw')
  }
}
