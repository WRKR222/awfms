import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// NOTE: This project uses a hand-written service worker (public/sw.js,
// manually registered in src/main.tsx) and a hand-written manifest
// (public/manifest.json, linked in index.html). Those are the ONLY
// PWA assets that should exist.
//
// vite-plugin-pwa used to be configured here too, with its own
// auto-generated manifest (pointing at pwa-192x192.png / pwa-512x512.png,
// neither of which exist in /public) and its own auto-generated service
// worker (written to the same dist/sw.js the custom one is copied to).
// Having both meant:
//   - Two <link rel="manifest"> tags could end up in the built index.html,
//     one of them pointing at icon files that don't exist -> the "download
//     error / not a valid image" console errors seen on the deployed site.
//   - Two service worker registrations racing to register '/sw.js', and
//     two different build steps racing to write dist/sw.js -> whichever
//     ran last silently won, so the deployed SW's behavior (and cached
//     assets) could vary between deploys.
// Removed entirely rather than reconfigured, since the custom SW already
// implements everything the plugin was configured to do (network-first
// API caching, offline queueing) and does it more precisely for this app.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
});
