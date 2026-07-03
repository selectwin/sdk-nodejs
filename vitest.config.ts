import { readFileSync } from 'node:fs';
import { defineConfig, configDefaults } from 'vitest/config';

// Mirror tsup's build-time version inject so `SDK_VERSION` resolves to the real
// package version under the unit suite too (lets a test guard against drift).
const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string };

export default defineConfig({
  define: { __SDK_VERSION__: JSON.stringify(version) },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // The sandbox integration suite runs separately (npm run test:integration)
    // and makes real network calls — keep it out of the fast unit run.
    exclude: [...configDefaults.exclude, 'test/integration/**'],
  },
});
