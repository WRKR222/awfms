// OO Fix: Added Visitors + User Management nav links per Class Diagram Director role
import { useState, useEffect } from 'react';
// OO Fix: Added Visitors + User Management nav links per Class Diagram Director role
import { Outlet, useNavigate } from 'react-router-dom';
// OO Fix: Added Visitors + User Management nav links per Class Diagram Director role
import { useAuthStore } from '../../stores/auth.store';
// OO Fix: Added Visitors + User Management nav links per Class Diagram Director role
import { useNotificationsStore } from '../../stores/notifications.store';
// OO Fix: Added Visitors + User Management nav links per Class Diagram Director role
import { useLoginNotifications } from '../../hooks/useLoginNotifications';
// OO Fix: Added Visitors + User Management nav links per Class Diagram Director role
import { LoginNotificationModal } from '../../components/shared/LoginNotificationModal';
// OO Fix: Added Visitors + User Management nav links per Class Diagram Director role
import { MobileSidebar } from '../../components/shared/MobileSidebar';
// OO Fix: Added Visitors + User Management nav links per Class Diagram Director role
import { LayoutDashboard, Bell, LogOut, TrendingUp, Brain, Upload, Settings, UserCheck, Shield , FileText, FileSpreadsheet } from 'lucide-react';
// OO Fix: Added Visitors + User Management nav links per Class Diagram Director role
import { Sidebar, SidebarBody, SidebarLink, SidebarLinkItem } from '../../components/ui/sidebar';
// OO Fix: Added Visitors + User Management nav links per Class Diagram Director role
import { motion } from 'framer-motion';
// OO Fix: Added Visitors + User Management nav links per Class Diagram Director role
import { FlockIcon } from '../../components/ui/icons';


const navDefs = [
  { label: 'Dashboard',   icon: LayoutDashboard, to: '/owner',              end: true },
  { label: 'Analytics',   icon: TrendingUp,      to: '/owner/analytics' },
  { label: 'AI Reports',  icon: Brain,           to: '/owner/reports' },
  { label: 'Data Upload', icon: Upload,          to: '/owner/data-upload' },
  { label: 'Visitors',       icon: UserCheck, to: '/owner/visitors' },
  { label: 'User Mgmt',      icon: Shield,    to: '/owner/users' },
  { label: 'Issuance Plans', icon: FileText,      to: '/owner/issuance-plans' },
  { label: 'Production Reports', icon: FileSpreadsheet, to: '/owner/production-reports' },
  { label: 'Settings',    icon: Settings,        to: '/owner/settings' },
];

export function OwnerLayout() {
  const { user, logout } = useAuthStore();
  const { unreadCount, fetchNotifications } = useNotificationsStore();
  useLoginNotifications();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 60_000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  const handleLogout = () => { logout(); navigate('/login'); };

  const sidebarLinks: SidebarLinkItem[] = [
    ...navDefs.map(n => ({ to: n.to, label: n.label, icon: <n.icon className="w-5 h-5" />, end: n.end })),
    {
      to: '/owner/notifications',
      label: 'Notifications',
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
      <Sidebar open={open} setOpen={setOpen}>
        <SidebarBody className="justify-between gap-6 h-screen sticky top-0">
          <div className="flex flex-col flex-1 overflow-y-auto overflow-x-hidden">
            <div className="flex items-center gap-3 py-2 mb-6 px-1">
              <div className="w-8 h-8 rounded-lg bg-brand-green flex items-center justify-center flex-shrink-0">
                <FlockIcon className="w-4 h-4" />
              </div>
              <motion.span animate={{ display: open ? 'block' : 'none', opacity: open ? 1 : 0 }}
                className="text-sm font-bold text-gray-800 dark:text-gray-100 whitespace-pre">
                Anza Whole Foods
              </motion.span>
            </div>
            <div className="flex flex-col gap-1">
              {sidebarLinks.map(link => (
                <SidebarLink key={link.to} link={link} accentColor="text-brand-green" accentBg="bg-brand-green/10 dark:bg-brand-green/20" />
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1 border-t border-gray-100 dark:border-dark-border pt-4">
            <SidebarLink link={{ to: '', label: 'Logout', icon: <LogOut className="w-5 h-5" />, onClick: handleLogout }} />
            <div className="flex items-center gap-3 px-1 py-2">
              <div className="w-7 h-7 rounded-full bg-brand-green/20 flex items-center justify-center flex-shrink-0">
                <span className="text-xs font-bold text-brand-green">{user?.fullName?.charAt(0) ?? 'D'}</span>
              </div>
              <motion.div animate={{ display: open ? 'block' : 'none', opacity: open ? 1 : 0 }} className="overflow-hidden min-w-0">
                <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 truncate">{user?.fullName}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500">Director</p>
              </motion.div>
            </div>
          </div>
        </SidebarBody>
      </Sidebar>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="md:hidden flex items-center justify-between px-4 py-3 bg-brand-green text-white sticky top-0 z-10">
          <div className="flex items-center gap-3 min-w-0"><MobileSidebar links={sidebarLinks} user={user ?? undefined} roleLabel={"Director"} onLogout={handleLogout} /><div className="min-w-0">
            <p className="text-xs opacity-75">Director</p>
            <p className="font-semibold text-sm">{user?.fullName}</p>
          </div></div>
          <button onClick={() => navigate('/owner/notifications')} className="relative p-1">
            <Bell className="w-5 h-5" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
        </header>
        <main className="flex-1 overflow-y-auto bg-gray-50 dark:bg-dark-bg">
          <Outlet />
        </main>
      </div>
      <LoginNotificationModal />
    </div>
  );
}
