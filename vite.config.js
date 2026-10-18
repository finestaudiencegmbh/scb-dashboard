import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Frontend liegt in /web, Build-Ausgabe nach /dist (vom Express-Server bedient).
export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
