// Builds every docs page from its template, inlining a fresh bundle of the library.
//
// The pages have to be self contained: they are served from GitHub Pages and also published as
// standalone pages, where relative script paths do not exist. That means the library is duplicated
// inside the HTML, so this script is the only thing allowed to write those files, and CI fails when
// a committed page does not match what this produces.
import { build } from 'esbuild'
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const docs = join(root, 'docs')

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

async function templates(dir) {
  const found = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...(await templates(full)))
    else if (entry.name === 'index.template.html') found.push(full)
  }
  return found
}

for (const template of await templates(docs)) {
  const source = await readFile(template, 'utf8')
  const out = template.replace(/index\.template\.html$/, 'index.html')
  // A page with no placeholder is static and just gets copied through.
  const page = source.includes('__BUNDLE__') ? source.replace('__BUNDLE__', () => bundle) : source
  await writeFile(out, page)
  console.log(`${out.slice(root.length + 1)}: ${(page.length / 1024).toFixed(1)} KB`)
}

console.log(`bundle ${(bundle.length / 1024).toFixed(1)} KB`)
