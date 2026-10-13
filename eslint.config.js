import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Shared code must never reach into a shell or a platform API (ADR-0012). */
const shellImports = {
  patterns: [
    {
      group: ['@tauri-apps/*'],
      message: 'Use os ports de @bipae/platform; Tauri só em apps/desktop.',
    },
    {
      group: ['**/apps/*', '@bipae/web', '@bipae/desktop', '@bipae/api'],
      message: 'Pacotes não importam cascas.',
    },
  ],
};

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/.turbo/**',
      '**/playwright-report/**',
      '**/test-results/**',
      'apps/desktop/src-tauri/**',
      '.data/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-non-null-assertion': 'off',
      eqeqeq: ['error', 'smart'],
    },
  },
  {
    files: ['**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ['packages/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': ['error', shellImports] },
  },
  {
    // Pure packages: no UI framework, no I/O.
    files: ['packages/domain/**/*.ts', 'packages/platform/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          ...shellImports,
          paths: [
            { name: 'react', message: 'domain e platform são puros (sem React).' },
            { name: 'node:fs', message: 'domain e platform não fazem I/O.' },
          ],
        },
      ],
    },
  },
  {
    // Motor fiscal: puro, sem I/O (ADR-0006). Só os testes leem arquivo, para conferir as fontes.
    files: ['packages/fiscal/src/**/*.ts'],
    ignores: ['packages/fiscal/src/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...shellImports.patterns,
            { group: ['node:*'], message: 'O motor fiscal é puro: sem arquivo, rede ou processo.' },
          ],
          paths: [{ name: 'react', message: 'O motor fiscal é puro (sem React).' }],
        },
      ],
    },
  },
);
