export type Alg = 'ES256' | 'EdDSA'

export interface Jwk {
  kty: string
  crv?: string
  x?: string
  y?: string
  d?: string
  kid?: string
  alg?: string
  key_ops?: string[]
  [key: string]: unknown
}

export interface IssuerKey {
  kid: string
  alg: Alg
  jwk: Jwk
}

/**
 * The set of issuers a verifier is willing to believe. This is the one thing that has to reach the
 * device out of band. It changes rarely, so shipping it with the app and refreshing it weekly is a
 * perfectly reasonable distribution strategy.
 */
export interface TrustList {
  issuers: Record<string, { name?: string; keys: IssuerKey[] }>
}

export interface StatusPointer {
  /** Index of this credential's bit inside the issuer's status list. */
  idx: number
  /** Where a verifier with connectivity can refresh the list. */
  uri: string
}

export interface IssueOptions {
  issuer: string
  /** Private key in JWK form. It never leaves this call. */
  key: Jwk
  kid: string
  alg?: Alg
  claims: Record<string, unknown>
  /** Claim names the holder may withhold at presentation time. Everything else is always visible. */
  disclose?: string[]
  /** Credential type, the `vct` of SD-JWT VC. */
  vct?: string
  subject?: string
  /** Seconds, or a duration string like '30d'. */
  expiresIn?: number | string
  notBefore?: number | string
  status?: StatusPointer
}

export interface IssueResult {
  /** The SD-JWT combined form. Store this in the wallet. */
  credential: string
  /** The scannable envelope. This is what goes into the QR code. */
  qr: string
  /** Size of `qr` in characters, which is what the QR encoder actually has to fit. */
  bytes: number
  /** Claim names that the holder is able to withhold. */
  disclosable: string[]
}

export type FailReason =
  | 'malformed'
  | 'unsupported_alg'
  | 'unknown_issuer'
  | 'unknown_key'
  | 'bad_signature'
  | 'expired'
  | 'not_yet_valid'
  | 'digest_mismatch'
  | 'revoked'
  | 'status_list_stale'
  | 'status_unavailable'
  | 'unsupported_feature'

export interface VerifyOptions {
  trust: TrustList
  /** A cached status list token. Without it, a credential that points at one cannot be cleared. */
  status?: string
  /** Refuse to answer from a status list older than this. Seconds or a duration string. */
  maxStatusAge?: number | string
  /** Tolerance for clock drift between issuer and verifier, in seconds. Defaults to 60. */
  clockSkew?: number
  /** Override the current time, in seconds since the epoch. Exists for tests and replay analysis. */
  now?: number
}

export interface VerifiedCredential {
  ok: true
  claims: Record<string, unknown>
  issuer: string
  subject?: string
  issuedAt?: number
  expiresAt?: number
  /** Names of the selectively disclosable claims the holder chose to reveal. */
  disclosed: string[]
  /** How many disclosable claims were withheld. Useful for policy, never for identifying them. */
  withheld: number
  /** False when no status list was consulted, so the caller knows revocation was not checked. */
  revocationChecked: boolean
}

export interface RejectedCredential {
  ok: false
  reason: FailReason
  message: string
}

export type VerifyResult = VerifiedCredential | RejectedCredential
