import { b64url, b64urlJson, unb64urlJson } from './bytes.js'
import { algForJwk, importPrivateKey, importPublicKey, sign, verifySignature } from './crypto.js'
import { seconds, nowSeconds } from './duration.js'
import { pack, unpack, isEnvelope } from './envelope.js'
import { parseStatusList, readStatus, isStale } from './status.js'
import {
  REGISTERED_CLAIMS,
  digest,
  sdHash,
  makeDisclosure,
  splitCombined,
  joinCombined,
  parseDisclosure,
  reconstructClaims,
} from './sdjwt.js'
import { QredentialError } from './errors.js'
import type {
  Alg,
  Jwk,
  KeyBindingRequest,
  IssueOptions,
  IssueResult,
  RejectedCredential,
  VerifiedCredential,
  VerifyOptions,
  VerifyResult,
} from './types.js'

export type * from './types.js'
export { QredentialError, isQredentialError } from './errors.js'
export type { ErrorCode, QredentialErrorOptions } from './errors.js'

/**
 * Turn a rejected result into a thrown {@link QredentialError}, for callers who would rather use
 * try/catch than branch on `result.ok`.
 *
 * The thrown error carries `code: 'verification_failed'` and the original `reason`, so nothing is
 * lost by choosing this style.
 *
 * ```ts
 * const credential = assertVerified(await verify(scanned, { trust }))
 * console.log(credential.claims.over_18)
 * ```
 */
export function assertVerified(result: VerifyResult): VerifiedCredential {
  if (result.ok) return result
  throw new QredentialError('verification_failed', result.message, { reason: result.reason })
}
export { fits } from './qr.js'
export type { ErrorCorrection, FitResult } from './qr.js'
export { pack, unpack, isEnvelope } from './envelope.js'
export { createStatusList } from './status.js'
export { encodeBase45, decodeBase45 } from './base45.js'

function reject(reason: RejectedCredential['reason'], message: string): RejectedCredential {
  return { ok: false, reason, message }
}

/**
 * Fisher-Yates over a cryptographic source.
 *
 * The digest order is what hides which claims the issuer considered sensitive, so the permutation
 * is a privacy property, not a cosmetic one. Math.random cannot carry it: V8 seeds xorshift128+
 * from a recoverable state, and an observer with enough credentials from one issuer could predict
 * the permutation and map digest positions back to claim order.
 *
 * Rejection sampling keeps the distribution uniform; taking a modulo of a random word would bias
 * the low indices.
 */
function shuffle<T>(items: T[]): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomBelow(i + 1)
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

function randomBelow(bound: number): number {
  if (bound <= 1) return 0
  const limit = Math.floor(0xffffffff / bound) * bound
  const word = new Uint32Array(1)
  for (;;) {
    crypto.getRandomValues(word)
    if (word[0]! < limit) return word[0]! % bound
  }
}

export async function issue(options: IssueOptions): Promise<IssueResult> {
  const alg: Alg = options.alg ?? 'ES256'
  const iat = nowSeconds()
  const disclosable = options.disclose ?? []

  const unknown = disclosable.filter((name) => !(name in options.claims))
  if (unknown.length > 0) {
    throw new QredentialError(
      'invalid_option',
      `disclose lists claims that are not in the credential: ${unknown.join(', ')}`
    )
  }

  // RFC 9901 section 4.2.1: a disclosure's claim name must not be _sd, ..., or a claim that
  // describes the token rather than the subject. Without this the library would happily issue a
  // credential that its own verifier refuses, which is the worst kind of inconsistency to ship.
  const reserved = disclosable.filter((name) => name === '...' || REGISTERED_CLAIMS.has(name))
  if (reserved.length > 0) {
    throw new QredentialError(
      'invalid_option',
      `these claim names describe the token, not the subject, and cannot be made disclosable: ${reserved.join(', ')}`
    )
  }

  const disclosures = disclosable.map((name) => makeDisclosure(name, options.claims[name]))
  const digests = shuffle(await Promise.all(disclosures.map((d) => digest(d.raw))))

  const payload: Record<string, unknown> = { iss: options.issuer, iat }
  for (const [key, value] of Object.entries(options.claims)) {
    if (!disclosable.includes(key)) payload[key] = value
  }
  if (options.subject !== undefined) payload['sub'] = options.subject
  if (options.vct !== undefined) payload['vct'] = options.vct
  if (options.expiresIn !== undefined) payload['exp'] = iat + seconds(options.expiresIn)
  if (options.notBefore !== undefined) payload['nbf'] = iat + seconds(options.notBefore)
  if (options.status !== undefined) {
    payload['status'] = { status_list: { idx: options.status.idx, uri: options.status.uri } }
  }
  if (options.holderKey !== undefined) {
    const held: Jwk = { ...options.holderKey }
    // A private component here would be an issuer publishing the holder's secret inside a signed,
    // widely copied credential. Refuse rather than strip it silently.
    if (held.d !== undefined) {
      throw new QredentialError(
        'invalid_option',
        'holderKey must be the public key; this one carries a private component'
      )
    }
    delete held.key_ops
    payload['cnf'] = { jwk: held }
  }
  if (digests.length > 0) {
    payload['_sd'] = digests
    payload['_sd_alg'] = 'sha-256'
  }

  const header = { alg, typ: 'dc+sd-jwt', kid: options.kid }
  const signingInput = `${b64urlJson(header)}.${b64urlJson(payload)}`
  const key = await importPrivateKey(options.key, alg)
  const jwt = `${signingInput}.${b64url(await sign(signingInput, key, alg))}`

  const credential = joinCombined(jwt, disclosures.map((d) => d.raw))
  const qr = await pack(credential)

  return { credential, qr, bytes: qr.length, disclosable }
}

/**
 * Narrow a credential to the claims the holder is willing to show, then wrap it for scanning.
 *
 * The signed JWT is never touched. Withholding a claim just means its disclosure does not travel,
 * so the verifier ends up holding a digest it can never open.
 */
export async function present(
  credential: string,
  options: { disclose: string[]; keyBinding?: KeyBindingRequest }
): Promise<string> {
  const source = isEnvelope(credential) ? await unpack(credential) : credential
  const { jwt, disclosures } = splitCombined(source)

  const wanted = new Set(options.disclose)
  const available = new Map<string, string>()
  for (const raw of disclosures) available.set(parseDisclosure(raw).name, raw)

  const missing = options.disclose.filter((name) => !available.has(name))
  if (missing.length > 0) {
    throw new QredentialError('not_disclosable', `this credential cannot disclose: ${missing.join(', ')}`)
  }

  const kept = disclosures.filter((raw) => wanted.has(parseDisclosure(raw).name))

  if (options.keyBinding === undefined) return pack(joinCombined(jwt, kept))

  const bound = readHolderKey(jwt)
  if (bound === null) {
    throw new QredentialError(
      'invalid_option',
      'this credential has no cnf claim, so the issuer never bound a holder key and a proof would mean nothing'
    )
  }

  const alg = options.keyBinding.alg ?? algForJwk(options.keyBinding.key)
  const kbPayload = {
    iat: nowSeconds(),
    aud: options.keyBinding.audience,
    nonce: options.keyBinding.nonce,
    // Commits to exactly this set of disclosures, so a relay cannot add or strip one afterwards.
    sd_hash: await sdHash(jwt, kept),
  }
  const kbInput = `${b64urlJson({ alg, typ: 'kb+jwt' })}.${b64urlJson(kbPayload)}`
  const holderKey = await importPrivateKey(options.keyBinding.key, alg)
  const kbJwt = `${kbInput}.${b64url(await sign(kbInput, holderKey, alg))}`

  return pack(joinCombined(jwt, kept, kbJwt))
}

/** Pull the bound holder key out of a credential's payload, without verifying anything. */
function readHolderKey(jwt: string): Jwk | null {
  const segments = jwt.split('.')
  if (segments.length !== 3) return null
  try {
    const payload = unb64urlJson<Record<string, unknown>>(segments[1]!)
    const cnf = payload['cnf'] as { jwk?: Jwk } | undefined
    return cnf?.jwk ?? null
  } catch {
    return null
  }
}

export async function verify(input: string, options: VerifyOptions): Promise<VerifyResult> {
  const now = options.now ?? nowSeconds()
  const skew = options.clockSkew ?? 60

  let combined: string
  try {
    combined = isEnvelope(input) ? await unpack(input) : input
  } catch (error) {
    return reject('malformed', (error as Error).message)
  }

  let jwt: string
  let disclosures: string[]
  let keyBinding: string | undefined
  try {
    // Strict parsing throws, and verify() is the one place that must never do that: hostile input
    // is its whole job, and a verifier that throws gets wrapped in a try/catch that waves people
    // through.
    ;({ jwt, disclosures, keyBinding } = splitCombined(combined))
  } catch (error) {
    return reject('malformed', (error as Error).message)
  }

  const segments = jwt.split('.')
  if (segments.length !== 3) return reject('malformed', 'credential JWT does not have three segments')

  let header: { alg?: string; kid?: string }
  let payload: Record<string, unknown>
  try {
    header = unb64urlJson(segments[0]!)
    payload = unb64urlJson(segments[1]!)
  } catch (error) {
    return reject('malformed', `could not parse the credential: ${(error as Error).message}`)
  }

  const issuer = typeof payload['iss'] === 'string' ? payload['iss'] : undefined
  if (!issuer) return reject('malformed', 'credential has no iss claim')

  const entry = options.trust.issuers[issuer]
  if (!entry) return reject('unknown_issuer', `no trusted key for issuer ${issuer}`)

  const candidates = header.kid ? entry.keys.filter((k) => k.kid === header.kid) : entry.keys
  if (candidates.length === 0) {
    return reject('unknown_key', `issuer ${issuer} has no trusted key with kid ${String(header.kid)}`)
  }

  // The trusted key decides the algorithm, never the attacker supplied header.
  const key = candidates.find((k) => k.alg === header.alg)
  if (!key) {
    return reject('unsupported_alg', `header asks for ${String(header.alg)} but the trusted key for that kid is ${candidates[0]!.alg}`)
  }

  const signingInput = `${segments[0]}.${segments[1]}`
  const publicKey = await importPublicKey(key.jwk, key.alg)
  if (!(await verifySignature(signingInput, segments[2]!, publicKey, key.alg))) {
    return reject('bad_signature', 'the issuer signature does not check out')
  }

  const exp = typeof payload['exp'] === 'number' ? payload['exp'] : undefined
  const nbf = typeof payload['nbf'] === 'number' ? payload['nbf'] : undefined
  if (exp !== undefined && now > exp + skew) {
    return reject('expired', `credential expired at ${new Date(exp * 1000).toISOString()}`)
  }
  if (nbf !== undefined && now + skew < nbf) {
    return reject('not_yet_valid', `credential is not valid until ${new Date(nbf * 1000).toISOString()}`)
  }

  const holderProof = await checkHolderProof({
    payload,
    jwt,
    disclosures,
    keyBinding,
    options,
    now,
    skew,
  })
  if (holderProof.rejected) return holderProof.rejected

  let claims: Record<string, unknown>
  let disclosed: string[]
  let withheld: number
  try {
    const rebuilt = await reconstructClaims(payload, disclosures)
    claims = rebuilt.claims
    disclosed = rebuilt.disclosed
    withheld = rebuilt.withheld
  } catch (error) {
    if (error instanceof QredentialError && error.code === 'unsupported_feature') {
      return reject('unsupported_feature', error.message)
    }
    return reject('digest_mismatch', (error as Error).message)
  }

  let revocationChecked = false
  const pointer = (payload['status'] as { status_list?: { idx: number; uri: string } } | undefined)?.status_list
  if (pointer) {
    if (!options.status) {
      return reject('status_unavailable', `this credential points at the status list ${pointer.uri} and no cached copy was provided`)
    }
    try {
      const { payload: listPayload, list } = await parseStatusList(options.status)

      const listIssuer = String(listPayload['iss'] ?? '')
      const listEntry = options.trust.issuers[listIssuer]
      if (!listEntry) return reject('unknown_issuer', `the status list is signed by the untrusted issuer ${listIssuer}`)

      // Bind the list to this credential. Without both checks any list from any trusted issuer
      // would clear any credential, and an index means something different in every list.
      if (listIssuer !== issuer) {
        return reject(
          'status_unavailable',
          `the status list is issued by ${listIssuer} but the credential is issued by ${issuer}`
        )
      }
      if (list.uri !== undefined && list.uri !== pointer.uri) {
        return reject(
          'status_unavailable',
          `the credential points at ${pointer.uri} but the cached list is ${list.uri}`
        )
      }

      const listSegments = options.status.split('.')
      const listHeader = unb64urlJson<{ alg?: string; kid?: string }>(listSegments[0]!)
      const listKey = listEntry.keys.find((k) => (!listHeader.kid || k.kid === listHeader.kid) && k.alg === listHeader.alg)
      if (!listKey) return reject('unknown_key', 'no trusted key matches the status list signature')

      const listPublic = await importPublicKey(listKey.jwk, listKey.alg)
      const listInput = `${listSegments[0]}.${listSegments[1]}`
      if (!(await verifySignature(listInput, listSegments[2]!, listPublic, listKey.alg))) {
        return reject('bad_signature', 'the status list signature does not check out')
      }

      if (isStale(list, options.maxStatusAge, now)) {
        return reject('status_list_stale', 'the cached status list is older than maxStatusAge, so revocation cannot be ruled out')
      }

      const state = readStatus(list, pointer.idx)
      if (state === 'invalid') return reject('revoked', 'the issuer has revoked this credential')
      if (state === 'suspended') return reject('revoked', 'the issuer has suspended this credential')
      if (state === 'unknown') {
        // The index falls outside the list, so nothing was actually checked. Reporting this as a
        // clean result would be the worst outcome available: a false assurance.
        return reject(
          'status_unavailable',
          `index ${pointer.idx} is outside the cached status list, so revocation was not checked`
        )
      }
      revocationChecked = true
    } catch (error) {
      return reject('status_unavailable', `could not read the status list: ${(error as Error).message}`)
    }
  }

  return {
    ok: true,
    claims,
    issuer,
    subject: typeof payload['sub'] === 'string' ? payload['sub'] : undefined,
    vct: typeof payload['vct'] === 'string' ? payload['vct'] : undefined,
    issuedAt: typeof payload['iat'] === 'number' ? payload['iat'] : undefined,
    expiresAt: exp,
    disclosed,
    withheld,
    revocationChecked,
    holderVerified: holderProof.holderVerified,
  }
}

/**
 * Decide whether the person presenting this credential proved it is theirs.
 *
 * Four states, and only one of them is a silent pass:
 *
 *   - bound key, valid proof              -> holderVerified true
 *   - bound key, no proof                 -> refuse, unless the caller opted out
 *   - no bound key (a static credential)  -> refuse, unless the caller opted out
 *   - proof without a bound key           -> always refuse, it is signed by nobody in particular
 */
async function checkHolderProof(input: {
  payload: Record<string, unknown>
  jwt: string
  disclosures: string[]
  keyBinding: string | undefined
  options: VerifyOptions
  now: number
  skew: number
}): Promise<{ rejected?: RejectedCredential; holderVerified: boolean }> {
  const { payload, jwt, disclosures, keyBinding, options, now, skew } = input
  const cnf = payload['cnf'] as { jwk?: Jwk } | undefined
  const boundKey = cnf?.jwk

  if (keyBinding === undefined) {
    if (options.acceptWithoutHolderProof === true) return { holderVerified: false }
    return {
      rejected: reject(
        'holder_proof_missing',
        boundKey
          ? 'this credential is bound to a holder key but the presentation carries no proof. Pass nonce and audience to require one, or acceptWithoutHolderProof to accept a copyable presentation.'
          : 'the issuer bound no holder key, so anyone with a copy of this code can present it. Pass acceptWithoutHolderProof if that is acceptable for this credential.'
      ),
      holderVerified: false,
    }
  }

  if (!boundKey) {
    return {
      rejected: reject(
        'holder_proof_invalid',
        'the presentation carries a holder proof but the issuer bound no key to this credential, so the proof attests to nothing'
      ),
      holderVerified: false,
    }
  }

  if (typeof options.nonce !== 'string' || typeof options.audience !== 'string') {
    return {
      rejected: reject(
        'holder_proof_invalid',
        'checking a holder proof needs the nonce and audience this verifier issued for this scan'
      ),
      holderVerified: false,
    }
  }

  const segments = keyBinding.split('.')
  if (segments.length !== 3) {
    return { rejected: reject('holder_proof_invalid', 'the holder proof is not a JWT'), holderVerified: false }
  }

  let kbHeader: { alg?: string; typ?: string }
  let kbPayload: Record<string, unknown>
  try {
    kbHeader = unb64urlJson(segments[0]!)
    kbPayload = unb64urlJson(segments[1]!)
  } catch (error) {
    return {
      rejected: reject('holder_proof_invalid', `could not read the holder proof: ${(error as Error).message}`),
      holderVerified: false,
    }
  }

  if (kbHeader.typ !== 'kb+jwt') {
    return {
      rejected: reject('holder_proof_invalid', `holder proof has typ ${String(kbHeader.typ)}, expected kb+jwt`),
      holderVerified: false,
    }
  }

  // The bound key decides the algorithm, never the header the presenter supplied.
  let alg: Alg
  try {
    alg = algForJwk(boundKey)
  } catch (error) {
    return { rejected: reject('holder_proof_invalid', (error as Error).message), holderVerified: false }
  }
  if (kbHeader.alg !== alg) {
    return {
      rejected: reject('holder_proof_invalid', `holder proof claims ${String(kbHeader.alg)} but the bound key is ${alg}`),
      holderVerified: false,
    }
  }

  let holderPublic: CryptoKey
  try {
    holderPublic = await importPublicKey(boundKey, alg)
  } catch (error) {
    return { rejected: reject('holder_proof_invalid', (error as Error).message), holderVerified: false }
  }

  const kbInput = `${segments[0]}.${segments[1]}`
  if (!(await verifySignature(kbInput, segments[2]!, holderPublic, alg))) {
    return {
      rejected: reject('holder_proof_invalid', 'the holder proof is not signed by the key the issuer bound'),
      holderVerified: false,
    }
  }

  if (kbPayload['aud'] !== options.audience) {
    return {
      rejected: reject('holder_proof_invalid', `the holder proof was made for ${String(kbPayload['aud'])}, not for ${options.audience}`),
      holderVerified: false,
    }
  }
  if (kbPayload['nonce'] !== options.nonce) {
    return {
      rejected: reject('holder_proof_invalid', 'the holder proof answers a different challenge, which is what a replayed presentation looks like'),
      holderVerified: false,
    }
  }

  const expected = await sdHash(jwt, disclosures)
  if (kbPayload['sd_hash'] !== expected) {
    return {
      rejected: reject('holder_proof_invalid', 'the holder proof commits to a different set of disclosures than the one presented'),
      holderVerified: false,
    }
  }

  const iat = typeof kbPayload['iat'] === 'number' ? kbPayload['iat'] : undefined
  if (iat === undefined) {
    return { rejected: reject('holder_proof_invalid', 'the holder proof has no iat'), holderVerified: false }
  }
  const maxAge = seconds(options.maxKeyBindingAge ?? 300)
  if (now - iat > maxAge) {
    return {
      rejected: reject('holder_proof_invalid', `the holder proof is ${now - iat} seconds old, past the ${maxAge} second limit`),
      holderVerified: false,
    }
  }
  if (iat - now > skew) {
    return { rejected: reject('holder_proof_invalid', 'the holder proof is dated in the future'), holderVerified: false }
  }

  return { holderVerified: true }
}
