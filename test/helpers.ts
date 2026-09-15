import { b64url, b64urlJson, utf8 } from '../src/bytes.js'
import { deflate } from '../src/compress.js'
import { importPrivateKey, sign } from '../src/crypto.js'
import type { Alg, Jwk, TrustList } from '../src/types.js'

export async function makeIssuer(iss: string, kid = 'k1', alg: Alg = 'ES256') {
  const params: EcKeyGenParams | Algorithm =
    alg === 'ES256' ? { name: 'ECDSA', namedCurve: 'P-256' } : { name: 'Ed25519' }
  const pair = (await crypto.subtle.generateKey(params, true, ['sign', 'verify'])) as CryptoKeyPair

  const privateJwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as Jwk
  const publicJwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as Jwk

  const trust: TrustList = { issuers: { [iss]: { keys: [{ kid, alg, jwk: publicJwk }] } } }
  return { iss, kid, alg, privateJwk, publicJwk, trust }
}

/** Build a signed Token Status List over `size` entries, with `revoked` indices set to 1. */
export async function makeStatusList(
  issuer: { iss: string; kid: string; alg: Alg; privateJwk: Jwk },
  opts: { size: number; revoked?: number[]; iat?: number; exp?: number; uri?: string }
): Promise<string> {
  const bytes = new Uint8Array(Math.ceil(opts.size / 8))
  for (const idx of opts.revoked ?? []) {
    bytes[Math.floor(idx / 8)]! |= 1 << idx % 8
  }

  const payload = {
    iss: issuer.iss,
    sub: opts.uri ?? 'https://issuer.example/status/1',
    iat: opts.iat ?? Math.floor(Date.now() / 1000),
    ...(opts.exp !== undefined ? { exp: opts.exp } : {}),
    status_list: { bits: 1, lst: b64url(await deflate(bytes, 'deflate')) },
  }

  const header = { alg: issuer.alg, typ: 'statuslist+jwt', kid: issuer.kid }
  const input = `${b64urlJson(header)}.${b64urlJson(payload)}`
  const key = await importPrivateKey(issuer.privateJwk, issuer.alg)
  return `${input}.${b64url(await sign(input, key, issuer.alg))}`
}

export const utf8Bytes = utf8
