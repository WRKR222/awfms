// src/pages/attendant/AttendantHome.tsx
//
// Lead Attendant home — cleaned per changes.pdf:
// All daily tasks now live in the single Egg Collection page (egg counts,
// feed consumption, environmental data, vaccines/supplements). The Flock
// and Feed pages have been removed. The home shows today's outstanding
// AM/PM submissions and any returned-for-correction entries.
import { useNavigate } from 'react-router-dom';
import { Egg, Clock, AlertCircle, ChevronRight, Sun, Moon, CheckCircle } from 'lucide-react';
import { usePendingEntries } from '../../hooks/useFlock';
import { useAuthStore } from '../../stores/auth.store';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api/client';
import dayjs from 'dayjs';

export function AttendantHome() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { data: pending = [] } = usePendingEntries();

  // Today's egg collection sessions (AM / PM) for this attendant.
  const { data: todaySessions = [] } = useQuery({
    queryKey: ['attendant', 'today-sessions'],
    queryFn: () =>
      api
        .get(`/production/sessions?sessionDate=${dayjs().format('YYYY-MM-DD')}`)
        .then(r => r.data)
        .catch(() => []),
    refetchInterval: 60_000,
  });

  const amDone = todaySessions.some((s: any) => s.shift === 'AM');
  const pmDone = todaySessions.some((s: any) => s.shift === 'PM');

  const myEntries = pending.filter((e: any) => e.submittedById === user?.id);
  const returned = myEntries.filter((e: any) => e.status === 'RETURNED');
  const awaitingApproval = myEntries.filter((e: any) => e.status === 'PENDING').length;

  const hour = dayjs().hour();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = user?.fullName?.split(' ')[0] ?? '';

  const sessionTask = (kind: 'AM' | 'PM') => {
    const done = kind === 'AM' ? amDone : pmDone;
    const Icon = kind === 'AM' ? Sun : Moon;
    return (
      <button
        key={kind}
        onClick={() => navigate('egg-collection')}
        className="w-full bg-white dark:bg-dark-card rounded-2xl p-5 shadow-sm
          border border-gray-100 dark:border-dark-border
          flex items-center gap-4 text-left hover:shadow-md active:scale-[0.98]
          transition-all group"
      >
        <div className={`w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0
          group-hover:scale-105 transition-transform ${done ? 'bg-gray-200 dark:bg-dark-bg' : kind === 'AM' ? 'bg-amber-500' : 'bg-indigo-600'}`}>
          {done
            ? <CheckCircle className="w-7 h-7 text-green-600" />
            : <Icon className="w-7 h-7 text-white" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-gray-800 dark:text-gray-100 text-base">
            {kind} Egg Collection {done && <span className="text-xs font-normal text-green-600 ml-1">· Submitted</span>}
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Egg counts · Feed · Environment · Vaccines
          </p>
        </div>
        <ChevronRight className="w-5 h-5 text-gray-300 dark:text-gray-600 flex-shrink-0
          group-hover:text-gray-500 group-hover:translate-x-0.5 transition-all" />
      </button>
    );
  };

  return (
    <div className="p-4 md:p-8 space-y-5 max-w-5xl mx-auto">

      {/* Greeting */}
      <div className="bg-brand-green text-white rounded-2xl p-4 md:p-6">
        <p className="text-sm opacity-75">TODAY · {dayjs().format('dddd, D MMMM YYYY').toUpperCase()}</p>
        <p className="text-xl md:text-2xl font-bold mt-1">{greeting}, {firstName}! 👋</p>
        <p className="text-sm opacity-75 mt-0.5">Submit your AM and PM egg-collection sessions below.</p>
      </div>

      {/* Returned-entry alerts */}
      {returned.length > 0 && (
        <div className="bg-red-50 dark:bg-red-900/20 border-2 border-red-300 dark:border-red-700 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
            <p className="font-bold text-red-700 dark:text-red-400">
              {returned.length} {returned.length === 1 ? 'Entry' : 'Entries'} Returned — Action Required
            </p>
          </div>
          <p className="text-xs text-red-500 dark:text-red-500 mb-3">
            The Production Manager has returned the following entries for correction. Open Egg Collection to resubmit.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {returned.map((e: any) => (
              <div key={e.id} className="bg-white dark:bg-dark-card rounded-xl p-3 border border-red-100 dark:border-red-800">
                <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                  {dayjs(e.entryDate).format('D MMM')} · {e.shift} shift · {e.batch?.batchCode}
                </p>
                <p className="text-sm text-red-600 dark:text-red-400 mt-1 font-medium">
                  {e.returnReason}
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
          {sessionTask('AM')}
          {sessionTask('PM')}
        </div>
        <p className="text-[11px] text-gray-400 mt-3 leading-relaxed">
          Each session bundles egg collection, session feed consumption, environmental data
          and any vaccines/supplements given — they are submitted together and locked once verified.
        </p>
      </div>

      {/* Awaiting approval banner */}
      {awaitingApproval > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700
          rounded-2xl p-4 flex items-center gap-3">
          <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-amber-700 dark:text-amber-400 text-sm font-semibold">
              {awaitingApproval} {awaitingApproval === 1 ? 'entry' : 'entries'} pending Production Manager verification
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
