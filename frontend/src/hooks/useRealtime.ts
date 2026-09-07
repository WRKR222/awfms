/**
 * PW-02 — Hybrid Realtime Hook
 *
 * Strategy:
 * - Desktop / tablet (width > 768px): persistent Socket.IO WebSocket connection.
 *   Live events push immediate updates — no polling needed.
 * - Mobile (width ≤ 768px): lightweight 60s interval polling.
 *   Avoids persistent connections that drain mobile battery.
 *
 * Both paths share the same callback API so components are transport-agnostic.
 *
 * Usage:
 *   useRealtimeDashboard({
 *     onNotification: (n) => addToStore(n),
 *     onDashboardRefresh: () => qc.invalidateQueries(...),
 *     onTallyUpdate: (data) => ...,
 *   });
 */

import { useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '../stores/auth.store';
import { useNotificationsStore } from '../stores/notifications.store';

const BASE_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:3000') as string;
const MOBILE_BREAKPOINT = 768;
const POLL_INTERVAL_MS  = 60_000;

interface RealtimeCallbacks {
  onDashboardRefresh?: () => void;
  onTallyUpdate?: (data: { tallyId: string; status: string }) => void;
  onProductionNew?: (data: { sessionId: string }) => void;
  onVerificationPending?: (data: { entryId: string; entryType: string }) => void;
  // Fires for every 'notification:new' this user receives, in addition to
  // the built-in fetchNotifications() call below. Lets a screen react to a
  // specific notification (e.g. an attendant refetching their session state
  // the instant a PM approves/returns it) without waiting for its own
  // polling interval — see useAttendantRealtime.
  onNotification?: (n: { id: string; type: string; title: string; message: string }) => void;
}

function isMobile() {
  return window.innerWidth <= MOBILE_BREAKPOINT;
}

// ── Singleton socket — shared across hook instances ──────────────────────────
let globalSocket: Socket | null = null;
let socketRefCount = 0;

function getSocket(token: string): Socket {
  if (!globalSocket || globalSocket.disconnected) {
    globalSocket = io(`${BASE_URL}/ws`, {
      auth: { token },
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 2000,
      reconnectionAttempts: 10,
    });
  }
  return globalSocket;
}

function releaseSocket() {
  socketRefCount = Math.max(0, socketRefCount - 1);
  if (socketRefCount === 0 && globalSocket) {
    globalSocket.disconnect();
    globalSocket = null;
  }
}

// ── Main hook ─────────────────────────────────────────────────────────────────
export function useRealtimeDashboard(callbacks: RealtimeCallbacks = {}) {
  const { accessToken, isAuthenticated } = useAuthStore();
  const { fetchNotifications } = useNotificationsStore();
  const qc = useQueryClient();
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  const handleDashboardRefresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['owner-dashboard'] });
    qc.invalidateQueries({ queryKey: ['analytics'] });
    callbacksRef.current.onDashboardRefresh?.();
  }, [qc]);

  const handleNewNotification = useCallback(
    (n: { id: string; type: string; title: string; message: string }) => {
      // Refresh notification store so badge count and list update instantly
      fetchNotifications();
      callbacksRef.current.onNotification?.(n);
    },
    [fetchNotifications],
  );

  useEffect(() => {
    if (!isAuthenticated || !accessToken) return;

    // ── Mobile path: polling ─────────────────────────────────────────────────
    if (isMobile()) {
      fetchNotifications(); // immediate on mount
      const pollTimer = setInterval(() => {
        fetchNotifications();
        qc.invalidateQueries({ queryKey: ['owner-dashboard'] });
      }, POLL_INTERVAL_MS);

      return () => clearInterval(pollTimer);
    }

    // ── Desktop path: WebSocket ──────────────────────────────────────────────
    const socket = getSocket(accessToken);
    socketRefCount++;

    socket.on('notification:new',       handleNewNotification);
    socket.on('dashboard:refresh',      handleDashboardRefresh);
    socket.on('tally:updated',          (d) => callbacksRef.current.onTallyUpdate?.(d));
    socket.on('production:new',         (d) => callbacksRef.current.onProductionNew?.(d));
    socket.on('verification:pending',   (d) => callbacksRef.current.onVerificationPending?.(d));
    socket.on('connect',                () => console.log('[WS] Connected'));
    socket.on('disconnect',             (reason) => console.log('[WS] Disconnected:', reason));

    return () => {
      socket.off('notification:new',     handleNewNotification);
      socket.off('dashboard:refresh',    handleDashboardRefresh);
      socket.off('tally:updated');
      socket.off('production:new');
      socket.off('verification:pending');
      releaseSocket();
    };
  }, [isAuthenticated, accessToken, handleNewNotification, handleDashboardRefresh, qc, fetchNotifications]);
}

// ── Specialised hook for Manager dashboard ───────────────────────────────────
export function useManagerRealtime() {
  const qc = useQueryClient();
  useRealtimeDashboard({
    onDashboardRefresh:    () => {
      qc.invalidateQueries({ queryKey: ['owner-dashboard'] });
      qc.invalidateQueries({ queryKey: ['cage-map'] });
    },
    onTallyUpdate:         () => qc.invalidateQueries({ queryKey: ['tally'] }),
    onVerificationPending: () => qc.invalidateQueries({ queryKey: ['flock', 'entries', 'pending'] }),
    onProductionNew:       () => {
      qc.invalidateQueries({ queryKey: ['production'] });
      qc.invalidateQueries({ queryKey: ['cage-map'] });
    },
  });
}

// ── Specialised hook for the Lead Attendant's egg-collection screens ─────────
// Fixes: a PM approving/returning an AM or PM session used to only reach the
// attendant's browser via polling — up to 2 minutes on AttendantHome's stale
// cache, or 30s on EggCollectionPage's — which could show a freshly-approved
// PM session as still locked ("account restricted"-looking) until a hard
// refresh. The approve/return notifications now flow through
// NotificationsService (see ProductionService.verifySession), so this
// invalidates the shared today's-sessions query the instant that
// notification arrives over the socket, on top of the existing polling.
export function useAttendantRealtime() {
  const qc = useQueryClient();
  useRealtimeDashboard({
    onNotification: () => {
      qc.invalidateQueries({ queryKey: ['egg-sessions-today'] });
      qc.invalidateQueries({ queryKey: ['attendant', 'pending-tallies'] });
    },
  });
}

// ── Specialised hook for Owner/Director dashboard ────────────────────────────
export function useOwnerRealtime() {
  const qc = useQueryClient();
  useRealtimeDashboard({
    onDashboardRefresh: () => {
      qc.invalidateQueries({ queryKey: ['owner-dashboard'] });
      qc.invalidateQueries({ queryKey: ['analytics'] });
      qc.invalidateQueries({ queryKey: ['ai-summary'] });
      qc.invalidateQueries({ queryKey: ['cage-map'] });
    },
    onTallyUpdate: () => qc.invalidateQueries({ queryKey: ['tally'] }),
  });
}
