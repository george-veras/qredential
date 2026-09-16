import { b64url, b64urlJson, unb64urlJson } from './bytes.js'
import { importPrivateKey, importPublicKey, sign, verifySignature } from './crypto.js'
import { seconds, nowSeconds } from './duration.js'
import { pack, unpack, isEnvelope } from './envelope.js'
import { parseStatusList, readStatus, isStale } from './status.js'
import {
  digest,
  makeDisclosure,
  splitCombined,
  joinCombined,
  parseDisclosure,
  reconstructClaims,
} from './sdjwt.js'
import type {
  Alg,
  IssueOptions,
  IssueResult,
  RejectedCredential,
  VerifyOptions,
  VerifyResult,
} from './types.js'

export type * from './types.js'
export { fits } from './qr.js'
export type { ErrorCorrection, FitResult } from './qr.js'
export { pack, unpack, isEnvelope } from './envelope.js'
export { createStatusList } from './status.js'
export { encodeBase45, decodeBase45 } from './base45.js'

function reject(reason: RejectedCredential['reason'], message: string): RejectedCredential {
  return { ok: false, reason, message }
}

/** Fisher-Yates. The digest order must not leak which claims the issuer considered sensitive. */
function shuffle<T>(items: T[]): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

export async function issue(options: IssueOptions): Promise<IssueResult> {
  const alg: Alg = options.alg ?? 'ES256'
  const iat = nowSeconds()
  const disclosable = options.disclose ?? []

  const unknown = disclosable.filter((name) => !(name in options.claims))
  if (unknown.length > 0) {
    throw new Error(`disclose lists claims that are not in the credential: ${unknown.join(', ')}`)
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
  options: { disclose: string[] }
): Promise<string> {
  const source = isEnvelope(credential) ? await unpack(credential) : credential
  const { jwt, disclosures } = splitCombined(source)

  const wanted = new Set(options.disclose)
  const available = new Map<string, string>()
  for (const raw of disclosures) available.set(parseDisclosure(raw).name, raw)

  const missing = options.disclose.filter((name) => !available.has(name))
  if (missing.length > 0) {
    throw new Error(`this credential cannot disclose: ${missing.join(', ')}`)
  }

  const kept = disclosures.filter((raw) => wanted.has(parseDisclosure(raw).name))
  return pack(joinCombined(jwt, kept))
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

  const { jwt, disclosures, keyBinding } = splitCombined(combined)
  if (keyBinding !== undefined) {
    return reject('unsupported_feature', 'key binding JWTs are not supported yet, and ignoring one would weaken the check it exists to provide')
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

  let claims: Record<string, unknown>
  let disclosed: string[]
  let withheld: number
  try {
    const rebuilt = await reconstructClaims(payload, disclosures)
    claims = rebuilt.claims
    disclosed = rebuilt.disclosed
    withheld = rebuilt.withheld
  } catch (error) {
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
  }
}
