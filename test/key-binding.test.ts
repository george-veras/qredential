import { describe, it, expect, beforeAll } from 'vitest'
import { issue, present, verify, unpack, pack } from '../src/index.js'
import { splitCombined, joinCombined } from '../src/sdjwt.js'
import { b64urlJson, unb64urlJson } from '../src/bytes.js'
import { makeIssuer } from './helpers.js'
import type { Jwk, TrustList } from '../src/types.js'

const CLAIMS = { given_name: 'Ana', birth_date: '1991-04-02', over_18: true }
const AUDIENCE = 'https://bar.example/door'

let issuer: Awaited<ReturnType<typeof makeIssuer>>
let trust: TrustList
let holderPrivate: Jwk
let holderPublic: Jwk
let credential: string

beforeAll(async () => {
  issuer = await makeIssuer('https://detran.example')
  trust = issuer.trust

  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair
  holderPrivate = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as Jwk
  holderPublic = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as Jwk

  const issued = await issue({
    issuer: issuer.iss,
    kid: issuer.kid,
    key: issuer.privateJwk,
    claims: CLAIMS,
    disclose: ['birth_date', 'over_18'],
    expiresIn: '365d',
    holderKey: holderPublic,
  })
  credential = issued.credential
})

function scan(nonce: string) {
  return { trust, nonce, audience: AUDIENCE }
}

async function proveWith(nonce: string, disclose = ['over_18']) {
  return present(credential, {
    disclose,
    keyBinding: { key: holderPrivate, audience: AUDIENCE, nonce },
  })
}

describe('a holder proof works', () => {
  it('verifies, and says the holder was proved', async () => {
    const presentation = await proveWith('challenge-1')
    const result = await verify(presentation, scan('challenge-1'))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.holderVerified).toBe(true)
    expect(result.claims['over_18']).toBe(true)
    expect(result.claims['birth_date']).toBeUndefined()
  })

  it('still hides what the holder withheld', async () => {
    const presentation = await proveWith('challenge-2')
    const wire = await unpack(presentation)
    expect(wire).not.toContain('1991-04-02')
  })
})

describe('the attacks key binding exists to stop', () => {
  it('rejects a recorded presentation replayed against a new challenge', async () => {
    // The bouncer photographs a valid scan and tries it again an hour later. The nonce is different.
    const recorded = await proveWith('challenge-A')
    const result = await verify(recorded, scan('challenge-B'))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('holder_proof_invalid')
    expect(result.message).toContain('different challenge')
  })

  it('rejects a proof made for a different verifier', async () => {
    const forOtherBar = await present(credential, {
      disclose: ['over_18'],
      keyBinding: { key: holderPrivate, audience: 'https://other.example/door', nonce: 'n1' },
    })
    const result = await verify(forOtherBar, scan('n1'))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('holder_proof_invalid')
    expect(result.message).toContain('other.example')
  })

  it('rejects a proof signed by a key the issuer did not bind', async () => {
    const impostorPair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair
    const impostorKey = (await crypto.subtle.exportKey('jwk', impostorPair.privateKey)) as Jwk

    const forged = await present(credential, {
      disclose: ['over_18'],
      keyBinding: { key: impostorKey, audience: AUDIENCE, nonce: 'n2' },
    })
    const result = await verify(forged, scan('n2'))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('holder_proof_invalid')
    expect(result.message).toContain('not signed by the key the issuer bound')
  })

  it('rejects a disclosure added after the holder signed', async () => {
    // A relay sits between wallet and verifier and tries to widen what is revealed. The holder
    // signed sd_hash over one disclosure; the relay presents two.
    const narrow = await proveWith('n3', ['over_18'])
    const full = await present(credential, { disclose: ['over_18', 'birth_date'] })

    const narrowParts = splitCombined(await unpack(narrow))
    const fullParts = splitCombined(await unpack(full))
    const widened = await pack(
      joinCombined(fullParts.jwt, fullParts.disclosures, narrowParts.keyBinding)
    )

    const result = await verify(widened, scan('n3'))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('holder_proof_invalid')
    expect(result.message).toContain('different set of disclosures')
  })

  it('rejects a disclosure stripped after the holder signed', async () => {
    const wide = await proveWith('n4', ['over_18', 'birth_date'])
    const parts = splitCombined(await unpack(wide))
    const stripped = await pack(
      joinCombined(parts.jwt, parts.disclosures.slice(0, 1), parts.keyBinding)
    )

    const result = await verify(stripped, scan('n4'))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('holder_proof_invalid')
  })

  it('rejects a proof that has gone stale', async () => {
    const presentation = await proveWith('n5')
    const anHourLater = Math.floor(Date.now() / 1000) + 3600
    const result = await verify(presentation, { ...scan('n5'), now: anHourLater })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('holder_proof_invalid')
    expect(result.message).toMatch(/seconds old/)
  })

  it('rejects a proof dated in the future', async () => {
    const presentation = await proveWith('n6')
    const anHourEarlier = Math.floor(Date.now() / 1000) - 3600
    const result = await verify(presentation, { ...scan('n6'), now: anHourEarlier })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('future')
  })

  it('does not let the proof header choose the algorithm', async () => {
    const presentation = await proveWith('n7')
    const parts = splitCombined(await unpack(presentation))
    const [, kbPayload, kbSig] = parts.keyBinding!.split('.')
    const swapped = `${b64urlJson({ alg: 'EdDSA', typ: 'kb+jwt' })}.${kbPayload}.${kbSig}`

    const result = await verify(
      await pack(joinCombined(parts.jwt, parts.disclosures, swapped)),
      scan('n7')
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('bound key is ES256')
  })

  it('rejects a proof with the wrong typ, which is how a token from elsewhere gets reused', async () => {
    const presentation = await proveWith('n8')
    const parts = splitCombined(await unpack(presentation))
    const [, kbPayload, kbSig] = parts.keyBinding!.split('.')
    const swapped = `${b64urlJson({ alg: 'ES256', typ: 'JWT' })}.${kbPayload}.${kbSig}`

    const result = await verify(
      await pack(joinCombined(parts.jwt, parts.disclosures, swapped)),
      scan('n8')
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('expected kb+jwt')
  })
})

describe('the verifier has to make the choice consciously', () => {
  it('refuses a bound credential presented without a proof', async () => {
    const bare = await present(credential, { disclose: ['over_18'] })
    const result = await verify(bare, scan('n9'))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('holder_proof_missing')
    expect(result.message).toContain('bound to a holder key')
  })

  it('refuses a static credential unless the caller opts in', async () => {
    const staticCredential = await issue({
      issuer: issuer.iss,
      kid: issuer.kid,
      key: issuer.privateJwk,
      claims: CLAIMS,
    })

    const refused = await verify(staticCredential.qr, { trust })
    expect(refused.ok).toBe(false)
    if (refused.ok) return
    expect(refused.reason).toBe('holder_proof_missing')
    expect(refused.message).toContain('anyone with a copy')

    const accepted = await verify(staticCredential.qr, { trust, acceptWithoutHolderProof: true })
    expect(accepted.ok).toBe(true)
    if (!accepted.ok) return
    // The fact never disappears, even when the caller chose to accept it.
    expect(accepted.holderVerified).toBe(false)
  })

  it('will not check a proof without the nonce and audience for this scan', async () => {
    const presentation = await proveWith('n10')
    const result = await verify(presentation, { trust })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('holder_proof_invalid')
    expect(result.message).toContain('nonce and audience')
  })

  it('opting out does not wave through a proof that is present and broken', async () => {
    const recorded = await proveWith('n11')
    const result = await verify(recorded, {
      trust,
      acceptWithoutHolderProof: true,
      nonce: 'a-different-one',
      audience: AUDIENCE,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('holder_proof_invalid')
  })
})

describe('issuing with a holder key', () => {
  it('refuses a private key where the public one belongs', async () => {
    await expect(
      issue({
        issuer: issuer.iss,
        kid: issuer.kid,
        key: issuer.privateJwk,
        claims: CLAIMS,
        holderKey: holderPrivate,
      })
    ).rejects.toThrow(/private component/)
  })

  it('refuses to build a proof for a credential with no bound key', async () => {
    const staticCredential = await issue({
      issuer: issuer.iss,
      kid: issuer.kid,
      key: issuer.privateJwk,
      claims: CLAIMS,
    })

    await expect(
      present(staticCredential.credential, {
        disclose: [],
        keyBinding: { key: holderPrivate, audience: AUDIENCE, nonce: 'n12' },
      })
    ).rejects.toThrow(/no cnf claim/)
  })

  it('writes the bound key into cnf where a verifier can find it', async () => {
    const { jwt } = splitCombined(credential)
    const payload = unb64urlJson<Record<string, unknown>>(jwt.split('.')[1]!)
    const cnf = payload['cnf'] as { jwk: Jwk }
    expect(cnf.jwk.x).toBe(holderPublic.x)
    expect(cnf.jwk.d).toBeUndefined()
  })
})
