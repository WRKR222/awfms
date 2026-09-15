// src/pages/attendant/AttendantHome.tsx
//
// Lead Attendant home — task cards driven entirely by server session state,
// mirroring the exact pageMode logic in EggCollectionPage.tsx.
//
// Session states now visually differentiate three distinct phases:
//   1. "Awaiting PM verification" — session is PENDING
//   2. "Awaiting next-morning 3-party tally" — session is APPROVED but tally not yet locked
//   3. "Tally complete" — session is APPROVED and tally is locked (DAY_LOCKED)

import { useNavigate } from 'react-router-dom';
import {
  Egg, Clock, AlertCircle, ChevronRight, Sun, Moon,
  CheckCircle, Lock, Flame, RefreshCw, ClipboardCheck, WifiOff,
} from 'lucide-react';
import { useAuthStore } from '../../stores/auth.store';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api/client';
import dayjs from '../../lib/dayjs';
import { useTodayEggSessions } from '../../hooks/useEggSessions';
import { useAttendantRealtime } from '../../hooks/useRealtime';

// ── Mirrors resolvePageMode in EggCollectionPage exactly ──────────────────────
type PageMode =
  | 'AM_FORM' | 'AM_PENDING' | 'AM_RETURNED'
  | 'PM_FORM' | 'PM_PENDING' | 'PM_RETURNED'
  | 'DAY_LOCKED';

function resolvePageMode(amSession: any, pmSession: any): PageMode {
  if (!amSession || amSession.status === 'RETURNED') {
    return amSession?.status === 'RETURNED' ? 'AM_RETURNED' : 'AM_FORM';
  }
  if (amSession.status === 'PENDING') return 'AM_PENDING';
  if (amSession.status === 'APPROVED') {
    if (!pmSession || pmSession.status === 'RETURNED') {
      return pmSession?.status === 'RETURNED' ? 'PM_RETURNED' : 'PM_FORM';
    }
    if (pmSession.status === 'PENDING') return 'PM_PENDING';
    if (pmSession.status === 'APPROVED') return 'DAY_LOCKED';
  }
  return 'AM_FORM';
}

export function AttendantHome() {
  const navigate = useNavigate();
  const { user } = useAuthStore();

  // Single source of truth — egg collection sessions for today. Shared with
  // EggCollectionPage via the same hook/cache key (see useEggSessions.ts) so
  // a PM approving/returning a session while the attendant is on either
  // screen is reflected on both, instead of this page's own copy going
  // stale for up to its old (uncapped) default staleTime.
  const {
    data: todaySessions = [], isLoading: sessionsLoading,
    isError: sessionsError, refetch: refetchSessions,
  } = useTodayEggSessions();
  useAttendantRealtime();

  const amSession = (todaySessions as any[]).find((s: any) => s.shift === 'AM');
  const pmSession = (todaySessions as any[]).find((s: any) => s.shift === 'PM');
  const pageMode  = resolvePageMode(amSession, pmSession);

  // Fetch pending tallies so we can show "awaiting next-morning tally" vs
  // "awaiting PM verification" as distinct states on the dashboard cards.
  // Secondary/derived — no dedicated error UI: a failure just means the
  // purple "awaiting tally" distinction doesn't show for one 60s poll
  // cycle, not a wrong core state (unlike todaySessions above).
  const { data: pendingTallies = [] } = useQuery({
    queryKey: ['attendant', 'pending-tallies'],
    queryFn: () =>
      api.get('/tally-verifications/pending').then(r => r.data),
    refetchInterval: 60_000,
  });
  const tallySessionIds = new Set(
    (pendingTallies as any[]).map((t: any) => t.sessionId),
  );
  // A session is "awaiting tally" when it's APPROVED but the morning sign-off
  // tally is still pending (not yet locked by all 3 parties).
  const amAwaitingTally = amSession?.status === 'APPROVED' && tallySessionIds.has(amSession.id);
  const pmAwaitingTally = pmSession?.status === 'APPROVED' && tallySessionIds.has(pmSession.id);

  // Returned sessions — sourced from todaySessions, not the flock hook
  const returnedSessions = (todaySessions as any[]).filter(
    (s: any) => s.status === 'RETURNED',
  );

  // Awaiting-approval count from egg sessions only
  const awaitingApproval = (todaySessions as any[]).filter(
    (s: any) => s.status === 'PENDING',
  ).length;

  const hour = dayjs().hour();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = user?.fullName?.split(' ')[0] ?? '';

  // ── AM card ───────────────────────────────────────────────────────────────
  function AMCard() {
    const isReturned = pageMode === 'AM_RETURNED';
    const isPending  = pageMode === 'AM_PENDING';
    const isApproved = ['PM_FORM', 'PM_PENDING', 'PM_RETURNED', 'DAY_LOCKED'].includes(pageMode);
    const isClickable = pageMode === 'AM_FORM' || isReturned;

    let iconBg   = 'bg-amber-500';
    let IconComp: React.ReactNode = <Sun className="w-7 h-7 text-white" />;
    let statusTag: React.ReactNode = null;
    let subText = 'Egg counts · Feed · Environment · Vaccines';

    if (isApproved && amAwaitingTally) {
      // PM verified — now sitting in next-morning tally queue
      iconBg   = 'bg-purple-100 dark:bg-purple-900/30';
      IconComp = <ClipboardCheck className="w-7 h-7 text-purple-600" />;
      statusTag = <span className="text-xs font-normal text-purple-600 ml-1">· Awaiting morning tally</span>;
      subText = 'PM-verified ✓ — awaiting next-morning 3-party sign-off';
    } else if (isApproved) {
      iconBg   = 'bg-green-100 dark:bg-green-900/30';
      IconComp = <CheckCircle className="w-7 h-7 text-green-600" />;
      statusTag = <span className="text-xs font-normal text-green-600 ml-1">· Approved ✓</span>;
      subText = 'Verified by Production Manager — tally complete';
    } else if (isPending) {
      iconBg   = 'bg-amber-100 dark:bg-amber-900/30';
      IconComp = <Clock className="w-7 h-7 text-amber-500" />;
      statusTag = <span className="text-xs font-normal text-amber-600 ml-1">· Awaiting PM verification</span>;
      subText = 'Submitted — awaiting Production Manager verification';
    } else if (isReturned) {
      iconBg   = 'bg-red-100 dark:bg-red-900/30';
      IconComp = <RefreshCw className="w-7 h-7 text-red-500" />;
      statusTag = <span className="text-xs font-normal text-red-500 ml-1">· Recount required</span>;
      subText = amSession?.returnReason
        ? `Returned: ${amSession.returnReason}`
        : 'Returned for correction — tap to resubmit';
    }

    const cardBase = `w-full rounded-2xl p-5 shadow-sm border flex items-center gap-4 text-left transition-all`;
    const cardVariant =
      isApproved && amAwaitingTally
        ? 'bg-purple-50 dark:bg-purple-900/10 border-purple-200 dark:border-purple-700 cursor-default'
        : isApproved
          ? 'bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800 cursor-default'
          : isPending
            ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-700 cursor-default'
            : isReturned
              ? 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-700 hover:shadow-md active:scale-[0.98] cursor-pointer group'
              : 'bg-white dark:bg-dark-card border-gray-100 dark:border-dark-border hover:shadow-md active:scale-[0.98] cursor-pointer group';

    return (
      <button
        onClick={() => isClickable && navigate('egg-collection')}
        disabled={!isClickable}
        className={`${cardBase} ${cardVariant}`}
      >
        <div className={`w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0 ${iconBg}`}>
          {IconComp}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-gray-800 dark:text-gray-100 text-base">
            AM Egg Collection
            {statusTag}
          </p>
          <p className={`text-sm mt-0.5 ${
            isReturned ? 'text-red-500 dark:text-red-400'
            : isPending ? 'text-amber-600 dark:text-amber-400'
            : (isApproved && amAwaitingTally) ? 'text-purple-600 dark:text-purple-400'
            : 'text-gray-500 dark:text-gray-400'
          }`}>
            {subText}
          </p>
        </div>
        {isClickable && (
          <ChevronRight className="w-5 h-5 text-gray-300 dark:text-gray-600 flex-shrink-0 group-hover:text-gray-500 group-hover:translate-x-0.5 transition-all" />
        )}
      </button>
    );
  }

  // ── PM card ───────────────────────────────────────────────────────────────
  function PMCard() {
    const amApproved = amSession?.status === 'APPROVED';

    const isBlocked  = !amApproved;
    const isReturned = pageMode === 'PM_RETURNED';
    const isPending  = pageMode === 'PM_PENDING';
    const isApproved = pageMode === 'DAY_LOCKED';
    const isClickable = (pageMode === 'PM_FORM' || isReturned) && amApproved;

    let iconBg   = isBlocked ? 'bg-gray-200 dark:bg-dark-bg' : 'bg-indigo-600';
    let IconComp: React.ReactNode = isBlocked
      ? <Lock className="w-7 h-7 text-gray-400" />
      : <Moon className="w-7 h-7 text-white" />;
    let statusTag: React.ReactNode = null;
    let subText = isBlocked
      ? 'Available once AM session is approved'
      : 'Egg counts · Feed · Environment · Vaccines';

    if (isApproved && pmAwaitingTally) {
      iconBg   = 'bg-purple-100 dark:bg-purple-900/30';
      IconComp = <ClipboardCheck className="w-7 h-7 text-purple-600" />;
      statusTag = <span className="text-xs font-normal text-purple-600 ml-1">· Awaiting morning tally</span>;
      subText = 'PM-verified ✓ — awaiting next-morning 3-party sign-off';
    } else if (isApproved) {
      iconBg   = 'bg-green-100 dark:bg-green-900/30';
      IconComp = <CheckCircle className="w-7 h-7 text-green-600" />;
      statusTag = <span className="text-xs font-normal text-green-600 ml-1">· Approved ✓</span>;
      subText = 'Verified by Production Manager — day complete';
    } else if (isPending) {
      iconBg   = 'bg-indigo-100 dark:bg-indigo-900/30';
      IconComp = <Clock className="w-7 h-7 text-indigo-500" />;
      statusTag = <span className="text-xs font-normal text-indigo-500 ml-1">· Awaiting PM verification</span>;
      subText = 'Submitted — awaiting Production Manager verification';
    } else if (isReturned) {
      iconBg   = 'bg-red-100 dark:bg-red-900/30';
      IconComp = <RefreshCw className="w-7 h-7 text-red-500" />;
      statusTag = <span className="text-xs font-normal text-red-500 ml-1">· Recount required</span>;
      subText = pmSession?.returnReason
        ? `Returned: ${pmSession.returnReason}`
        : 'Returned for correction — tap to resubmit';
    }

    const cardBase = `w-full rounded-2xl p-5 shadow-sm border flex items-center gap-4 text-left transition-all`;
    const cardVariant = isBlocked
      ? 'bg-gray-50 dark:bg-dark-bg/60 border-gray-200 dark:border-dark-border opacity-60 cursor-not-allowed'
      : (isApproved && pmAwaitingTally)
        ? 'bg-purple-50 dark:bg-purple-900/10 border-purple-200 dark:border-purple-700 cursor-default'
        : isApproved
          ? 'bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800 cursor-default'
          : isPending
            ? 'bg-indigo-50 dark:bg-indigo-900/10 border-indigo-200 dark:border-indigo-700 cursor-default'
            : isReturned
              ? 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-700 hover:shadow-md active:scale-[0.98] cursor-pointer group'
              : 'bg-white dark:bg-dark-card border-gray-100 dark:border-dark-border hover:shadow-md active:scale-[0.98] cursor-pointer group';

    return (
      <button
        onClick={() => isClickable && navigate('egg-collection')}
        disabled={!isClickable}
        className={`${cardBase} ${cardVariant}`}
      >
        <div className={`w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0 ${iconBg}`}>
          {IconComp}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-gray-800 dark:text-gray-100 text-base">
            PM Egg Collection
            {statusTag}
          </p>
          <p className={`text-sm mt-0.5 ${
            isReturned ? 'text-red-500 dark:text-red-400'
            : isPending ? 'text-indigo-500 dark:text-indigo-400'
            : (isApproved && pmAwaitingTally) ? 'text-purple-600 dark:text-purple-400'
            : isBlocked ? 'text-gray-400 dark:text-gray-500'
            : 'text-gray-500 dark:text-gray-400'
          }`}>
            {subText}
          </p>
        </div>
        {isClickable && (
          <ChevronRight className="w-5 h-5 text-gray-300 dark:text-gray-600 flex-shrink-0 group-hover:text-gray-500 group-hover:translate-x-0.5 transition-all" />
        )}
      </button>
    );
  }

  return (
    <div className="p-4 md:p-8 space-y-5 max-w-5xl mx-auto">

      {/* Greeting */}
      <div className="bg-brand-green text-white rounded-2xl p-4 md:p-6">
        <p className="text-sm opacity-75">TODAY · {dayjs().format('dddd, D MMMM YYYY').toUpperCase()}</p>
        <p className="text-xl md:text-2xl font-bold mt-1">{greeting}, {firstName}! 👋</p>
        <p className="text-sm opacity-75 mt-0.5">Submit your AM and PM egg-collection sessions below.</p>
      </div>

      {/* Returned-session alerts — sourced from today's egg sessions */}
      {returnedSessions.length > 0 && (
        <div className="bg-red-50 dark:bg-red-900/20 border-2 border-red-300 dark:border-red-700 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
            <p className="font-bold text-red-700 dark:text-red-400">
              {returnedSessions.length} {returnedSessions.length === 1 ? 'Session' : 'Sessions'} Returned — Recount Required
            </p>
          </div>
          <p className="text-xs text-red-500 dark:text-red-500 mb-3">
            The Production Manager has returned the following sessions for correction. Tap the card below to resubmit.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {returnedSessions.map((s: any) => (
              <div key={s.id} className="bg-white dark:bg-dark-card rounded-xl p-3 border border-red-100 dark:border-red-800">
                <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                  {dayjs(s.sessionDate).format('D MMM')} · {s.shift} session · {s.batch?.batchCode ?? '—'}
                </p>
                <p className="text-sm text-red-600 dark:text-red-400 mt-1 font-medium">
                  {s.returnReason}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Today's tasks */}
      <div>
        <p className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-3">
          Today's Tasks
        </p>
        {sessionsLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[1, 2].map(i => (
              <div key={i} className="h-24 rounded-2xl bg-gray-100 dark:bg-dark-card animate-pulse" />
            ))}
          </div>
        ) : sessionsError ? (
          // Don't guess: showing the cards below as if nothing were
          // submitted yet (the old .catch(() => []) behavior) could tell an
          // attendant who already submitted today's session that they
          // hadn't — worse than just saying the load failed.
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-2xl p-5 flex items-center gap-4">
            <WifiOff className="w-8 h-8 text-red-500 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-red-700 dark:text-red-400">
                Couldn't load today's sessions
              </p>
              <p className="text-xs text-red-500 dark:text-red-500 mt-0.5">
                This is a connection or server problem, not lost data — your submissions are safe. Tap retry.
              </p>
            </div>
            <button
              onClick={() => refetchSessions()}
              className="flex-shrink-0 bg-red-600 text-white text-xs font-semibold px-3 py-2 rounded-xl"
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <AMCard />
            <PMCard />
          </div>
        )}
        <p className="text-[11px] text-gray-400 mt-3 leading-relaxed">
          Each session bundles egg collection, session feed consumption, environmental data
          and any vaccines/supplements given — they are submitted together and locked once verified.
          PM session unlocks only after AM is approved by the Production Manager.
        </p>
      </div>

      {/* Brooder Management task */}
      <div>
        <button onClick={() => navigate('brooder')} className="w-full bg-white dark:bg-dark-card rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-dark-border flex items-center gap-4 text-left hover:shadow-md active:scale-[0.98] transition-all group">
          <div className="w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0 bg-orange-500 group-hover:scale-105 transition-transform">
            <Flame className="w-7 h-7 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-gray-800 dark:text-gray-100 text-base">Brooder Management</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Log temperature · Feed · Water · Health</p>
          </div>
          <ChevronRight className="w-5 h-5 text-gray-300 dark:text-gray-600 flex-shrink-0 group-hover:text-gray-500 group-hover:translate-x-0.5 transition-all" />
        </button>
      </div>

      {/* Awaiting PM verification banner */}
      {awaitingApproval > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700
          rounded-2xl p-4 flex items-center gap-3">
          <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-amber-700 dark:text-amber-400 text-sm font-semibold">
              {awaitingApproval} {awaitingApproval === 1 ? 'session' : 'sessions'} awaiting Production Manager verification
            </p>
            <p className="text-xs text-amber-500 dark:text-amber-500 mt-0.5">
              You'll be notified if any are returned for correction.
            </p>
          </div>
        </div>
      )}

      {/* Awaiting morning tally banner — shown when at least one session is in the tally queue */}
      {(amAwaitingTally || pmAwaitingTally) && (
        <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-700
          rounded-2xl p-4 flex items-center gap-3">
          <ClipboardCheck className="w-5 h-5 text-purple-600 dark:text-purple-400 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-purple-700 dark:text-purple-400 text-sm font-semibold">
              Next-morning 3-party tally in progress
            </p>
            <p className="text-xs text-purple-500 dark:text-purple-400 mt-0.5">
              PM-verified session(s) are awaiting sign-off by Production Manager, Sales and Store.
            </p>
          </div>
        </div>
      )}

    </div>
  );
}
