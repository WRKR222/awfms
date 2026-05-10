/**
 * AWFMS Service Worker — Offline-First PWA
 * 
 * Strategy:
 * - App shell (JS/CSS/HTML): Cache First — always serve from cache, update in background
 * - API GET requests: Network First — try network, fall back to cache
 * - API POST/PATCH (data entry): Queue offline, replay when online
 * 
 * This ensures attendants can always log entries even with no signal.
 */

const CACHE_NAME = 'awfms-v2';
const OFFLINE_QUEUE_KEY = 'awfms-offline-queue';

// Files to pre-cache (app shell)
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

  // Cache First for app shell assets
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
  try {
    const response = await fetch(request);
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
