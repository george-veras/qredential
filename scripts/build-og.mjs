// Renders docs/og/<locale>.png, the preview card that appears when the site is shared.
//
// Run with: npm run build:og
//
// One card per language, because the card is the only part of the site a reader sees before
// deciding whether to click. A link passed around a Korean forum that previews in English has
// already lost the argument, and the share surfaces that matter here (X, LinkedIn, KakaoTalk,
// LINE, WeChat, Slack, Discord) all read the same og:image.
//
// The text is not written here: it is the headline and the first sentence of the lede from
// content/landing/<locale>.json, so the card can never disagree with the page it links to, and a
// translation fix lands on both at once.
//
// Committed rather than generated on every build, because the cards change only when the copy does
// and a headless browser is a heavy thing to require of anyone running the site build.
import { chromium } from 'playwright'
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const locales = JSON.parse(await readFile(join(root, 'content/locales.json'), 'utf8'))
const codes = Object.keys(locales).filter((k) => k !== '_comment')
const card = await readFile(join(root, 'scripts/og-card.html'), 'utf8')

/** The first sentence of the lede. Every locale opens with the same short claim, and the card has
 *  room for one line, not five. Falls back to the whole lede if a translation has no break. */
const opener = (lede) => /^[\s\S]*?(?:[.。！？]|$)/.exec(lede.trim())?.[0] ?? lede

const out = join(root, 'docs/og')
await rm(out, { recursive: true, force: true })
await mkdir(out, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } })

for (const code of codes) {
  const t = JSON.parse(await readFile(join(root, `content/landing/${code}.json`), 'utf8'))
  const html = card
    .replace('__LANG__', locales[code].htmlLang ?? code)
    .replace('__TITLE__', t['hero.title'])
    .replace('__LEDE__', opener(t['hero.lede']))
    .replace('__PASS__', t['demo.pass'])
    .replace('__NETWORK__', `0 ${t['demo.networkRequests']}`)
    .replace(
      '__STRIP__',
      t['hero.eyebrow']
        .split('&middot;')
        .map((s, i, all) => (i === all.length - 1 ? `<span><b>${s.trim()}</b></span>` : `<span>${s.trim()}</span>`))
        .join('\n  ')
    )

  const tmp = join(root, 'scripts/.og-card.tmp.html')
  await writeFile(tmp, html)
  await page.goto(`file://${tmp}`, { waitUntil: 'networkidle', timeout: 40000 })
  await page.waitForTimeout(1200)
  await page.screenshot({ path: join(out, `${code}.png`), clip: { x: 0, y: 0, width: 1200, height: 630 } })
  await rm(tmp)
  console.log(`docs/og/${code}.png`)
}

await browser.close()
console.log(`\n${codes.length} cards, 1200x630`)
