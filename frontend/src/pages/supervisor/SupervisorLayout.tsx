import { Routes, Route, NavLink } from 'react-router-dom';
import { Home, CheckSquare, ShoppingCart, Bell, LogOut } from 'lucide-react';
import { useAuthStore } from '../../stores/auth.store';
import { useLogout } from '../../hooks/useAuth';
import { useNotificationsStore } from '../../stores/notifications.store';
import { SupervisorHome } from './SupervisorHome';
import { VerificationQueue } from './VerificationQueue';
import { useEffect } from 'react';

export function SupervisorLayout() {
  const { user } = useAuthStore();
  const logout = useLogout();
  const { unreadCount, fetchNotifications } = useNotificationsStore();

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 60000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-brand-teal text-white px-4 py-3 flex items-center justify-between shadow-md">
        <div>
          <p className="text-xs opacity-75">Supervisor</p>
          <p className="font-semibold text-sm">{user?.fullName}</p>
        </div>
        <div className="flex items-center gap-3">
          <button className="relative p-2">
            <Bell className="w-6 h-6" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
          <button onClick={logout} className="p-2"><LogOut className="w-5 h-5" /></button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto pb-24">
        <Routes>
          <Route index element={<SupervisorHome />} />
          <Route path="verify" element={<VerificationQueue />} />
        </Routes>
      </main>

      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg">
        <div className="flex">
          {[
            { to: '/supervisor', icon: Home, label: 'Home', end: true },
            { to: '/supervisor/verify', icon: CheckSquare, label: 'Verify' },
            { to: '/supervisor/sales', icon: ShoppingCart, label: 'Sales' },
          ].map(({ to, icon: Icon, label, end }) => (
            <NavLink key={to} to={to} end={end}
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center py-3 min-h-[64px] transition-colors ${isActive ? 'text-brand-teal' : 'text-gray-500'}`
              }
            >
              <Icon className="w-6 h-6 mb-1" />
              <span className="text-xs font-medium">{label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
