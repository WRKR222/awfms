/**
 * Shared layout primitives used by all role layouts.
 * Provides responsive containers, headers, and nav patterns.
 */

import { Bell, LogOut, Sun, Moon } from 'lucide-react';
import { useThemeStore } from '../../stores/theme.store';
import { useLogout } from '../../hooks/useAuth';
import { useNotificationsStore } from '../../stores/notifications.store';
import { NavLink } from 'react-router-dom';
import { useEffect } from 'react';

// ── Responsive page wrapper ───────────────────────────────────────────────────
// On mobile: full width. On desktop: centered with max-width, subtle sidebar feel.
export function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-dark-bg flex flex-col">
      {/* On larger screens, constrain and center the app like a mobile shell */}
      <div className="flex-1 flex flex-col w-full md:max-w-2xl md:mx-auto md:shadow-2xl md:shadow-black/20 min-h-screen">
        {children}
      </div>
    </div>
  );
}

// ── Shared top header ─────────────────────────────────────────────────────────
interface AppHeaderProps {
  roleLabel: string;
  userName?: string;
  accentClass?: string; // e.g. 'bg-brand-green' or 'bg-brand-teal'
}

export function AppHeader({ roleLabel, userName, accentClass = 'bg-brand-green' }: AppHeaderProps) {
  const { isDark, toggleTheme } = useThemeStore();
  const logout = useLogout();
  const { unreadCount } = useNotificationsStore();

  return (
    <header className={`${accentClass} dark:bg-dark-surface dark:border-b dark:border-dark-border text-white px-4 py-3 flex items-center justify-between shadow-md sticky top-0 z-30`}>
      <div>
        <p className="text-xs opacity-70 leading-none">{roleLabel}</p>
        <p className="font-semibold text-sm leading-tight">{userName}</p>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={toggleTheme}
          className="p-2 rounded-lg hover:bg-white/20 active:bg-white/30 transition-colors"
          aria-label="Toggle theme"
        >
          {isDark
            ? <Sun className="w-5 h-5 text-yellow-300" />
            : <Moon className="w-5 h-5 text-white" />
          }
        </button>
        <button className="relative p-2 rounded-lg hover:bg-white/20 active:bg-white/30 transition-colors">
          <Bell className="w-5 h-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center font-bold leading-none">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
        <button
          onClick={logout}
          className="p-2 rounded-lg hover:bg-white/20 active:bg-white/30 transition-colors"
          aria-label="Log out"
        >
          <LogOut className="w-5 h-5" />
        </button>
      </div>
    </header>
  );
}

// ── Shared bottom nav ─────────────────────────────────────────────────────────
interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  end?: boolean;
  activeColor?: string; // e.g. 'text-brand-green dark:text-brand-greenDark'
}

interface BottomNavProps {
  items: NavItem[];
  activeColor?: string;
}

export function BottomNav({ items, activeColor = 'text-brand-green dark:text-brand-greenDark' }: BottomNavProps) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white dark:bg-dark-surface border-t border-gray-200 dark:border-dark-border shadow-lg z-30">
      {/* Constrain to same width as content on desktop */}
      <div className="flex w-full md:max-w-2xl md:mx-auto">
        {items.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center justify-center py-2 min-h-[60px] gap-0.5 transition-colors
               ${isActive
                 ? activeColor
                 : 'text-gray-400 dark:text-dark-muted hover:text-gray-600 dark:hover:text-dark-text hover:bg-gray-50 dark:hover:bg-dark-card'
               }`
            }
          >
            {({ isActive }) => (
              <>
                <div className={`p-1 rounded-lg transition-colors ${isActive ? 'bg-brand-light dark:bg-brand-lightDark' : ''}`}>
                  <Icon className="w-6 h-6" />
                </div>
                <span className="text-xs font-medium leading-none">{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

// ── Shared page content wrapper ───────────────────────────────────────────────
export function PageContent({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex-1 overflow-y-auto pb-24">
      {children}
    </main>
  );
}

// ── Shared inner content container (responsive padding) ───────────────────────
export function ContentContainer({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`p-4 space-y-4 max-w-full ${className}`}>
      {children}
    </div>
  );
}

// ── Reusable hook for notification polling ────────────────────────────────────
export function useNotificationPolling() {
  const { fetchNotifications } = useNotificationsStore();
  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 60000);
    return () => clearInterval(interval);
  }, []);
}
