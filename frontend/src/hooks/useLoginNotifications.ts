// useLoginNotifications.ts
// Shows a styled modal with unread notifications every time a role logs in.
// The actual UI is rendered by <LoginNotificationModal /> in each layout.
// This hook just triggers the fetch on mount so notifications are ready.
import { useEffect } from 'react';
import { useNotificationsStore } from '../stores/notifications.store';

export function useLoginNotifications() {
  const { fetchNotifications } = useNotificationsStore();

  useEffect(() => {
    // Fetch notifications on mount so LoginNotificationModal can display them
    fetchNotifications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
