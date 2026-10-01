import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backend = process.env.BACKEND_URL ?? 'http://localhost:3000';

// Im Dev-Modus werden API, Proxy- und Archiv-Inhalte an das Backend weitergereicht,
// damit alles same-origin zum Vite-Server bleibt (iframes, Content-Tokens in Pfaden).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': backend,
      '/proxy': backend,
      '/archive': backend,
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
