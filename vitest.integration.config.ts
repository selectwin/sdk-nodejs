import { defineConfig } from 'vitest/config';

// Sandbox integration suite — separate from the unit suite. Runs real network
// calls and is self-gated (every describe skips unless a sandbox key is set).
// Run: npm run test:integration
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/integration/**/*.integration.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
