/**
 * OfflineBanner — shown to Attendants when device is offline or has pending entries
 *
 * Displays:
 * - Gray "No connection" banner when offline
 * - Amber "N entries pending sync" when back online but queue not cleared
 * - Spinner "Syncing…" while replay is in progress
 * - Green "All synced" flash briefly after successful sync
 * - Red "N entries failed to sync" with retry button if any entries failed
 *
 * NOTE: This component does NOT mount its own sync runner.
 * The single sync runner lives in App.tsx via useOfflineSyncRunner().
 * OfflineBanner only reads state and exposes the manual runSync trigger.
 */

import React, { useState, useEffect } from 'react';
import { WifiOff, RefreshCw, CheckCircle, AlertTriangle, Loader2 } from 'lucide-react';
import { useOfflineStatus } from '../../hooks/useOfflineSync';
import { useOfflineStore } from '../../stores/offline.store';

export function OfflineBanner() {
  const { isOnline, pendingCount, syncingCount, failedCount, showBanner } = useOfflineStatus();
  const _pendingEntries = useOfflineStore(s => s.pendingEntries);
  const [showSuccess, setShowSuccess] = useState(false);

  const prevPending = usePrevious(pendingCount + syncingCount);
  useEffect(() => {
    if ((prevPending ?? 0) > 0 && pendingCount === 0 && syncingCount === 0 && isOnline) {
      setShowSuccess(true);
      const t = setTimeout(() => setShowSuccess(false), 3000);
      return () => clearTimeout(t);
    }
  }, [pendingCount, syncingCount, isOnline, prevPending]);

  const requestSync = () => {
    window.dispatchEvent(new CustomEvent('awfms:request-sync'));
  };

  if (!showBanner && !showSuccess) return null;

  if (showSuccess) {
    return (
      <div className="fixed top-0 inset-x-0 z-50 flex items-center justify-center gap-2 bg-green-600 text-white text-sm py-2 px-4">
        <CheckCircle className="w-4 h-4 shrink-0" />
        <span>All entries synced successfully</span>
      </div>
    );
  }

  if (syncingCount > 0) {
    return (
      <div className="fixed top-0 inset-x-0 z-50 flex items-center justify-center gap-2 bg-blue-600 text-white text-sm py-2 px-4">
        <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
        <span>Syncing {syncingCount} entr{syncingCount === 1 ? 'y' : 'ies'}…</span>
      </div>
    );
  }

  if (failedCount > 0 && isOnline) {
    return (
      <div className="fixed top-0 inset-x-0 z-50 flex items-center justify-between gap-2 bg-red-600 text-white text-sm py-2 px-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{failedCount} entr{failedCount === 1 ? 'y' : 'ies'} failed to sync</span>
        </div>
        <button
          onClick={requestSync}
          className="flex items-center gap-1 bg-white/20 hover:bg-white/30 px-3 py-1 rounded-lg text-xs transition-colors"
        >
          <RefreshCw className="w-3 h-3" /> Retry
        </button>
      </div>
    );
  }

  if (!isOnline) {
    return (
      <div className="fixed top-0 inset-x-0 z-50 flex items-center justify-between gap-2 bg-gray-800 text-white text-sm py-2 px-4">
        <div className="flex items-center gap-2">
          <WifiOff className="w-4 h-4 shrink-0" />
          <span>
            No connection{pendingCount > 0 ? ` — ${pendingCount} entr${pendingCount === 1 ? 'y' : 'ies'} saved offline` : ' — entries will be saved locally'}
          </span>
        </div>
        {pendingCount > 0 && (
          <span className="bg-amber-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
            {pendingCount}
          </span>
        )}
      </div>
    );
  }

  if (pendingCount > 0) {
    return (
      <div className="fixed top-0 inset-x-0 z-50 flex items-center justify-between gap-2 bg-amber-500 text-white text-sm py-2 px-4">
        <div className="flex items-center gap-2">
          <RefreshCw className="w-4 h-4 shrink-0" />
          <span>{pendingCount} entr{pendingCount === 1 ? 'y' : 'ies'} pending sync</span>
        </div>
        <button
          onClick={requestSync}
          className="bg-white/20 hover:bg-white/30 px-3 py-1 rounded-lg text-xs transition-colors"
        >
          Sync now
        </button>
      </div>
    );
  }

  return null;
}

function usePrevious<T>(value: T): T | undefined {
  const [prev, setPrev] = useState<T | undefined>(undefined);
  useEffect(() => { setPrev(value); }, [value]);
  return prev;
}
