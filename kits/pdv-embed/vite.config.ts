import { defineConfig } from 'vite';

/**
 * Builds a single self-contained file, dist/bipae-pdv.js (styles inside), loadable with a
 * plain <script> tag in any page: React, Vue, Angular, Laravel/Blade, Django, PHP, WordPress...
 */
export default defineConfig({
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    lib: {
      entry: 'src/element.tsx',
      name: 'BipaePdv',
      formats: ['iife'],
      fileName: () => 'bipae-pdv.js',
    },
  },
});
