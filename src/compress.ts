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

/**
 * Feed a transform stream and collect what comes out.
 *
 * The subtlety is the writable side. When the stream errors on malformed input, the write and close
 * promises reject too. Leaving them floating turns hostile input into an unhandled rejection, which
 * modern Node treats as fatal: a verifier that takes the process down with it is worse than one
 * that returns false. They are settled here, while the real error still surfaces through the
 * readable side, where the caller is waiting for it.
 */
async function run(
  transform: { writable: WritableStream<BufferSource>; readable: ReadableStream<Uint8Array> },
  bytes: Uint8Array
): Promise<Uint8Array> {
  const writer = transform.writable.getWriter()
  const pumped = writer
    .write(bytes as BufferSource)
    .then(() => writer.close())
    .catch(() => undefined)

  try {
    return await drain(transform.readable)
  } finally {
    await pumped
  }
}

export async function deflate(bytes: Uint8Array, format: CompressionFormat = 'deflate-raw'): Promise<Uint8Array> {
  return run(new CompressionStream(format), bytes)
}

export async function inflate(bytes: Uint8Array, format: CompressionFormat = 'deflate-raw'): Promise<Uint8Array> {
  return run(new DecompressionStream(format), bytes)
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
