import { defineConfig } from 'vitest/config'

/**
 * The suite, run in a real browser.
 *
 * The README claims browsers and React Native, and until this existed that claim had three versions
 * of Node behind it and nothing else. Everything here is the same test files: the library has no
 * Node specific code, so there is nothing to fork.
 *
 * Pick the engine with BROWSER=chromium|firefox|webkit. CI runs all three.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    browser: {
      enabled: true,
      provider: 'playwright',
      name: process.env['BROWSER'] ?? 'chromium',
      headless: true,
      screenshotFailures: false,
    },
  },
})
