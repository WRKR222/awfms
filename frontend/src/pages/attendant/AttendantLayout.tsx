import { Routes, Route, NavLink } from 'react-router-dom';
import { Home, Package, Egg, Heart, Bell, LogOut } from 'lucide-react';
import { useAuthStore } from '../../stores/auth.store';
import { useLogout } from '../../hooks/useAuth';
import { useNotificationsStore } from '../../stores/notifications.store';
import { AttendantHome } from './AttendantHome';
import { DailyFlockEntry } from './DailyFlockEntry';
import { DailyFeedEntry } from './DailyFeedEntry';
import { DailyProductionEntry } from './DailyProductionEntry';
import { useEffect } from 'react';

export function AttendantLayout() {
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
      <header className="bg-brand-green text-white px-4 py-3 flex items-center justify-between shadow-md">
        <div>
          <p className="text-xs opacity-75">Attendant</p>
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
          <Route index element={<AttendantHome />} />
          <Route path="flock" element={<DailyFlockEntry />} />
          <Route path="feed" element={<DailyFeedEntry />} />
          <Route path="eggs" element={<DailyProductionEntry />} />
        </Routes>
      </main>

      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg">
        <div className="flex">
          {[
            { to: '/attendant', icon: Home, label: 'Home', end: true },
            { to: '/attendant/flock', icon: Package, label: 'Flock' },
            { to: '/attendant/feed', icon: Package, label: 'Feed' },
            { to: '/attendant/eggs', icon: Egg, label: 'Eggs' },
            { to: '/attendant/health', icon: Heart, label: 'Health' },
          ].map(({ to, icon: Icon, label, end }) => (
            <NavLink key={to} to={to} end={end}
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center py-3 min-h-[64px] transition-colors ${isActive ? 'text-brand-green' : 'text-gray-500'}`
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
