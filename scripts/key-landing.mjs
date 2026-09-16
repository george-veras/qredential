// One time pass that turns the hand written English landing page into a template plus a catalogue.
//
// Each entry below is a key and the exact text as it stands in the page today. The script swaps the
// text for {{key}} in the template and writes the same text into content/landing/en.json, so the
// two cannot drift apart at the moment of separation. It is thrown away afterwards.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const file = join(root, 'docs/index.template.html')

/** key -> the exact substring to replace. Order matters: longer strings first where they overlap. */
const entries = [
  ['nav.docs', '>Docs<'],
  ['nav.playground', '>Playground<'],

  ['hero.eyebrow', 'SD-JWT &middot; Token Status List &middot; base45'],
  ['hero.title', 'The answer is already <em>inside</em> the code'],
  ['hero.lede', `A credential that proves itself. Signature, expiry, revocation and claims, all checked
        without one request leaving the device.`],
  ['hero.sub', `TypeScript, zero runtime dependencies, WebCrypto only. Node, browsers and React Native,
        because the thing doing the verifying is usually a phone.`],
  ['hero.ctaBreak', '>Try to break it<'],
  ['hero.ctaDocs', '>Read the docs<'],

  ['demo.signing', 'signing a demo credential&hellip;'],
  ['demo.networkRequests', 'network requests '],
  ['demo.verifiedIn', 'verified in '],

  ['signal.title', 'Built for the moment there is no signal'],
  ['signal.p1', `I built the eCNH, Brazil's digital driving licence, used by more than 40 million people. The
      part that taught me the most was not the app. It was the roadside: an officer scanning a
      licence on a highway with one bar of signal, or none, needing a yes or no in under a second.`],
  ['signal.p2', `Everything you need for that answer fits in the code. The signature proves the issuer, the
      claims are right there, and the only thing you need from outside is the issuer's public key,
      which changes so rarely that you can ship it and refresh it weekly.`],
  ['signal.p3', `Libraries for this exist. They are enterprise SDKs: heavy, tied to one country's profile, and
      written as though you already work in the identity industry. This is the version a product
      engineer can add on a Tuesday.`],

  ['flow.title', 'Three parties, and none of them is a server'],
  ['flow.alt', 'The issuer signs a credential and gives it to the holder. The holder presents a narrowed copy to the verifier. The verifier checks it against a pinned trust list held on the device. No party contacts a server at scan time.'],
  ['flow.issuer', '>Issuer<'],
  ['flow.issuerSub', '>signs once, then leaves<'],
  ['flow.holder', '>Holder<'],
  ['flow.holderSub', '>picks what travels<'],
  ['flow.verifier', '>Verifier<'],
  ['flow.verifierSub', '>decides, offline<'],
  ['flow.credential', '>credential<'],
  ['flow.qrScan', '>QR scan<'],
  ['flow.trustList', '>trust list, on the device<'],
  ['flow.trustListSub', '>shipped and refreshed weekly<'],
  ['flow.noCall', '>No network call at scan time.<'],
  ['flow.noCallSub', '>That is the whole design, not an optimisation.<'],

  ['steps.issueLabel', '01 &middot; ISSUE'],
  ['steps.issueTitle', 'Sign every claim once'],
  ['steps.issueBody', 'The issuer decides which claims may later be withheld, and signs a digest for each of those.'],
  ['steps.presentLabel', '02 &middot; PRESENT'],
  ['steps.presentTitle', 'Send only what is asked'],
  ['steps.presentBody', 'The wallet drops the claims it is keeping. The issuer\'s signature still checks out on what is left.'],
  ['steps.verifyLabel', '03 &middot; VERIFY'],
  ['steps.verifyTitle', 'Answer without asking anyone'],
  ['steps.verifyBody', 'Signature, expiry, revocation and every disclosure, checked against a pinned key on the device.'],

  ['age.title', 'Prove you are over 18 without handing over your birthday'],
  ['age.p1', `Age verification laws are arriving faster than the tooling. The usual implementation has the
        customer upload a photo of their ID to a third party, which is a privacy disaster and a
        breach waiting to happen.`],
  ['age.p2', `Selective disclosure does it properly. The verifier cannot learn the birth date even if it
        wants to, because that value never left the wallet. The property is cryptographic, not a
        promise in a privacy policy.`],
  ['age.c1', '// The credential holds name, address, birth date and document number.'],
  ['age.c2', '// The bar gets one boolean.'],
  ['age.c3', '// { over_18: true }'],
  ['age.c4', '// undefined, and it was never transmitted'],
  ['age.c5', '// 4, and it cannot tell you which four'],

  ['numbers.title', 'Real numbers, including the awkward one'],
  ['numbers.intro', `A realistic driving licence, eight claims, five year expiry, status list pointer. Measured, not
      estimated:`],
  ['numbers.thCredential', '>Credential<'],
  ['numbers.thChars', '>Characters<'],
  ['numbers.thVersion', '>QR version<'],
  ['numbers.row1', '>everything visible<'],
  ['numbers.row1v', '>18, scans fine<'],
  ['numbers.row2', '>all eight claims disclosable<'],
  ['numbers.row2v', '>27, too dense<'],
  ['numbers.row3v', '>22, still dense<'],
  ['numbers.aside', `<strong>Selective disclosure roughly doubles the credential.</strong> Every disclosable claim
      costs a salt plus a signed digest, and the digests stay in the payload whether the holder
      reveals the claim or not. That is deliberate, since a digest count that shrank with what you
      revealed would leak what you withheld. It does mean the saving at presentation time is
      thirty percent here, not the eighty that intuition promises. Make two or three claims
      disclosable, not all of them, and let <code>fits()</code> tell you where you stand before you
      print anything.`],

  ['attacks.title', "Don't take my word for it"],
  ['attacks.intro', `The playground runs the whole library in your browser and fires eight real attacks at it. Each
      one prints the rejection code it expects, so you can check the library against its own claims
      instead of trusting a README.`],
  ['attacks.a1', 'Flip a claim in the payload'],
  ['attacks.a2', 'Invent a claim never issued'],
  ['attacks.a3', 'Send a disclosure twice'],
  ['attacks.a4', 'Sign with the wrong key'],
  ['attacks.a5', 'Claim to be another authority'],
  ['attacks.a6', 'Use it ten years from now'],
  ['attacks.a7', 'Use it after revocation'],
  ['attacks.a8', 'Hide behind a stale status list'],
  ['attacks.a9', 'Replay a recorded presentation'],
  ['attacks.a10', "Present a photo of someone's code"],
  ['attacks.cta', '>Open the playground<'],

  ['install.title', '>Install<'],
  ['install.note', `Node 20 or newer, every current browser, React Native. About 700 lines of source with no
        runtime dependencies, specifically so that reading it before you trust it is realistic.`],
  ['install.ctaDocs', '>Documentation<'],
  ['install.ctaSource', '>Source<'],

  ['standards.title', 'Standards, not inventions'],
  ['standards.s1', 'selective disclosure and key binding, nested and recursive, the mechanism the European identity wallet uses'],
  ['standards.s2', 'the credential shape'],
  ['standards.s3', 'revocation that works from a cached copy'],
  ['standards.s4', 'the QR envelope, chosen for scanner compatibility'],
  ['standards.note', `Not ISO 18013-5 mDL, which is CBOR and COSE rather than JWT, and no path selector yet for
        presenting individual array elements. Both are on the roadmap, and a credential using
        something unsupported is refused rather than half understood. Claiming half of a compliance
        standard is worse than not claiming it.`],

  ['footer.audit', 'No third party audit. '],
  ['footer.auditLink', '>What that means<'],
  ['footer.source', '>Source and issues<'],
]

let html = await readFile(file, 'utf8')
const catalogue = {}
const missing = []

for (const [key, text] of entries) {
  // Angle brackets in the entry mean "this exact element content", so the placeholder keeps them.
  const wrapped = text.startsWith('>') && text.endsWith('<')
  const needle = text
  const replacement = wrapped ? `>{{${key}}}<` : `{{${key}}}`
  const value = wrapped ? text.slice(1, -1) : text

  if (!html.includes(needle)) {
    missing.push(key)
    continue
  }
  html = html.replace(needle, replacement)
  catalogue[key] = value.replace(/\s*\n\s+/g, ' ').trim()
}

await mkdir(join(root, 'content/landing'), { recursive: true })
await writeFile(join(root, 'content/landing/en.json'), JSON.stringify(catalogue, null, 2) + '\n')
await writeFile(file, html)

console.log(`${Object.keys(catalogue).length} chaves extraidas`)
if (missing.length) console.log('NAO ENCONTRADAS:', missing.join(', '))
