// src/pages/shared/NotificationsPage.tsx
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api/client';
import {
  Bell, AlertTriangle, CheckCircle, Clock, Zap, Info, CheckCheck,
} from 'lucide-react';
import dayjs from '../../lib/dayjs';
import { useState } from 'react';

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  readAt?: string;
  createdAt: string;
  entityId?: string;
  entityType?: string;
}

function useNotifications() {
  return useQuery({
    queryKey: ['notifications-all'],
    queryFn: async () => {
      const res = await api.get('/notifications?includeRead=true&limit=100');
      return res.data as Notification[];
    },
    refetchInterval: 60_000,
  });
}

const TYPE_ICONS: Record<string, { icon: any; color: string }> = {
  FEED_LOW_STOCK:        { icon: AlertTriangle, color: 'text-red-500' },
  MORTALITY_ANOMALY:     { icon: AlertTriangle, color: 'text-red-500' },
  OVERDUE_INVOICE:       { icon: AlertTriangle, color: 'text-amber-500' },
  VERIFICATION_PENDING:  { icon: Clock,         color: 'text-amber-500' },
  VACCINATION_DUE:       { icon: Zap,           color: 'text-blue-500' },
  AI_REPORT_READY:       { icon: Zap,           color: 'text-purple-500' },
  ENTRY_RETURNED:        { icon: AlertTriangle, color: 'text-orange-500' },
  EGG_TALLY_TRIGGERED:   { icon: CheckCircle,   color: 'text-teal-500' },
  STOCK_LOCKED_BOOKING:  { icon: Info,          color: 'text-blue-500' },
  BOOKING_CANCELLED:     { icon: AlertTriangle, color: 'text-red-500' },
  SYSTEM:                { icon: Info,          color: 'text-gray-400' },
};

export default function NotificationsPage() {
  const qc = useQueryClient();
  const { data: notifications = [], isLoading } = useNotifications();
  const [showAll, setShowAll] = useState(false);

  const markRead = useMutation({
    mutationFn: (ids: string[]) => api.patch('/notifications/read-all', { ids }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications-all'] }),
  });

  const markAllRead = useMutation({
    mutationFn: () => api.patch('/notifications/read-all'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications-all'] }),
  });

  const unread = notifications.filter(n => !n.isRead);
  const displayed = showAll ? notifications : unread.length > 0 ? notifications : notifications;
  const filtered = showAll ? notifications : unread;

  return (
    <div className="p-4 md:p-8 space-y-4 max-w-3xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell className="w-5 h-5 text-brand-green" />
          <h1 className="text-lg font-bold text-gray-800 dark:text-gray-100">Notifications</h1>
          {unread.length > 0 && (
            <span className="bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
              {unread.length}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          {unread.length > 0 && (
            <button
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
              className="flex items-center gap-1 text-xs text-brand-green font-semibold disabled:opacity-50"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              Mark all read
            </button>
          )}
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-2xl p-1">
        <button
          onClick={() => setShowAll(false)}
          className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-colors ${
            !showAll ? 'bg-white dark:bg-dark-card text-brand-green shadow-sm' : 'text-gray-500'
          }`}
        >
          Unread {unread.length > 0 ? `(${unread.length})` : ''}
        </button>
        <button
          onClick={() => setShowAll(true)}
          className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-colors ${
            showAll ? 'bg-white dark:bg-dark-card text-brand-green shadow-sm' : 'text-gray-500'
          }`}
        >
          All ({notifications.length})
        </button>
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-400 text-center py-10">Loading notifications…</p>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <CheckCircle className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{showAll ? 'No notifications yet' : 'All caught up!'}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(n => {
            const cfg = TYPE_ICONS[n.type] ?? TYPE_ICONS.SYSTEM;
            const Icon = cfg.icon;
            return (
              <button
                key={n.id}
                onClick={() => !n.isRead && markRead.mutate([n.id])}
                className={`w-full text-left rounded-2xl p-4 border transition-colors ${
                  n.isRead
                    ? 'bg-white dark:bg-dark-card border-gray-100 dark:border-dark-border opacity-60'
                    : 'bg-white dark:bg-dark-card border-gray-200 dark:border-dark-border shadow-sm'
                }`}
              >
                <div className="flex items-start gap-3">
                  {!n.isRead && (
                    <div className="w-2 h-2 rounded-full bg-brand-green mt-1.5 flex-shrink-0" />
                  )}
                  <Icon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${cfg.color} ${n.isRead ? 'opacity-50' : ''}`} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold ${n.isRead ? 'text-gray-500 dark:text-gray-400' : 'text-gray-800 dark:text-gray-200'}`}>
                      {n.title}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{n.message}</p>
                    <p className="text-xs text-gray-300 dark:text-gray-600 mt-1">{dayjs(n.createdAt).fromNow()}</p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
