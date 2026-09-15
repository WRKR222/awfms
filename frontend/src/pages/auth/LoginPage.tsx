import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2, Eye, EyeOff, User, Lock, Info } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { authApi } from '../../lib/api/auth.api';
import { useAuthStore } from '../../stores/auth.store';

// FIX: this always fell back to "Invalid username or password" for ANY
// error, including a network failure with no response at all — so a device
// that can't reach the server (weak/blocked connection) saw the exact same
// message as someone who genuinely typed the wrong password, sending them
// on a wild goose chase re-entering credentials that were never wrong. Only
// a real 401 from the server means the credentials were rejected.
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

const loginSchema = z.object({
  username: z.string().min(1, 'Enter your username'),
  password: z.string().min(1, 'Enter your password'),
});
type LoginForm = z.infer<typeof loginSchema>;

const ROLE_HOME: Record<string, string> = {
  ATTENDANT:  '/attendant',
  MANAGER:    '/manager',
  ACCOUNTANT: '/accountant',
  OWNER:      '/owner',
  SALES:      '/sales',
  STORE:      '/store',
  SECURITY1:  '/security1',
  SECURITY2:  '/security2',
};

// Animated leaf/grain particle canvas
function ParticleCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const particles = Array.from({ length: 40 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: Math.random() * 2.5 + 0.5,
      speedX: (Math.random() - 0.5) * 0.3,
      speedY: (Math.random() - 0.5) * 0.3,
      opacity: Math.random() * 0.15 + 0.05,
    }));

    let raf: number;
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of particles) {
        p.x += p.speedX;
        p.y += p.speedY;
        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height;
        if (p.y > canvas.height) p.y = 0;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${p.opacity})`;
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
    />
  );
}

export default function LoginPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [showPassword, setShowPassword] = useState(false);
  const [usernameFocused, setUsernameFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [mounted, setMounted] = useState(false);

  // The API client tags the redirect to here with ?sessionExpired=1 when a
  // refresh token existed but the server rejected it (expired, revoked, or
  // no longer recognised — e.g. right after a deploy that reset the
  // database) — see lib/api/client.ts. Captured once via the useState
  // initializer so the banner stays visible even after the URL is cleaned
  // up below (otherwise it would vanish the instant searchParams changes).
  const [searchParams, setSearchParams] = useSearchParams();
  const [showSessionExpired] = useState(() => searchParams.get('sessionExpired') === '1');

  useEffect(() => {
    if (showSessionExpired) {
      searchParams.delete('sessionExpired');
      setSearchParams(searchParams, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 50);
    return () => clearTimeout(t);
  }, []);

  const { register, handleSubmit, watch, formState: { errors } } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  });

  const usernameVal = watch('username', '');
  const passwordVal = watch('password', '');

  const loginMutation = useMutation({
    mutationFn: authApi.login,
    onSuccess: (data) => {
      setAuth(data.user, data.accessToken, data.refreshToken ?? '');
      const home = ROLE_HOME[data.user.role] ?? '/owner';
      navigate(home, { replace: true });
    },
  });

  return (
    <div className="min-h-screen flex items-stretch bg-[#0d1f0f]">

      {/* ── LEFT PANEL (hidden on mobile) ── */}
      <div className="hidden lg:flex lg:w-[52%] relative overflow-hidden flex-col items-center justify-center p-12"
        style={{ background: 'linear-gradient(135deg, #1a4a1f 0%, #0d2e10 40%, #071a09 100%)' }}>
        <ParticleCanvas />

        {/* decorative rings */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full border border-white/5" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[360px] h-[360px] rounded-full border border-white/5" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[220px] h-[220px] rounded-full border border-white/8" />

        {/* content */}
        <div className={`relative z-10 text-center transition-all duration-700 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
          {/* Logo */}
          <div className="w-24 h-24 rounded-3xl bg-white/10 backdrop-blur border border-white/20 flex items-center justify-center mx-auto mb-8 shadow-2xl">
            <svg viewBox="357 585 476 513" className="w-12 h-12 fill-white">
              <path d="M 595.421875 585.589844 L 594.433594 586.578125 L 593.445312 585.589844 L 357.472656 820.671875 L 358.460938 821.660156 L 358.460938 1098.226562 L 437.445312 1098.226562 L 437.445312 853.265625 L 622.078125 668.558594 L 792.890625 838.449219 L 792.890625 1098.226562 L 832.382812 1098.226562 L 832.382812 822.644531 Z" />
              <path d="M 620.105469 930.308594 C 606.28125 930.308594 595.421875 941.175781 595.421875 955.003906 C 595.421875 968.832031 606.28125 979.695312 620.105469 979.695312 C 633.925781 979.695312 644.789062 968.832031 644.789062 955.003906 C 644.789062 941.175781 633.925781 930.308594 620.105469 930.308594 Z M 712.914062 919.445312 C 725.75 908.578125 733.648438 891.789062 733.648438 874.007812 C 733.648438 840.425781 706.003906 812.769531 672.433594 812.769531 C 655.648438 812.769531 639.851562 819.683594 628.992188 830.546875 C 615.167969 812.769531 594.433594 801.902344 570.738281 801.902344 C 530.257812 801.902344 496.6875 835.488281 496.6875 875.984375 C 496.6875 884.875 498.660156 893.765625 501.625 901.664062 C 491.75 904.628906 481.875 909.566406 473.976562 917.46875 C 450.28125 941.175781 450.28125 979.695312 473.976562 1003.402344 C 485.828125 1015.253906 500.636719 1019.207031 516.433594 1019.207031 L 526.308594 1019.207031 L 526.308594 1058.714844 L 565.800781 1058.714844 L 565.800781 950.066406 C 565.800781 923.394531 590.484375 901.664062 618.128906 901.664062 C 618.128906 901.664062 674.40625 900.679688 674.40625 950.066406 L 674.40625 1058.714844 L 713.902344 1058.714844 L 713.902344 985.625 L 773.140625 950.066406 Z" />
            </svg>
          </div>

          <h1 className="text-4xl font-bold text-white mb-3 tracking-tight">Anza Whole Foods</h1>
          <p className="text-green-300/80 text-lg font-medium mb-2">Farm Management System</p>
          <div className="flex items-center justify-center gap-2 mt-6">
            <div className="h-px w-12 bg-white/20" />
            <span className="text-white/40 text-xs uppercase tracking-widest">AWFMS</span>
            <div className="h-px w-12 bg-white/20" />
          </div>

          <div className="mt-12 grid grid-cols-3 gap-4 text-center">
            {[
              { label: 'Egg Production', sub: 'Daily tracking' },
              { label: 'Feed & Flock', sub: 'Full records' },
              { label: 'Role-Based', sub: '5 access levels' },
            ].map(({ label, sub }) => (
              <div key={label} className="bg-white/5 rounded-2xl p-4 border border-white/10">
                <p className="text-white text-sm font-semibold">{label}</p>
                <p className="text-white/40 text-xs mt-1">{sub}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── RIGHT PANEL (login form) ── */}
      <div className="flex-1 flex items-center justify-center p-6 bg-[#0f1f11]">
        <div className={`w-full max-w-[400px] transition-all duration-700 delay-100 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>

          {/* Mobile logo */}
          <div className="lg:hidden text-center mb-10">
            <div className="w-16 h-16 rounded-2xl bg-brand-green/20 border border-brand-green/30 flex items-center justify-center mx-auto mb-4">
              <svg viewBox="357 585 476 513" className="w-8 h-8 fill-brand-green">
                <path d="M 595.421875 585.589844 L 594.433594 586.578125 L 593.445312 585.589844 L 357.472656 820.671875 L 358.460938 821.660156 L 358.460938 1098.226562 L 437.445312 1098.226562 L 437.445312 853.265625 L 622.078125 668.558594 L 792.890625 838.449219 L 792.890625 1098.226562 L 832.382812 1098.226562 L 832.382812 822.644531 Z" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-white">Anza Whole Foods</h1>
            <p className="text-green-400/60 text-sm">Farm Management System</p>
          </div>

          {/* Form card */}
          <div className="bg-white/5 backdrop-blur border border-white/10 rounded-3xl p-8 shadow-2xl">
            <div className="mb-8">
              <h2 className="text-2xl font-bold text-white">Welcome back</h2>
              <p className="text-white/40 text-sm mt-1">Sign in to your account</p>
            </div>

            {/* Session expired notice */}
            {showSessionExpired && (
              <div className="mb-6 px-4 py-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-300 text-sm flex items-start gap-2.5">
                <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>Your session expired — please sign in again to continue.</span>
              </div>
            )}

            {/* Error */}
            {loginMutation.isError && (
              <div className="mb-6 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm">
                {loginErrorMessage(loginMutation.error)}
              </div>
            )}

            <form onSubmit={handleSubmit((data) => loginMutation.mutate(data))} noValidate className="space-y-4">

              {/* Username */}
              <div>
                <label className="block text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">
                  Username
                </label>
                <div className={`relative flex items-center rounded-xl border transition-all duration-200 ${
                  usernameFocused
                    ? 'border-brand-green/60 bg-brand-green/5 shadow-[0_0_0_3px_rgba(34,197,94,0.1)]'
                    : 'border-white/10 bg-white/5'
                }`}>
                  <User className={`absolute left-4 w-4 h-4 transition-colors ${usernameFocused || usernameVal ? 'text-brand-green' : 'text-white/30'}`} />
                  <input
                    {...register('username')}
                    type="text"
                    autoComplete="username"
                    autoCapitalize="none"
                    autoCorrect="off"
                    placeholder="e.g. james.attendant"
                    onFocus={() => setUsernameFocused(true)}
                    onBlur={() => setUsernameFocused(false)}
                    className="w-full bg-transparent pl-11 pr-4 py-3.5 text-white placeholder-white/20 text-sm focus:outline-none rounded-xl"
                  />
                </div>
                {errors.username && (
                  <p className="mt-1.5 text-xs text-red-400">{errors.username.message}</p>
                )}
              </div>

              {/* Password */}
              <div>
                <label className="block text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">
                  Password
                </label>
                <div className={`relative flex items-center rounded-xl border transition-all duration-200 ${
                  passwordFocused
                    ? 'border-brand-green/60 bg-brand-green/5 shadow-[0_0_0_3px_rgba(34,197,94,0.1)]'
                    : 'border-white/10 bg-white/5'
                }`}>
                  <Lock className={`absolute left-4 w-4 h-4 transition-colors ${passwordFocused || passwordVal ? 'text-brand-green' : 'text-white/30'}`} />
                  <input
                    {...register('password')}
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="Your password"
                    onFocus={() => setPasswordFocused(true)}
                    onBlur={() => setPasswordFocused(false)}
                    className="w-full bg-transparent pl-11 pr-12 py-3.5 text-white placeholder-white/20 text-sm focus:outline-none rounded-xl"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 p-1.5 text-white/30 hover:text-white/70 transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {errors.password && (
                  <p className="mt-1.5 text-xs text-red-400">{errors.password.message}</p>
                )}
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={loginMutation.isPending}
                className="w-full mt-2 py-3.5 rounded-xl font-semibold text-sm transition-all duration-200
                           bg-brand-green hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed
                           text-white flex items-center justify-center gap-2 shadow-lg shadow-brand-green/20
                           active:scale-[0.98]"
              >
                {loginMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Signing in...</>
                ) : (
                  'Sign In'
                )}
              </button>
            </form>

            {/* Forgot password note */}
            <div className="mt-6 pt-6 border-t border-white/10">
              <p className="text-white/30 text-xs text-center leading-relaxed">
                Forgot your password? Contact your{' '}
                <span className="text-white/50 font-medium">Supervisor or Manager</span>{' '}
                to have it reset.
              </p>
            </div>
          </div>

          <p className="text-center text-white/20 text-xs mt-6">
            AWFMS v1.0 · Anza Whole Foods Farm Management System
          </p>
        </div>
      </div>
    </div>
  );
}
