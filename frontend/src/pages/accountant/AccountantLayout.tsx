import { Routes, Route, NavLink, useNavigate } from 'react-router-dom';
import { FileText, DollarSign, BarChart2, LogOut, Bell } from 'lucide-react';
import { AccountantHome } from './AccountantHome';
import { useLogout } from '../../hooks/useAuth';
import { useNotificationsStore } from '../../stores/notifications.store';
import { useEffect } from 'react';

export function AccountantLayout() {
  const logout = useLogout();
  const navigate = useNavigate();
  const { unreadCount, fetchNotifications } = useNotificationsStore();

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 60_000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  const nav = [
    { to: '/accountant', label: 'Invoices', icon: FileText, end: true },
    { to: '/accountant/finance', label: 'Finance', icon: DollarSign },
    { to: '/accountant/reports', label: 'Reports', icon: BarChart2 },
  ];

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col max-w-lg mx-auto">
      {/* Top bar */}
      <header className="bg-brand-gold text-white px-4 py-3 flex items-center justify-between sticky top-0 z-10 shadow-sm">
        <div>
          <p className="text-xs opacity-75 leading-none">AWFMS</p>
          <p className="font-bold text-sm leading-tight">Accountant</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/accountant/notifications')}
            className="relative p-1"
            aria-label="Notifications"
          >
            <Bell className="w-5 h-5" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center font-bold">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
          <button onClick={logout} className="p-1" aria-label="Logout">
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto pb-20">
        <Routes>
          <Route index element={<AccountantHome />} />
          <Route path="finance" element={<div className="p-6 text-center text-gray-500">Finance module — Phase 5</div>} />
          <Route path="reports" element={<div className="p-6 text-center text-gray-500">Reports module — Phase 5</div>} />
        </Routes>
      </main>

      {/* Bottom nav */}
      <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-lg bg-white border-t border-gray-200 flex">
        {nav.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center py-3 gap-0.5 text-xs font-medium transition-colors
               ${isActive ? 'text-brand-gold' : 'text-gray-400'}`
            }
          >
            <Icon className="w-5 h-5" />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
