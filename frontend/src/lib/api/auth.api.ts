import apiClient from './client';
import { AuthUser } from '../../stores/auth.store';

export interface LoginRequest { username: string; password: string; }
export interface LoginResponse { accessToken: string; refreshToken?: string; user: AuthUser; }

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

  changePassword: async (dto: { currentPassword: string; newPassword: string }): Promise<void> => {
    await apiClient.post('/auth/change-password', dto);
  },

  adminResetPassword: async (userId: string, newPassword: string): Promise<void> => {
    await apiClient.post(`/auth/admin-reset-password/${userId}`, { newPassword });
  },

  getPasswordResetLog: async () => {
    const { data } = await apiClient.get('/auth/password-reset-log');
    return data as Array<{
      id: string;
      resetType: 'ADMIN_RESET' | 'SELF_CHANGE';
      createdAt: string;
      admin: { fullName: string; username: string; role: string };
      targetUser: { fullName: string; username: string; role: string };
    }>;
  },
};

