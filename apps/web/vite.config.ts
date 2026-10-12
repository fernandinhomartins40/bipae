import { readFileSync } from 'node:fs';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
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
        start_url: '/',
        display: 'standalone',
        background_color: '#f6f7f4',
        theme_color: '#007a4d',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
      },
    }),
  ],
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: { sourcemap: true },
});
