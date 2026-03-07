import { useNavigate } from 'react-router-dom';
import { CheckSquare, AlertTriangle, Clock } from 'lucide-react';
import { usePendingEntries } from '../../hooks/useFlock';
import { useAuthStore } from '../../stores/auth.store';
import dayjs from 'dayjs';

export function SupervisorHome() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { data: pending = [], isLoading } = usePendingEntries();

  const pendingCount = pending.length;

  return (
    <div className="p-4 space-y-5">
      <div className="bg-brand-teal text-white rounded-2xl p-4">
        <p className="text-sm opacity-75">Today</p>
        <p className="text-xl font-bold">{dayjs().format('dddd, D MMMM YYYY')}</p>
        <p className="text-sm opacity-90 mt-1">Welcome, {user?.fullName?.split(' ')[0]}</p>
      </div>

      {/* Verification queue — primary action */}
      <button
        onClick={() => navigate('/supervisor/verify')}
        className={`w-full rounded-2xl p-5 shadow-sm border-2 flex items-center gap-4 text-left min-h-[88px]
          ${pendingCount > 0 ? 'bg-amber-50 border-amber-300' : 'bg-green-50 border-green-200'}`}
      >
        <div className={`w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0
          ${pendingCount > 0 ? 'bg-amber-500' : 'bg-green-500'}`}>
          {pendingCount > 0 ? <AlertTriangle className="w-7 h-7 text-white" /> : <CheckSquare className="w-7 h-7 text-white" />}
        </div>
        <div className="flex-1">
          <p className="font-bold text-gray-800 text-base">Verification Queue</p>
          {isLoading ? (
            <p className="text-sm text-gray-500">Loading...</p>
          ) : pendingCount > 0 ? (
            <p className="text-sm text-amber-700 font-semibold">{pendingCount} entries awaiting your review</p>
          ) : (
            <p className="text-sm text-green-700 font-semibold">All entries verified ✓</p>
          )}
        </div>
        <span className={`text-2xl font-bold ${pendingCount > 0 ? 'text-amber-600' : 'text-green-600'}`}>
          {pendingCount > 0 ? pendingCount : '✓'}
        </span>
      </button>

      {/* Pending list preview */}
      {pendingCount > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Needs Your Attention</p>
          {pending.slice(0, 3).map((e: any) => (
            <div key={e.id} className="bg-white rounded-xl p-3 border border-gray-100 flex items-center gap-3">
              <Clock className="w-4 h-4 text-amber-500 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-800 truncate">
                  {e.submittedBy?.fullName} — {e.batch?.batchCode}
                </p>
                <p className="text-xs text-gray-500">{dayjs(e.entryDate).format('D MMM')} · {e.shift} shift</p>
              </div>
            </div>
          ))}
          {pendingCount > 3 && (
            <button onClick={() => navigate('/supervisor/verify')}
              className="w-full text-brand-teal text-sm font-semibold py-2">
              View all {pendingCount} pending →
            </button>
          )}
        </div>
      )}
    </div>
  );
}
