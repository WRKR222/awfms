// src/components/shared/LoginNotificationModal.tsx
// Beautiful notification alert modal shown on login with unread notifications
import { useState, useEffect } from 'react';
import { Bell, X, CheckCheck, AlertTriangle, Clock, Zap, Info, CheckCircle } from 'lucide-react';
import { useNotificationsStore } from '../../stores/notifications.store';

const TYPE_ICONS: Record<string, { icon: any; color: string; bg: string }> = {
  FEED_LOW_STOCK:        { icon: AlertTriangle, color: 'text-red-500',    bg: 'bg-red-50 dark:bg-red-900/20' },
  MORTALITY_ANOMALY:     { icon: AlertTriangle, color: 'text-red-500',    bg: 'bg-red-50 dark:bg-red-900/20' },
  OVERDUE_INVOICE:       { icon: AlertTriangle, color: 'text-amber-500',  bg: 'bg-amber-50 dark:bg-amber-900/20' },
  VERIFICATION_PENDING:  { icon: Clock,         color: 'text-amber-500',  bg: 'bg-amber-50 dark:bg-amber-900/20' },
  VACCINATION_DUE:       { icon: Zap,           color: 'text-blue-500',   bg: 'bg-blue-50 dark:bg-blue-900/20' },
  AI_REPORT_READY:       { icon: Zap,           color: 'text-purple-500', bg: 'bg-purple-50 dark:bg-purple-900/20' },
  ENTRY_RETURNED:        { icon: AlertTriangle, color: 'text-orange-500', bg: 'bg-orange-50 dark:bg-orange-900/20' },
  EGG_TALLY_TRIGGERED:   { icon: CheckCircle,   color: 'text-teal-500',   bg: 'bg-teal-50 dark:bg-teal-900/20' },
  BROODER_LOG_MISSED:    { icon: AlertTriangle, color: 'text-red-500',    bg: 'bg-red-50 dark:bg-red-900/20' },
  STOCK_LOCKED_BOOKING:  { icon: Info,          color: 'text-blue-500',   bg: 'bg-blue-50 dark:bg-blue-900/20' },
  BOOKING_CANCELLED:     { icon: AlertTriangle, color: 'text-red-500',    bg: 'bg-red-50 dark:bg-red-900/20' },
  SYSTEM:                { icon: Info,          color: 'text-gray-400',   bg: 'bg-gray-50 dark:bg-gray-900/20' },
};

function getIcon(type: string) {
  return TYPE_ICONS[type] ?? TYPE_ICONS.SYSTEM;
}

export function LoginNotificationModal() {
  const { notifications, fetchNotifications, markAllRead } = useNotificationsStore();
  const [visible, setVisible] = useState(false);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (shown) return;
    fetchNotifications().then(() => {
      if (shown) return;
      setShown(true);
      const unread = useNotificationsStore.getState().notifications.filter(n => !n.isRead);
      if (unread.length > 0) {
        setTimeout(() => setVisible(true), 800);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const unread = notifications.filter(n => !n.isRead);

  if (!visible || unread.length === 0) return null;

  const handleMarkAllRead = () => {
    markAllRead();
    setVisible(false);
  };

  const handleClose = () => {
    setVisible(false);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] flex items-end md:items-center justify-center p-0 md:p-4">
      <div className="bg-white dark:bg-dark-card w-full md:max-w-md rounded-t-3xl md:rounded-2xl shadow-2xl overflow-hidden bottom-sheet">
        
        {/* Header */}
        <div className="bg-brand-green px-5 pt-5 pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                <Bell className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="font-bold text-white text-base">
                  {unread.length} Unread {unread.length === 1 ? 'Notification' : 'Notifications'}
                </p>
                <p className="text-xs text-white/75">Review before continuing</p>
              </div>
            </div>
            <button
              onClick={handleClose}
              className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center hover:bg-white/30 transition-colors"
            >
              <X className="w-4 h-4 text-white" />
            </button>
          </div>
        </div>

        {/* Notification list */}
        <div className="overflow-y-auto max-h-[50vh] md:max-h-[55vh] p-4 space-y-2">
          {unread.slice(0, 15).map(n => {
            const cfg = getIcon(n.type);
            const Icon = cfg.icon;
            return (
              <div key={n.id} className={`rounded-xl p-3 ${cfg.bg} flex items-start gap-3`}>
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-white/60 dark:bg-black/20`}>
                  <Icon className={`w-4 h-4 ${cfg.color}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 leading-snug">{n.title}</p>
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5 leading-relaxed">{n.message}</p>
                </div>
              </div>
            );
          })}
          {unread.length > 15 && (
            <p className="text-center text-xs text-gray-400 dark:text-gray-500 py-2">
              ...and {unread.length - 15} more notifications
            </p>
          )}
        </div>

        {/* Footer actions */}
        <div className="p-4 border-t border-gray-100 dark:border-dark-border flex gap-3">
          <button
            onClick={handleClose}
            className="flex-1 border border-gray-200 dark:border-dark-border text-gray-600 dark:text-gray-400 rounded-xl py-3 text-sm font-semibold hover:bg-gray-50 dark:hover:bg-dark-bg transition-colors"
          >
            Review Later
          </button>
          <button
            onClick={handleMarkAllRead}
            className="flex-1 bg-brand-green text-white rounded-xl py-3 text-sm font-semibold hover:bg-green-800 transition-colors flex items-center justify-center gap-2"
          >
            <CheckCheck className="w-4 h-4" />
            Mark All as Read
          </button>
        </div>
      </div>
    </div>
  );
}
