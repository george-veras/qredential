// Renders docs/og.png, the preview card that appears when the site is shared.
//
// Run with: npm run build:og
//
// It is committed rather than generated on every build, because it changes only when the card does
// and a headless browser is a heavy thing to require of anyone running the site build.
import { chromium } from 'playwright'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } })
await page.goto(`file://${join(root, 'scripts/og-card.html')}`, { waitUntil: 'networkidle', timeout: 40000 })
await page.waitForTimeout(2000)
await page.screenshot({
  path: join(root, 'docs/og.png'),
  clip: { x: 0, y: 0, width: 1200, height: 630 },
})
await browser.close()
console.log('docs/og.png written, 1200x630')
