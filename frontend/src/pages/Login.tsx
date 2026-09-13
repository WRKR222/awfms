import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AxiosError } from 'axios';
import { useLogin } from '../hooks/useAuth';

// The login endpoint only ever returns 401 for a genuinely wrong username/
// password. Anything else (no response at all, a timeout, a 5xx, a CORS
// failure on a device hitting a different/stale frontend build) is a
// connectivity or server problem, not a credentials problem — showing
// "Invalid username or password" for those masks the real issue and sends
// people on a wild goose chase re-typing a password that was never wrong.
function loginErrorMessage(error: unknown): string {
  if (error instanceof AxiosError) {
    if (error.response?.status === 401) {
      return 'Invalid username or password. Please try again.';
    }
    if (error.response) {
      return error.response.data?.message ?? 'Sign-in failed. Please try again.';
    }
    return 'Unable to reach the server. Check your internet connection and try again.';
  }
  return 'Sign-in failed. Please try again.';
}

const schema = z.object({
  username: z.string().min(3, 'Username required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

type FormData = z.infer<typeof schema>;

export function LoginPage() {
  const login = useLogin();
  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  return (
    <div className="min-h-screen bg-brand-green flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-brand-light rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl">🐓</span>
          </div>
          <h1 className="text-2xl font-bold text-brand-green">Anza Whole Foods</h1>
          <p className="text-gray-500 text-sm mt-1">Farm Management System</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit(data => login.mutate(data))} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Username
            </label>
            <input
              {...register('username')}
              className="w-full border border-gray-300 rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand-green"
              placeholder="e.g. james.attendant"
              autoCapitalize="none"
              autoCorrect="off"
            />
            {errors.username && (
              <p className="text-red-500 text-sm mt-1">{errors.username.message}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Password
            </label>
            <input
              {...register('password')}
              type="password"
              className="w-full border border-gray-300 rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand-green"
              placeholder="Your password"
            />
            {errors.password && (
              <p className="text-red-500 text-sm mt-1">{errors.password.message}</p>
            )}
          </div>

          {login.error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-700 text-sm">
              {loginErrorMessage(login.error)}
            </div>
          )}

          <button
            type="submit"
            disabled={login.isPending}
            className="w-full bg-brand-green text-white rounded-xl py-4 text-base font-semibold
                       hover:bg-brand-mid transition-colors disabled:opacity-60 disabled:cursor-not-allowed
                       min-h-[56px]" // 56px = 3.5rem — large touch target
          >
            {login.isPending ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p className="text-center text-xs text-gray-400 mt-6">
          Anza Whole Foods FMS v1.0 · Phase 1
        </p>
      </div>
    </div>
  );
}
