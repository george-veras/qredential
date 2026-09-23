// Runs the code samples in the documentation, so the documentation cannot drift away from the
// library while still looking plausible.
//
// This exists because of a real failure. The guide's headline example, the one a newcomer copies
// first, presented a credential without key binding and verified it without a nonce. Key binding
// became mandatory and the sample was never re-run, so for some time the first thing anybody
// pasted returned ok: false and reason: holder_proof_missing. It read perfectly. Nothing checked
// it. Nine translations carried the same broken block.
//
// The samples are not self contained: they say `trust` and `issuerPrivateJwk` without defining
// them, which is right for a document and useless for an interpreter. So each sample named here
// gets a fixture preamble, and then it has to actually run and produce what its own trailing
// comments claim.
//
// Adding a sample to this file is cheap and worth doing whenever a sample is something a reader
// would paste.

import { readFile, writeFile, mkdir, rm, readdir } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL, fileURLToPath } from 'node:url'

// An import specifier, so it stays a URL and never becomes a path. On Windows the .pathname
// of a file URL is /C:/… , which is a valid URL component and not a valid path, and that is
// the difference this whole file tripped over the first time it ran there.
const DIST = new URL('../dist/index.js', import.meta.url).href

/** Everything the samples refer to without defining. Mirrors what a real integration would hold. */
const PREAMBLE = `
const _ip = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const _hp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const issuerPrivateJwk = await crypto.subtle.exportKey('jwk', _ip.privateKey)
const issuerPublicJwk = await crypto.subtle.exportKey('jwk', _ip.publicKey)
const holderPrivateJwk = await crypto.subtle.exportKey('jwk', _hp.privateKey)
const holderPublicJwk = await crypto.subtle.exportKey('jwk', _hp.publicKey)
const challenge = 'a-fresh-challenge'
const trust = {
  issuers: {
    'https://id.example.gov': { name: 'Gov', keys: [{ kid: '2026-a', alg: 'ES256', jwk: issuerPublicJwk }] },
  },
}
`

const SAMPLES = [
  {
    file: 'content/guide/en.md',
    what: 'the whole round trip',
    // The sample that starts with this line, up to the end of its fenced block.
    startsWith: "import { issue, present, verify } from 'qredential'",
    expect: (globals) => {
      const { result } = globals
      if (!result.ok) throw new Error(`verify returned ok: false, reason: ${result.reason}`)
      if (result.claims.over_18 !== true) throw new Error('over_18 was not disclosed')
      if (result.claims.birth_date !== undefined) throw new Error('birth_date leaked')
      if (result.claims.given_name !== 'Ana') throw new Error('an always visible claim went missing')
      if (result.holderVerified !== true) throw new Error('holderVerified was not true')
    },
  },
]

function extract(markdown, startsWith, file) {
  const at = markdown.indexOf(startsWith)
  if (at < 0) throw new Error(`${file}: no sample starting with ${JSON.stringify(startsWith.slice(0, 40))}`)
  const end = markdown.indexOf('\n```', at)
  if (end < 0) throw new Error(`${file}: the sample has no closing fence`)
  return markdown.slice(at, end)
}

const dir = join(tmpdir(), `qredential-docs-${process.pid}`)
await mkdir(dir, { recursive: true })
let failures = 0

for (const sample of SAMPLES) {
  const markdown = await readFile(new URL(`../${sample.file}`, import.meta.url), 'utf8')
  let code = extract(markdown, sample.startsWith, sample.file)

  // A reader installs the package; this runs against the build in the working tree.
  code = code.replace(/from ['"]qredential['"]/g, `from '${DIST}'`)

  const file = join(dir, `${sample.what.replace(/\W+/g, '-')}.mjs`)
  await writeFile(file, `${PREAMBLE}\n${code}\n\nexport { result }\n`)

  try {
    const globals = await import(pathToFileURL(file).href)
    sample.expect(globals)
    console.log(`  ok   ${sample.file}: ${sample.what}`)
  } catch (error) {
    failures++
    console.error(`  FAIL ${sample.file}: ${sample.what}`)
    console.error(`       ${error.message}`)
  }
}

await rm(dir, { recursive: true, force: true })

// The examples are documentation too, and the most likely kind to be pasted whole. They print
// their own findings, so the only thing worth asserting here is that each one runs to the end
// without throwing. An example that crashes is worse than no example.
const run = promisify(execFile)
const examplesDir = new URL('../examples/', import.meta.url)
for (const name of (await readdir(examplesDir)).filter((f) => f.endsWith('.mjs')).sort()) {
  try {
    await run(process.execPath, [fileURLToPath(new URL(name, examplesDir))], { timeout: 60_000 })
    console.log(`  ok   examples/${name}`)
  } catch (error) {
    failures++
    console.error(`  FAIL examples/${name}`)
    console.error(`       ${String(error.stderr || error.message).trim().split('\n').slice(-3).join('\n       ')}`)
  }
}

if (failures) {
  console.error(`\n${failures} documentation sample(s) do not do what they say.\n`)
  process.exit(1)
}
console.log(`\nevery documentation sample and example ran and produced what the surrounding text claims\n`)
