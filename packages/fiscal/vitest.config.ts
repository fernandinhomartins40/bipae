import { defineConfig } from 'vitest/config';

// O motor fiscal exige cobertura alta (ADR-0006): um erro aqui vira nota rejeitada ou imposto errado.
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
      thresholds: { lines: 90, functions: 90, branches: 90, statements: 90 },
    },
  },
});
