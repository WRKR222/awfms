import { useNavigate } from 'react-router-dom';
import { Egg, Clock, AlertCircle, ChevronRight } from 'lucide-react';
import { FlockIcon, FeedIcon, HomeIcon } from '../../components/ui/icons';
import { usePendingEntries } from '../../hooks/useFlock';
import { useAuthStore } from '../../stores/auth.store';
import dayjs from 'dayjs';

// ── Tooltip ───────────────────────────────────────────────────────────────────
function Tooltip({ children, tip }: { children: React.ReactNode; tip: string }) {
  return (
    <span className="relative group inline-flex items-center">
      {children}
      <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50
        bg-gray-900 dark:bg-gray-700 text-white text-xs rounded-lg px-2.5 py-1.5
        w-48 text-center leading-relaxed
        opacity-0 group-hover:opacity-100 transition-opacity duration-150 shadow-lg
        after:content-[''] after:absolute after:top-full after:left-1/2 after:-translate-x-1/2
        after:border-4 after:border-transparent after:border-t-gray-900 dark:after:border-t-gray-700">
        {tip}
      </span>
    </span>
  );
}

export function AttendantHome() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { data: pending = [] } = usePendingEntries();

  const myEntries = pending.filter((e: any) => e.submittedById === user?.id);
  const returned = myEntries.filter((e: any) => e.status === 'RETURNED');
  const awaitingApproval = myEntries.filter((e: any) => e.status === 'PENDING').length;

  const hour = dayjs().hour();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = user?.fullName?.split(' ')[0] ?? '';

  const tasks = [
    {
      label: 'Flock Entry',
      sub: 'Mortality · Water · Temperature',
      icon: FlockIcon,
      color: 'bg-brand-green',
      route: 'flock',
    },
    {
      label: 'Feed Entry',
      sub: 'Feed dispensed · Wastage',
      icon: FeedIcon,
      color: 'bg-brand-teal',
      route: 'feed',
    },
    {
      label: 'Egg Collection',
      sub: '',
      icon: Egg,
      color: 'bg-yellow-600',
      route: 'egg-collection',
    },
  ];

  return (
    <div className="p-4 md:p-8 space-y-5 max-w-5xl mx-auto">

      {/* Greeting */}
      <div className="bg-brand-green text-white rounded-2xl p-4 md:p-6">
        <p className="text-sm opacity-75">TODAY · {dayjs().format('dddd, D MMMM YYYY').toUpperCase()}</p>
        <p className="text-xl md:text-2xl font-bold mt-1">{greeting}, {firstName}! 👋</p>
        <p className="text-sm opacity-75 mt-0.5">Submit your shift data below</p>
      </div>

      {/* Returned entry alerts */}
      {returned.length > 0 && (
        <div className="bg-red-50 dark:bg-red-900/20 border-2 border-red-300 dark:border-red-700 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
            <p className="font-bold text-red-700 dark:text-red-400">
              {returned.length} {returned.length === 1 ? 'Entry' : 'Entries'} Returned — Action Required
            </p>
          </div>
          <p className="text-xs text-red-500 dark:text-red-500 mb-3">
            Your supervisor reviewed and returned the following entries. Please correct and resubmit.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {returned.map((e: any) => (
              <div key={e.id} className="bg-white dark:bg-dark-card rounded-xl p-3 border border-red-100 dark:border-red-800">
                <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                  {dayjs(e.entryDate).format('D MMM')} ·{' '}
                  <Tooltip tip={e.shift === 'AM' ? 'Morning shift' : 'Afternoon shift'}>
                    <span className="cursor-default underline decoration-dotted">
                      {e.shift} shift
                    </span>
                  </Tooltip>{' '}
                  · {e.batch?.batchCode}
                </p>
                <p className="text-sm text-red-600 dark:text-red-400 mt-1 font-medium">{e.returnReason}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Task cards */}
      <div>
        <p className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-3">
          Submit Today's Data
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {tasks.map(({ label, sub, icon: Icon, color, route }) => (
            <button
              key={route}
              onClick={() => navigate(route)}
              className="w-full bg-white dark:bg-dark-card rounded-2xl p-4 md:p-5 shadow-sm
                border border-gray-100 dark:border-dark-border
                flex items-center gap-4 text-left hover:shadow-md active:scale-[0.98]
                transition-all group"
            >
              <div className={`w-14 h-14 ${color} rounded-xl flex items-center justify-center flex-shrink-0
                group-hover:scale-105 transition-transform`}>
                <Icon className="w-7 h-7 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-gray-800 dark:text-gray-100 text-base">{label}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{sub}</p>
              </div>
              <ChevronRight className="w-5 h-5 text-gray-300 dark:text-gray-600 flex-shrink-0
                group-hover:text-gray-500 group-hover:translate-x-0.5 transition-all" />
            </button>
          ))}
        </div>
      </div>

      {/* Awaiting approval banner */}
      {awaitingApproval > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700
          rounded-2xl p-4 flex items-center gap-3">
          <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-amber-700 dark:text-amber-400 text-sm font-semibold">
              {awaitingApproval} {awaitingApproval === 1 ? 'entry' : 'entries'} pending supervisor approval
            </p>
            <p className="text-xs text-amber-500 dark:text-amber-500 mt-0.5">
              Entries are typically reviewed within the same shift. You'll be notified if any are returned.
            </p>
          </div>
        </div>
      )}


    </div>
  );
}
