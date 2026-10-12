import { defineConfig } from 'vite';

// Landing page at www.bipae.com.br (static, no framework). The app lives under /app/.
export default defineConfig({
  base: '/',
  build: { assetsInlineLimit: 0 },
  server: { port: 5180 },
});
