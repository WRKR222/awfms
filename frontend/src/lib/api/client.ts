/**
 * AWFMS API Client (lib/api/client.ts)
 *
 * Set in Vercel Environment Variables:
 *   VITE_API_URL = https://anza-whole-foods-poultry-management.up.railway.app
 *
 * This matches lib/api.ts — both use the same BASE_URL derivation.
 */
import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '../../stores/auth.store';

// Strip trailing slash if present, then append /api/v1
const BASE_URL = `${(import.meta.env.VITE_API_URL ?? 'http://localhost:3000').replace(/\/$/, '')}/api/v1`;

export const apiClient = axios.create({
  baseURL: BASE_URL,
  withCredentials: true,
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
});

// ── Request interceptor — attach access token ────────────────────────────────
apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ── Response interceptor — silent refresh on 401 ─────────────────────────────
let isRefreshing = false;
let failedQueue: Array<{
  resolve: (value?: unknown) => void;
  reject: (reason?: unknown) => void;
}> = [];

const processQueue = (error: Error | null, token?: string) => {
  failedQueue.forEach(({ resolve, reject }) => {
    if (error) reject(error);
    else resolve(token);
  });
  failedQueue = [];
};

// zustand-persist rehydrates `refreshToken` from localStorage ASYNCHRONOUSLY.
// On a fresh page load, background polls (notifications, tally-verifications,
// production/sessions, ...) can 401 and reach this interceptor before that
// rehydration has landed — at which point `refreshToken` reads as null even
// though the real one is still sitting in localStorage. Treating that as "not
// logged in" and calling logout() would immediately persist an EMPTY auth
// state over the real one, wiping a perfectly valid session (and bouncing the
// user to /login for no reason). So: if hydration hasn't finished yet, wait
// for it before deciding there's really no refresh token.
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

// ── Network-error retry (with backoff) for GET requests ──────────────────────
// A device on a weak/intermittent connection (e.g. a rural site vs. a fast
// office connection) can throw a plain network error/timeout on a request
// that would have succeeded a second later. Without this, that one blip
// permanently looks like "no data" to any caller that does
// `.catch(() => [])` on the request (very common in this codebase) — React
// Query's own retry never engages for those, because the queryFn "succeeds"
// with an empty value instead of rejecting. Retrying a couple of times here,
// below that swallowing, gives transient failures a chance to self-heal
// before the caller ever sees them. Only GETs — POST/PATCH are not safely
// retryable without idempotency handling.
const MAX_NETWORK_RETRIES = 2;
const NETWORK_RETRY_DELAY_MS = 1000;
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean; _networkRetryCount?: number };

    if (!error.response && originalRequest && (originalRequest.method ?? 'get').toLowerCase() === 'get') {
      originalRequest._networkRetryCount = originalRequest._networkRetryCount ?? 0;
      if (originalRequest._networkRetryCount < MAX_NETWORK_RETRIES) {
        originalRequest._networkRetryCount += 1;
        await delay(NETWORK_RETRY_DELAY_MS * originalRequest._networkRetryCount);
        return apiClient(originalRequest);
      }
    }

    if (error.response?.status === 401 && !originalRequest._retry) {
      if (!hydrated) await hydrationPromise;

      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then((token) => {
          originalRequest.headers.Authorization = `Bearer ${token}`;
          return apiClient(originalRequest);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const { refreshToken, setTokens, logout } = useAuthStore.getState();
        if (!refreshToken) {
          // Never had a session (or it was cleared) — plain "please log in",
          // not "your session expired", so don't tag this with a reason.
          logout();
          window.location.href = '/login';
          return Promise.reject(error);
        }

        const res = await axios.post(`${BASE_URL}/auth/refresh`, { refreshToken });
        const { accessToken, refreshToken: newRefresh } = res.data;
        setTokens(accessToken, newRefresh);
        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        processQueue(null, accessToken);
        return apiClient(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError as Error);

        // No `response` on the error means the refresh request never made it
        // to the server (or back) — a network blip, not the server actually
        // rejecting the token. On a flaky connection this can happen often;
        // logging the user out over it was wiping perfectly valid sessions
        // (this is what made devices on a poor connection look permanently
        // broken/blank while a fast connection rarely hit this path at all).
        // Leave the session intact — the next request gets another chance to
        // refresh once connectivity recovers.
        if (!(refreshError as AxiosError)?.response) {
          return Promise.reject(refreshError);
        }

        useAuthStore.getState().logout();
        // A refresh token DID exist and the server actively rejected it
        // (expired, revoked, or no longer recognised — e.g. after a deploy
        // that reset the database). Tag the redirect so the login page can
        // show a clear "your session expired" message instead of just
        // silently dropping the user back at a blank login form with no
        // explanation of why they were logged out.
        window.location.href = '/login?sessionExpired=1';
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  },
);

export const api = apiClient;
export default apiClient;
