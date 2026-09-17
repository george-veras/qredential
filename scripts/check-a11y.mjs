// Runs WCAG 2.2 AA against every page of the site, in every language.
//
// Run with: npm run check:a11y
//
// Automation catches roughly a third of what WCAG asks for, so this is a floor and not a pass mark.
// It is worth having as a floor anyway: the pages are generated, so one markup mistake becomes the
// same mistake in twenty seven places, and a contrast pair chosen once is wrong in nine languages
// at once.
//
// The rules are the standard's own tags, not axe's opinions: best-practice findings are printed
// separately and do not fail the run, because failing a build on something that is not in the
// standard teaches people to disable the check.
import { chromium } from 'playwright'
import { readFile, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const axePath = require.resolve('axe-core')
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const docs = join(root, 'docs')

const locales = JSON.parse(await readFile(join(root, 'content/locales.json'), 'utf8'))
const codes = Object.keys(locales).filter((k) => k !== '_comment')

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

async function walk(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(full)))
    else if (entry.name === 'index.html') out.push(full)
  }
  return out
}

const browser = await chromium.launch()
let failures = 0
const advisory = new Map()

// Contrast is a property of the stylesheet, not of the language, so the dark theme is exercised on
// one page of each shape rather than on all twenty seven. The cost of the full matrix is five
// minutes of CI for findings that would be identical nine times over.
const pages = (await walk(docs)).sort()
const darkToo = new Set([join(docs, 'index.html'), join(docs, 'guide/index.html'), join(docs, 'playground/index.html')])
const runs = pages.flatMap((f) => (darkToo.has(f) ? [[f, 'light'], [f, 'dark']] : [[f, 'light']]))

for (const [file, scheme] of runs) {
  const where = relative(root, file) + (scheme === 'dark' ? '  [dark]' : '')
  const context = await browser.newContext({ colorScheme: scheme })
  // Same rule as the other checks: the page may reach itself and the QR library on disk, and
  // nothing else. A check that needs the network fails for the wrong reason.
  await context.route('**', (route) => {
    const url = route.request().url()
    if (url.endsWith('/vendor/qrcode.min.js')) {
      return route.fulfill({ path: join(docs, 'vendor/qrcode.min.js'), contentType: 'text/javascript' })
    }
    return url.startsWith('file://') ? route.continue() : route.abort()
  })
  const page = await context.newPage()
  await page.goto(`file://${file}`, { waitUntil: 'domcontentloaded' })
  // The landing writes its verdict asynchronously, and a rule about live regions or contrast has
  // to see the finished page rather than the placeholder. Only the landing has one, so only the
  // landing waits: asking the other eighteen pages to wait for an element they will never have
  // costs three quarters of an hour and finds nothing.
  if (!where.includes('/guide/') && !where.includes('/playground/')) {
    await page.waitForSelector('#hero-verdict.pass', { timeout: 45000 }).catch(() => {})
  }
  await page.waitForTimeout(300)
  await page.addScriptTag({ path: axePath })

  const run = async (tags) =>
    page.evaluate(
      ([t]) => window.axe.run(document, { runOnly: { type: 'tag', values: t }, resultTypes: ['violations'] }),
      [tags]
    )

  const wcag = await run(WCAG)
  for (const v of wcag.violations) {
    console.log(`  FAIL  ${where}`)
    console.log(`        ${v.id} (${v.impact}): ${v.help}`)
    for (const node of v.nodes.slice(0, 3)) {
      console.log(`        ${node.target.join(' ')}`)
      const detail = (node.failureSummary || '').split('\n').filter(Boolean).slice(1, 3)
      for (const d of detail) console.log(`          ${d.trim()}`)
    }
    if (v.nodes.length > 3) console.log(`        and ${v.nodes.length - 3} more`)
    failures++
  }

  const best = await run(['best-practice'])
  for (const v of best.violations) {
    const key = `${v.id}: ${v.help}`
    advisory.set(key, (advisory.get(key) ?? 0) + v.nodes.length)
  }
  await context.close()
}
// The part no scanner can check: that the skip link is the first thing a keyboard reaches, and that
// using it actually moves focus into the content. A skip link that is present but does not move
// focus passes every automated tool and helps nobody, which is the usual way this criterion fails.
for (const file of ['docs/index.html', 'docs/guide/index.html', 'docs/playground/index.html']) {
  const context = await browser.newContext()
  await context.route('**', (route) => {
    const url = route.request().url()
    if (url.endsWith('/vendor/qrcode.min.js')) {
      return route.fulfill({ path: join(docs, 'vendor/qrcode.min.js'), contentType: 'text/javascript' })
    }
    return url.startsWith('file://') ? route.continue() : route.abort()
  })
  const page = await context.newPage()
  await page.goto(`file://${join(root, file)}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(600)
  await page.keyboard.press('Tab')
  const first = await page.evaluate(() => ({
    cls: document.activeElement?.className ?? '',
    text: (document.activeElement?.textContent ?? '').trim().slice(0, 40),
    visible: document.activeElement ? getComputedStyle(document.activeElement).left : ''
  }))
  if (!String(first.cls).includes('skip')) {
    console.log(`  FAIL  ${file}`)
    console.log(`        the first thing a keyboard reaches is "${first.text}", not the skip link`)
    failures++
  } else {
    await page.keyboard.press('Enter')
    await page.waitForTimeout(300)
    const landed = await page.evaluate(() => document.activeElement?.id ?? '')
    if (landed !== 'content') {
      console.log(`  FAIL  ${file}`)
      console.log(`        the skip link moved focus to "${landed || 'nothing'}" instead of the main content`)
      failures++
    }
  }
  await context.close()
}

await browser.close()

if (advisory.size) {
  console.log('\nadvisory, outside the standard and not failing this run:')
  for (const [k, n] of [...advisory].sort((a, b) => b[1] - a[1])) console.log(`  ${k} (${n} nodes)`)
}

console.log(
  failures === 0
    ? `\n${runs.length} runs over ${pages.length} pages in ${codes.length} languages, both themes:` +
      ' no WCAG 2.2 AA violations that a machine can see'
    : `\n${failures} violation${failures === 1 ? '' : 's'}`
)
process.exitCode = failures === 0 ? 0 : 1
