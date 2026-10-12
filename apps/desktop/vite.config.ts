import { readFileSync } from 'node:fs';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// Thin desktop shell (ADR-0012): same UI packages as apps/web, bundled into the Tauri app.
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  // SQLite WASM ships its own .wasm and must not be pre-bundled; the worker is an ES module.
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  worker: { format: 'es' },
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
