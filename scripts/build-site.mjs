// Builds the site.
//
// Two mechanisms, because the pages have two shapes.
//
// The guide is prose, so its content lives as Markdown in content/guide/<locale>.md and the design
// lives once in docs/guide/_shell.html. A design change is one edit rather than one per language,
// and a translator edits sentences rather than markup.
//
// The landing and the playground are app shaped, with a live demo and interactive state, so they
// stay as templates with the library bundle inlined. They have to be self contained: they are
// served from GitHub Pages and also published standalone, where relative script paths do not exist.
// That means the library is duplicated inside the HTML, so this script is the only thing allowed to
// write those files, and CI fails when a committed page disagrees with the source.
import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { renderGuide } from './render.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const docs = join(root, 'docs')

const REPO = 'https://github.com/george-veras/qredential'
const SITE = 'https://george-veras.github.io/qredential'

const locales = JSON.parse(await readFile(join(root, 'content/locales.json'), 'utf8'))
const codes = Object.keys(locales).filter((k) => k !== '_comment')
const SOURCE = codes.find((c) => locales[c].source) ?? 'en'

const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16)

/** Every translation records the hash of the English it was made from, on its first line. */
function readStamp(markdown) {
  const m = /^<!--\s*translated-from:\s*([0-9a-f]+)\s*-->/.exec(markdown)
  return { stamp: m?.[1] ?? null, body: markdown.replace(/^<!--\s*translated-from:[^>]*-->\n?/, '') }
}

// ---------------------------------------------------------------- the guide, one page per locale

const guideSources = {}
for (const code of codes) {
  try {
    guideSources[code] = await readFile(join(root, `content/guide/${code}.md`), 'utf8')
  } catch {
    // A language with no file yet simply does not appear. Half a page is worse than none.
  }
}

const sourceBody = readStamp(guideSources[SOURCE] ?? '').body
const sourceHash = sha(sourceBody)
const shell = await readFile(join(docs, 'guide/_shell.html'), 'utf8')

/** Where a locale's guide lives, and how deep it is relative to the site root. */
const guidePath = (code) => (code === SOURCE ? 'guide' : `${code}/guide`)
const rootFrom = (code) => (code === SOURCE ? '../' : '../../')

const status = []

for (const code of codes) {
  const raw = guideSources[code]
  if (!raw) {
    status.push({ code, state: 'missing' })
    continue
  }

  const { stamp, body } = readStamp(raw)
  const isSource = code === SOURCE
  const stale = !isSource && stamp !== null && stamp !== sourceHash
  const unstamped = !isSource && stamp === null

  const { html, headings } = renderGuide(body)
  const ui = locales[code].ui

  const toc = headings.map((h) => `<li><a href="#${h.id}">${h.text}</a></li>`).join('\n      ')

  const langs = codes
    .filter((c) => guideSources[c])
    .map((c) => {
      const here = c === code
      const href = c === SOURCE ? `${rootFrom(code)}guide/` : `${rootFrom(code)}${c}/guide/`
      const behind =
        !here && c !== SOURCE && readStamp(guideSources[c]).stamp !== sourceHash
          ? `<span class="behind">${locales[c].ui.behind}</span>`
          : ''
      return `<li><a href="${href}" hreflang="${c}" lang="${c}"${
        here ? ' aria-current="page"' : ''
      }>${locales[c].native}</a>${behind}</li>`
    })
    .join('\n      ')

  // The locale landing sits one level up from its guide, in every language. The playground is
  // still English only, so it is reached from the site root instead.
  const page = shell
    .replace(/__HOME__/g, '../')
    .replace(/__ROOT__/g, rootFrom(code))
    .replace('__NAV_HOME__', ui.navHome)
    .replace('__NAV_DOCS__', ui.navDocs)
    .replace('__NAV_PLAYGROUND__', ui.navPlayground)
    .replace('__TOC_TITLE__', ui.tocTitle)
    .replace('__LANG_TITLE__', ui.langTitle)
    .replace('__FOOTER_SOURCE__', ui.footerSource)
    .replace('__TOC__', toc)
    .replace('__LANGS__', langs)
    .replace('__CONTENT__', html)
    .replace('__PROVENANCE__', provenance(code, { stale, unstamped }))

  const seo = locales[code].seo
  const withHead =
    `<html lang="${code}" dir="${locales[code].dir ?? 'ltr'}">\n` +
    page
      .replace(
        /<title>[^<]*<\/title>/,
        head(code, {
          path: `${guidePath(code)}/`,
          title: seo.guideTitle,
          description: seo.guideDesc,
          type: 'guide',
        }) + `\n<title>${seo.guideTitle}</title>`
      )

  const out = join(docs, guidePath(code), 'index.html')
  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, withHead)

  status.push({
    code,
    state: isSource ? 'source' : stale ? 'stale' : unstamped ? 'unstamped' : 'current',
    reviewed: Boolean(locales[code].reviewedBy),
    bytes: withHead.length,
  })
}

/**
 * The notice that appears on every translated page.
 *
 * It says out loud whether a native speaker has read the page, and links straight at the file, so
 * the distance between noticing a bad sentence and fixing it is one click. An unreviewed
 * translation is not a secret to keep; it is an open invitation.
 */
function provenance(code, { stale, unstamped }) {
  if (code === SOURCE) return ''
  const p = locales[code].provenance
  const who = locales[code].reviewedBy

  const lines = []
  if (stale || unstamped) lines.push(`<strong>${p.stale}</strong>`)
  lines.push(who ? p.reviewed.replace('{who}', who) : p.unreviewed)

  const file = `${REPO}/blob/main/content/guide/${code}.md`
  return `    <div class="provenance">
      ${lines.join('<br>')}
      <a class="fix" href="${file}">${p.fix}</a>
    </div>
`
}

/**
 * Everything a search engine and a link preview need, in the page's own language.
 *
 * Before this existed the nine landings all announced themselves as "Qredential" and the nine
 * guides as "Qredential Documentation" in English, which is nine duplicate titles to a crawler and
 * a Japanese page describing itself in a language its reader did not ask for.
 */
function head(code, { path, title, description, type }) {
  const url = `${SITE}/${path}`
  const available = (c) => (type === 'guide' ? guideSources[c] : landing[c])

  const tags = codes
    .filter(available)
    .map((c) => {
      const p = type === 'guide' ? (c === SOURCE ? 'guide/' : `${c}/guide/`) : c === SOURCE ? '' : `${c}/`
      return `<link rel="alternate" hreflang="${c}" href="${SITE}/${p}">`
    })

  tags.push(
    `<link rel="alternate" hreflang="x-default" href="${SITE}/${type === 'guide' ? 'guide/' : ''}">`,
    `<link rel="canonical" href="${url}">`,
    `<meta name="description" content="${escapeAttr(description)}">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<link rel="icon" href="${SITE}/favicon.svg" type="image/svg+xml">`,

    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="qredential">`,
    `<meta property="og:title" content="${escapeAttr(title)}">`,
    `<meta property="og:description" content="${escapeAttr(description)}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:locale" content="${code.replace('-', '_')}">`,
    `<meta property="og:image" content="${SITE}/og.png">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${escapeAttr(title)}">`,
    `<meta name="twitter:description" content="${escapeAttr(description)}">`,
    `<meta name="twitter:image" content="${SITE}/og.png">`
  )

  for (const c of codes.filter(available)) {
    if (c !== code) tags.push(`<meta property="og:locale:alternate" content="${c.replace('-', '_')}">`)
  }

  // Structured data. The landing is the software itself; a guide page is documentation about it.
  const ld =
    type === 'guide'
      ? {
          '@context': 'https://schema.org',
          '@type': 'TechArticle',
          headline: title,
          description,
          inLanguage: code,
          url,
          author: { '@type': 'Person', name: 'George Veras Valentim' },
          license: 'https://opensource.org/licenses/MIT',
        }
      : {
          '@context': 'https://schema.org',
          '@type': 'SoftwareSourceCode',
          name: 'qredential',
          description,
          inLanguage: code,
          url,
          codeRepository: REPO,
          programmingLanguage: 'TypeScript',
          runtimePlatform: ['Node.js', 'Browser', 'React Native'],
          license: 'https://opensource.org/licenses/MIT',
          author: { '@type': 'Person', name: 'George Veras Valentim' },
        }
  tags.push(`<script type="application/ld+json">${JSON.stringify(ld)}</script>`)

  return tags.join('\n')
}

function escapeAttr(s) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

// ------------------------------------------------------------- the landing, one page per locale
//
// The landing is app shaped rather than prose: a fixed layout wrapped around a live demo. So its
// text lives in a key catalogue rather than Markdown, and the same template is filled nine times.
// Runtime strings, the ones the demo writes only after a credential has been verified, ride along
// as a T object injected before the page script.

const landing = {}
for (const code of codes) {
  try {
    landing[code] = JSON.parse(await readFile(join(root, `content/landing/${code}.json`), 'utf8'))
  } catch {
    // Not translated yet. The language simply does not get a landing page.
  }
}

// -------------------------------------------------- the landing and the playground, with a bundle

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
  if (!source.includes('__BUNDLE__')) continue

  const isLanding = template === join(docs, 'index.template.html')
  if (!isLanding) {
    const out = template.replace(/index\.template\.html$/, 'index.html')
    await writeFile(out, source.replace('__BUNDLE__', () => bundle))
    console.log(`${out.slice(root.length + 1)}: ${(source.length / 1024).toFixed(1)} KB`)
    continue
  }

  for (const code of codes) {
    const strings = landing[code]
    if (!strings) continue

    const missing = [...source.matchAll(/\{\{([a-zA-Z.0-9]+)\}\}/g)]
      .map((m) => m[1])
      .filter((k) => strings[k] === undefined)
    if (missing.length > 0) {
      // A page half in one language and half in another is worse than an untranslated one.
      throw new Error(`landing/${code}.json is missing keys: ${[...new Set(missing)].join(', ')}`)
    }

    const home = code === SOURCE ? './' : '../'
    const guide = code === SOURCE ? './guide/' : './guide/'
    const play = code === SOURCE ? './playground/' : '../playground/'

    const langRow = codes
      .filter((c) => landing[c])
      .map((c) => {
        const href = c === SOURCE ? (code === SOURCE ? './' : '../') : (code === SOURCE ? `./${c}/` : `../${c}/`)
        const here = c === code ? ' aria-current="page"' : ''
        return `<a href="${href}" hreflang="${c}" lang="${c}"${here}>${locales[c].native}</a>`
      })
      .join('\n    ')

    // Only the keys the demo needs at runtime travel into the page as data.
    const runtime = Object.fromEntries(
      Object.entries(strings).filter(([k]) => k.startsWith('demo.'))
    )

    let page = source
      .replace(/\{\{([a-zA-Z.0-9]+)\}\}/g, (_, k) => strings[k])
      .replace('__HOME__', home)
      .replace(/__GUIDE__/g, guide)
      .replace(/__PLAYGROUND__/g, play)
      .replace('__LANGS__', langRow)
      .replace('__STRINGS__', `window.__T=${JSON.stringify(runtime)};`)
      .replace('__BUNDLE__', () => bundle)

    const seo = locales[code].seo
    page =
      `<html lang="${code}" dir="${locales[code].dir ?? 'ltr'}">\n` +
      page.replace(
        /<title>[^<]*<\/title>/,
        head(code, {
          path: code === SOURCE ? '' : `${code}/`,
          title: seo.landingTitle,
          description: seo.landingDesc,
          type: 'landing',
        }) + `\n<title>${seo.landingTitle}</title>`
      )

    const out = join(docs, code === SOURCE ? '' : code, 'index.html')
    await mkdir(dirname(out), { recursive: true })
    await writeFile(out, page)
    console.log(`landing ${code.padEnd(8)} ${(page.length / 1024).toFixed(1)} KB`)
  }
}

// ------------------------------------------------------------ robots, sitemap and the site icon
//
// Generated rather than committed by hand, so a language added tomorrow appears in the sitemap
// without anyone remembering to edit it.

const urls = []
for (const code of codes.filter((c) => landing[c])) {
  urls.push({
    loc: `${SITE}/${code === SOURCE ? '' : code + '/'}`,
    alts: codes.filter((c) => landing[c]).map((c) => [c, `${SITE}/${c === SOURCE ? '' : c + '/'}`]),
  })
}
for (const code of codes.filter((c) => guideSources[c])) {
  urls.push({
    loc: `${SITE}/${guidePath(code)}/`,
    alts: codes
      .filter((c) => guideSources[c])
      .map((c) => [c, `${SITE}/${c === SOURCE ? 'guide' : c + '/guide'}/`]),
  })
}
urls.push({ loc: `${SITE}/playground/`, alts: [] })

const sitemap = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemap.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">'
    .replace('www.sitemap.org', 'www.sitemaps.org'),
  ...urls.map(({ loc, alts }) =>
    [
      '  <url>',
      `    <loc>${loc}</loc>`,
      ...alts.map(([c, href]) => `    <xhtml:link rel="alternate" hreflang="${c}" href="${href}"/>`),
      '  </url>',
    ].join('\n')
  ),
  '</urlset>',
].join('\n')

await writeFile(join(docs, 'sitemap.xml'), sitemap + '\n')
await writeFile(
  join(docs, 'robots.txt'),
  `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`
)

// The mark from the masthead, as a tab icon. Inline so it costs no request and scales anywhere.
await writeFile(
  join(docs, 'favicon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="10" fill="#111A1D"/>
  <text x="32" y="46" text-anchor="middle" font-family="Archivo, Helvetica, Arial, sans-serif"
        font-size="44" font-weight="700" fill="#0E6B54">q</text>
</svg>
`
)

console.log(`\nsitemap: ${urls.length} URLs, robots.txt and favicon.svg written`)

// ------------------------------------------------------------------------------------- the report

console.log(`\nbundle ${(bundle.length / 1024).toFixed(1)} KB`)
console.log(`guide source hash ${sourceHash}\n`)

const label = { source: 'source', current: 'up to date', stale: 'BEHIND', unstamped: 'no stamp', missing: 'not translated yet' }
for (const s of status) {
  const review = s.state === 'missing' ? '' : s.reviewed ? 'reviewed' : 'unreviewed'
  console.log(`  ${s.code.padEnd(8)} ${label[s.state].padEnd(20)} ${review}`)
}

const behind = status.filter((s) => s.state === 'stale' || s.state === 'unstamped')
if (behind.length && process.env['CHECK_TRANSLATIONS'] === '1') {
  console.error(
    `\nThese translations are behind the English guide: ${behind.map((s) => s.code).join(', ')}.\n` +
      `Update them, or re-stamp with the current hash once you have checked the change does not\n` +
      `affect them: <!-- translated-from: ${sourceHash} -->`
  )
  process.exit(1)
}
