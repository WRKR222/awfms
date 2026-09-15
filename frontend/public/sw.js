/**
 * AWFMS Service Worker — Offline-First PWA
 * 
 * Strategy:
 * - Navigation (index.html / '/'): Network First — always try to get the
 *   latest deploy; fall back to cache only when offline. index.html is NOT
 *   content-hashed, so caching it Cache First meant the browser could keep
 *   serving an old shell (pointing at old, since-deleted JS bundle files)
 *   indefinitely, regardless of how many times a new version was deployed.
 * - Hashed build assets (JS/CSS, filenames include a content hash): Cache
 *   First — safe, because a new deploy always produces a new filename, so
 *   there's nothing to go stale.
 * - API GET requests: Network First — try network, fall back to cache
 * - API POST/PATCH (data entry): Queue offline, replay when online
 * 
 * This ensures attendants can always log entries even with no signal, while
 * still guaranteeing everyone is running the latest deployed app shell as
 * soon as they have connectivity.
 */

const CACHE_NAME = 'awfms-v5'; // bumped: NETWORK_TIMEOUT_MS raised 8s -> 20s (see below)
const OFFLINE_QUEUE_KEY = 'awfms-offline-queue';
// A stalled request on a weak/intermittent connection can otherwise hang far
// longer than this before the browser itself gives up, leaving the UI stuck
// showing nothing while it waits. Bounding it means a slow network falls
// back to the cache (or the offline JSON response) quickly instead.
//
// FIX: this used to be 8000ms, which is far too aggressive for a genuinely
// slow-but-working connection (e.g. a high-latency rural WiFi/satellite
// backhaul) — confirmed by a report that the SAME device, at the SAME
// location, works fine on mobile data but fails on that site's WiFi. A
// request that would have succeeded in 10-15s was being cut off at 8s and
// reported as a failure, indistinguishable from a genuinely dead
// connection. Raised to 20s — still well under the axios client's own 30s
// timeout (lib/api/client.ts), so this SW timeout stays the first thing to
// fire on a truly dead connection, but no longer fires on a merely slow one.
const NETWORK_TIMEOUT_MS = 20000;

// Files to pre-cache (offline fallback only — NOT served preferentially, see fetch handler below)
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
];

// ─── Install — pre-cache app shell ──────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// ─── Activate — clean old caches ────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// ─── Fetch — routing strategy ────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET API calls (handled by offline queue in the app)
  if (url.pathname.startsWith('/api/') && request.method !== 'GET') {
    return; // Let app handle offline queuing
  }

  // Network First for API GET calls
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Navigations (the HTML shell) and index.html/'/' itself are never
  // content-hashed — always prefer the network so a new deploy is picked up
  // on the very next load, falling back to the cached shell only offline.
  if (request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') {
    event.respondWith(networkFirst(request));
    return;
  }

  // Cache First for hashed build assets (JS/CSS/images) — safe because a new
  // deploy always produces a new, different filename.
  event.respondWith(cacheFirst(request));
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Return offline page for navigation requests
    if (request.mode === 'navigate') {
      const cached = await caches.match('/index.html');
      if (cached) return cached;
    }
    return new Response('Offline', { status: 503 });
  }
}

async function networkFirst(request) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
  try {
    const response = await fetch(request, { signal: controller.signal });
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: 'Offline', cached: false }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── Background Sync — replay offline queue when connection restores ─────────
self.addEventListener('sync', (event) => {
  if (event.tag === 'awfms-sync') {
    event.waitUntil(replayOfflineQueue());
  }
});

async function replayOfflineQueue() {
  // The actual replay logic lives in the React app's offline.store.ts
  // This just notifies all open clients to trigger a sync
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach(client => {
    client.postMessage({ type: 'SYNC_REQUESTED' });
  });
}

// ─── Push notifications (future) ─────────────────────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return;
  const data = event.data.json();
  self.registration.showNotification(data.title, {
    body: data.message,
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    tag: data.type,
  });
});
