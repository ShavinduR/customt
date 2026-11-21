import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    // Installable app (PWA): Android, iPhone, Windows, macOS, ChromeOS. See docs/MOBILE_DESKTOP_APPS.md.
    VitePWA({
      // The Android app (Capacitor, `--mode android`) already ships every file inside the APK, so it gets no
      // service worker: updates come with a new APK and nothing can serve a stale bundle.
      disable: mode === 'android',
      registerType: 'prompt', // never reload under the user's feet: they choose when to update
      injectRegister: false, // registered from React (components/pwa/PwaPrompts.jsx)
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: 'CustomT: custom apparel marketplace',
        short_name: 'CustomT',
        description: 'Design custom apparel, get competing quotes from verified printers and pay safely through escrow.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#ffffff',
        theme_color: '#4f46e5',
        categories: ['shopping', 'business', 'productivity'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Design & launch', short_name: 'Design', url: '/create-rfq', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
          { name: 'Discover', url: '/feed', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
          { name: 'My orders', short_name: 'Orders', url: '/buyer/orders', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
        ],
      },
      workbox: {
        // App shell (HTML, JS, CSS, icons) is precached so the app opens instantly and offline.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Heavy chunks that load only on demand (3D viewer, PDF receipts) are not part of the install
        // download; they are cached the first time they are used (see runtimeCaching below).
        globIgnores: ['**/mockups/**', '**/Shirt3DViewer-*.js', '**/jspdf*.js', '**/html2canvas*.js', '**/purify*.js', '**/index.es-*.js'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        // The API, uploads and live updates live on another origin and are never cached by the worker.
        runtimeCaching: [
          {
            // Hashed build files are immutable: once downloaded they never change, so cache them for good.
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/assets/'),
            handler: 'CacheFirst',
            options: { cacheName: 'customt-lazy-chunks', expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 60 } },
          },
          {
            // 3D garment models: downloaded the first time the 3D view opens, then served from the device.
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/models/'),
            handler: 'CacheFirst',
            options: { cacheName: 'customt-garment-models', expiration: { maxEntries: 12, maxAgeSeconds: 60 * 60 * 24 * 30 } },
          },
          {
            // Garment photos for the photo preview: downloaded when first shown, then kept on the device.
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/mockups/'),
            handler: 'CacheFirst',
            options: { cacheName: 'customt-garment-photos', expiration: { maxEntries: 12, maxAgeSeconds: 60 * 60 * 24 * 30 } },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    host: true,
  },
  build: {
    sourcemap: false,
    // The lazily loaded 3D viewer (three.js) is ~940 kB raw / ~255 kB gzip and only downloads on demand.
    chunkSizeWarningLimit: 1000,
  },
}));
