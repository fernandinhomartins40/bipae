import { defineConfig } from 'vitest/config';

// O DANFE acompanha a mercadoria e é o que o fisco confere na estrada: cobertura alta.
export default defineConfig({
  test: {
    // Gerar PDF passa de 5 s nas máquinas do CI; o padrão derrubava o deploy.
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
    },
  },
});
