import { encodeBase45, decodeBase45 } from './base45.js'
import { utf8, fromUtf8, concat } from './bytes.js'
import { deflate, inflate, hasCompression } from './compress.js'
import { QredentialError, isQredentialError } from './errors.js'

export const PREFIX = 'QC1:'

const FLAG_RAW = 0x00
const FLAG_DEFLATE = 0x01

/**
 * Wrap a credential string into the scannable envelope.
 *
 * Compression is attempted and then kept only if it actually helped. Short payloads sometimes grow
 * under deflate, and silently shipping the larger one would be a bug nobody would ever notice.
 * React Native has no CompressionStream, so the uncompressed path is a supported outcome rather
 * than a failure: the flag byte tells the decoder which one it got.
 */
export async function pack(payload: string): Promise<string> {
  const raw = utf8(payload)
  let flag = FLAG_RAW
  let body = raw

  if (hasCompression()) {
    const squeezed = await deflate(raw)
    if (squeezed.length < raw.length) {
      flag = FLAG_DEFLATE
      body = squeezed
    }
  }

  return PREFIX + encodeBase45(concat(new Uint8Array([flag]), body))
}

export async function unpack(envelope: string): Promise<string> {
  if (!envelope.startsWith(PREFIX)) {
    throw new QredentialError(
      'malformed_envelope',
      `not a qredential envelope: expected the ${PREFIX} prefix`
    )
  }
  let bytes: Uint8Array
  try {
    bytes = decodeBase45(envelope.slice(PREFIX.length))
  } catch (error) {
    throw new QredentialError('malformed_envelope', 'envelope is not valid base45', { cause: error })
  }
  // One byte is a complete envelope: the flag, with an empty payload after it.
  if (bytes.length < 1) throw new QredentialError('malformed_envelope', 'envelope is truncated')

  const flag = bytes[0]!
  const body = bytes.subarray(1)

  if (flag === FLAG_RAW) return fromUtf8(body)
  if (flag === FLAG_DEFLATE) {
    if (!hasCompression()) {
      throw new QredentialError(
        'unsupported_runtime',
        'this credential is deflate compressed and the runtime has no DecompressionStream'
      )
    }
    return fromUtf8(await inflate(body))
  }
  throw new QredentialError(
    'malformed_envelope',
    `unknown envelope encoding flag: 0x${flag.toString(16)}`
  )
}

export function isEnvelope(text: string): boolean {
  return text.startsWith(PREFIX)
}
