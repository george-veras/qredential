import { defineConfig } from 'vitest/config'

/**
 * Only coverage lives here. Everything else is vitest's default on purpose, so that running the
 * suite by hand and running it in CI are the same thing.
 *
 * The thresholds sit a little under where the suite actually is. They are a ratchet against
 * regression, not a target: a pull request that adds an untested branch should be told so, and a
 * pull request that is two points better than the floor should not be asked to celebrate. Raise
 * them when the real number moves up and stays there.
 *
 * Functions is at 100 and stays at 100. A function nothing calls is either dead code or a gap, and
 * both are worth stopping for.
 */
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      reporter: ['text', 'json-summary'],
      thresholds: {
        statements: 92,
        branches: 85,
        functions: 100,
        lines: 93,
      },
    },
  },
})
