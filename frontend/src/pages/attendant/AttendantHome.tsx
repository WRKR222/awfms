import { useNavigate } from 'react-router-dom';
import { Package, Egg, Clock, AlertCircle } from 'lucide-react';
import { usePendingEntries } from '../../hooks/useFlock';
import { useAuthStore } from '../../stores/auth.store';
import dayjs from 'dayjs';

export function AttendantHome() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { data: pending = [] } = usePendingEntries();

  const myEntries = pending.filter((e: any) => e.submittedById === user?.id);
  const returned = myEntries.filter((e: any) => e.status === 'RETURNED');
  const awaitingApproval = myEntries.filter((e: any) => e.status === 'PENDING').length;

  const tasks = [
    { label: 'Flock Entry', sub: 'Mortality · Water · Temperature', icon: Package, color: 'bg-brand-green', route: 'flock' },
    { label: 'Feed Entry', sub: 'Feed dispensed · Wastage', icon: Package, color: 'bg-brand-teal', route: 'feed' },
    { label: 'Egg Collection', sub: 'Count · Grading (S/M/L/XL/Reject)', icon: Egg, color: 'bg-yellow-600', route: 'eggs' },
  ];

  return (
    <div className="p-4 space-y-5">
      {/* Date header */}
      <div className="bg-brand-green text-white rounded-2xl p-4">
        <p className="text-sm opacity-75">Today</p>
        <p className="text-xl font-bold">{dayjs().format('dddd, D MMMM YYYY')}</p>
        <p className="text-sm mt-1 opacity-90">Good morning, {user?.fullName?.split(' ')[0]}!</p>
      </div>

      {/* Returned entry alerts */}
      {returned.length > 0 && (
        <div className="bg-red-50 border-2 border-red-300 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle className="w-5 h-5 text-red-600" />
            <p className="font-bold text-red-700">{returned.length} Entry Returned — Action Required</p>
          </div>
          {returned.map((e: any) => (
            <div key={e.id} className="bg-white rounded-xl p-3 mt-2 border border-red-100">
              <p className="text-sm font-semibold text-gray-800">
                {dayjs(e.entryDate).format('D MMM')} · {e.shift} shift · {e.batch?.batchCode}
              </p>
              <p className="text-sm text-red-600 mt-1 font-medium">{e.returnReason}</p>
            </div>
          ))}
        </div>
      )}

      {/* Entry tasks */}
      <div>
        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Submit Today's Data</p>
        <div className="space-y-3">
          {tasks.map(({ label, sub, icon: Icon, color, route }) => (
            <button
              key={route}
              onClick={() => navigate(route)}
              className="w-full bg-white rounded-2xl p-4 shadow-sm border border-gray-100
                         flex items-center gap-4 text-left hover:shadow-md active:scale-98 transition-all
                         min-h-[80px]"
            >
              <div className={`w-14 h-14 ${color} rounded-xl flex items-center justify-center flex-shrink-0`}>
                <Icon className="w-7 h-7 text-white" />
              </div>
              <div className="flex-1">
                <p className="font-bold text-gray-800 text-base">{label}</p>
                <p className="text-sm text-gray-500 mt-0.5">{sub}</p>
              </div>
              <span className="text-gray-400 text-xl">›</span>
            </button>
          ))}
        </div>
      </div>

      {/* Status indicator */}
      {awaitingApproval > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center gap-3">
          <Clock className="w-5 h-5 text-amber-600 flex-shrink-0" />
          <p className="text-amber-700 text-sm font-medium">
            {awaitingApproval} {awaitingApproval === 1 ? 'entry' : 'entries'} pending supervisor approval
          </p>
        </div>
      )}
    </div>
  );
}
