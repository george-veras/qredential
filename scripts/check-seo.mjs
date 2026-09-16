// Checks that the built site still says, in every language, what it is supposed to say to a search
// engine.
//
// Run with: npm run check:seo
//
// This exists because this kind of thing rots silently. Nothing renders wrong, nothing throws, and
// nobody notices for months. It has already happened here twice: all nine landings once shipped the
// same English <title>, and a playground check once compared a verdict against the English word for
// it and passed anyway. A page that is merely invisible looks exactly like a page that is fine.
import { chromium } from 'playwright'
import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const docs = join(root, 'docs')
const SITE = 'https://qredential.js.org'

const locales = JSON.parse(await readFile(join(root, 'content/locales.json'), 'utf8'))
const codes = Object.keys(locales).filter((k) => k !== '_comment')
const SOURCE = codes.find((c) => locales[c].source) ?? 'en'
const seoConfig = JSON.parse(await readFile(join(root, 'content/seo.json'), 'utf8'))

let failures = 0
const fail = (where, what) => {
  console.log(`  FAIL  ${where}\n        ${what}`)
  failures++
}

// ---------------------------------------------------------------------------- collect the pages

async function walk(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(full)))
    else if (entry.name === 'index.html') out.push(full)
  }
  return out
}

/** docs/ko/guide/index.html becomes https://.../qredential/ko/guide/, which is what the canonical,
 *  the hreflang set and the sitemap all have to agree on. */
const urlOf = (file) => {
  const rel = relative(docs, file).replace(/index\.html$/, '')
  return `${SITE}/${rel}`
}
const typeOf = (file) =>
  file.includes('/guide/') ? 'guide' : file.includes('/playground/') ? 'playground' : 'landing'

const pages = (await walk(docs)).sort()
const meta = new Map()

const attr = (html, re) => re.exec(html)?.[1] ?? null

for (const file of pages) {
  const html = await readFile(file, 'utf8')
  const where = relative(root, file)
  const url = urlOf(file)

  const m = {
    url,
    type: typeOf(file),
    title: attr(html, /<title>([^<]*)<\/title>/),
    description: attr(html, /<meta name="description" content="([^"]*)"/),
    canonical: attr(html, /<link rel="canonical" href="([^"]*)"/),
    lang: attr(html, /<html lang="([^"]*)"/),
    ogLocale: attr(html, /<meta property="og:locale" content="([^"]*)"/),
    ogImage: attr(html, /<meta property="og:image" content="([^"]*)"/),
    alternates: [...html.matchAll(/<link rel="alternate" hreflang="([^"]*)" href="([^"]*)"/g)].map(
      (x) => `${x[1]} ${x[2]}`
    ),
    ld: attr(html, /<script type="application\/ld\+json">([\s\S]*?)<\/script>/),
    preloads: [...html.matchAll(/<link rel="preload" as="font"[^>]*href="([^"]*)"/g)].map((x) => x[1]),
  }
  meta.set(where, m)

  if (!m.title) fail(where, 'no <title>')
  if (!m.description) fail(where, 'no meta description')
  if (m.canonical !== url) fail(where, `canonical is ${m.canonical}, should be ${url}`)
  if (!m.lang) fail(where, 'no lang on <html>')

  // Facebook, LinkedIn, Kakao and Line all read og:locale, and all of them want a territory. A
  // bare "ko", or a script subtag like "zh_Hans", is not a locale any of them can resolve.
  if (!/^[a-z]{2}_[A-Z]{2}$/.test(m.ogLocale ?? ''))
    fail(where, `og:locale is ${m.ogLocale}, should look like ko_KR`)

  if (!m.ogImage) fail(where, 'no og:image')
  else if (!existsSync(join(docs, m.ogImage.replace(`${SITE}/`, ''))))
    fail(where, `og:image points at ${m.ogImage}, which is not in docs/`)

  if (/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(html))
    fail(where, 'calls Google Fonts, which is unreachable from mainland China and blocks the render')

  for (const href of m.preloads) {
    if (!existsSync(join(docs, href.replace(`${SITE}/`, ''))))
      fail(where, `preloads ${href}, which is not in docs/`)
  }

  try {
    const parsed = JSON.parse(m.ld ?? '')
    if (!Array.isArray(parsed['@graph']) || parsed['@graph'].length < 3)
      fail(where, 'structured data is not a graph of at least three nodes')
  } catch {
    fail(where, 'structured data is missing or is not valid JSON')
  }

  if (!m.alternates.some((a) => a.startsWith('x-default ')))
    fail(where, 'no x-default alternate, so a reader outside the nine languages is unplaced')
}

// ------------------------------------------------------- the things only a whole site can check

// Nine landings that share one title are nine pages competing to be the same result, and eight of
// them lose. This is the check that would have caught it the first time.
for (const field of ['title', 'description']) {
  const seen = new Map()
  for (const [where, m] of meta) {
    const key = `${m.type}::${m[field]}`
    if (seen.has(key)) fail(where, `same ${field} as ${seen.get(key)}`)
    else seen.set(key, where)
  }
}

// An hreflang set is believed only when it is reciprocal: every page in the group has to name the
// same alternates, including itself, or engines discard the lot.
const byType = new Map()
for (const [where, m] of meta) {
  const known = byType.get(m.type)
  if (!known) byType.set(m.type, { where, set: m.alternates.join('|') })
  else if (known.set !== m.alternates.join('|'))
    fail(where, `hreflang set differs from ${known.where}, so the group is not reciprocal`)
  if (!m.alternates.some((a) => a.endsWith(` ${m.url}`)))
    fail(where, 'the hreflang set does not include the page itself')
}

const sitemap = await readFile(join(docs, 'sitemap.xml'), 'utf8')
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
for (const [where, m] of meta) {
  if (!locs.includes(m.url)) fail(where, `not in sitemap.xml`)
}
for (const loc of locs) {
  const file = join(docs, loc.replace(`${SITE}/`, ''), 'index.html')
  if (!existsSync(file)) fail('docs/sitemap.xml', `lists ${loc}, which is not a page`)
}
if ([...sitemap.matchAll(/<lastmod>/g)].length !== locs.length)
  fail('docs/sitemap.xml', 'some URLs carry no lastmod')

const robots = await readFile(join(docs, 'robots.txt'), 'utf8')
if (!robots.includes(`Sitemap: ${SITE}/sitemap.xml`)) fail('docs/robots.txt', 'does not point at the sitemap')
for (const ua of ['Yeti', 'Baiduspider']) {
  if (!robots.includes(`User-agent: ${ua}`))
    fail('docs/robots.txt', `does not name ${ua}, whose own documentation asks to be named`)
}

// The key file is the entire proof of ownership for IndexNow. If it stops matching, every push to
// Bing, Naver, Yandex and Seznam is rejected, silently, forever.
const keyFile = join(docs, `${seoConfig.indexnow}.txt`)
if (!existsSync(keyFile)) fail('docs/', `no ${seoConfig.indexnow}.txt, so IndexNow cannot verify the key`)
else if ((await readFile(keyFile, 'utf8')).trim() !== seoConfig.indexnow)
  fail(`docs/${seoConfig.indexnow}.txt`, 'does not contain the key it is named after')

for (const c of codes) {
  if (!existsSync(join(docs, 'og', `${c}.png`))) fail('docs/og/', `no card for ${c}`)
}
const llms = await readFile(join(docs, 'llms.txt'), 'utf8')
for (const c of codes) {
  const guide = `${SITE}/${c === SOURCE ? 'guide' : c + '/guide'}/`
  if (!llms.includes(guide)) fail('docs/llms.txt', `does not link the ${c} guide`)
}
const feed = await readFile(join(docs, 'feed.xml'), 'utf8')
if (!/<item>/.test(feed)) fail('docs/feed.xml', 'has no items, so there is nothing to submit to Naver')
if (!(await readFile(join(docs, '404.html'), 'utf8')).includes('name="robots" content="noindex"'))
  fail('docs/404.html', 'is indexable, and a 404 in the index is worse than no 404 page')

// -------------------------------------------------------------- the offer, in a real browser

// The banner is the one piece of this that is behaviour rather than markup, so it is the one piece
// worth opening a browser for.
const browser = await chromium.launch()

/** A context that can reach the file being tested and nothing else. The pages name the deployed
 *  font and script URLs, which do not answer from a checkout, so the QR library is served from
 *  disk and everything else is refused: a check that needs the internet to pass is a check that
 *  fails for the wrong reason. */
const offline = async (locale) => {
  const context = await browser.newContext(locale ? { locale } : {})
  await context.route('**', (route) => {
    const url = route.request().url()
    if (url.endsWith('/vendor/qrcode.min.js')) {
      return route.fulfill({ path: join(docs, 'vendor/qrcode.min.js'), contentType: 'text/javascript' })
    }
    return url.startsWith('file://') ? route.continue() : route.abort()
  })
  return context
}

// The hero demo, in every language. It issues a real credential, narrows it, verifies it and puts
// three numbers on screen: the verdict, the network calls it counted while verifying, and how long
// it took. Those numbers are the site's central claim, and nothing tested them until now. The
// scripts that produce them sit after the content for speed, which is exactly the kind of move
// that breaks a page silently.
for (const code of codes) {
  const file = code === SOURCE ? 'docs/index.html' : `docs/${code}/index.html`
  const context = await offline(null)
  const page = await context.newPage()
  await page.goto(`file://${join(root, file)}`, { waitUntil: 'domcontentloaded' })
  try {
    // Generous on purpose. Nine browser contexts in a row on a loaded CI box is not the same as one
    // on an idle laptop, and a check that fails on a busy machine teaches people to ignore it.
    await page.waitForSelector('#hero-verdict.pass', { timeout: 45000 })
  } catch {
    const word = await page.locator('#hero-word').textContent().catch(() => '')
    fail(file, `the hero demo did not verify its own credential (verdict reads "${word}")`)
    await context.close()
    continue
  }
  const net = (await page.locator('#hero-net').textContent()) ?? ''
  if (net.trim() !== '0') fail(file, `the demo counted ${net} network calls while claiming zero`)
  const qr = await page.locator('#hero-qr svg').count()
  if (qr === 0) {
    const why = await page.locator('#hero-qr .fallback').textContent().catch(() => '')
    fail(file, `no QR was drawn${why ? `, the page says: ${why}` : ''}`)
  }
  const caption = (await page.locator('#hero-caption').textContent()) ?? ''
  if (!/\d/.test(caption)) fail(file, 'the QR caption carries no version or character count')
  await context.close()
}

const cases = [
  ['docs/index.html', 'ko-KR', locales.ko.ui.suggest, `${SITE}/ko/`],
  ['docs/ko/index.html', 'ko-KR', null, null],
  ['docs/index.html', 'en-US', null, null],
  ['docs/pt/guide/index.html', 'fr-CA', locales.fr.ui.suggest, `${SITE}/fr/guide/`],
]
for (const [file, locale, expected, href] of cases) {
  const context = await offline(locale)
  const page = await context.newPage()
  await page.goto(`file://${join(root, file)}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(150)
  const bar = page.locator('#qr-lang a')
  const shown = (await bar.count()) > 0
  if (expected === null && shown) {
    fail(file, `offers ${await bar.textContent()} to a ${locale} reader who does not need it`)
  } else if (expected !== null && !shown) {
    fail(file, `offers nothing to a ${locale} reader`)
  } else if (expected !== null) {
    const text = await bar.textContent()
    const link = await bar.getAttribute('href')
    if (text !== expected) fail(file, `offer reads "${text}", expected "${expected}"`)
    if (link !== href) fail(file, `offer links to ${link}, expected ${href}`)
  }
  await context.close()
}
await browser.close()

console.log(
  failures === 0
    ? `\n${meta.size} pages, ${locs.length} sitemap URLs, ${codes.length} share cards,` +
      ` ${codes.length} hero demos that verify their own credential: all consistent`
    : `\n${failures} problem${failures === 1 ? '' : 's'}`
)
process.exitCode = failures === 0 ? 0 : 1
