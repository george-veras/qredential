/**
 * The error model, in one place.
 *
 * There are exactly two contracts, and the split is deliberate:
 *
 * 1. **`verify()` never throws.** Its entire job is hostile input, and a verifier that throws is one
 *    a caller wraps in a try/catch that waves people through. It returns a discriminated union, and
 *    a failure carries a `reason` from {@link FailReason}.
 *
 * 2. **Everything else throws {@link QredentialError}.** These are conditions a caller fixes in
 *    code: a bad option, a malformed key, a credential string that was damaged before it reached
 *    the library. Every one carries a stable `code`.
 *
 * `code` values are part of the public API and follow semver: a code is never repurposed, and new
 * ones are added only in minor versions. Message text is *not* part of the API. Branch on `code`,
 * never on the message.
 */

import type { FailReason } from './types.js'

export type ErrorCode =
  /** An argument the API cannot use: an unknown claim name, an index outside the list, a bad duration. */
  | 'invalid_option'
  /** `present()` was asked to reveal a claim the issuer never made disclosable. */
  | 'not_disclosable'
  /** The SD-JWT combined form is not well formed. */
  | 'malformed_credential'
  /** The QR envelope is not well formed. Its `cause` carries the codec error when there was one. */
  | 'malformed_envelope'
  /** A status list token is not well formed. */
  | 'malformed_status_list'
  /** Text that should have been base45 or base64url is not. */
  | 'invalid_encoding'
  /** An algorithm this version does not implement. */
  | 'unsupported_alg'
  /** The platform is missing something required, such as DecompressionStream on React Native. */
  | 'unsupported_runtime'
  /** WebCrypto refused a key or an operation. Its `cause` is the original DOMException. */
  | 'crypto_failure'
  /** Only from {@link assertVerified}, for callers who prefer try/catch over the result union. */
  | 'verification_failed'

export interface QredentialErrorOptions {
  cause?: unknown
  /** Present only on `verification_failed`, carrying the reason the credential was rejected. */
  reason?: FailReason
}

export class QredentialError extends Error {
  /** Stable, documented, safe to branch on. */
  readonly code: ErrorCode
  /** Set only when `code` is `verification_failed`. */
  readonly reason?: FailReason

  constructor(code: ErrorCode, message: string, options: QredentialErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = 'QredentialError'
    this.code = code
    if (options.reason !== undefined) this.reason = options.reason

    // Keeps instanceof working when the output is transpiled down to ES5 by a consumer's bundler.
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/**
 * Narrowing type guard.
 *
 * It checks the shape rather than the prototype, so it still works when two copies of the package
 * end up in one dependency tree, which is the usual reason `instanceof` quietly stops matching.
 */
export function isQredentialError(value: unknown): value is QredentialError {
  return (
    value instanceof Error &&
    value.name === 'QredentialError' &&
    typeof (value as QredentialError).code === 'string'
  )
}

/** Wrap anything WebCrypto throws, so a caller never sees a bare DOMException from this library. */
export function asCryptoFailure(what: string, cause: unknown): QredentialError {
  const detail = cause instanceof Error ? `: ${cause.message}` : ''
  return new QredentialError('crypto_failure', `${what}${detail}`, { cause })
}
