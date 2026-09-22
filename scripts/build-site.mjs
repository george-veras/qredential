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
const SITE = 'https://qredential.js.org'

const locales = JSON.parse(await readFile(join(root, 'content/locales.json'), 'utf8'))
const codes = Object.keys(locales).filter((k) => k !== '_comment')
const SOURCE = codes.find((c) => locales[c].source) ?? 'en'

const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16)

// The verification tokens and the IndexNow key. See content/seo.json for what each one is and
// where it comes from; an empty one emits nothing.
const seoConfig = JSON.parse(await readFile(join(root, 'content/seo.json'), 'utf8'))

// The typefaces, served from this site rather than from fonts.googleapis.com. That host is
// unreachable from mainland China, and a render blocking stylesheet on an unreachable host does
// not degrade gracefully, it hangs: the page stays blank until the socket times out. Two of the
// nine languages here are Chinese. docs/fonts/NOTICE.txt has the other two reasons and the licence.
// When each page last changed, and when it first existed.
//
// Kept in content/dates.json and maintained here: a source file whose hash moved gets today, one
// whose hash did not keeps the date it already had. It cannot come from git directly, because a
// date read from git history moves the instant the file is committed, so a sitemap built before a
// commit would never match the one CI rebuilds after it, and the check that the committed pages
// match their source would fail from then on. The ledger was seeded once from the real history.
const dates = JSON.parse(await readFile(join(root, 'content/dates.json'), 'utf8'))
const today = new Date().toISOString().slice(0, 10)
let datesMoved = false

const shells = {
  landing: 'docs/index.template.html',
  guide: 'docs/guide/_shell.html',
  playground: 'docs/playground/index.template.html',
}

const tracked = []
for (const dir of ['content/guide', 'content/landing', 'content/playground', 'content/accessibility']) {
  for (const name of await readdir(join(root, dir))) tracked.push(`${dir}/${name}`)
}
tracked.push(...Object.values(shells))

const stamps = {}
for (const file of tracked) {
  const digest = sha(await readFile(join(root, file), 'utf8'))
  const had = dates.files[file]
  if (!had) {
    dates.files[file] = { sha: digest, created: today, modified: today }
    datesMoved = true
  } else if (had.sha !== digest) {
    dates.files[file] = { ...had, sha: digest, modified: today }
    datesMoved = true
  }
  stamps[file] = dates.files[file]
}
// A language that was removed should not keep claiming a date.
for (const file of Object.keys(dates.files)) {
  if (!tracked.includes(file)) {
    delete dates.files[file]
    datesMoved = true
  }
}

const lastmodOf = (files) => files.map((f) => stamps[f]?.modified).filter(Boolean).sort().pop() ?? null
const createdOf = (files) => files.map((f) => stamps[f]?.created).filter(Boolean).sort()[0] ?? null

const fontFaces = JSON.parse(await readFile(join(root, 'scripts/fonts.json'), 'utf8'))
const fontCss = fontFaces
  .map(
    (f) =>
      `@font-face{font-family:'${f.family}';font-style:normal;font-weight:${f.weight};` +
      (f.family === 'Archivo' ? 'font-stretch:100%;' : '') +
      `font-display:swap;src:url(${SITE}/fonts/${f.file}) format('woff2');` +
      `unicode-range:${f.range}}`
  )
  .join('')

/** Wraps a built page in a real HTML document.
 *
 *  The pages were shipping with no doctype, no <head> and no <body>, which put every one of them in
 *  quirks mode: browsers guessed, and the guesses happened to look right, so nothing ever said so.
 *  It also left them unparseable by anything stricter than a browser, which is how this surfaced:
 *  Google Search Console refused to verify the site because the meta tag it was looking for was,
 *  as far as its parser could tell, not inside a head.
 *
 *  Takes a page that already starts with its <html> tag, and puts the boundary between head and
 *  body at the skip link, which is the first thing in the body of every shell. */
function asDocument(page) {
  const open = page.indexOf('\n')
  const boundary = page.indexOf('<a class="skip"')
  if (boundary < 0) throw new Error('no skip link: cannot tell where the head ends')
  return (
    '<!doctype html>\n' +
    page.slice(0, open) +
    '\n<head>\n' +
    page.slice(open + 1, boundary).trimEnd() +
    '\n</head>\n<body>\n' +
    page.slice(boundary).trimEnd() +
    '\n</body>\n</html>\n'
  )
}

/** The tag that goes in <html lang>, which is not always the locale code: Baidu reads this
 *  attribute instead of hreflang, and expects zh-CN rather than the script subtag zh-Hans. */
const htmlLang = (c) => locales[c].htmlLang ?? c

/** Every hreflang value that should point at a locale. Chinese needs the regional aliases:
 *  nothing in zh-Hant tells a search engine that Taiwan and Hong Kong are the regions meant. */
const hreflangsFor = (c) => [c, ...(locales[c].alsoHreflang ?? [])]


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

const a11ySources = {}
for (const code of codes) {
  try {
    a11ySources[code] = await readFile(join(root, `content/accessibility/${code}.md`), 'utf8')
  } catch {
    // Same rule as the guide: a language with no statement yet does not get a page claiming one.
  }
}

const landing = {}
const playground = {}
for (const code of codes) {
  try {
    landing[code] = JSON.parse(await readFile(join(root, `content/landing/${code}.json`), 'utf8'))
  } catch {
    // Not translated yet. The language simply does not get a landing page.
  }
  try {
    playground[code] = JSON.parse(await readFile(join(root, `content/playground/${code}.json`), 'utf8'))
  } catch {
    // Same for the playground.
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

  // Both the locale landing and the locale playground sit beside the guide, one level up.
  const page = shell
    .replace(/__HOME__/g, '../')
    .replace(/__ROOT__/g, '../')
    .replace('__NAV_HOME__', ui.navHome)
    .replace('__DOCS_HREF__', './')
    .replace('__DOCS_CURRENT__', ' aria-current="page"')
    .replace('__NAV_DOCS__', ui.navDocs)
    .replace('__NAV_PLAYGROUND__', ui.navPlayground)
    .replace('__TOC_TITLE__', ui.tocTitle)
    .replace('__LANG_TITLE__', ui.langTitle)
    .replace('__FOOTER_SOURCE__', ui.footerSource)
    .replace('__TOC__', toc)
    .replace('__LANGS__', langs)
    .replace('__CONTENT__', html)
    .replace('__PROVENANCE__', provenance(code, { stale, unstamped }))
    .replace(/__SKIP__/g, ui.skip)
    .replace(/__A11Y_LABEL__/g, ui.accessibility)

  const seo = locales[code].seo
  const withHead =
    `<html lang="${htmlLang(code)}" dir="${locales[code].dir ?? 'ltr'}">\n` +
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
  await writeFile(out, asDocument(withHead))

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
  const pool = { guide: guideSources, landing, playground, accessibility: a11ySources }[type]
  const available = (c) => pool[c]
  const localePath = (c) =>
    type === 'landing'
      ? c === SOURCE ? '' : `${c}/`
      : c === SOURCE ? `${type}/` : `${c}/${type}/`

  const tags = codes
    .filter(available)
    .flatMap((c) =>
      hreflangsFor(c).map(
        (tag) => `<link rel="alternate" hreflang="${tag}" href="${SITE}/${localePath(c)}">`
      )
    )

  tags.push(
    `<link rel="alternate" hreflang="x-default" href="${SITE}/${localePath(SOURCE)}">`,
    `<link rel="canonical" href="${url}">`,
    `<meta name="description" content="${escapeAttr(description)}">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<style>${fontCss}</style>`,
    `<link rel="preload" as="font" type="font/woff2" crossorigin href="${SITE}/fonts/ibm-plex-sans-400.woff2">`,
    `<link rel="preload" as="font" type="font/woff2" crossorigin href="${SITE}/fonts/archivo-${
      type === 'landing' ? 800 : 700
    }.woff2">`,
    `<link rel="icon" href="${SITE}/favicon.svg" type="image/svg+xml">`,

    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="qredential">`,
    `<meta property="og:title" content="${escapeAttr(title)}">`,
    `<meta property="og:description" content="${escapeAttr(description)}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:locale" content="${locales[code].ogLocale}">`,
    `<meta property="og:image" content="${SITE}/og/${code}.png">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:image:type" content="image/png">`,
    `<meta property="og:image:alt" content="${escapeAttr(title)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${escapeAttr(title)}">`,
    `<meta name="twitter:description" content="${escapeAttr(description)}">`,
    `<meta name="twitter:image" content="${SITE}/og/${code}.png">`
  )

  for (const c of codes.filter(available)) {
    if (c !== code) tags.push(`<meta property="og:locale:alternate" content="${locales[c].ogLocale}">`)
  }

  // Ownership tokens, one per console. Google and Bing find a site by themselves and these only
  // unlock their reports, but Naver is different: Yeti collects nothing from a domain that was
  // never registered in Search Advisor, so Korea cannot see this site at all until that token
  // exists. Baidu works the same way for a site hosted outside China.
  for (const [name, token] of Object.entries(seoConfig.verification)) {
    if (token) tags.push(`<meta name="${name}" content="${escapeAttr(token)}">`)
  }

  // Baidu reads meta keywords, which Google stopped using in 2009, so only the locales whose
  // market runs on Baidu declare them. applicable-device is Baidu's own mobile signal.
  const localeSeo = locales[code].seo
  if (localeSeo.keywords) {
    tags.push(`<meta name="keywords" content="${escapeAttr(localeSeo.keywords)}">`)
  }
  tags.push(`<meta name="applicable-device" content="pc,mobile">`)

  // Naver's console takes an RSS feed alongside the sitemap, and releases are the one thing here
  // that changes on a schedule worth subscribing to.
  tags.push(
    `<link rel="alternate" type="application/rss+xml" title="qredential releases" href="${SITE}/feed.xml">`
  )

  // A reader who lands on a language they do not read is a reader lost, and the URL they were sent
  // is the URL they will pass on. Google is explicit that redirecting by IP is the wrong fix: it
  // hides the other languages from the crawler too, and it takes the choice away from someone who
  // opened that link deliberately. So this is an offer, in the language being offered, dismissed
  // for good with one click and never shown to someone already reading their own language.
  const offers = {}
  for (const c of codes.filter(available)) {
    offers[c] = [`${SITE}/${localePath(c)}`, locales[c].ui.suggest, locales[c].ui.suggestClose]
  }
  tags.push(
    '<style>#qr-lang{display:flex;gap:1rem;align-items:center;justify-content:center;flex-wrap:wrap;' +
      'padding:.65rem 1rem;font:500 .875rem/1.35 ui-sans-serif,system-ui,sans-serif;' +
      'background:var(--panel,#EDF1EE);color:var(--ink,#111A1D);' +
      'border-bottom:1px solid var(--line,#D4DCD7)}' +
      '#qr-lang a{color:var(--viridian,#0E6B54);display:inline-flex;align-items:center;' +
      'min-height:24px}' +
      '#qr-lang button{background:none;border:0;color:inherit;opacity:.55;cursor:pointer;' +
      // WCAG 2.2 adds a 24 by 24 minimum for anything you have to hit with a finger.
      'font-size:1.1rem;line-height:1;min-width:24px;min-height:24px;display:grid;' +
      'place-items:center}' +
      '#qr-lang button:hover{opacity:1}</style>',
    `<script>${languageOffer(code, offers)}</script>`
  )

  // Structured data, as one graph rather than three unrelated islands. The nodes carry @id and
  // point at each other, which is how a search engine works out that nine landings in nine
  // languages are one piece of software and not nine competing ones.
  const sourceFile = {
    guide: `content/guide/${code}.md`,
    landing: `content/landing/${code}.json`,
    playground: `content/playground/${code}.json`,
    accessibility: `content/accessibility/${code}.md`,
  }[type]
  const modified = lastmodOf([sourceFile])
  const created = createdOf([sourceFile])
  const homeUrl = `${SITE}/${code === SOURCE ? '' : code + '/'}`
  const ui = locales[code].ui

  // The accessibility vocabulary schema.org defines for creative works. Catalogues and search
  // engines read it, and unlike a logo it says what is actually true in a form a machine can check
  // against the page. Every value here is one the statement page can defend.
  const a11y = {
    accessMode: ['textual', 'visual'],
    // Nothing on these pages needs sight to be understood: the QR code is a picture of data whose
    // every value is also printed as text, and the diagram carries a full description.
    accessModeSufficient: [{ '@type': 'ItemList', itemListElement: ['textual'] }],
    accessibilityFeature: [
      'structuralNavigation',
      'readingOrder',
      'tableOfContents',
      'alternativeText',
      'displayTransformability',
    ],
    accessibilityControl: ['fullKeyboardControl', 'fullMouseControl', 'fullTouchControl'],
    accessibilityHazard: ['noFlashingHazard', 'noSoundHazard', 'noMotionSimulationHazard'],
    accessibilitySummary: locales[code].seo.a11ySummary,
  }

  const author = {
    '@type': 'Person',
    '@id': `${SITE}/#author`,
    name: 'George Veras Valentim',
    // Two sites that point at each other say, in a form a search engine reads, that they are one
    // person's work rather than two unrelated things.
    url: 'https://george-veras.github.io/',
    sameAs: ['https://github.com/george-veras', 'https://george-veras.github.io/'],
  }

  const software = {
    ...a11y,
    '@type': 'SoftwareSourceCode',
    '@id': `${SITE}/#software`,
    name: 'qredential',
    description: locales[code].seo.landingDesc,
    inLanguage: code,
    url: homeUrl,
    codeRepository: REPO,
    programmingLanguage: 'TypeScript',
    runtimePlatform: ['Node.js', 'Browser', 'React Native'],
    license: 'https://opensource.org/licenses/MIT',
    isAccessibleForFree: true,
    sameAs: ['https://www.npmjs.com/package/qredential', REPO],
    author: { '@id': `${SITE}/#author` },
    ...(modified ? { dateModified: modified.slice(0, 10) } : {}),
  }

  // Home is the first crumb on every page, including home itself, so the trail is the same shape
  // wherever a result lands.
  const crumb = (position, name, item) => ({ '@type': 'ListItem', position, name, item })
  const trail = [crumb(1, ui.navHome, homeUrl)]
  if (type === 'guide') trail.push(crumb(2, ui.navDocs, url))
  if (type === 'playground') trail.push(crumb(2, ui.navPlayground, url))

  const page =
    // The statement is an article about the site, the same shape as the guide, not the software.
    type === 'guide' || type === 'accessibility'
      ? {
          ...a11y,
          '@type': 'TechArticle',
          '@id': `${url}#article`,
          headline: title,
          description,
          inLanguage: code,
          url,
          about: { '@id': `${SITE}/#software` },
          author: { '@id': `${SITE}/#author` },
          license: 'https://opensource.org/licenses/MIT',
          ...(created ? { datePublished: created.slice(0, 10) } : {}),
          ...(modified ? { dateModified: modified.slice(0, 10) } : {}),
        }
      : type === 'playground'
        ? {
            // It is not a page about the library, it is the library running. Saying so is both
            // true and the only description under which a result makes sense to click.
            ...a11y,
            '@type': 'WebApplication',
            '@id': `${url}#app`,
            name: title,
            description,
            inLanguage: code,
            url,
            applicationCategory: 'DeveloperApplication',
            browserRequirements: 'Requires WebCrypto, available in all current browsers',
            operatingSystem: 'Any',
            isAccessibleForFree: true,
            offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
            about: { '@id': `${SITE}/#software` },
            author: { '@id': `${SITE}/#author` },
          }
        : software

  const graph = [
    {
      '@type': 'WebSite',
      '@id': `${SITE}/#website`,
      name: 'qredential',
      url: homeUrl,
      inLanguage: code,
      publisher: { '@id': `${SITE}/#author` },
    },
    author,
    ...(type === 'landing' ? [] : [software]),
    page,
    { '@type': 'BreadcrumbList', '@id': `${url}#trail`, itemListElement: trail },
  ]

  tags.push(
    `<script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': graph,
    })}</script>`
  )

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


// ------------------------------------------------- the accessibility statement, one per locale
//
// Prose, like the guide, so it reuses the guide's shell and its provenance machinery rather than
// growing a second design. It is a page and not a section of the documentation because a
// conformance claim has to be findable from anywhere, and because it is addressed to a different
// reader than the API reference is.

const a11ySourceHash = sha(readStamp(a11ySources[SOURCE] ?? '').body)
const a11yPath = (code) => (code === SOURCE ? 'accessibility' : `${code}/accessibility`)

for (const code of codes) {
  const raw = a11ySources[code]
  if (!raw) continue

  const { stamp, body } = readStamp(raw)
  const isSource = code === SOURCE
  const { html, headings } = renderGuide(body)
  const ui = locales[code].ui

  const toc = headings.map((h) => `<li><a href="#${h.id}">${h.text}</a></li>`).join('\n      ')
  const langs = codes
    .filter((c) => a11ySources[c])
    .map((c) => {
      const here = c === code
      const href = c === SOURCE ? `${rootFrom(code)}accessibility/` : `${rootFrom(code)}${c}/accessibility/`
      return `<li><a href="${href}" hreflang="${c}" lang="${htmlLang(c)}"${
        here ? ' aria-current="page"' : ''
      }>${locales[c].native}</a></li>`
    })
    .join('\n      ')

  const seo = locales[code].seo
  const page =
    `<html lang="${htmlLang(code)}" dir="${locales[code].dir ?? 'ltr'}">\n` +
    shell
      .replace(/__HOME__/g, code === SOURCE ? '../' : '../../')
      .replace(/__ROOT__/g, rootFrom(code))
      .replace('__NAV_HOME__', ui.navHome)
      .replace('__DOCS_HREF__', '../guide/')
      .replace('__DOCS_CURRENT__', '')
    .replace('__NAV_DOCS__', ui.navDocs)
      .replace('__NAV_PLAYGROUND__', ui.navPlayground)
      .replace('__TOC_TITLE__', ui.tocTitle)
      .replace('__LANG_TITLE__', ui.langTitle)
      .replace('__FOOTER_SOURCE__', ui.footerSource)
      .replace('__TOC__', toc)
      .replace('__LANGS__', langs)
      .replace('__CONTENT__', html)
      .replace('__PROVENANCE__', provenance(code, {
        stale: !isSource && stamp !== null && stamp !== a11ySourceHash,
        unstamped: !isSource && stamp === null,
      }))
      .replace(/__SKIP__/g, ui.skip)
    .replace(/__A11Y_LABEL__/g, ui.accessibility)
      .replace(
        /<title>[^<]*<\/title>/,
        head(code, {
          path: `${a11yPath(code)}/`,
          title: seo.a11yTitle,
          description: seo.a11yDesc,
          type: 'accessibility',
        }) + `\n<title>${seo.a11yTitle}</title>`
      )

  const out = join(docs, a11yPath(code), 'index.html')
  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, asDocument(page))
  console.log(`statement ${code.padEnd(8)} ${(page.length / 1024).toFixed(1)} KB`)
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
  const isPlayground = template === join(docs, 'playground/index.template.html')

  if (isPlayground) {
    for (const code of codes) {
      const strings = playground[code]
      if (!strings) continue

      const gaps = [...source.matchAll(/\{\{([a-zA-Z.0-9]+)\}\}/g)]
        .map((m) => m[1])
        .filter((k) => strings[k] === undefined)
      if (gaps.length > 0) {
        throw new Error(`playground/${code}.json is missing keys: ${[...new Set(gaps)].join(', ')}`)
      }

      let page = source
        .replace(/\{\{([a-zA-Z.0-9]+)\}\}/g, (_, k) => strings[k])
        .replace('__STRINGS__', `window.__T=${JSON.stringify(strings)};`)
        .replace('__BUNDLE__', () => bundle)
        .replace('__QRLIB__', `<script src="${SITE}/vendor/qrcode.min.js"></script>`)
        .replace(/__SKIP__/g, locales[code].ui.skip)
        .replace(/__A11Y_LABEL__/g, locales[code].ui.accessibility)
        .replace('__H1__', locales[code].seo.playgroundTitle)

      const path = code === SOURCE ? 'playground/' : `${code}/playground/`
      page =
        `<html lang="${htmlLang(code)}" dir="${locales[code].dir ?? 'ltr'}">\n` +
        page.replace(
          /<title>[^<]*<\/title>/,
          head(code, {
            path,
            title: locales[code].seo.playgroundTitle,
            description: locales[code].seo.playgroundDesc,
            type: 'playground',
          }) + `\n<title>${locales[code].seo.playgroundTitle}</title>`
        )

      const out = join(docs, path, 'index.html')
      await mkdir(dirname(out), { recursive: true })
      await writeFile(out, asDocument(page))
      console.log(`playground ${code.padEnd(8)} ${(page.length / 1024).toFixed(1)} KB`)
    }
    continue
  }

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
    const play = './playground/'

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
      .replace('__QRLIB__', `<script src="${SITE}/vendor/qrcode.min.js"></script>`)
      .replace(/__SKIP__/g, locales[code].ui.skip)
        .replace(/__A11Y_LABEL__/g, locales[code].ui.accessibility)

    const seo = locales[code].seo
    page =
      `<html lang="${htmlLang(code)}" dir="${locales[code].dir ?? 'ltr'}">\n` +
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
    await writeFile(out, asDocument(page))
    console.log(`landing ${code.padEnd(8)} ${(page.length / 1024).toFixed(1)} KB`)
  }
}

/** The banner script, inlined. Runs before the page paints, decides in microseconds, and touches
 *  the DOM only if it has something to offer. */
function languageOffer(code, offers) {
  const data = JSON.stringify(offers).replace(/</g, '\\u003c')
  return (
    `(function(){var O=${data},cur=${JSON.stringify(code)};` +
    `try{if(localStorage.getItem('qr-lang-off'))return}catch(e){}` +
    // Chinese is the only language here where the browser tag and the locale code disagree:
    // zh-TW and zh-HK mean traditional, everything else under zh means simplified.
    `var want=(navigator.languages||[navigator.language||'']).map(function(t){t=String(t);` +
    `var l=t.toLowerCase();if(l.indexOf('zh')===0)return /hant|tw|hk|mo/.test(l)?'zh-Hant':'zh-Hans';` +
    `return t.split('-')[0]});` +
    // First supported preference wins. If it is the page they are already on, say nothing.
    `var pick=null;for(var i=0;i<want.length;i++){if(!O[want[i]])continue;` +
    `if(want[i]===cur)return;pick=want[i];break}if(!pick)return;` +
    `document.addEventListener('DOMContentLoaded',function(){` +
    `var d=document.createElement('div');d.id='qr-lang';d.lang=pick;d.dir='ltr';` +
    `var a=document.createElement('a');a.href=O[pick][0];a.hreflang=pick;a.textContent=O[pick][1];` +
    `var b=document.createElement('button');b.type='button';b.textContent='\\u00D7';` +
    `b.setAttribute('aria-label',O[pick][2]);` +
    `b.onclick=function(){d.remove();try{localStorage.setItem('qr-lang-off','1')}catch(e){}};` +
    `d.appendChild(a);d.appendChild(b);document.body.insertBefore(d,document.body.firstChild)})})()`
  )
}

// ------------------------------------------------------------ robots, sitemap and the site icon
//
// Generated rather than committed by hand, so a language added tomorrow appears in the sitemap
// without anyone remembering to edit it.


// Each page declares every language it exists in, plus the regional aliases, plus x-default for a
// reader the set does not cover. The list is identical on every URL in the group, which is what
// makes it reciprocal and therefore believed.
const groupFor = (pool, href) => [
  ...codes.filter((c) => pool[c]).flatMap((c) => hreflangsFor(c).map((tag) => [tag, href(c)])),
  ['x-default', href(SOURCE)],
]

const urls = []
for (const code of codes.filter((c) => landing[c])) {
  const href = (c) => `${SITE}/${c === SOURCE ? '' : c + '/'}`
  urls.push({
    loc: href(code),
    alts: groupFor(landing, href),
    lastmod: lastmodOf([`content/landing/${code}.json`, shells.landing]),
  })
}
for (const code of codes.filter((c) => guideSources[c])) {
  const href = (c) => `${SITE}/${c === SOURCE ? 'guide' : c + '/guide'}/`
  urls.push({
    loc: href(code),
    alts: groupFor(guideSources, href),
    lastmod: lastmodOf([`content/guide/${code}.md`, shells.guide]),
  })
}
for (const code of codes.filter((c) => a11ySources[c])) {
  const href = (c) => `${SITE}/${c === SOURCE ? 'accessibility' : c + '/accessibility'}/`
  urls.push({
    loc: href(code),
    alts: groupFor(a11ySources, href),
    lastmod: lastmodOf([`content/accessibility/${code}.md`, shells.guide]),
  })
}
for (const code of codes.filter((c) => playground[c])) {
  const href = (c) => `${SITE}/${c === SOURCE ? 'playground' : c + '/playground'}/`
  urls.push({
    loc: href(code),
    alts: groupFor(playground, href),
    lastmod: lastmodOf([`content/playground/${code}.json`, shells.playground]),
  })
}

const sitemap = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemap.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">'
    .replace('www.sitemap.org', 'www.sitemaps.org'),
  ...urls.map(({ loc, alts, lastmod }) =>
    [
      '  <url>',
      `    <loc>${loc}</loc>`,
      ...(lastmod ? [`    <lastmod>${lastmod}</lastmod>`] : []),
      ...alts.map(([c, href]) => `    <xhtml:link rel="alternate" hreflang="${c}" href="${href}"/>`),
      '  </url>',
    ].join('\n')
  ),
  '</urlset>',
].join('\n')

await writeFile(join(docs, 'sitemap.xml'), sitemap + '\n')
// robots.txt. The blanket rule already allows everyone, so the named groups below are not there to
// change behaviour: they are there because Naver's and Baidu's own documentation asks to see their
// crawler named, and because a file that lists who is welcome is easier to audit than one that
// leaves it implied.
await writeFile(
  join(docs, 'robots.txt'),
  [
    'User-agent: *',
    'Allow: /',
    // The two build templates live in docs/ so the build can read them in place, which means Pages
    // serves them too. They render as a wall of unsubstituted placeholders, so keep them out of
    // every index. A more specific path beats the blanket Allow above, for every crawler that
    // implements the spec properly.
    'Disallow: /index.template.html',
    'Disallow: /guide/_shell.html',
    '',
    '# Search engines that do not share an index with Google, one market each.',
    '# Yeti is Naver, and Korea is the market that most depends on being let in by name.',
    ...['Yeti', 'Baiduspider', 'Sogou web spider', '360Spider', 'YandexBot', 'Applebot'].flatMap(
      (ua) => [`User-agent: ${ua}`, 'Allow: /', '']
    ),
    '# Answer engines. A library is found through a question as often as through a query now, and',
    '# an answer that cites the documentation sends a reader who already knows what this does.',
    ...['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'PerplexityBot', 'Google-Extended'].flatMap(
      (ua) => [`User-agent: ${ua}`, 'Allow: /', '']
    ),
    `Sitemap: ${SITE}/sitemap.xml`,
    '',
  ].join('\n')
)

// The 404. GitHub Pages serves this file for anything it cannot find, and a dead end on a nine
// language site is usually someone who typed or was sent the wrong language prefix, so the way out
// is the language list itself. noindex, because a 404 in the index is worse than no 404 at all.
await writeFile(
  join(docs, '404.html'),
  `<!doctype html>
<html lang="en" dir="ltr">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Not found, qredential</title>
<link rel="icon" href="${SITE}/favicon.svg" type="image/svg+xml">
<style>${fontCss}
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:grid; place-content:center; gap:1.25rem;
         padding:2rem; background:#F4F6F4; color:#111A1D;
         font:400 1rem/1.5 'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif; }
  h1 { margin:0; font-family:Archivo, ui-sans-serif, sans-serif; font-weight:800; font-size:3.5rem;
       letter-spacing:-.03em; }
  p { margin:0; max-width:48ch; color:#3B4A47; }
  ul { list-style:none; margin:0; padding:0; display:flex; flex-wrap:wrap; gap:.4rem 1.25rem; }
  a { color:#0E6B54; }
  @media (prefers-color-scheme: dark) {
    body { background:#0C1214; color:#E4EAE5; } p { color:#C4CFCA; } a { color:#4FBB98; }
  }
</style>
<h1>404</h1>
<p>That page does not exist. It may have been the wrong language prefix, so here is every language
this site is written in.</p>
<ul>
${codes
  .filter((c) => landing[c])
  .map(
    (c) =>
      `  <li><a href="${SITE}/${c === SOURCE ? '' : c + '/'}" hreflang="${c}" lang="${htmlLang(
        c
      )}">${locales[c].native}</a></li>`
  )
  .join('\n')}
</ul>
</html>
`
)

// The IndexNow key, hosted as its own file. The protocol has no accounts and no registration: you
// invent the key, and serving it here is the whole proof that you own what you are pushing. One
// POST reaches Bing, Naver, Yandex, Seznam and Yep, which between them cover Korea, Russia, central
// Europe and everything downstream of Bing.
await writeFile(join(docs, `${seoConfig.indexnow}.txt`), `${seoConfig.indexnow}\n`)

// llms.txt, for the answer engines that read one. Same idea as robots.txt, aimed at a reader that
// summarises rather than ranks: say what this is, in one screen, and point at the real pages.
await writeFile(
  join(docs, 'llms.txt'),
  [
    '# qredential',
    '',
    '> Offline verification of digital credentials carried in a QR code. SD-JWT with selective',
    '> disclosure and key binding (RFC 9901), Token Status List revocation from a cached copy and',
    '> base45 QR framing, in TypeScript with no runtime dependencies, on WebCrypto alone. Built for',
    '> the roadside case: a verifier with no signal that must answer yes or no in under a second.',
    '',
    'MIT licensed. No third party security audit; the README says so in the same words.',
    '',
    '## Documentation',
    '',
    ...codes
      .filter((c) => guideSources[c])
      .map(
        (c) =>
          `- [${locales[c].name} guide](${SITE}/${c === SOURCE ? 'guide' : c + '/guide'}/): ` +
          `issue, present and verify, the error model and the QR size budget, in ${locales[c].name}.`
      ),
    '',
    '## Also',
    '',
    `- [Accessibility statement](${SITE}/accessibility/): the WCAG 2.2 AA claim, what it rests on, and what it does not.`,
    `- [Playground](${SITE}/playground/): runs the library in the browser and fires ten real attacks at the verifier.`,
    `- [Source](${REPO}): implementation, tests and issues.`,
    `- [Changelog](${REPO}/blob/main/CHANGELOG.md): error codes and rejection reasons are API and are versioned as such.`,
    '',
  ].join('\n')
)

// The release feed. Naver's console takes an RSS URL alongside the sitemap, and someone who
// depends on these error codes should be able to hear about a change without watching a repo.
const changelog = await readFile(join(root, 'CHANGELOG.md'), 'utf8')
const plain = (md) =>
  md
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#+ /gm, '')
    .replace(/^- /gm, '')
    .replace(/\s+/g, ' ')
    .trim()

const items = []
for (const section of changelog.split(/^## /m).slice(1)) {
  const version = /^\[([^\]]+)\]/.exec(section)?.[1]
  if (!version || version.toLowerCase() === 'unreleased') continue
  const body = plain(section.split('\n').slice(1).join('\n'))
  if (!dates.releases[version]) {
    dates.releases[version] = today
    datesMoved = true
  }
  const when = dates.releases[version]
  items.push(
    [
      '  <item>',
      `    <title>qredential ${version}</title>`,
      // On domain on purpose. Naver's Search Advisor refuses a feed whose item URLs point somewhere
      // other than the verified site, and it is right to: a feed that links away is a feed that can
      // be used to vouch for anybody. The changelog itself is named in the description instead.
      `    <link>${SITE}/</link>`,
      `    <guid isPermaLink="false">qredential-${version}</guid>`,
      ...(when ? [`    <pubDate>${new Date(`${when}T00:00:00Z`).toUTCString()}</pubDate>`] : []),
      `    <description><![CDATA[${body.slice(0, 900)}\n\nFull changelog: ${REPO}/blob/main/CHANGELOG.md]]></description>`,
      '  </item>',
    ].join('\n')
  )
}
await writeFile(
  join(docs, 'feed.xml'),
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '<channel>',
    '  <title>qredential releases</title>',
    `  <link>${SITE}/</link>`,
    '  <description>Offline credential verification from a QR code. New versions, and every change to the error codes.</description>',
    '  <language>en</language>',
    `  <atom:link href="${SITE}/feed.xml" rel="self" type="application/rss+xml"/>`,
    ...items,
    '</channel>',
    '</rss>',
    '',
  ].join('\n')
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

if (datesMoved) {
  await writeFile(join(root, 'content/dates.json'), JSON.stringify(dates, null, 2) + '\n')
}

console.log(
  `\nsitemap: ${urls.length} URLs, plus robots.txt, llms.txt, feed.xml (${items.length} releases),` +
    ` 404.html, the IndexNow key and favicon.svg${datesMoved ? ', dates.json updated' : ''}`
)

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
