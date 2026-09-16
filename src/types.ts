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
  /**
   * The holder's **public** key, written into the `cnf` claim.
   *
   * This is what makes key binding possible later. Without it a presentation proves the issuer
   * signed the claims but not that the person presenting is the subject, so a photograph of
   * someone else's code works. Omit it only for credentials that are inherently static, such as one
   * printed on a card, where no device can sign at scan time.
   */
  holderKey?: Jwk
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
  /** The presentation carries no holder proof and the caller did not opt into accepting that. */
  | 'holder_proof_missing'
  /** A holder proof is present but does not hold up: wrong key, nonce, audience, age or contents. */
  | 'holder_proof_invalid'
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

/** What the holder's wallet signs at presentation time to prove the credential is theirs. */
export interface KeyBindingRequest {
  /** The holder's **private** key. Must match the `cnf` key the issuer wrote in. */
  key: Jwk
  /** Who is asking. Echoed into `aud` and checked by that verifier. */
  audience: string
  /** The verifier's fresh challenge. This is what stops a recorded presentation being replayed. */
  nonce: string
  alg?: Alg
}

export interface VerifyOptions {
  trust: TrustList
  /**
   * The challenge this verifier issued for this scan. Required to accept a holder proof.
   */
  nonce?: string
  /** This verifier's own identifier, checked against the proof's `aud`. */
  audience?: string
  /**
   * Accept a presentation with no holder proof.
   *
   * Say yes only for credentials that are inherently static, such as one printed on a card, and
   * know what it costs: anyone who photographs the code can present it. The result reports
   * `holderVerified: false` either way, so the fact never disappears.
   */
  acceptWithoutHolderProof?: boolean
  /** How old a holder proof may be. Seconds or a duration string. Defaults to 5 minutes. */
  maxKeyBindingAge?: number | string
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
  /** Credential type from the `vct` claim, when the issuer set one. */
  vct?: string
  issuedAt?: number
  expiresAt?: number
  /** Names of the selectively disclosable claims the holder chose to reveal. */
  disclosed: string[]
  /** How many disclosable claims were withheld. Useful for policy, never for identifying them. */
  withheld: number
  /** False when no status list was consulted, so the caller knows revocation was not checked. */
  revocationChecked: boolean
  /**
   * True when the holder proved possession of the key the issuer bound to this credential.
   *
   * False means the credential is authentic but anyone holding a copy could have presented it.
   * That is a legitimate state for a static credential, and it is reported rather than hidden.
   */
  holderVerified: boolean
}

export interface RejectedCredential {
  ok: false
  reason: FailReason
  message: string
}

export type VerifyResult = VerifiedCredential | RejectedCredential
