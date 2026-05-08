import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type SyncStatus = 'pending' | 'syncing' | 'synced' | 'failed';

export interface OfflineEntry {
  id: string; // Local UUID
  type: 'flock' | 'feed' | 'production' | 'weight' | 'temperature';
  payload: Record<string, unknown>;
  submittedAt: string;
  status: SyncStatus;
  error?: string;
  retryCount: number;
}

interface OfflineState {
  isOnline: boolean;
  pendingEntries: OfflineEntry[];
  lastSyncAt: string | null;

  // Actions
  setOnline: (online: boolean) => void;
  addPendingEntry: (entry: Omit<OfflineEntry, 'status' | 'retryCount'>) => void;
  updateEntryStatus: (id: string, status: SyncStatus, error?: string) => void;
  removeSyncedEntries: () => void;
  getPendingCount: () => number;
}

export const useOfflineStore = create<OfflineState>()(
  persist(
    (set, get) => ({
      isOnline: navigator.onLine,
      pendingEntries: [],
      lastSyncAt: null,

      setOnline: (isOnline) => set({ isOnline }),

      addPendingEntry: (entry) =>
        set((state) => ({
          pendingEntries: [
            ...state.pendingEntries,
            { ...entry, status: 'pending', retryCount: 0 },
          ],
        })),

      updateEntryStatus: (id, status, error) =>
        set((state) => ({
          pendingEntries: state.pendingEntries.map((e) =>
            e.id === id
              ? { ...e, status, error, retryCount: e.retryCount + (status === 'failed' ? 1 : 0) }
              : e,
          ),
          lastSyncAt: status === 'synced' ? new Date().toISOString() : state.lastSyncAt,
        })),

      removeSyncedEntries: () =>
        set((state) => ({
          pendingEntries: state.pendingEntries.filter((e) => e.status !== 'synced'),
        })),

      getPendingCount: () => {
        return get().pendingEntries.filter((e) => e.status === 'pending').length;
      },
    }),
    {
      name: 'awfms-offline',
      partialize: (state) => ({
        // Only persist the unsynced entries — these are the ones that need recovery
        pendingEntries: state.pendingEntries.filter((e) => e.status !== 'synced'),
      }),
    },
  ),
);
