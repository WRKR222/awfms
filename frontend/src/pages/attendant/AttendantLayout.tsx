// src/pages/attendant/AttendantLayout.tsx
//
// Lead Attendant layout — Flock and Feed nav links removed; everything flows
// through the single Egg Collection page now (per changes.pdf).
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useNavigate } from 'react-router-dom';
import { Egg, Bell, LogOut, Settings, Flame } from 'lucide-react';
import { HomeIcon, FlockIcon } from '../../components/ui/icons';
import { Sidebar, SidebarBody, SidebarLink, SidebarLinkItem } from '../../components/ui/sidebar';
import { motion } from 'framer-motion';
import { useAuthStore } from '../../stores/auth.store';
import { useLogout } from '../../hooks/useAuth';
import { useNotificationsStore } from '../../stores/notifications.store';
import { useLoginNotifications } from '../../hooks/useLoginNotifications';
import { LoginNotificationModal } from '../../components/shared/LoginNotificationModal';
import { MobileSidebar } from '../../components/shared/MobileSidebar';

export function AttendantLayout() {
  const { user } = useAuthStore();
  const logout = useLogout();
  const { t } = useTranslation();
  useLoginNotifications();

  const navigate = useNavigate();
  const { unreadCount, fetchNotifications } = useNotificationsStore();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 60_000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  const sidebarLinks: SidebarLinkItem[] = [
    { to: '/attendant',                  label: t('nav.home'),     icon: <HomeIcon className="w-5 h-5" />, end: true },
    { to: '/attendant/egg-collection',   label: t('nav.eggs'),     icon: <Egg className="w-5 h-5" /> },
    { to: '/attendant/brooder',           label: 'Brooder',         icon: <Flame className="w-5 h-5" /> },
    { to: '/attendant/settings',         label: t('nav.settings'), icon: <Settings className="w-5 h-5" /> },
    {
      to: '/attendant/notifications',
      label: t('nav.alerts'),
      icon: (
        <span className="relative inline-flex w-5 h-5 items-center justify-center">
          <Bell className="w-5 h-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] rounded-full w-3.5 h-3.5 flex items-center justify-center font-bold">
              {unreadCount > 9 ? '9' : unreadCount}
            </span>
          )}
        </span>
      ),
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-dark-bg flex flex-row">

      {/* ── DESKTOP SIDEBAR ── */}
      <Sidebar open={open} setOpen={setOpen}>
        <SidebarBody className="justify-between gap-6 h-screen sticky top-0">
          <div className="flex flex-col flex-1 overflow-y-auto overflow-x-hidden">
            <div className="flex items-center gap-3 py-2 mb-6 px-1">
              <div className="w-8 h-8 rounded-lg bg-brand-green flex items-center justify-center flex-shrink-0">
                <FlockIcon className="w-4 h-4" />
              </div>
              <motion.span
                animate={{ display: open ? 'block' : 'none', opacity: open ? 1 : 0 }}
                className="text-sm font-bold text-gray-800 dark:text-gray-100 whitespace-pre"
              >
                Anza Whole Foods
              </motion.span>
            </div>
            <div className="flex flex-col gap-1">
              {sidebarLinks.map(link => (
                <SidebarLink
                  key={link.to}
                  link={link}
                  accentColor="text-brand-green"
                  accentBg="bg-brand-green/10 dark:bg-brand-green/20"
                />
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1 border-t border-gray-100 dark:border-dark-border pt-4">
            <SidebarLink link={{ to: '', label: t('nav.logout'), icon: <LogOut className="w-5 h-5" />, onClick: logout }} />
            <div className="flex items-center gap-3 px-1 py-2">
              <div className="w-7 h-7 rounded-full bg-brand-green/20 flex items-center justify-center flex-shrink-0">
                <span className="text-xs font-bold text-brand-green">{user?.fullName?.charAt(0) ?? 'A'}</span>
              </div>
              <motion.div
                animate={{ display: open ? 'block' : 'none', opacity: open ? 1 : 0 }}
                className="overflow-hidden min-w-0"
              >
                <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 truncate">{user?.fullName}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500">Lead Attendant</p>
              </motion.div>
            </div>
          </div>
        </SidebarBody>
      </Sidebar>

      {/* ── MAIN CONTENT — App.tsx owns routing, Outlet renders child pages ── */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="md:hidden flex items-center justify-between px-4 py-3 bg-brand-green text-white sticky top-0 z-10">
          <div className="flex items-center gap-3 min-w-0">
            <MobileSidebar links={sidebarLinks} user={user ?? undefined} roleLabel={'Lead Attendant'} onLogout={logout} />
            <div className="min-w-0">
              <p className="text-xs opacity-75">Lead Attendant</p>
              <p className="font-semibold text-sm">{user?.fullName}</p>
            </div>
          </div>
          <button onClick={() => navigate('/attendant/notifications')} className="relative p-1">
            <Bell className="w-5 h-5" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
        </header>

        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
      <LoginNotificationModal />
    </div>
  );
}
