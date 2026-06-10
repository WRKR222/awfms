// src/pages/attendant/AttendantHome.tsx
//
// Lead Attendant home — task cards driven entirely by server session state,
// mirroring the exact pageMode logic in EggCollectionPage.tsx:
//
//   AM card states:
//     • AM_FORM     → not yet submitted, clickable
//     • AM_PENDING  → submitted, awaiting PM verification
//     • AM_RETURNED → returned for recount, action required (clickable)
//     • AM_APPROVED → verified; PM session is now unlocked
//
//   PM card states:
//     • Blocked     → AM not yet approved (not submitted or still pending)
//     • PM_FORM     → AM approved, PM not yet submitted, clickable
//     • PM_PENDING  → submitted, awaiting PM verification
//     • PM_RETURNED → returned for recount, action required (clickable)
//     • DAY_LOCKED  → both sessions approved, day complete
//
// Session state is the single source of truth — no time-based window logic.
// Returned egg-collection sessions come from todaySessions, not the flock hook.

import { useNavigate } from 'react-router-dom';
import {
  Egg, Clock, AlertCircle, ChevronRight, Sun, Moon,
  CheckCircle, Lock, Flame, RefreshCw,
} from 'lucide-react';
import { useAuthStore } from '../../stores/auth.store';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api/client';
import dayjs from 'dayjs';

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

  // Single source of truth — egg collection sessions for today
  const { data: todaySessions = [] } = useQuery({
    queryKey: ['attendant', 'today-sessions'],
    queryFn: () =>
      api
        .get(`/production/sessions?sessionDate=${dayjs().format('YYYY-MM-DD')}`)
        .then(r => r.data)
        .catch(() => []),
    refetchInterval: 30_000,
  });

  const amSession = (todaySessions as any[]).find((s: any) => s.shift === 'AM');
  const pmSession = (todaySessions as any[]).find((s: any) => s.shift === 'PM');
  const pageMode  = resolvePageMode(amSession, pmSession);

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
    let IconComp = <Sun className="w-7 h-7 text-white" />;
    let statusTag: React.ReactNode = null;
    let subText = 'Egg counts · Feed · Environment · Vaccines';

    if (isApproved) {
      iconBg   = 'bg-green-100 dark:bg-green-900/30';
      IconComp = <CheckCircle className="w-7 h-7 text-green-600" />;
      statusTag = <span className="text-xs font-normal text-green-600 ml-1">· Approved ✓</span>;
      subText = 'Verified by Production Manager';
    } else if (isPending) {
      iconBg   = 'bg-amber-100 dark:bg-amber-900/30';
      IconComp = <Clock className="w-7 h-7 text-amber-500" />;
      statusTag = <span className="text-xs font-normal text-amber-600 ml-1">· Awaiting verification</span>;
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
    const cardVariant = isApproved || isPending
      ? isApproved
        ? 'bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800 cursor-default'
        : 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-700 cursor-default'
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
    // PM is blocked until AM is APPROVED
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

    if (isApproved) {
      iconBg   = 'bg-green-100 dark:bg-green-900/30';
      IconComp = <CheckCircle className="w-7 h-7 text-green-600" />;
      statusTag = <span className="text-xs font-normal text-green-600 ml-1">· Approved ✓</span>;
      subText = 'Verified by Production Manager — day complete';
    } else if (isPending) {
      iconBg   = 'bg-indigo-100 dark:bg-indigo-900/30';
      IconComp = <Clock className="w-7 h-7 text-indigo-500" />;
      statusTag = <span className="text-xs font-normal text-indigo-500 ml-1">· Awaiting verification</span>;
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <AMCard />
          <PMCard />
        </div>
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

      {/* Awaiting-approval banner — egg sessions only */}
      {awaitingApproval > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700
          rounded-2xl p-4 flex items-center gap-3">
          <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-amber-700 dark:text-amber-400 text-sm font-semibold">
              {awaitingApproval} {awaitingApproval === 1 ? 'session' : 'sessions'} pending Production Manager verification
            </p>
            <p className="text-xs text-amber-500 dark:text-amber-500 mt-0.5">
              You'll be notified if any are returned for correction.
            </p>
          </div>
        </div>
      )}

    </div>
  );
}
