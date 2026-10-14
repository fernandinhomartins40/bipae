import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // indexeddb.ts só existe no navegador: é coberto pelo E2E (web e desktop-ui).
      exclude: ['src/**/*.test.ts', 'src/index.ts', 'src/indexeddb.ts'],
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
    },
  },
});
