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
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
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
        // Símbolo oficial da marca (logo_bipae_vetor.ai); o maskable tem a margem da área segura.
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: `${base}index.html`,
        // Never let the app's service worker answer for the landing page or the API.
        navigateFallbackAllowlist: [new RegExp(`^${base}`)],
        navigateFallbackDenylist: [new RegExp('^/v1/')],
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        // Fotos dos produtos (F2-14): o endereço leva o hash da foto, então a cópia guardada
        // nunca fica velha. O caixa mostra a foto mesmo sem rede depois da primeira vez.
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.pathname.includes('/v1/products/') &&
              url.pathname.endsWith('/image') &&
              url.searchParams.has('v'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'bipae-product-images',
              expiration: { maxEntries: 3000, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: { sourcemap: true },
});
