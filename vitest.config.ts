import { defineConfig } from 'vitest/config'

// Automatic tests (tests/), run by `npm test` and inside `npm run build`.
// Its own config, so the app's Vite plugins (service worker...) stay out of the tests.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
