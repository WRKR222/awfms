/**
 * AWFMS API Client
 * All API calls go through this module.
 * Handles: auth headers, token refresh, offline queuing.
 */

import axios, { AxiosInstance } from 'axios';
import { useAuthStore } from '../stores/auth.store';

// FIX: was '/api/v1' (relative, hits Vercel) → now reads VITE_API_URL env var
const BASE_URL = `${(import.meta.env.VITE_API_URL ?? 'http://localhost:3000').replace(/\/api\/v1\/?$/, '')}/api/v1`;

export const api: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

// Attach JWT token to every request
api.interceptors.request.use(config => {
  const token = useAuthStore.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Handle 401 → attempt token refresh → retry once
let refreshing = false;
let refreshSubscribers: ((token: string) => void)[] = [];

function subscribeTokenRefresh(cb: (token: string) => void) {
  refreshSubscribers.push(cb);
}

function onRefreshed(token: string) {
  refreshSubscribers.forEach(cb => cb(token));
  refreshSubscribers = [];
}

// zustand-persist rehydrates `refreshToken` from localStorage ASYNCHRONOUSLY.
// On a fresh page load, background polls can 401 and reach this interceptor
// before that rehydration has landed — at which point `refreshToken` reads
// as null even though the real one is still sitting in localStorage. This
// race is more likely to actually bite on a slower device/connection (more
// time for a request to round-trip and land before hydration finishes), so
// without this guard it disproportionately hit exactly the kind of
// lower-end devices/weaker connections that showed this as "everything
// blank" — treating that as "not logged in" and calling logout() wipes a
// perfectly valid session. See lib/api/client.ts, which already had this
// fix; this second client module didn't.
let hydrated = useAuthStore.persist.hasHydrated();
const hydrationPromise: Promise<void> = hydrated
  ? Promise.resolve()
  : new Promise<void>((resolve) => {
      const unsub = useAuthStore.persist.onFinishHydration(() => {
        hydrated = true;
        resolve();
        unsub();
      });
    });

// Network-error retry (with backoff) for GET requests — see lib/api/client.ts
// for the full rationale. A weak/intermittent connection can throw a plain
// network error on a request that would have succeeded moments later;
// without a retry here, that blip permanently looks like "no data" to any
// caller that does `.catch(() => [])` (common in this codebase), since
// React Query's own retry never engages for a queryFn that "succeeds" with
// an empty value.
const MAX_NETWORK_RETRIES = 2;
const NETWORK_RETRY_DELAY_MS = 1000;
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

api.interceptors.response.use(
  response => response,
  async error => {
    const original = error.config;

    if (!error.response && original && (original.method ?? 'get').toLowerCase() === 'get') {
      original._networkRetryCount = (original._networkRetryCount ?? 0);
      if (original._networkRetryCount < MAX_NETWORK_RETRIES) {
        original._networkRetryCount += 1;
        await delay(NETWORK_RETRY_DELAY_MS * original._networkRetryCount);
        return api(original);
      }
    }

    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      if (!hydrated) await hydrationPromise;

      if (!refreshing) {
        refreshing = true;
        try {
          const { refreshToken, setTokens, logout } = useAuthStore.getState();
          if (!refreshToken) { logout(); return Promise.reject(error); }

          const res = await axios.post(`${BASE_URL}/auth/refresh`, { refreshToken });
          const { accessToken, refreshToken: newRefresh } = res.data;
          setTokens(accessToken, newRefresh);
          onRefreshed(accessToken);
        } catch (refreshError: any) {
          // No `response` means the refresh request itself never reached the
          // server (or back) — a network blip, not an actual rejection of
          // the token. Don't wipe a valid session over that; the next
          // request gets another chance once connectivity recovers.
          if (!refreshError?.response) {
            return Promise.reject(refreshError);
          }
          useAuthStore.getState().logout();
          return Promise.reject(error);
        } finally {
          refreshing = false;
        }
      }

      return new Promise(resolve => {
        subscribeTokenRefresh(token => {
          original.headers.Authorization = `Bearer ${token}`;
          resolve(api(original));
        });
      });
    }
    return Promise.reject(error);
  },
);
