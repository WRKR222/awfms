import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../../stores/auth.store';
import { api } from '../../lib/api/client';
import { Users, CheckCircle, ChevronRight, Clock, AlertCircle, LogIn, LogOut as LogOutIcon } from 'lucide-react';
import dayjs from 'dayjs';

interface SecurityHomeProps {
  role: 'SECURITY1' | 'SECURITY2';
}

export default function SecurityHome({ role }: SecurityHomeProps) {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const base = role === 'SECURITY1' ? '/security1' : '/security2';
  const gate = role === 'SECURITY1' ? 'Main Gate' : 'Farm Gate';
  const gateKey = role === 'SECURITY1' ? 'MAIN_GATE' : 'FARM_GATE';

  const hour = dayjs().hour();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = user?.fullName?.split(' ')[0] ?? '';

  // Today's approved visitor list for this gate
  const { data: approvedVisitors = [], isLoading } = useQuery({
    queryKey: ['approved-visitors', gateKey],
    queryFn: () => api.get(`/visitors/approved?gate=${gateKey}`).then(r => r.data),
    refetchInterval: 30_000,
  });

  // Today's logged entries at this gate
  const { data: todayLog = [] } = useQuery({
    queryKey: ['gate-log', gateKey, dayjs().format('YYYY-MM-DD')],
    queryFn: () => api.get(`/visitors/gate-log?gate=${gateKey}&date=${dayjs().format('YYYY-MM-DD')}`).then(r => r.data),
    refetchInterval: 30_000,
  });

  const logEntry = useMutation({
    mutationFn: ({ visitorId, action }: { visitorId: string; action: 'CHECK_IN' | 'CHECK_OUT' }) =>
      api.post('/visitors/gate-log', { visitorId, gate: gateKey, action, timestamp: new Date().toISOString() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['approved-visitors', gateKey] });
      qc.invalidateQueries({ queryKey: ['gate-log', gateKey] });
    },
  });

  const checkedInIds = new Set(
    todayLog
      .filter((e: any) => e.action === 'CHECK_IN' && !todayLog.some((o: any) => o.visitorId === e.visitorId && o.action === 'CHECK_OUT' && o.timestamp > e.timestamp))
      .map((e: any) => e.visitorId)
  );

  const pending = approvedVisitors.filter((v: any) => !checkedInIds.has(v.id));
  const inside = approvedVisitors.filter((v: any) => checkedInIds.has(v.id));

  return (
    <div className="p-4 md:p-8 space-y-5 max-w-2xl mx-auto">

      {/* Greeting banner */}
      <div className="bg-brand-green text-white rounded-2xl p-4 md:p-6">
        <p className="text-sm opacity-75">TODAY · {dayjs().format('dddd, D MMMM YYYY').toUpperCase()}</p>
        <p className="text-xl md:text-2xl font-bold mt-1">{greeting}, {firstName}! 👋</p>
        <p className="text-sm opacity-75 mt-0.5">{gate} Security Post</p>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white dark:bg-dark-card rounded-2xl p-3 border border-gray-100 dark:border-dark-border text-center">
          <p className="text-2xl font-bold text-brand-green">{approvedVisitors.length}</p>
          <p className="text-[10px] text-gray-400 mt-0.5">Approved</p>
        </div>
        <div className="bg-white dark:bg-dark-card rounded-2xl p-3 border border-gray-100 dark:border-dark-border text-center">
          <p className="text-2xl font-bold text-amber-500">{pending.length}</p>
          <p className="text-[10px] text-gray-400 mt-0.5">Awaiting</p>
        </div>
        <div className="bg-white dark:bg-dark-card rounded-2xl p-3 border border-gray-100 dark:border-dark-border text-center">
          <p className="text-2xl font-bold text-blue-500">{inside.length}</p>
          <p className="text-[10px] text-gray-400 mt-0.5">Inside</p>
        </div>
      </div>

      {/* Task card — visitor management */}
      <button
        onClick={() => navigate(`${base}/visitors`)}
        className="w-full bg-white dark:bg-dark-card rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-dark-border flex items-center gap-4 text-left hover:shadow-md active:scale-[0.98] transition-all group"
      >
        <div className="w-14 h-14 bg-brand-green rounded-xl flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform">
          <Users className="w-7 h-7 text-white" />
        </div>
        <div className="flex-1">
          <p className="font-bold text-gray-800 dark:text-gray-100 text-base">Visitor Management</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Approved list · Check-in · Check-out</p>
          {pending.length > 0 && (
            <p className="text-xs text-amber-600 font-medium mt-1">{pending.length} visitor{pending.length > 1 ? 's' : ''} expected today</p>
          )}
        </div>
        <ChevronRight className="w-5 h-5 text-gray-300 dark:text-gray-600 flex-shrink-0" />
      </button>

      {/* Approved visitors with quick check-in/out */}
      {isLoading ? (
        <p className="text-sm text-gray-400 text-center py-4">Loading approved list…</p>
      ) : approvedVisitors.length === 0 ? (
        <div className="bg-white dark:bg-dark-card rounded-2xl p-6 border border-gray-100 dark:border-dark-border text-center">
          <CheckCircle className="w-10 h-10 text-brand-green mx-auto mb-2 opacity-40" />
          <p className="text-sm text-gray-500">No approved visitors for today</p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Today's Approved Visitors</p>

          {/* Awaiting check-in */}
          {pending.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-amber-600 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" /> Awaiting Entry
              </p>
              {pending.map((v: any) => (
                <div key={v.id} className="bg-white dark:bg-dark-card rounded-2xl p-4 border border-gray-100 dark:border-dark-border flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0">
                    <span className="text-sm font-bold text-amber-700">{v.name?.[0]?.toUpperCase()}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-800 dark:text-gray-100 text-sm">{v.name}</p>
                    <p className="text-xs text-gray-400">{v.purpose} · {v.destination}</p>
                    {v.vehiclePlate && <p className="text-xs text-gray-400">{v.vehiclePlate}</p>}
                  </div>
                  <button
                    onClick={() => logEntry.mutate({ visitorId: v.id, action: 'CHECK_IN' })}
                    disabled={logEntry.isPending}
                    className="flex items-center gap-1.5 bg-brand-green text-white px-3 py-2 rounded-xl text-xs font-semibold flex-shrink-0 hover:bg-green-700 disabled:opacity-50 transition-colors"
                  >
                    <LogIn className="w-3.5 h-3.5" /> Check In
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Currently inside */}
          {inside.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-blue-600 flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5" /> Currently Inside
              </p>
              {inside.map((v: any) => {
                const checkIn = todayLog.find((e: any) => e.visitorId === v.id && e.action === 'CHECK_IN');
                return (
                  <div key={v.id} className="bg-blue-50 dark:bg-blue-900/20 rounded-2xl p-4 border border-blue-100 dark:border-blue-800 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center flex-shrink-0">
                      <span className="text-sm font-bold text-blue-700">{v.name?.[0]?.toUpperCase()}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-800 dark:text-gray-100 text-sm">{v.name}</p>
                      <p className="text-xs text-gray-400">{v.purpose} · {v.destination}</p>
                      {checkIn && <p className="text-xs text-blue-500">In at {dayjs(checkIn.timestamp).format('HH:mm')}</p>}
                    </div>
                    <button
                      onClick={() => logEntry.mutate({ visitorId: v.id, action: 'CHECK_OUT' })}
                      disabled={logEntry.isPending}
                      className="flex items-center gap-1.5 bg-red-500 text-white px-3 py-2 rounded-xl text-xs font-semibold flex-shrink-0 hover:bg-red-600 disabled:opacity-50 transition-colors"
                    >
                      <LogOutIcon className="w-3.5 h-3.5" /> Check Out
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
