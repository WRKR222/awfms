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

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

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
        useAuthStore.getState().logout();
        window.location.href = '/login';
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
