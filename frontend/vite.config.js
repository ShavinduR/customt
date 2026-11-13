import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    host: true,
  },
  build: {
    sourcemap: false,
    // The lazily loaded 3D viewer (three.js) is ~940 kB raw / ~255 kB gzip and only downloads on demand.
    chunkSizeWarningLimit: 1000,
  },
});
