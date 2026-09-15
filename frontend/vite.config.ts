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
  // Vite's default build target ('modules') assumes a baseline around
  // Chrome 87/early 2021 and leaves newer syntax (optional chaining `?.`,
  // nullish coalescing `??` — both used throughout this codebase) untranspiled
  // in the output. A browser older than that baseline doesn't fail some
  // request or show an error — it hits a JS parse error before the app's
  // code runs at all, i.e. a plain blank page with nothing in it, which is
  // indistinguishable from a data/network problem to whoever's looking at
  // the screen. Field devices — an older Android whose OS caps how far
  // Chrome auto-updates — are exactly where this bites. Targeting es2017
  // makes esbuild downlevel that syntax into compatible code while still
  // shipping as an ES module (Chrome 61+, mid-2017 — module support is the
  // real compatibility floor here, not this target), without the bundle
  // size/complexity of full legacy nomodule + polyfill bundling, which)
  // would only make things worse for devices already on a weak connection.
  build: {
    target: 'es2017',
  },
  server: {
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
});
