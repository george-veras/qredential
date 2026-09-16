import { b64url, b64urlJson, unb64urlJson, randomBytes, utf8, timingSafeEqual } from './bytes.js'
import { sha256 } from './crypto.js'

export const SEPARATOR = '~'

/**
 * Registered claims that describe the token rather than the subject.
 *
 * They are kept out of `claims` because every one of them is already surfaced as a typed field on
 * the result. Leaving them mixed in means `Object.keys(result.claims)` hands a caller `iat` and
 * `status` alongside `over_18`, which makes the obvious loop over a person's attributes wrong.
 */
export const REGISTERED_CLAIMS = new Set([
  'iss', 'iat', 'exp', 'nbf', 'sub', 'vct', 'status', 'cnf', '_sd', '_sd_alg',
])

export interface Disclosure {
  /** The transmitted string. The digest is taken over exactly these characters. */
  raw: string
  salt: string
  name: string
  value: unknown
}

export function makeDisclosure(name: string, value: unknown): Disclosure {
  const salt = b64url(randomBytes(16))
  // The array form and its ordering are fixed by the SD-JWT spec: [salt, claim name, claim value].
  const raw = b64urlJson([salt, name, value])
  return { raw, salt, name, value }
}

export function parseDisclosure(raw: string): Disclosure {
  const parsed = unb64urlJson<unknown>(raw)
  if (!Array.isArray(parsed) || parsed.length !== 3) {
    throw new Error('disclosure is not a three element array')
  }
  const [salt, name, value] = parsed as [unknown, unknown, unknown]
  if (typeof salt !== 'string' || typeof name !== 'string') {
    throw new Error('disclosure salt and claim name must be strings')
  }
  return { raw, salt, name, value }
}

/** Digest of a disclosure exactly as transmitted. Hashing a re-serialised copy would not match. */
export async function digest(raw: string): Promise<string> {
  return b64url(await sha256(utf8(raw)))
}

export function splitCombined(combined: string): { jwt: string; disclosures: string[]; keyBinding?: string } {
  const parts = combined.split(SEPARATOR)
  const jwt = parts[0] ?? ''
  const rest = parts.slice(1)

  // The combined form ends with a separator when there is no key binding JWT, which leaves a
  // trailing empty segment. A non-empty final segment is a key binding JWT.
  let keyBinding: string | undefined
  if (rest.length > 0) {
    const last = rest[rest.length - 1]!
    if (last === '') rest.pop()
    else {
      keyBinding = last
      rest.pop()
    }
  }

  // Everything still in `rest` is a disclosure, and an empty one is not a disclosure. Accepting it
  // quietly would mean this parser and a stricter one disagree about whether the same bytes are a
  // valid credential, which is exactly how parser differentials start.
  if (rest.some((d) => d === '')) {
    throw new Error('credential contains an empty disclosure segment')
  }

  return { jwt, disclosures: rest, keyBinding }
}

export function joinCombined(jwt: string, disclosures: string[], keyBinding?: string): string {
  return [jwt, ...disclosures, keyBinding ?? ''].join(SEPARATOR)
}

/**
 * Rebuild the claim set from the always visible payload plus whichever disclosures travelled.
 *
 * Every disclosure has to match a digest the issuer signed. A disclosure that does not is an
 * attempt to add a claim after the fact, so it fails the whole credential rather than being
 * skipped: a verifier that silently ignores an injected claim is the bug that makes the format
 * pointless.
 */
export async function reconstructClaims(
  payload: Record<string, unknown>,
  disclosures: string[]
): Promise<{ claims: Record<string, unknown>; disclosed: string[]; withheld: number }> {
  const sdAlg = (payload['_sd_alg'] as string | undefined) ?? 'sha-256'
  if (sdAlg !== 'sha-256') throw new Error(`unsupported _sd_alg: ${sdAlg}`)

  const signedDigests = Array.isArray(payload['_sd']) ? (payload['_sd'] as string[]) : []
  const claims: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(payload)) {
    if (REGISTERED_CLAIMS.has(key)) continue
    claims[key] = value
  }

  const disclosed: string[] = []
  const seen = new Set<string>()
  for (const raw of disclosures) {
    const d = parseDisclosure(raw)
    const dig = await digest(raw)
    if (!signedDigests.some((s) => timingSafeEqual(s, dig))) {
      throw new Error(`disclosure for "${d.name}" does not match any digest signed by the issuer`)
    }
    if (seen.has(dig)) throw new Error(`disclosure for "${d.name}" was sent more than once`)
    seen.add(dig)
    claims[d.name] = d.value
    disclosed.push(d.name)
  }

  return { claims, disclosed, withheld: signedDigests.length - disclosed.length }
}
