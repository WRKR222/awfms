// src/hooks/useEggSessions.ts
//
// Shared "today's egg-collection sessions" query for the attendant screens.
//
// FIX (account-restricted / needs-hard-refresh bug): EggCollectionPage.tsx
// and AttendantHome.tsx used to each define their own copy of this query
// under DIFFERENT cache keys (['egg-sessions-today', today] vs.
// ['attendant', 'today-sessions']) with different staleness settings —
// EggCollectionPage used staleTime: 0, AttendantHome had no override and so
// inherited the app's global 2-minute default. A PM approving/returning a
// session while the attendant was on Home could leave that page showing a
// stale, locked-looking session for up to 2 minutes, with no way to tell it
// apart from a genuinely restricted/locked day short of a hard refresh
// (which tears down the whole query cache and forces an immediate fetch).
// Both screens now share this single hook/cache entry, so whichever page is
// fresher is what both read, and the tight staleTime:0 + 30s poll applies
// everywhere instead of only on one of the two pages.
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api/client';
import dayjs from '../lib/dayjs';

export function todayEggSessionsKey(date: string = dayjs().format('YYYY-MM-DD')) {
  return ['egg-sessions-today', date] as const;
}

export function useTodayEggSessions() {
  // Include today's date in the query key so a new calendar day always gets
  // a fresh fetch instead of reading stale data from the previous day's cache.
  const today = dayjs().format('YYYY-MM-DD');
  return useQuery({
    queryKey: todayEggSessionsKey(today),
    queryFn: () =>
      api.get(`/production/sessions?sessionDate=${today}`).then(r => r.data).catch(() => []),
    refetchInterval: 30_000,
    staleTime: 0,
  });
}
