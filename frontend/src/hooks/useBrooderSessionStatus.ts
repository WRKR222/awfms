// src/hooks/useBrooderSessionStatus.ts
//
// The attendant brooder daily log is 3 time-gated popups — Morning (≤9am),
// 11am check-in (≤1pm), 3pm check-in (≤5pm). Which one is open right now is
// decided by the SERVER (farm-local time), never the viewer's own device
// clock/timezone, so this hook polls GET /flock/brooder-session-status
// instead of computing it in the browser.
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api/client';

export type BrooderSessionKey = 'MORNING' | 'MIDDAY' | 'EVENING';

export interface BrooderSessionInfo {
  key: BrooderSessionKey;
  label: string;
  opensLabel: string;
  closesLabel: string;
  open: boolean;
}

export interface BrooderSessionStatus {
  farmTime: string;
  farmDate: string;
  sessions: BrooderSessionInfo[];
}

export function useBrooderSessionStatus() {
  return useQuery<BrooderSessionStatus>({
    queryKey: ['brooder-session-status'],
    queryFn: async () => (await api.get('/flock/brooder-session-status')).data,
    // Popups open/close on the minute — refresh often enough that a button
    // unlocks/locks without the attendant needing to refresh the page.
    refetchInterval: 30_000,
  });
}
