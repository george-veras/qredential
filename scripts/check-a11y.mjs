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
// ---------------------------------------------------------------- the criteria axe does not test
//
// These are the AA criteria that need a browser driven deliberately rather than a rule engine:
// reflow, text resize, text spacing, a focus indicator that can actually be seen, focus that is not
// hidden behind the masthead, pointer targets, and every control having a name. Run on English,
// German and Japanese: German is the longest Latin text on the site and Japanese the densest, so a
// layout that survives all three survives the other six.
const layoutLocales = ['', 'de/', 'ja/']
const shapes = ['', 'guide/', 'playground/']

for (const loc of layoutLocales) {
  for (const shape of shapes) {
    const file = join(docs, loc, shape, 'index.html')
    const where = relative(root, file)
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    await context.route('**', (route) => {
      const url = route.request().url()
      if (url.endsWith('/vendor/qrcode.min.js')) {
        return route.fulfill({ path: join(docs, 'vendor/qrcode.min.js'), contentType: 'text/javascript' })
      }
      return url.startsWith('file://') ? route.continue() : route.abort()
    })
    const page = await context.newPage()
    await page.goto(`file://${file}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(700)

    // 1.4.10 Reflow. 320 CSS pixels is the width the criterion names, and the page must not ask for
    // sideways scrolling to read it. Tables and code may scroll inside their own box; the document
    // may not.
    await page.setViewportSize({ width: 320, height: 640 })
    await page.waitForTimeout(400)
    const spill = await page.evaluate(() => {
      const d = document.documentElement
      const over = [...document.querySelectorAll('body *')]
        .filter((e) => e.getBoundingClientRect().right > d.clientWidth + 2)
        .filter((e) => getComputedStyle(e).overflowX !== 'auto' && getComputedStyle(e).overflowX !== 'scroll')
        .filter((e) => !e.closest('[style*="overflow"], .tablewrap, .signature, .strip, pre'))
        .slice(0, 3)
        .map((e) => e.tagName.toLowerCase() + (e.className ? '.' + String(e.className).split(' ')[0] : ''))
      return { doc: d.scrollWidth - d.clientWidth, over }
    })
    if (spill.doc > 2) {
      console.log(`  FAIL  ${where}`)
      console.log(`        1.4.10 reflow: at 320px the page scrolls ${spill.doc}px sideways (${spill.over.join(', ') || 'unattributed'})`)
      failures++
    }

    // 1.4.4 Resize text, at the 200% the criterion asks for, and 1.4.12 Text Spacing, with the
    // exact overrides the criterion specifies. Both fail the same way: text that clips or vanishes.
    await page.setViewportSize({ width: 1280, height: 900 })
    for (const [id, name, css] of [
      ['zoom', '1.4.4 resize text to 200%', 'html{font-size:200%!important}'],
      [
        'spacing',
        '1.4.12 text spacing',
        '*{line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important}' +
          'p{margin-bottom:2em!important}',
      ],
    ]) {
      await page.addStyleTag({ content: css })
      await page.waitForTimeout(400)
      const clipped = await page.evaluate(() =>
        [...document.querySelectorAll('h1,h2,h3,p,li,td,th,button,a,.word,.chip')]
          .filter((e) => {
            const s = getComputedStyle(e)
            if (s.display === 'none' || s.visibility === 'hidden' || !e.textContent.trim()) return false
            // A visually hidden heading is a one pixel box on purpose. Clipping is the mechanism,
            // not a defect.
            if (e.classList.contains('visually-hidden')) return false
            // clipped means the box cuts its own text off with no way to see the rest
            return e.scrollHeight > e.clientHeight + 2 && s.overflow === 'hidden'
          })
          .slice(0, 3)
          .map((e) => e.tagName.toLowerCase() + (e.className ? '.' + String(e.className).split(' ')[0] : ''))
      )
      if (clipped.length) {
        console.log(`  FAIL  ${where}`)
        console.log(`        ${name}: text is cut off in ${clipped.join(', ')}`)
        failures++
      }
      await page.evaluate(() => document.querySelectorAll('style:last-of-type').forEach((s) => s.remove()))
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(500)
    }

    // 2.4.7 Focus Visible and 2.4.11 Focus Not Obscured. Tab through everything and check two
    // things per stop: that the focused control looks different from the way it looked at rest, and
    // that it is not sitting under a sticky header where nobody can see it.
    const stops = await page.evaluate(async () => {
      const bad = { invisible: [], obscured: [] }
      const focusables = [...document.querySelectorAll('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])')]
        .filter((e) => e.offsetParent !== null)
      for (const e of focusables.slice(0, 40)) {
        const before = getComputedStyle(e).outline + getComputedStyle(e).boxShadow + getComputedStyle(e).border
        e.focus()
        const after = getComputedStyle(e).outline + getComputedStyle(e).boxShadow + getComputedStyle(e).border
        const name = e.tagName.toLowerCase() + (e.className ? '.' + String(e.className).split(' ')[0] : '')
        if (before === after) bad.invisible.push(name)
        const r = e.getBoundingClientRect()
        if (r.width && r.height) {
          const top = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(4, r.height / 2))
          if (top && top !== e && !e.contains(top) && !top.contains(e)) bad.obscured.push(name)
        }
      }
      return bad
    })
    if (stops.invisible.length) {
      console.log(`  FAIL  ${where}`)
      console.log(`        2.4.7 focus visible: no change on focus for ${[...new Set(stops.invisible)].slice(0, 3).join(', ')}`)
      failures++
    }
    if (stops.obscured.length) {
      console.log(`  FAIL  ${where}`)
      console.log(`        2.4.11 focus not obscured: ${[...new Set(stops.obscured)].slice(0, 3).join(', ')} sits under something`)
      failures++
    }

    // 2.5.8 Target Size, 24 by 24 CSS pixels. Text links inside a sentence are excepted by the
    // criterion itself, so they are measured but not failed.
    const small = await page.evaluate(() => {
      const isInline = (e) => e.tagName === 'A' && getComputedStyle(e).display === 'inline' && e.closest('p, li, td')
      return [...document.querySelectorAll('a[href],button,input[type="checkbox"],input[type="radio"],[role="button"]')]
        .filter((e) => e.offsetParent !== null && !isInline(e))
        .map((e) => ({ n: e.tagName.toLowerCase() + (e.className ? '.' + String(e.className).split(' ')[0] : ''), r: e.getBoundingClientRect() }))
        .filter((x) => x.r.width && (x.r.width < 24 || x.r.height < 24))
        .slice(0, 4)
        .map((x) => `${x.n} ${Math.round(x.r.width)}x${Math.round(x.r.height)}`)
    })
    if (small.length) {
      console.log(`  FAIL  ${where}`)
      console.log(`        2.5.8 target size: ${small.join(', ')}`)
      failures++
    }

    // 3.3.2 Labels or Instructions, and 4.1.2 Name Role Value for the same controls.
    const unnamed = await page.evaluate(() =>
      [...document.querySelectorAll('input,textarea,select,button,a[href]')]
        .filter((e) => e.offsetParent !== null)
        .filter((e) => {
          const name =
            e.getAttribute('aria-label') ||
            (e.getAttribute('aria-labelledby') && document.getElementById(e.getAttribute('aria-labelledby'))?.textContent) ||
            (e.id && document.querySelector(`label[for="${e.id}"]`)?.textContent) ||
            e.closest('label')?.textContent ||
            e.textContent ||
            e.getAttribute('title') ||
            e.getAttribute('placeholder')
          return !String(name || '').trim()
        })
        .slice(0, 3)
        .map((e) => e.tagName.toLowerCase() + (e.className ? '.' + String(e.className).split(' ')[0] : ''))
    )
    if (unnamed.length) {
      console.log(`  FAIL  ${where}`)
      console.log(`        3.3.2 and 4.1.2: no accessible name on ${unnamed.join(', ')}`)
      failures++
    }

    await context.close()
  }
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
