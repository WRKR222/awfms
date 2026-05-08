import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api/client';
import { Users, LogIn, LogOut as LogOutIcon, Clock, CheckCircle, Search } from 'lucide-react';
import dayjs from 'dayjs';

interface SecurityVisitorPageProps {
  role: 'SECURITY1' | 'SECURITY2';
}

export default function SecurityVisitorPage({ role }: SecurityVisitorPageProps) {
  const gateKey = role === 'SECURITY1' ? 'MAIN_GATE' : 'FARM_GATE';
  const gateLabel = role === 'SECURITY1' ? 'Main Gate' : 'Farm Gate';
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState(dayjs().format('YYYY-MM-DD'));

  const { data: approvedVisitors = [], isLoading } = useQuery({
    queryKey: ['approved-visitors', gateKey, dateFilter],
    queryFn: () => api.get(`/visitors/approved?gate=${gateKey}&date=${dateFilter}`).then(r => r.data),
    refetchInterval: 30_000,
  });

  const { data: gateLog = [] } = useQuery({
    queryKey: ['gate-log', gateKey, dateFilter],
    queryFn: () => api.get(`/visitors/gate-log?gate=${gateKey}&date=${dateFilter}`).then(r => r.data),
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

  // Determine each visitor's current gate status
  const visitorStatus = (visitorId: string): 'OUTSIDE' | 'INSIDE' | 'DEPARTED' => {
    const entries = gateLog
      .filter((e: any) => e.visitorId === visitorId)
      .sort((a: any, b: any) => a.timestamp.localeCompare(b.timestamp));
    if (entries.length === 0) return 'OUTSIDE';
    const last = entries[entries.length - 1];
    if (last.action === 'CHECK_OUT') return 'DEPARTED';
    return 'INSIDE';
  };

  const getLastEntry = (visitorId: string) => {
    return gateLog
      .filter((e: any) => e.visitorId === visitorId)
      .sort((a: any, b: any) => b.timestamp.localeCompare(a.timestamp))[0];
  };

  const filtered = approvedVisitors.filter((v: any) =>
    !search || v.name?.toLowerCase().includes(search.toLowerCase()) ||
    v.purpose?.toLowerCase().includes(search.toLowerCase()) ||
    v.vehiclePlate?.toLowerCase().includes(search.toLowerCase())
  );

  const outside  = filtered.filter((v: any) => visitorStatus(v.id) === 'OUTSIDE');
  const inside   = filtered.filter((v: any) => visitorStatus(v.id) === 'INSIDE');
  const departed = filtered.filter((v: any) => visitorStatus(v.id) === 'DEPARTED');

  const inputCls = 'w-full border border-gray-200 dark:border-dark-border rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-green';

  return (
    <div className="p-4 md:p-8 space-y-5 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <Users className="w-5 h-5 text-brand-green" /> {gateLabel} — Visitor Log
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">Approved visitors for selected date</p>
        </div>
      </div>

      {/* Date + Search */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, purpose, plate…"
            className="w-full border border-gray-200 dark:border-dark-border rounded-xl pl-9 pr-3 py-2.5 text-sm bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-green"
          />
        </div>
        <input
          type="date"
          value={dateFilter}
          onChange={e => setDateFilter(e.target.value)}
          className="border border-gray-200 dark:border-dark-border rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-green"
        />
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-400 text-center py-8">Loading visitors…</p>
      ) : approvedVisitors.length === 0 ? (
        <div className="text-center py-12">
          <CheckCircle className="w-12 h-12 text-brand-green mx-auto mb-3 opacity-30" />
          <p className="text-gray-500 text-sm">No approved visitors for {dateFilter === dayjs().format('YYYY-MM-DD') ? 'today' : dateFilter}</p>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Awaiting */}
          {outside.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-amber-500" /> Awaiting Entry ({outside.length})
              </p>
              {outside.map((v: any) => (
                <VisitorCard
                  key={v.id} visitor={v} status="OUTSIDE"
                  lastEntry={getLastEntry(v.id)}
                  onAction={() => logEntry.mutate({ visitorId: v.id, action: 'CHECK_IN' })}
                  isPending={logEntry.isPending}
                />
              ))}
            </div>
          )}

          {/* Inside */}
          {inside.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center gap-1.5">
                <LogIn className="w-3.5 h-3.5 text-blue-500" /> Currently Inside ({inside.length})
              </p>
              {inside.map((v: any) => (
                <VisitorCard
                  key={v.id} visitor={v} status="INSIDE"
                  lastEntry={getLastEntry(v.id)}
                  onAction={() => logEntry.mutate({ visitorId: v.id, action: 'CHECK_OUT' })}
                  isPending={logEntry.isPending}
                />
              ))}
            </div>
          )}

          {/* Departed */}
          {departed.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center gap-1.5">
                <LogOutIcon className="w-3.5 h-3.5 text-gray-400" /> Departed ({departed.length})
              </p>
              {departed.map((v: any) => (
                <VisitorCard
                  key={v.id} visitor={v} status="DEPARTED"
                  lastEntry={getLastEntry(v.id)}
                  onAction={() => {}}
                  isPending={false}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function VisitorCard({ visitor, status, lastEntry, onAction, isPending }: {
  visitor: any;
  status: 'OUTSIDE' | 'INSIDE' | 'DEPARTED';
  lastEntry: any;
  onAction: () => void;
  isPending: boolean;
}) {
  const bgCls = status === 'INSIDE'
    ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-100 dark:border-blue-800'
    : status === 'DEPARTED'
      ? 'bg-gray-50 dark:bg-gray-800/50 border-gray-100 dark:border-gray-700'
      : 'bg-white dark:bg-dark-card border-gray-100 dark:border-dark-border';

  const initBg = status === 'INSIDE' ? 'bg-blue-100 text-blue-700' : status === 'DEPARTED' ? 'bg-gray-100 text-gray-500' : 'bg-amber-100 text-amber-700';

  return (
    <div className={`rounded-2xl p-4 border ${bgCls} flex items-center gap-3`}>
      <div className={`w-10 h-10 rounded-full ${initBg} flex items-center justify-center flex-shrink-0 text-sm font-bold`}>
        {visitor.name?.[0]?.toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-gray-800 dark:text-gray-100 text-sm">{visitor.name}</p>
        <p className="text-xs text-gray-400">{visitor.purpose} · {visitor.destination}</p>
        {visitor.vehiclePlate && <p className="text-xs text-gray-400">🚗 {visitor.vehiclePlate}</p>}
        {lastEntry && (
          <p className={`text-xs mt-0.5 ${status === 'INSIDE' ? 'text-blue-500' : 'text-gray-400'}`}>
            {lastEntry.action === 'CHECK_IN' ? 'Entered' : 'Departed'} at {dayjs(lastEntry.timestamp).format('HH:mm')}
          </p>
        )}
      </div>
      {status !== 'DEPARTED' && (
        <button
          onClick={onAction}
          disabled={isPending}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold flex-shrink-0 disabled:opacity-50 transition-colors ${
            status === 'OUTSIDE'
              ? 'bg-brand-green text-white hover:bg-green-700'
              : 'bg-red-500 text-white hover:bg-red-600'
          }`}
        >
          {status === 'OUTSIDE'
            ? <><LogIn className="w-3.5 h-3.5" /> Check In</>
            : <><LogOutIcon className="w-3.5 h-3.5" /> Check Out</>
          }
        </button>
      )}
      {status === 'DEPARTED' && (
        <span className="text-xs text-gray-400 flex items-center gap-1">
          <CheckCircle className="w-3.5 h-3.5 text-gray-300" /> Done
        </span>
      )}
    </div>
  );
}
