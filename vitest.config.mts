import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Landing-page tests run separately (npm run test:site) so they never block an app build or release.
    exclude: ['tests/site/**'],
  },
})
