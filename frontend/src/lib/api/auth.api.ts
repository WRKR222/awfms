import apiClient from './client';
import { AuthUser } from '../../stores/auth.store';

export interface LoginRequest { username: string; password: string; }
export interface LoginResponse { accessToken: string; user: AuthUser; }

export const authApi = {
  login: async (dto: LoginRequest): Promise<LoginResponse> => {
    const { data } = await apiClient.post<LoginResponse>('/auth/login', dto);
    return data;
  },

  refresh: async (): Promise<{ accessToken: string }> => {
    const { data } = await apiClient.post('/auth/refresh');
    return data;
  },

  logout: async (): Promise<void> => {
    await apiClient.post('/auth/logout');
  },

  me: async (): Promise<AuthUser & { house?: { name: string } }> => {
    const { data } = await apiClient.get('/auth/me');
    return data;
  },
};
