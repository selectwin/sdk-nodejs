import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // The sandbox integration suite runs separately (npm run test:integration)
    // and makes real network calls — keep it out of the fast unit run.
    exclude: [...configDefaults.exclude, 'test/integration/**'],
  },
});
