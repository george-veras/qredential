import { unb64url, utf8 } from './bytes.js'
import { QredentialError, asCryptoFailure } from './errors.js'
import type { Alg, Jwk } from './types.js'

function params(alg: Alg): { import: EcKeyImportParams | Algorithm; sign: EcdsaParams | Algorithm } {
  switch (alg) {
    case 'ES256':
      return {
        import: { name: 'ECDSA', namedCurve: 'P-256' },
        sign: { name: 'ECDSA', hash: 'SHA-256' },
      }
    case 'EdDSA':
      return { import: { name: 'Ed25519' }, sign: { name: 'Ed25519' } }
    default: {
      const never: never = alg
      throw new QredentialError('unsupported_alg', `unsupported algorithm: ${String(never)}`)
    }
  }
}

export async function importPrivateKey(jwk: Jwk, alg: Alg): Promise<CryptoKey> {
  try {
    return await crypto.subtle.importKey('jwk', jwk as JsonWebKey, params(alg).import, false, ['sign'])
  } catch (error) {
    throw asCryptoFailure(`could not import the ${alg} private key`, error)
  }
}

export async function importPublicKey(jwk: Jwk, alg: Alg): Promise<CryptoKey> {
  const pub: Jwk = { ...jwk }
  delete pub.d
  pub.key_ops = ['verify']
  try {
    return await crypto.subtle.importKey('jwk', pub as JsonWebKey, params(alg).import, false, ['verify'])
  } catch (error) {
    throw asCryptoFailure(`could not import the ${alg} public key`, error)
  }
}

export async function sign(data: string, key: CryptoKey, alg: Alg): Promise<Uint8Array> {
  try {
    const sig = await crypto.subtle.sign(params(alg).sign, key, utf8(data) as BufferSource)
    return new Uint8Array(sig)
  } catch (error) {
    throw asCryptoFailure(`could not sign with ${alg}`, error)
  }
}

export async function verifySignature(
  data: string,
  signature: string,
  key: CryptoKey,
  alg: Alg
): Promise<boolean> {
  try {
    return await crypto.subtle.verify(
      params(alg).sign,
      key,
      unb64url(signature) as BufferSource,
      utf8(data) as BufferSource
    )
  } catch {
    return false
  }
}

/**
 * Work out which algorithm a key is for.
 *
 * The JWK's own `alg` wins when it is there. Otherwise the curve decides, because a P-256 key can
 * only be used one way here and guessing wrong fails loudly at import rather than quietly.
 */
export function algForJwk(jwk: Jwk): Alg {
  if (jwk.alg === 'ES256' || jwk.alg === 'EdDSA') return jwk.alg
  if (jwk.crv === 'P-256') return 'ES256'
  if (jwk.crv === 'Ed25519') return 'EdDSA'
  throw new QredentialError(
    'unsupported_alg',
    `cannot tell which algorithm this key is for: kty ${String(jwk.kty)}, crv ${String(jwk.crv)}`
  )
}

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const buf = await crypto.subtle.digest('SHA-256', data as BufferSource)
  return new Uint8Array(buf)
}
