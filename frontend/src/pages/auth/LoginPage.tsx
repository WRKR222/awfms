import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2, Eye, EyeOff } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { authApi } from '../../lib/api/auth.api';
import { useAuthStore } from '../../stores/auth.store';

const loginSchema = z.object({
  username: z.string().min(1, 'Enter your username'),
  password: z.string().min(1, 'Enter your password'),
});
type LoginForm = z.infer<typeof loginSchema>;

// Role-specific home routes
const ROLE_HOME: Record<string, string> = {
  attendant:  '/attendant',
  supervisor: '/supervisor',
  manager:    '/manager',
  accountant: '/accountant',
  owner:      '/owner',
};

export default function LoginPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [showPassword, setShowPassword] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  });

  const loginMutation = useMutation({
    mutationFn: authApi.login,
    onSuccess: (data) => {
      setAuth(data.user, data.accessToken);
      const home = ROLE_HOME[data.user.roleName] ?? '/dashboard';
      navigate(home, { replace: true });
    },
  });

  return (
    <div className="min-h-screen bg-green-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo / Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-green-700 rounded-2xl mb-4 shadow-lg">
            <span className="text-white text-2xl font-bold">A</span>
          </div>
          <h1 className="text-2xl font-bold text-green-900">Anza Whole Foods</h1>
          <p className="text-green-600 text-sm mt-1">Farm Management System</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-green-100 p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-6">Sign in to continue</h2>

          {/* Error banner */}
          {loginMutation.isError && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {(loginMutation.error as any)?.response?.data?.message ?? 'Invalid username or password'}
            </div>
          )}

          <form onSubmit={handleSubmit((data) => loginMutation.mutate(data))} noValidate>
            {/* Username */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Username
              </label>
              <input
                {...register('username')}
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                placeholder="Enter your username"
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-gray-900 placeholder-gray-400
                           focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent
                           text-base" // text-base prevents iOS zoom
              />
              {errors.username && (
                <p className="mt-1 text-xs text-red-600">{errors.username.message}</p>
              )}
            </div>

            {/* Password */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  {...register('password')}
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  className="w-full px-4 py-3 pr-12 border border-gray-300 rounded-xl text-gray-900 placeholder-gray-400
                             focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent
                             text-base"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
              {errors.password && (
                <p className="mt-1 text-xs text-red-600">{errors.password.message}</p>
              )}
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loginMutation.isPending}
              className="w-full py-3.5 bg-green-700 hover:bg-green-800 disabled:bg-green-400
                         text-white font-semibold rounded-xl transition-colors
                         flex items-center justify-center gap-2 text-base min-h-[52px]"
            >
              {loginMutation.isPending ? (
                <><Loader2 size={20} className="animate-spin" /> Signing in...</>
              ) : (
                'Sign In'
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          Contact your supervisor if you've forgotten your password
        </p>
      </div>
    </div>
  );
}
