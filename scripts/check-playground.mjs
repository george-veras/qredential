// Clicks every attack button in the playground and checks the verifier answers with the code the
// button promises.
//
// The playground makes ten claims on screen, one per button, and those claims are the whole reason
// it is worth showing anyone. A README that lies is embarrassing; a live demo that lies is worse,
// because the visitor came specifically to check. So the demo is tested like anything else.
//
// Run with: npm run check:playground
import { chromium } from 'playwright'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const pages = process.argv.slice(2)
const locales = JSON.parse(await readFile(join(root, 'content/locales.json'), 'utf8'))
const targets =
  pages.length > 0
    ? pages
    : Object.keys(locales)
        .filter((c) => c !== '_comment')
        .map((c) => (locales[c].source ? 'docs/playground/index.html' : `docs/${c}/playground/index.html`))
        .filter((f) => existsSync(join(root, f)))

const browser = await chromium.launch()
let failures = 0

for (const target of targets) {
  const page = await browser.newPage()
  const jsErrors = []
  page.on('pageerror', (e) => jsErrors.push(e.message))

  await page.goto(`file://${join(root, target)}`, { waitUntil: 'networkidle', timeout: 40000 })
  await page.waitForFunction(() => !document.getElementById('app')?.hidden, { timeout: 30000 })

  // The verdict word is translated, so assert on the state rather than the text. The rejection
  // codes below are machine identifiers and stay English in every language, which is the point of
  // having them.
  const passed = await page.evaluate(() => document.getElementById('stamp')?.classList.contains('pass'))
  if (!passed) {
    const said = await page.evaluate(() => document.getElementById('stamp-code')?.textContent.trim())
    console.error(`${target}: the honest presentation did not verify, it said "${said}"`)
    failures++
  }

  const buttons = await page.$$('button.attack')
  if (buttons.length === 0) {
    console.error(`${target}: no attack buttons found`)
    failures++
  }

  for (const button of buttons) {
    const expected = await button.$eval('.expect', (e) => e.textContent.replace(/^\S+\s/, '').trim())
    const label = await button.$eval('.label', (e) => e.textContent.trim())
    await button.click()
    await page.waitForTimeout(400)
    const got = await page.$eval('#stamp-code', (e) => e.textContent.trim())

    if (got !== expected) {
      console.error(`${target}: "${label}" promises ${expected} but the verifier said ${got}`)
      failures++
    }
  }

  if (jsErrors.length > 0) {
    console.error(`${target}: ${jsErrors.length} JavaScript error(s): ${jsErrors.join(' | ')}`)
    failures++
  }

  console.log(`${target}: ${buttons.length} attacks checked${failures ? '' : ', all as promised'}`)
  await page.close()
}

await browser.close()
if (failures > 0) process.exit(1)
