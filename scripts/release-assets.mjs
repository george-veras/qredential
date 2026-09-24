// Attaches the package exactly as npm serves it, and its provenance, to the GitHub release of the
// same version:
//
//   node scripts/release-assets.mjs v0.3.1
//
// Three files per release:
//
//   qredential-<version>.tgz            the tarball npm serves, downloaded from the registry
//   qredential-<version>.intoto.jsonl   the SLSA provenance, as the signed DSSE envelope
//   qredential-<version>.sigstore.json  the whole Sigstore bundle, for cosign or sigstore-js
//
// Everything comes from the registry after publishing, not from a local build, so what gets
// attached is what people install. Nothing here signs anything: the provenance is the attestation
// npm recorded when the publish workflow ran, and this only puts a copy next to the release.
//
// The publish workflow runs this after every release. Run it by hand to fill in an older one.

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const SLSA = 'https://slsa.dev/provenance/v1'

const tag = process.argv[2] ?? ''
if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
  console.error('usage: node scripts/release-assets.mjs vX.Y.Z')
  process.exit(2)
}
const version = tag.slice(1)
const name = `qredential-${version}`

/** The registry can take a few minutes to serve the attestation of a version it just accepted. */
async function provenance() {
  for (let attempt = 1; attempt <= 30; attempt++) {
    const res = await fetch(`https://registry.npmjs.org/-/npm/v1/attestations/qredential@${version}`)
    if (res.ok) {
      const found = (await res.json()).attestations?.find((a) => a.predicateType === SLSA)
      if (found) return found.bundle
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000))
  }
  throw new Error(`the registry has no SLSA provenance for qredential@${version} after five minutes`)
}

/**
 * Refuses to attach a provenance that is not about this exact tarball. The registry is trusted to
 * serve the file, not to be right about it: the statement has to be SLSA provenance for this
 * package and version, and its subject digest has to match the bytes that were downloaded.
 */
function checkProvenance(bundle, tarball) {
  const envelope = bundle?.dsseEnvelope
  if (envelope?.payloadType !== 'application/vnd.in-toto+json' || !envelope.signatures?.length)
    throw new Error('the provenance is not a signed in-toto envelope')
  const statement = JSON.parse(Buffer.from(envelope.payload, 'base64').toString('utf8'))
  if (statement.predicateType !== SLSA) throw new Error(`unexpected predicate ${statement.predicateType}`)
  const digest = createHash('sha512').update(tarball).digest('hex')
  const subject = statement.subject?.find((s) => s.name === `pkg:npm/qredential@${version}`)
  if (subject?.digest?.sha512 !== digest)
    throw new Error(`the provenance does not describe the tarball npm serves for qredential@${version}`)
}

const bundle = await provenance()
const dir = await mkdtemp(join(tmpdir(), 'qredential-release-'))

// Given a registry spec rather than a directory, npm pack downloads the published tarball.
await run('npm', ['pack', `qredential@${version}`, '--pack-destination', dir])
checkProvenance(bundle, await readFile(join(dir, `${name}.tgz`)))
await writeFile(join(dir, `${name}.intoto.jsonl`), JSON.stringify(bundle.dsseEnvelope) + '\n')
await writeFile(join(dir, `${name}.sigstore.json`), JSON.stringify(bundle, null, 2) + '\n')

const files = ['.tgz', '.intoto.jsonl', '.sigstore.json'].map((ext) => join(dir, name + ext))
const repo = process.env['GITHUB_REPOSITORY'] ? ['--repo', process.env['GITHUB_REPOSITORY']] : []
await run('gh', ['release', 'upload', tag, ...files, '--clobber', ...repo])
console.log(`attached ${files.map((f) => f.slice(dir.length + 1)).join(', ')} to ${tag}`)
