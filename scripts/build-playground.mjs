// Builds docs/index.html by inlining a fresh bundle of the library into the template.
//
// The playground has to be one self contained file: it is served from GitHub Pages and also
// published as a standalone page, where relative script paths do not exist. That means the library
// is duplicated inside the HTML, so this script is the only thing allowed to write docs/index.html,
// and CI fails when the committed file does not match what this produces.
import { build } from 'esbuild'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const result = await build({
  entryPoints: [join(root, 'src/index.ts')],
  bundle: true,
  format: 'iife',
  globalName: 'Q',
  target: 'es2022',
  minify: true,
  write: false,
})

const bundle = result.outputFiles[0].text
const template = await readFile(join(root, 'docs/index.template.html'), 'utf8')

if (!template.includes('__BUNDLE__')) {
  throw new Error('docs/index.template.html has no __BUNDLE__ placeholder')
}

const page = template.replace('__BUNDLE__', () => bundle)
await writeFile(join(root, 'docs/index.html'), page)

console.log(`docs/index.html written: ${(page.length / 1024).toFixed(1)} KB, bundle ${(bundle.length / 1024).toFixed(1)} KB`)
