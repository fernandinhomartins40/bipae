import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // Each file boots its own database; keep files sequential when using real PostgreSQL.
    fileParallelism: !process.env.TEST_DATABASE_URL,
  },
});
