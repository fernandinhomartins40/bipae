import { readFileSync } from 'node:fs';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Production serves the app under www.bipae.com.br/app/ (the landing page owns the root).
const base = process.env.BIPAE_BASE ?? '/';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  base,
  define: { __APP_VERSION__: JSON.stringify(version) },
  // SQLite WASM ships its own .wasm and must not be pre-bundled; the worker is an ES module.
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  worker: { format: 'es' },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // The app decides when to apply an update (never during a sale) — see platform.ts.
      registerType: 'prompt',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Bipaê',
        short_name: 'Bipaê',
        description: 'PDV e gestão para o seu comércio. Bipou? Bipaê!',
        lang: 'pt-BR',
        start_url: base,
        scope: base,
        display: 'standalone',
        background_color: '#f6f7f4',
        theme_color: '#007a4d',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
      workbox: {
        navigateFallback: `${base}index.html`,
        // Never let the app's service worker answer for the landing page or the API.
        navigateFallbackAllowlist: [new RegExp(`^${base}`)],
        navigateFallbackDenylist: [new RegExp('^/v1/')],
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
      },
    }),
  ],
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: { sourcemap: true },
});
