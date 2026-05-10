import { create } from 'zustand';
import { api } from '../lib/api';

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  entityId?: string;
  entityType?: string;
  isRead: boolean;
  createdAt: string;
}

interface NotificationsState {
  notifications: AppNotification[];
  unreadCount: number;
  fetchNotifications: () => Promise<void>;
  markRead: (ids: string[]) => Promise<void>;
  markAllRead: () => Promise<void>;
}

export const useNotificationsStore = create<NotificationsState>((set, get) => ({
  notifications: [],
  unreadCount: 0,
  fetchNotifications: async () => {
    try {
      const res = await api.get('/notifications');
      const notifications = res.data;
      set({ notifications, unreadCount: notifications.filter((n: any) => !n.isRead).length });
    } catch {}
  },
  markRead: async (ids: string[]) => {
    if (ids.length === 0) return;
    await Promise.all(ids.map(id => api.patch(`/notifications/${id}/read`).catch(() => {})));
    await get().fetchNotifications();
  },
  markAllRead: async () => {
    await api.patch('/notifications/read-all');
    set(state => ({
      notifications: state.notifications.map(n => ({ ...n, isRead: true })),
      unreadCount: 0,
    }));
  },
}));
