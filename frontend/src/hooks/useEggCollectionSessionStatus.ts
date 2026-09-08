// src/hooks/useEggCollectionSessionStatus.ts
//
// AM egg collection locks at 12:00pm, PM locks at 4:30pm (farm-local time) —
// mirrors useBrooderSessionStatus for the brooder 3-popup log. Which shift
// is open right now is decided by the SERVER, never the viewer's own device
// clock/timezone, so this polls GET /production/sessions/window-status.
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api/client';

export type EggCollectionShift = 'AM' | 'PM';

export interface EggCollectionShiftInfo {
  shift: EggCollectionShift;
  label: string;
  opensLabel: string;
  closesLabel: string;
  open: boolean;
}

export interface EggCollectionSessionStatus {
  farmTime: string;
  farmDate: string;
  shifts: EggCollectionShiftInfo[];
}

export function useEggCollectionSessionStatus() {
  return useQuery<EggCollectionSessionStatus>({
    queryKey: ['egg-collection-session-status'],
    queryFn: async () => (await api.get('/production/sessions/window-status')).data,
    // Cutoffs are clock-based — refresh often enough that the form locks
    // itself without the attendant needing to reload the page.
    refetchInterval: 30_000,
  });
}
