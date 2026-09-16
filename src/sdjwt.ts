import { b64url, b64urlJson, unb64urlJson, randomBytes, utf8 } from './bytes.js'
import { digestHash, isSupportedSdAlg } from './crypto.js'
import { QredentialError } from './errors.js'

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
  /** Present for an object property, absent for an array element. */
  name?: string
  value: unknown
  kind: 'property' | 'element'
}

export function makeDisclosure(name: string, value: unknown): Disclosure {
  const salt = b64url(randomBytes(16))
  // The array form and its ordering are fixed by RFC 9901: [salt, claim name, claim value].
  const raw = b64urlJson([salt, name, value])
  return { raw, salt, name, value, kind: 'property' }
}

/** RFC 9901 section 4.2.2: an array element disclosure carries no claim name. */
export function makeElementDisclosure(value: unknown): Disclosure {
  const salt = b64url(randomBytes(16))
  const raw = b64urlJson([salt, value])
  return { raw, salt, value, kind: 'element' }
}

export function parseDisclosure(raw: string): Disclosure {
  let parsed: unknown
  try {
    parsed = unb64urlJson<unknown>(raw)
  } catch (error) {
    throw new QredentialError('malformed_credential', 'disclosure is not readable', { cause: error })
  }
  if (!Array.isArray(parsed) || (parsed.length !== 2 && parsed.length !== 3)) {
    throw new QredentialError(
      'malformed_credential',
      'disclosure must be an array of two elements (array member) or three (object property)'
    )
  }

  const salt = parsed[0]
  if (typeof salt !== 'string') {
    throw new QredentialError('malformed_credential', 'disclosure salt must be a string')
  }

  if (parsed.length === 2) {
    return { raw, salt, value: parsed[1], kind: 'element' }
  }

  const name = parsed[1]
  if (typeof name !== 'string') {
    throw new QredentialError('malformed_credential', 'disclosure claim name must be a string')
  }
  return { raw, salt, name, value: parsed[2], kind: 'property' }
}

/**
 * The hash a key binding JWT commits to.
 *
 * Taken over the whole presentation up to and including the final separator, so the holder's
 * signature covers exactly this set of disclosures. Without it a relay could strip or add
 * disclosures after the holder signed, and the proof would still check out.
 */
export async function sdHash(jwt: string, disclosures: string[], alg: string = 'sha-256'): Promise<string> {
  return b64url(await digestHash(utf8(joinCombined(jwt, disclosures)), alg))
}

/** Digest of a disclosure exactly as transmitted. Hashing a re-serialised copy would not match. */
export async function digest(raw: string, alg: string = 'sha-256'): Promise<string> {
  return b64url(await digestHash(utf8(raw), alg))
}

export function splitCombined(combined: string): { jwt: string; disclosures: string[]; keyBinding?: string } {
  const parts = combined.split(SEPARATOR)

  // A bare JWT is not a combined form. The separator is mandatory even with no disclosures, and
  // accepting its absence is the same leniency the empty segment check below exists to stop.
  if (parts.length < 2) {
    throw new QredentialError(
      'malformed_credential',
      'credential is missing the ~ separator that ends every SD-JWT combined form'
    )
  }

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
    throw new QredentialError(
      'malformed_credential',
      'credential contains an empty disclosure segment'
    )
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
/**
 * Rebuild the claim set, following the processing model in RFC 9901 section 7.1.
 *
 * Two shapes of embedded digest exist and both are resolved here, at any depth:
 *
 *   - an object with an `_sd` array, whose digests stand for properties of that object
 *   - an array element shaped `{"...": digest}`, which stands for the element itself
 *
 * Resolution is recursive, because a disclosed value can itself contain either shape. The rules
 * that reject rather than skip are the ones that matter: a disclosure the issuer never signed, one
 * used twice, one naming a reserved or already-present claim, or one left over at the end. A
 * verifier that silently ignores any of those is the bug that makes the format pointless.
 */
export async function reconstructClaims(
  payload: Record<string, unknown>,
  disclosures: string[]
): Promise<{ claims: Record<string, unknown>; disclosed: string[]; withheld: number }> {
  const sdAlg = (payload['_sd_alg'] as string | undefined) ?? 'sha-256'
  if (!isSupportedSdAlg(sdAlg)) {
    throw new QredentialError('unsupported_alg', `unsupported _sd_alg: ${sdAlg}`)
  }

  const byDigest = new Map<string, Disclosure>()
  for (const raw of disclosures) {
    const dig = await digest(raw, sdAlg)
    // Keying by digest would quietly swallow a repeat, and a presentation that sends the same
    // disclosure twice is malformed however harmless it looks.
    if (byDigest.has(dig)) {
      throw new QredentialError(
        'malformed_credential',
        'the same disclosure was sent more than once'
      )
    }
    byDigest.set(dig, parseDisclosure(raw))
  }

  const used = new Set<string>()
  const seen = new Set<string>()
  const disclosed: string[] = []
  let withheld = 0

  /** Record a digest the payload embeds, rejecting a second sighting of the same one. */
  const note = (dig: string) => {
    if (seen.has(dig)) {
      throw new QredentialError(
        'malformed_credential',
        'the same digest appears more than once in this credential'
      )
    }
    seen.add(dig)
  }

  const resolveObject = (node: Record<string, unknown>, path: string[]): void => {
    const sd = node['_sd']
    delete node['_sd']

    if (sd !== undefined) {
      if (!Array.isArray(sd) || sd.some((d) => typeof d !== 'string')) {
        throw new QredentialError('malformed_credential', '_sd must be an array of strings')
      }

      for (const dig of sd as string[]) {
        note(dig)
        const found = byDigest.get(dig)
        // A digest with no disclosure is a claim the holder withheld. It is ignored on purpose:
        // that is what withholding looks like from here.
        if (!found) {
          withheld++
          continue
        }
        if (found.kind !== 'property' || found.name === undefined) {
          throw new QredentialError(
            'malformed_credential',
            'a digest under _sd resolved to an array element disclosure'
          )
        }
        if (found.name === '_sd' || found.name === '...') {
          throw new QredentialError(
            'malformed_credential',
            `disclosure uses the reserved claim name "${found.name}"`
          )
        }
        if (REGISTERED_CLAIMS.has(found.name)) {
          throw new QredentialError(
            'malformed_credential',
            `disclosure tries to set the registered claim "${found.name}"`
          )
        }
        if (Object.prototype.hasOwnProperty.call(node, found.name)) {
          throw new QredentialError(
            'malformed_credential',
            `disclosure for "${found.name}" collides with a claim already in the payload`
          )
        }

        used.add(dig)
        node[found.name] = found.value
        disclosed.push([...path, found.name].join('.'))
        walk(found.value, [...path, found.name])
      }
    }

    for (const [key, value] of Object.entries(node)) {
      walk(value, [...path, key])
    }
  }

  const resolveArray = (node: unknown[], path: string[]): void => {
    const kept: unknown[] = []

    for (let i = 0; i < node.length; i++) {
      const item = node[i]
      const dig = elementDigest(item)

      if (dig === null) {
        walk(item, [...path, `[${i}]`])
        kept.push(item)
        continue
      }

      note(dig)
      const found = byDigest.get(dig)
      // Section 7.1 step d: an element whose digest has no disclosure is removed, not left behind
      // as a placeholder for the caller to trip over.
      if (!found) {
        withheld++
        continue
      }
      if (found.kind !== 'element') {
        throw new QredentialError(
          'malformed_credential',
          'an array element digest resolved to an object property disclosure'
        )
      }

      used.add(dig)
      const at = `${path.join('.')}[${kept.length}]`
      disclosed.push(at)
      walk(found.value, [...path, `[${kept.length}]`])
      kept.push(found.value)
    }

    node.length = 0
    node.push(...kept)
  }

  const walk = (node: unknown, path: string[]): void => {
    if (Array.isArray(node)) return resolveArray(node, path)
    if (node !== null && typeof node === 'object') {
      return resolveObject(node as Record<string, unknown>, path)
    }
  }

  const claims: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(payload)) {
    if (REGISTERED_CLAIMS.has(key)) continue
    claims[key] = structuredClone(value)
  }

  // The top level `_sd` lives on the payload, so it is copied in for the walk and stripped after.
  const root: Record<string, unknown> = { ...claims }
  if (payload['_sd'] !== undefined) root['_sd'] = structuredClone(payload['_sd'])
  resolveObject(root, [])

  // Section 7.1 step 5: anything the payload never referenced is an attempt to add a claim after
  // the fact, and fails the whole credential rather than being skipped.
  const orphan = [...byDigest.entries()].find(([dig]) => !used.has(dig))
  if (orphan) {
    const [, d] = orphan
    const what = d.name !== undefined ? `"${d.name}"` : 'an array element'
    throw new QredentialError(
      'malformed_credential',
      `disclosure for ${what} does not match any digest signed by the issuer`
    )
  }

  return { claims: root, disclosed, withheld }
}

/** An array element stands for a hidden value when it is exactly `{"...": "<digest>"}`. */
function elementDigest(item: unknown): string | null {
  if (item === null || typeof item !== 'object' || Array.isArray(item)) return null
  const keys = Object.keys(item as object)
  if (keys.length !== 1 || keys[0] !== '...') return null
  const value = (item as Record<string, unknown>)['...']
  return typeof value === 'string' ? value : null
}
