import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/auth.store';

export function useLogin() {
  const { setAuth } = useAuthStore();
  const navigate = useNavigate();

  return useMutation({
    mutationFn: async (credentials: { username: string; password: string }) => {
      const res = await api.post('/auth/login', credentials);
      return res.data;
    },
    onSuccess: data => {
      setAuth(data.user, data.accessToken, data.refreshToken);
      // Route to role-specific dashboard
      const roleRoutes: Record<string, string> = {
        ATTENDANT: '/attendant',
        SUPERVISOR: '/supervisor',
        MANAGER: '/manager',
        ACCOUNTANT: '/accountant',
        OWNER: '/owner',
      };
      navigate(roleRoutes[data.user.role] ?? '/');
    },
  });
}

export function useLogout() {
  const { refreshToken, logout } = useAuthStore();
  const navigate = useNavigate();

  return async () => {
    try {
      if (refreshToken) await api.post('/auth/logout', { refreshToken });
    } finally {
      logout();
      navigate('/login');
    }
  };
}
