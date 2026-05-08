/**
 * PW-01 — PWA Offline Sync Hook
 *
 * Provides a wrapper around API mutations that:
 * 1. When online  → calls the API immediately (normal flow)
 * 2. When offline → stores the request in IndexedDB-backed Zustand store,
 *    registers a Background Sync tag, and resolves with a local stub
 * 3. On reconnect → replays all pending entries in submission order,
 *    retrying up to 3 times before marking as failed
 *
 * Usage:
 *   const { mutate, isOfflineQueued } = useOfflineMutation({
 *     endpoint: '/flock/entries',
 *     method: 'POST',
 *     type: 'flock',
 *   });
 */

import { useEffect, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useOfflineStore, type OfflineEntry } from '../stores/offline.store';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

// ── Endpoint → query-key mapping for cache invalidation after sync ────────────
const ENDPOINT_QUERY_KEYS: Record<string, string[][]> = {
  '/flock/entries':           [['flock'], ['flock', 'entries', 'pending']],
  '/production/sessions':     [['production']],
  '/feed/daily':              [['feed']],
  '/feed/intake':             [['feed']],
};

interface UseOfflineMutationOptions {
  endpoint: string;
  method?: 'POST' | 'PATCH' | 'PUT';
  type: OfflineEntry['type'];
  /** Called after a successful online submission or a successful sync replay */
  onSuccess?: (data: unknown) => void;
  /** Called when the entry is queued offline (replaces onSuccess in offline mode) */
  onQueued?: (localId: string) => void;
}

interface MutateOptions {
  pathSuffix?: string; // e.g. '/:id/approve'
  idParam?: string;
}

export function useOfflineMutation(options: UseOfflineMutationOptions) {
  const { endpoint, method = 'POST', type, onSuccess, onQueued } = options;
  const qc = useQueryClient();
  const { isOnline, addPendingEntry } = useOfflineStore();

  // ── Single mutation call ────────────────────────────────────────────────────
  const mutate = useCallback(
    async (payload: Record<string, unknown>, opts: MutateOptions = {}) => {
      const fullEndpoint = opts.pathSuffix
        ? `${endpoint}/${opts.idParam}${opts.pathSuffix}`
        : endpoint;

      if (isOnline) {
        // Online path — call API directly
        const fn = method === 'POST'
          ? api.post(fullEndpoint, payload)
          : api.patch(fullEndpoint, payload);

        const result = await fn.then(r => r.data);
        invalidateKeys(qc, endpoint);
        onSuccess?.(result);
        return { data: result, queued: false };
      }

      // Offline path — queue for later
      const localId = crypto.randomUUID();
      addPendingEntry({
        id: localId,
        type,
        payload: { ...payload, _endpoint: fullEndpoint, _method: method },
        submittedAt: new Date().toISOString(),
      });

      // Register background sync if supported
      if ('serviceWorker' in navigator && 'SyncManager' in window) {
        try {
          const reg = await navigator.serviceWorker.ready;
          await (reg as any).sync.register('awfms-sync');
        } catch {
          // Silently ignore — manual sync on reconnect will catch it
        }
      }

      onQueued?.(localId);
      return { data: null, queued: true, localId };
    },
    [isOnline, endpoint, method, type, addPendingEntry, onSuccess, onQueued, qc],
  );

  return { mutate, isOnline };
}

// ── Global sync runner — call this once from App.tsx on reconnect ─────────────
export function useOfflineSyncRunner() {
  const qc = useQueryClient();
  const { isOnline, pendingEntries, updateEntryStatus, removeSyncedEntries } =
    useOfflineStore();
  const isSyncing = useRef(false);

  const runSync = useCallback(async () => {
    if (isSyncing.current) return;
    const pending = pendingEntries.filter(e => e.status === 'pending');
    if (pending.length === 0) return;

    isSyncing.current = true;
    const endpoints = new Set<string>();

    for (const entry of pending) {
      updateEntryStatus(entry.id, 'syncing');
      const { _endpoint, _method, ...payload } = entry.payload as any;
      let success = false;

      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          if (_method === 'PATCH') {
            await api.patch(_endpoint, payload);
          } else {
            await api.post(_endpoint, payload);
          }
          updateEntryStatus(entry.id, 'synced');
          endpoints.add(_endpoint as string);
          success = true;
          break;
        } catch (err: any) {
          if (attempt < MAX_RETRIES - 1) {
            await sleep(RETRY_DELAY_MS * (attempt + 1));
          }
        }
      }

      if (!success) {
        updateEntryStatus(entry.id, 'failed', 'Max retries exceeded');
      }
    }

    // Invalidate all affected query keys
    for (const ep of endpoints) {
      invalidateKeys(qc, ep);
    }

    removeSyncedEntries();
    isSyncing.current = false;
  }, [pendingEntries, updateEntryStatus, removeSyncedEntries, qc]);

  // Auto-run sync when coming back online
  useEffect(() => {
    if (isOnline) {
      runSync();
    }
  }, [isOnline, runSync]);

  // Listen for SYNC_REQUESTED message from service worker
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'SYNC_REQUESTED' && isOnline) {
        runSync();
      }
    };
    navigator.serviceWorker?.addEventListener('message', handler);
    return () => navigator.serviceWorker?.removeEventListener('message', handler);
  }, [isOnline, runSync]);

  // Listen for manual sync requests from OfflineBanner (avoids duplicate runner instances)
  useEffect(() => {
    const handler = () => { if (isOnline) runSync(); };
    window.addEventListener('awfms:request-sync', handler);
    return () => window.removeEventListener('awfms:request-sync', handler);
  }, [isOnline, runSync]);

  const syncCount = pendingEntries.filter(e => e.status === 'pending').length;
  const failedCount = pendingEntries.filter(e => e.status === 'failed').length;

  return { runSync, syncCount, failedCount };
}

// ── Offline status banner component data ────────────────────────────────────
export function useOfflineStatus() {
  const { isOnline, pendingEntries } = useOfflineStore();
  const pendingCount = pendingEntries.filter(e => e.status === 'pending').length;
  const syncingCount = pendingEntries.filter(e => e.status === 'syncing').length;
  const failedCount  = pendingEntries.filter(e => e.status === 'failed').length;

  return {
    isOnline,
    pendingCount,
    syncingCount,
    failedCount,
    showBanner: !isOnline || pendingCount > 0 || syncingCount > 0 || failedCount > 0,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function invalidateKeys(qc: ReturnType<typeof useQueryClient>, endpoint: string) {
  const keys = ENDPOINT_QUERY_KEYS[endpoint] ?? [];
  keys.forEach(key => qc.invalidateQueries({ queryKey: key }));
}
