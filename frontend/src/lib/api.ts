/**
 * AWFMS API Client
 * All API calls go through this module.
 * Handles: auth headers, token refresh, offline queuing.
 */

import axios, { AxiosInstance } from 'axios';
import { useAuthStore } from '../stores/auth.store';

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api/v1';

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

api.interceptors.response.use(
  response => response,
  async error => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;

      if (!refreshing) {
        refreshing = true;
        try {
          const { refreshToken, setTokens, logout } = useAuthStore.getState();
          if (!refreshToken) { logout(); return Promise.reject(error); }

          const res = await axios.post(`${BASE_URL}/auth/refresh`, { refreshToken });
          const { accessToken, refreshToken: newRefresh } = res.data;
          setTokens(accessToken, newRefresh);
          onRefreshed(accessToken);
        } catch {
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
