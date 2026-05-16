// src/pages/manager/VerificationQueue.tsx
// Two-tab verification queue: Flock Entries (existing) + Egg Collection Sessions (Phase 3)

import { useState } from 'react';
import {
  Check, RotateCcw, ChevronDown, ChevronUp, Clock, AlertTriangle,
  Thermometer, Droplets, Bird, Info, CheckCircle2, XCircle,
  User, Calendar, Hash, ArrowUpDown, Filter, Egg, Package,
  Scale, AlertCircle,
} from 'lucide-react';
import { usePendingEntries, useVerifyEntry } from '../../hooks/useFlock';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api/client';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
dayjs.extend(relativeTime);

// ─── Shared helpers ────────────────────────────────────────────────────────────

function Tooltip({ children, tip }: { children: React.ReactNode; tip: string }) {
  return (
    <span className="relative group inline-flex items-center">
      {children}
      <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50
        bg-gray-900 dark:bg-gray-700 text-white text-xs rounded-lg px-2.5 py-1.5
        w-52 text-center leading-relaxed
        opacity-0 group-hover:opacity-100 transition-opacity duration-150 shadow-lg
        after:content-[''] after:absolute after:top-full after:left-1/2 after:-translate-x-1/2
        after:border-4 after:border-transparent after:border-t-gray-900 dark:after:border-t-gray-700">
        {tip}
      </span>
    </span>
  );
}

function StatPill({ label, value, tip, alert = false, accent = 'gray' }: {
  label: string; value: string | number; tip?: string; alert?: boolean; accent?: string;
}) {
  const accentMap: Record<string, string> = {
    gray:  'bg-gray-50 dark:bg-dark-bg border-gray-100 dark:border-dark-border',
    green: 'bg-green-50 dark:bg-green-900/20 border-green-100 dark:border-green-800',
    red:   'bg-red-50 dark:bg-red-900/20 border-red-100 dark:border-red-800',
    amber: 'bg-amber-50 dark:bg-amber-900/20 border-amber-100 dark:border-amber-800',
    teal:  'bg-teal-50 dark:bg-teal-900/20 border-teal-100 dark:border-teal-800',
    blue:  'bg-blue-50 dark:bg-blue-900/20 border-blue-100 dark:border-blue-800',
  };
  const textMap: Record<string, string> = {
    gray:  'text-gray-800 dark:text-gray-100',
    green: 'text-green-700 dark:text-green-400',
    red:   'text-red-600 dark:text-red-400',
    amber: 'text-amber-700 dark:text-amber-400',
    teal:  'text-teal-700 dark:text-teal-400',
    blue:  'text-blue-700 dark:text-blue-400',
  };
  const pill = (
    <div className={`rounded-xl border p-3 text-center ${alert ? accentMap.red : accentMap[accent]}`}>
      <p className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wide font-medium mb-0.5">
        {label}{tip && <Info className="inline w-2.5 h-2.5 ml-0.5 opacity-50" />}
      </p>
      <p className={`text-xl font-bold ${alert ? textMap.red : textMap[accent]}`}>{value}</p>
    </div>
  );
  if (!tip) return pill;
  return <Tooltip tip={tip}>{pill}</Tooltip>;
}

function eggsToTrays(eggs: number): string {
  if (!eggs || eggs <= 0) return '0 eggs';
  const trays = Math.floor(eggs / 30);
  const rem = eggs % 30;
  if (trays === 0) return `${rem} eggs`;
  if (rem === 0) return `${trays} trays`;
  return `${trays} trays + ${rem} eggs`;
}

// ─── TAB 1: FLOCK ENTRIES (existing logic, unchanged) ─────────────────────────

const CAUSE_LABELS: Record<string, { label: string; tip: string; color: string }> = {
  DISEASE:     { label: 'Disease',     tip: 'Death due to illness or infection',        color: 'text-purple-600 bg-purple-50 dark:bg-purple-900/20' },
  INJURY:      { label: 'Injury',      tip: 'Physical trauma or accidental death',      color: 'text-orange-600 bg-orange-50 dark:bg-orange-900/20' },
  HEAT_STRESS: { label: 'Heat Stress', tip: 'Death caused by high ambient temperature', color: 'text-red-600 bg-red-50 dark:bg-red-900/20' },
  PREDATOR:    { label: 'Predator',    tip: 'Bird killed by a predator animal',         color: 'text-red-700 bg-red-50 dark:bg-red-900/20' },
  CULLED_SICK: { label: 'Culled Sick', tip: 'Intentionally removed due to illness',    color: 'text-amber-600 bg-amber-50 dark:bg-amber-900/20' },
  UNKNOWN:     { label: 'Unknown',     tip: 'Cause of death not determined',            color: 'text-gray-500 bg-gray-50 dark:bg-gray-800' },
};

function FlockEntryDetail({ entry, onApprove, onReturn, isPending }: {
  entry: any; onApprove: () => void; onReturn: (r: string) => void; isPending: boolean;
}) {
  const [returnReason, setReturnReason] = useState('');
  const [isReturning, setIsReturning] = useState(false);
  const mortalityRate = entry.openingCount > 0
    ? ((entry.mortalityCount / entry.openingCount) * 100).toFixed(2) : '0.00';
  const isMortalityHigh = entry.mortalityCount > 5 || parseFloat(mortalityRate) > 2;
  const cause = entry.mortalityCause ? CAUSE_LABELS[entry.mortalityCause] ?? CAUSE_LABELS.UNKNOWN : null;

  return (
    <div className="border-t border-gray-100 dark:border-dark-border bg-gray-50/50 dark:bg-dark-bg/50 p-4 md:p-6 space-y-5">
      <div>
        <p className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-2">Bird Count</p>
        <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
          <StatPill label="Opening" value={entry.openingCount} tip="Birds at start of shift" accent="teal" />
          <StatPill label="Deaths" value={entry.mortalityCount} tip={`${mortalityRate}% mortality`} alert={isMortalityHigh} accent={isMortalityHigh ? 'red' : 'gray'} />
          <StatPill label="Culled" value={entry.cullingCount ?? 0} tip="Intentionally removed" accent="amber" />
          <StatPill label="Closing" value={entry.closingCount} tip="Live birds at end of shift" accent="green" />
          {entry.waterConsumptionL != null && <StatPill label="Water (L)" value={Number(entry.waterConsumptionL).toFixed(1)} tip="Water consumed" accent="blue" />}
          {entry.temperatureCelsius != null && <StatPill label="Temp °C" value={Number(entry.temperatureCelsius).toFixed(1)} tip="House temperature" accent={Number(entry.temperatureCelsius) > 35 ? 'red' : 'gray'} />}
        </div>
      </div>
      {isMortalityHigh && (
        <div className="flex items-start gap-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-xl p-3">
          <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-red-700 dark:text-red-400">Elevated Mortality — {mortalityRate}%</p>
            <p className="text-xs text-red-500 mt-0.5">Industry benchmark is &lt;0.5%/day.</p>
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {cause && (
          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Mortality Cause</p>
            <Tooltip tip={cause.tip}>
              <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold ${cause.color}`}>
                <Bird className="w-3.5 h-3.5" />{cause.label}
              </span>
            </Tooltip>
            {entry.cullingReason && <p className="text-xs text-gray-500 mt-2 bg-white dark:bg-dark-card rounded-xl p-2.5 border border-gray-100 dark:border-dark-border">{entry.cullingReason}</p>}
          </div>
        )}
        {entry.notes && (
          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Attendant Notes</p>
            <p className="text-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-dark-card rounded-xl p-3 border border-gray-100 dark:border-dark-border">{entry.notes}</p>
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-3 text-xs text-gray-400">
        <span className="flex items-center gap-1"><User className="w-3 h-3" />{entry.submittedBy?.fullName}</span>
        <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{dayjs(entry.entryDate).format('D MMM YYYY')} · {entry.shift === 'AM' ? 'Morning' : 'Afternoon'}</span>
        <span className="flex items-center gap-1"><Clock className="w-3 h-3" />Submitted {dayjs(entry.createdAt).fromNow()}</span>
        <span className="flex items-center gap-1 font-mono"><Hash className="w-3 h-3" />{entry.id.slice(0, 8)}</span>
      </div>
      {isReturning && (
        <div>
          <label className="block text-sm font-semibold text-red-700 dark:text-red-400 mb-1.5">Reason for returning *</label>
          <textarea value={returnReason} onChange={e => setReturnReason(e.target.value)} rows={3}
            className="w-full border-2 border-red-200 dark:border-red-700 rounded-xl px-4 py-3 text-sm bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-400 resize-none placeholder-gray-400"
            placeholder="e.g. Opening count doesn't match yesterday's closing count. Please recheck..." />
        </div>
      )}
      <div className="flex gap-3 pt-1">
        {!isReturning ? (
          <>
            <button onClick={onApprove} disabled={isPending}
              className="flex-1 bg-brand-teal hover:bg-brand-teal/90 text-white rounded-xl py-3 font-bold flex items-center justify-center gap-2 min-h-[52px] disabled:opacity-60 transition-all shadow-sm">
              <CheckCircle2 className="w-5 h-5" /> Approve Entry
            </button>
            <button onClick={() => setIsReturning(true)}
              className="flex-1 bg-white dark:bg-dark-card text-red-600 border-2 border-red-200 dark:border-red-700 hover:bg-red-50 rounded-xl py-3 font-bold flex items-center justify-center gap-2 min-h-[52px] transition-all">
              <RotateCcw className="w-5 h-5" /> Return to Attendant
            </button>
          </>
        ) : (
          <>
            <button onClick={() => { onReturn(returnReason); setIsReturning(false); setReturnReason(''); }}
              disabled={!returnReason.trim() || isPending}
              className="flex-1 bg-red-600 hover:bg-red-700 text-white rounded-xl py-3 font-bold min-h-[52px] disabled:opacity-40 transition-all">
              {isPending ? 'Sending...' : 'Confirm Return'}
            </button>
            <button onClick={() => { setIsReturning(false); setReturnReason(''); }}
              className="flex-1 bg-gray-100 dark:bg-dark-card text-gray-600 rounded-xl py-3 font-bold min-h-[52px]">
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function FlockEntryRow({ entry, isExpanded, onToggle, onApprove, onReturn, isPending }: {
  entry: any; isExpanded: boolean; onToggle: () => void;
  onApprove: () => void; onReturn: (r: string) => void; isPending: boolean;
}) {
  const mortalityRate = entry.openingCount > 0
    ? ((entry.mortalityCount / entry.openingCount) * 100).toFixed(1) : '0.0';
  const isMortalityHigh = entry.mortalityCount > 5 || parseFloat(mortalityRate) > 2;

  return (
    <div className={`bg-white dark:bg-dark-card rounded-2xl border overflow-hidden shadow-sm transition-all duration-200 ${isExpanded ? 'border-brand-teal/40 shadow-md' : 'border-gray-100 dark:border-dark-border hover:border-gray-200 hover:shadow-md'}`}>
      <button onClick={onToggle} className="w-full p-4 md:p-5 flex items-center gap-3 md:gap-4 text-left">
        <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${isMortalityHigh ? 'bg-red-500 animate-pulse' : 'bg-amber-400'}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-gray-800 dark:text-gray-100 text-sm">{entry.submittedBy?.fullName}</p>
            <span className="text-xs bg-gray-100 dark:bg-dark-bg text-gray-500 px-2 py-0.5 rounded-full font-mono">{entry.batch?.batchCode}</span>
            {isMortalityHigh && (
              <span className="text-xs bg-red-100 dark:bg-red-900/30 text-red-600 px-2 py-0.5 rounded-full font-semibold flex items-center gap-1">
                <AlertTriangle className="w-2.5 h-2.5" />High Mortality
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-400">
            <span>{dayjs(entry.entryDate).format('D MMM YYYY')}</span>
            <span>{entry.shift === 'AM' ? '☀ AM' : '🌙 PM'}</span>
            <span>{dayjs(entry.createdAt).fromNow()}</span>
          </div>
        </div>
        <div className="hidden md:flex items-center gap-4">
          <div className="flex items-center gap-1.5 text-sm text-gray-500">
            <Bird className="w-3.5 h-3.5" />
            <span className="font-semibold text-gray-700 dark:text-gray-300">{entry.openingCount?.toLocaleString()}</span>
          </div>
          <div className={`flex items-center gap-1.5 text-sm ${isMortalityHigh ? 'text-red-500' : 'text-gray-400'}`}>
            <XCircle className="w-3.5 h-3.5" />
            <span className="font-semibold">{entry.mortalityCount}</span>
          </div>
          {entry.temperatureCelsius != null && (
            <div className={`flex items-center gap-1.5 text-sm ${Number(entry.temperatureCelsius) > 35 ? 'text-red-500' : 'text-gray-400'}`}>
              <Thermometer className="w-3.5 h-3.5" />
              <span className="font-semibold">{Number(entry.temperatureCelsius).toFixed(0)}°C</span>
            </div>
          )}
          {entry.waterConsumptionL != null && (
            <div className="flex items-center gap-1.5 text-sm text-blue-400">
              <Droplets className="w-3.5 h-3.5" />
              <span className="font-semibold">{Number(entry.waterConsumptionL).toFixed(0)}L</span>
            </div>
          )}
        </div>
        <div className={`p-1.5 rounded-lg transition-colors shrink-0 ${isExpanded ? 'bg-brand-teal/10 text-brand-teal' : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-dark-bg'}`}>
          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </button>
      {isExpanded && (
        <FlockEntryDetail entry={entry} onApprove={onApprove} onReturn={onReturn} isPending={isPending} />
      )}
    </div>
  );
}

function FlockTab() {
  const { data: pending = [], isLoading, refetch } = usePendingEntries();
  const verify = useVerifyEntry();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'time' | 'mortality'>('time');
  const [filterHigh, setFilterHigh] = useState(false);

  const handleApprove = async (id: string) => {
    await verify.mutateAsync({ id, data: { status: 'APPROVED' } });
    setExpanded(null);
    refetch();
  };
  const handleReturn = async (id: string, reason: string) => {
    await verify.mutateAsync({ id, data: { status: 'RETURNED', returnReason: reason } });
    setExpanded(null);
    refetch();
  };

  const highCount = pending.filter((e: any) =>
    e.mortalityCount > 5 || (e.openingCount > 0 && e.mortalityCount / e.openingCount > 0.02)
  ).length;

  let sorted = [...pending];
  if (sortBy === 'mortality') sorted.sort((a: any, b: any) => b.mortalityCount - a.mortalityCount);
  if (filterHigh) sorted = sorted.filter((e: any) => e.mortalityCount > 5 || (e.openingCount > 0 && e.mortalityCount / e.openingCount > 0.02));

  if (isLoading) return <div className="space-y-3 p-4">{[1, 2, 3].map(i => <div key={i} className="bg-gray-100 dark:bg-dark-card rounded-2xl h-20 animate-pulse" />)}</div>;

  if (pending.length === 0) return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mb-4">
        <Check className="w-8 h-8 text-green-600" />
      </div>
      <h3 className="font-bold text-gray-700 dark:text-gray-300">Queue Clear</h3>
      <p className="text-sm text-gray-400 mt-1">No flock entries pending verification.</p>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => setSortBy('time')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${sortBy === 'time' ? 'bg-brand-teal text-white' : 'bg-gray-100 dark:bg-dark-card text-gray-600 dark:text-gray-400'}`}>
          <Clock className="w-3 h-3" /> By Time
        </button>
        <button onClick={() => setSortBy('mortality')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${sortBy === 'mortality' ? 'bg-brand-teal text-white' : 'bg-gray-100 dark:bg-dark-card text-gray-600 dark:text-gray-400'}`}>
          <ArrowUpDown className="w-3 h-3" /> By Mortality
        </button>
        {highCount > 0 && (
          <button onClick={() => setFilterHigh(!filterHigh)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${filterHigh ? 'bg-red-500 text-white' : 'bg-gray-100 dark:bg-dark-card text-gray-600 dark:text-gray-400'}`}>
            <Filter className="w-3 h-3" /> High Mortality Only
          </button>
        )}
      </div>
      <div className="space-y-3">
        {sorted.map((entry: any) => (
          <FlockEntryRow key={entry.id} entry={entry} isExpanded={expanded === entry.id}
            onToggle={() => setExpanded(expanded === entry.id ? null : entry.id)}
            onApprove={() => handleApprove(entry.id)}
            onReturn={(reason) => handleReturn(entry.id, reason)}
            isPending={verify.isPending}
          />
        ))}
      </div>
      {filterHigh && sorted.length === 0 && <p className="text-center py-8 text-sm text-gray-400">No high-mortality entries found.</p>}
    </div>
  );
}

// ─── TAB 2: EGG COLLECTION SESSIONS ───────────────────────────────────────────

function useEggSessionsForVerification() {
  return useQuery({
    queryKey: ['production', 'sessions', 'pending'],
    queryFn: () => api.get('/production/sessions').then(r =>
      r.data.filter((s: any) => s.status === 'PENDING')
    ),
    refetchInterval: 60_000,
  });
}

function useVerifyEggSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, returnReason }: { id: string; action: 'approve' | 'return'; returnReason?: string }) => {
      if (action === 'approve') return api.patch(`/production/sessions/${id}/approve`).then(r => r.data);
      return api.patch(`/production/sessions/${id}/return`, { returnReason }).then(r => r.data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['production', 'sessions', 'pending'] });
    },
  });
}

function EggSessionDetail({ session, onApprove, onReturn, onCosign, isPending, isCosigning }: {
  session: any; onApprove: () => void; onReturn: (r: string) => void;
  onCosign?: () => void; isPending: boolean; isCosigning?: boolean;
}) {
  const [returnReason, setReturnReason] = useState('');
  const [isReturning, setIsReturning] = useState(false);

  const storeIntake = session.storeIntakes?.[0] ?? null;
  const hasDiscrepancy = storeIntake && storeIntake.totalGoodEggs !== session.totalGoodEggs;
  const diff = storeIntake ? Math.abs(storeIntake.totalGoodEggs - session.totalGoodEggs) : 0;

  const rows: any[] = Array.isArray(session.rowData) ? session.rowData : [];

  return (
    <div className="border-t border-gray-100 dark:border-dark-border bg-gray-50/50 dark:bg-dark-bg/50 p-4 md:p-6 space-y-5">

      {/* Session totals */}
      <div>
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Egg Collection Totals</p>
        <div className="grid grid-cols-3 md:grid-cols-4 gap-2">
          <StatPill label="Total Eggs" value={(session.totalGoodEggs + (session.totalBrokenEggs ?? 0) + (session.totalSoftShell ?? 0) + (session.totalDeformed ?? 0)).toLocaleString()} accent="green" />
          <StatPill label="Good Eggs" value={session.totalGoodEggs.toLocaleString()} accent="green" />
          <StatPill label="Full Trays" value={session.totalFullTrays} accent="green" />
          <StatPill label="Loose Eggs" value={session.totalLooseEggs} accent="gray" />
          <StatPill label="Starter Eggs" value={session.totalStarterEggs ?? 0} accent="blue" />
          <StatPill label="Broken (Sellable)" value={session.totalBrokenSellable ?? 0} accent="amber" />
          <StatPill label="Broken (Unsellable)" value={session.totalBrokenUnsellable ?? (session.totalBrokenEggs ?? 0)} alert={(session.totalBrokenUnsellable ?? session.totalBrokenEggs ?? 0) > 10} accent="red" />
          <StatPill label="Soft Shell" value={session.totalSoftShell ?? 0} accent="amber" />
          <StatPill label="Deformed" value={session.totalDeformed ?? 0} accent="amber" />
          <StatPill label="Weight (kg)" value={Number(session.totalWeightKg).toFixed(1)} accent="blue" />
        </div>
      </div>

      {/* Bird population */}
      <div>
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Bird Population</p>
        <div className="grid grid-cols-3 gap-2">
          <StatPill label="Opening" value={session.openingPop.toLocaleString()} accent="teal" />
          <StatPill label="Mortalities" value={session.mortalities} alert={session.mortalities > 5} accent={session.mortalities > 5 ? 'red' : 'gray'} />
          <StatPill label="Closing Stock" value={session.closingStock.toLocaleString()} accent="green" />
        </div>
        {session.henDayPercent != null && (
          <p className="text-xs text-gray-500 mt-2">
            HDP: <strong className={`${Number(session.henDayPercent) < 60 ? 'text-red-600' : Number(session.henDayPercent) < 75 ? 'text-amber-600' : 'text-green-600'}`}>
              {Number(session.henDayPercent).toFixed(1)}%
            </strong>
            <span className="text-gray-400"> (target 70–85%)</span>
          </p>
        )}
      </div>

      {/* Per-row breakdown */}
      {rows.length > 0 && (
        <div>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Per-Row Breakdown</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-400 border-b border-gray-100 dark:border-dark-border">
                  <th className="text-left py-1.5 pr-3 font-medium">Row</th>
                  <th className="text-right py-1.5 px-2 font-medium">Total Eggs</th>
                  <th className="text-right py-1.5 px-2 font-medium">Starter</th>
                  <th className="text-right py-1.5 px-2 font-medium">Broken (S)</th>
                  <th className="text-right py-1.5 px-2 font-medium">Broken (U)</th>
                  <th className="text-right py-1.5 px-2 font-medium">Soft Shell</th>
                  <th className="text-right py-1.5 px-2 font-medium">Deformed</th>
                  <th className="text-right py-1.5 px-2 font-medium">Weight(kg)</th>
                  <th className="text-left py-1.5 pl-2 font-medium">Attendant</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row: any, i: number) => {
                  const rowEggs = row.totalEggs ?? ((row.fullTrays ?? 0) * 30 + (row.looseEggs ?? 0));
                  return (
                    <tr key={i} className="border-b border-gray-50 dark:border-dark-border/50">
                      <td className="py-1.5 pr-3">
                        <span className="font-bold text-brand-green bg-brand-green/10 rounded px-2 py-0.5">{row.rowCode}</span>
                      </td>
                      <td className="text-right px-2 font-semibold text-gray-700 dark:text-gray-200">{rowEggs}</td>
                      <td className={`text-right px-2 ${(row.brokenEggs ?? 0) > 3 ? 'text-red-500 font-semibold' : 'text-gray-500'}`}>{row.brokenEggs ?? 0}</td>
                      <td className={`text-right px-2 ${(row.softShell ?? 0) > 3 ? 'text-amber-500 font-semibold' : 'text-gray-500'}`}>{row.softShell ?? 0}</td>
                      <td className="text-right px-2 text-gray-500">{row.deformed ?? 0}</td>
                      <td className="text-right px-2 text-gray-500">{Number(row.weightKg ?? 0).toFixed(1)}</td>
                      <td className="text-left pl-2 text-gray-400">{row.attendantName ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Store intake comparison */}
      {storeIntake ? (
        <div className={`rounded-xl border p-4 ${hasDiscrepancy ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-700' : 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'}`}>
          <p className={`text-xs font-bold uppercase tracking-wide mb-2 ${hasDiscrepancy ? 'text-amber-700 dark:text-amber-400' : 'text-green-700 dark:text-green-400'}`}>
            Store Intake {hasDiscrepancy ? '⚠ Discrepancy' : '✓ Match'}
          </p>
          <div className="flex gap-6 text-sm">
            <span className="text-gray-700 dark:text-gray-200">Store count: <strong>{storeIntake.totalGoodEggs}</strong></span>
            <span className="text-gray-700 dark:text-gray-200">Attendant: <strong>{session.totalGoodEggs}</strong></span>
            {hasDiscrepancy && <span className="text-amber-700 dark:text-amber-400 font-semibold">Diff: {diff} eggs</span>}
          </div>
          {hasDiscrepancy && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-1.5">
              Approving will flag this discrepancy for review. The difference will be noted in the intake record.
            </p>
          )}
        </div>
      ) : (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-3 flex items-start gap-2 text-sm text-blue-700 dark:text-blue-400">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          Store has not yet logged their egg intake for this session. You can still approve.
        </div>
      )}

      {/* PM footer fields */}
      {session.shift === 'PM' && (
        <div className="grid grid-cols-2 gap-3 text-sm">
          {session.vaccineGiven && (
            <div className="bg-white dark:bg-dark-card rounded-xl p-3 border border-gray-100 dark:border-dark-border">
              <p className="text-xs text-gray-400 mb-0.5">Vaccine Given</p>
              <p className="font-semibold text-gray-700 dark:text-gray-200">{session.vaccineGiven}</p>
            </div>
          )}
          {(session.dailyFeedKg != null || session.feedKg != null) && (
            <div className="bg-white dark:bg-dark-card rounded-xl p-3 border border-gray-100 dark:border-dark-border">
              <p className="text-xs text-gray-400 mb-0.5">Feed</p>
              <p className="font-semibold text-gray-700 dark:text-gray-200">
                {Number(session.feedKg ?? session.dailyFeedKg ?? 0).toFixed(1)} kg
                {session.feedTypeName && <span className="text-gray-400 text-[10px] ml-1">({session.feedTypeName.replace(/_/g, ' ')})</span>}
              </p>
            </div>
          )}
          {session.waterLiters != null && (
            <div className="bg-white dark:bg-dark-card rounded-xl p-3 border border-gray-100 dark:border-dark-border">
              <p className="text-xs text-gray-400 mb-0.5">Water</p>
              <p className="font-semibold text-gray-700 dark:text-gray-200">{Number(session.waterLiters).toFixed(1)} litres</p>
            </div>
          )}
          {session.houseTempC != null && (
            <div className="bg-white dark:bg-dark-card rounded-xl p-3 border border-gray-100 dark:border-dark-border">
              <p className="text-xs text-gray-400 mb-0.5">House Temp</p>
              <p className="font-semibold text-gray-700 dark:text-gray-200">{Number(session.houseTempC).toFixed(1)}°C</p>
            </div>
          )}
          {session.vaccineGiven && (
            <div className="bg-white dark:bg-dark-card rounded-xl p-3 border border-gray-100 dark:border-dark-border">
              <p className="text-xs text-gray-400 mb-0.5">Vaccines</p>
              <p className="font-semibold text-gray-700 dark:text-gray-200">{session.vaccineGiven}</p>
            </div>
          )}
        </div>
      )}

      {session.remarks && (
        <div>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Remarks</p>
          <p className="text-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-dark-card rounded-xl p-3 border border-gray-100 dark:border-dark-border">{session.remarks}</p>
        </div>
      )}

      {/* Metadata */}
      <div className="flex flex-wrap gap-3 text-xs text-gray-400">
        <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{dayjs(session.sessionDate).format('D MMM YYYY')} · {session.shift} session</span>
        <span className="flex items-center gap-1"><Clock className="w-3 h-3" />Submitted {dayjs(session.createdAt).fromNow()}</span>
        <span className="flex items-center gap-1 font-mono"><Hash className="w-3 h-3" />{session.id.slice(0, 8)}</span>
      </div>

      {/* Return reason */}
      {isReturning && (
        <div>
          <label className="block text-sm font-semibold text-red-700 dark:text-red-400 mb-1.5">Reason for returning *</label>
          <textarea value={returnReason} onChange={e => setReturnReason(e.target.value)} rows={3}
            className="w-full border-2 border-red-200 dark:border-red-700 rounded-xl px-4 py-3 text-sm bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-400 resize-none placeholder-gray-400"
            placeholder="e.g. Row D1 total doesn't add up. Please recount and resubmit..." />
        </div>
      )}

      {/* Action buttons — shown only for PENDING sessions */}
      {session.status === 'PENDING' && (
        <div className="flex gap-3 pt-1">
          {!isReturning ? (
            <>
              <button onClick={onApprove} disabled={isPending}
                className="flex-1 bg-brand-green hover:bg-green-800 text-white rounded-xl py-3 font-bold flex items-center justify-center gap-2 min-h-[52px] disabled:opacity-60 transition-all shadow-sm">
                <CheckCircle2 className="w-5 h-5" /> Approve Session
              </button>
              <button onClick={() => setIsReturning(true)}
                className="flex-1 bg-white dark:bg-dark-card text-red-600 border-2 border-red-200 dark:border-red-700 hover:bg-red-50 rounded-xl py-3 font-bold flex items-center justify-center gap-2 min-h-[52px] transition-all">
                <RotateCcw className="w-5 h-5" /> Return to Attendant
              </button>
            </>
          ) : (
            <>
              <button onClick={() => { onReturn(returnReason); setIsReturning(false); setReturnReason(''); }}
                disabled={!returnReason.trim() || isPending}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white rounded-xl py-3 font-bold min-h-[52px] disabled:opacity-40 transition-all">
                {isPending ? 'Sending...' : 'Confirm Return'}
              </button>
              <button onClick={() => { setIsReturning(false); setReturnReason(''); }}
                className="flex-1 bg-gray-100 dark:bg-dark-card text-gray-600 rounded-xl py-3 font-bold min-h-[52px]">
                Cancel
              </button>
            </>
          )}
        </div>
      )}

      {/* Co-sign button — shown for APPROVED sessions where Store has logged intake but Manager hasn't co-signed */}
      {session.status === 'APPROVED' && !session.storeSignedById && onCosign && (
        <div className="pt-1">
          <div className="mb-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-3 text-sm text-blue-700 dark:text-blue-400">
            <p className="font-semibold mb-0.5">Session Approved — Tally Co-sign Pending</p>
            <p className="text-xs opacity-80">Store has logged their intake. Co-sign to confirm the tally is complete.</p>
          </div>
          <button onClick={onCosign} disabled={isCosigning || !session.storeIntakes?.length}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-xl py-3 font-bold flex items-center justify-center gap-2 min-h-[52px] disabled:opacity-60 transition-all shadow-sm">
            <CheckCircle2 className="w-5 h-5" />
            {isCosigning ? 'Co-signing...' : session.storeIntakes?.length ? 'Co-sign Tally' : 'Awaiting Store Intake'}
          </button>
        </div>
      )}

      {/* Already co-signed */}
      {session.storeSignedById && (
        <div className="pt-1 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-3 flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span className="font-semibold">Tally fully co-signed by Production Manager</span>
        </div>
      )}
    </div>
  );
}

function EggSessionRow({ session, isExpanded, onToggle, onApprove, onReturn, onCosign, isPending, isCosigning }: {
  session: any; isExpanded: boolean; onToggle: () => void;
  onApprove: () => void; onReturn: (r: string) => void;
  onCosign?: () => void; isPending: boolean; isCosigning?: boolean;
}) {
  const storeIntake = session.storeIntakes?.[0] ?? null;
  const hasDiscrepancy = storeIntake && storeIntake.totalGoodEggs !== session.totalGoodEggs;
  const needsCosign = session.status === 'APPROVED' && !session.storeSignedById;

  return (
    <div className={`bg-white dark:bg-dark-card rounded-2xl border overflow-hidden shadow-sm transition-all duration-200 ${isExpanded ? 'border-brand-green/40 shadow-md' : needsCosign ? 'border-blue-200 dark:border-blue-800' : 'border-gray-100 dark:border-dark-border hover:border-gray-200 hover:shadow-md'}`}>
      <button onClick={onToggle} className="w-full p-4 md:p-5 flex items-center gap-3 md:gap-4 text-left">
        <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${hasDiscrepancy ? 'bg-amber-500 animate-pulse' : needsCosign ? 'bg-blue-500 animate-pulse' : 'bg-brand-green'}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs bg-gray-100 dark:bg-dark-bg text-gray-500 px-2 py-0.5 rounded-full font-mono">{session.batch?.batchCode}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${session.shift === 'PM' ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400' : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'}`}>
              {session.shift} Session
            </span>
            {needsCosign && (
              <span className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded-full font-semibold">
                Co-sign needed
              </span>
            )}
            {hasDiscrepancy && (
              <span className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded-full font-semibold flex items-center gap-1">
                <AlertTriangle className="w-2.5 h-2.5" /> Discrepancy
              </span>
            )}
            {!storeIntake && session.status === 'PENDING' && (
              <span className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded-full font-semibold">
                Store pending
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-400">
            <span>{dayjs(session.sessionDate).format('D MMM YYYY')}</span>
            <span>{dayjs(session.createdAt).fromNow()}</span>
          </div>
        </div>
        <div className="hidden md:flex items-center gap-4">
          <div className="flex items-center gap-1.5 text-sm text-gray-500">
            <Egg className="w-3.5 h-3.5 text-amber-500" />
            <span className="font-semibold text-gray-700 dark:text-gray-300">{session.totalGoodEggs?.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-1.5 text-sm text-gray-500">
            <Package className="w-3.5 h-3.5" />
            <span className="font-semibold">{session.totalFullTrays} trays</span>
          </div>
          {session.henDayPercent != null && (
            <div className={`flex items-center gap-1.5 text-sm ${Number(session.henDayPercent) < 60 ? 'text-red-500' : Number(session.henDayPercent) < 75 ? 'text-amber-500' : 'text-green-600'}`}>
              <Scale className="w-3.5 h-3.5" />
              <span className="font-semibold">{Number(session.henDayPercent).toFixed(1)}%</span>
            </div>
          )}
        </div>
        <div className={`p-1.5 rounded-lg transition-colors shrink-0 ${isExpanded ? 'bg-brand-green/10 text-brand-green' : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-dark-bg'}`}>
          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </button>
      {isExpanded && (
        <EggSessionDetail session={session} onApprove={onApprove} onReturn={onReturn}
          onCosign={onCosign} isPending={isPending} isCosigning={isCosigning} />
      )}
    </div>
  );
}

function useEggSessionsNeedingAttention() {
  return useQuery({
    queryKey: ['production', 'sessions', 'attention'],
    queryFn: () => api.get('/production/sessions').then(r =>
      r.data.filter((s: any) =>
        s.status === 'PENDING' ||
        (s.status === 'APPROVED' && !s.storeSignedById && s.storeIntakes?.length > 0)
      )
    ),
    refetchInterval: 60_000,
  });
}

function EggSessionsTab() {
  const { data: sessions = [], isLoading } = useEggSessionsNeedingAttention();
  const verify = useVerifyEggSession();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<string | null>(null);

  const cosign = useMutation({
    mutationFn: (sessionId: string) =>
      api.patch(`/store/egg-intake/${sessionId}/cosign`).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['production', 'sessions'] });
    },
  });

  const handleApprove = async (id: string) => {
    await verify.mutateAsync({ id, action: 'approve' });
    setExpanded(null);
  };
  const handleReturn = async (id: string, reason: string) => {
    await verify.mutateAsync({ id, action: 'return', returnReason: reason });
    setExpanded(null);
  };
  const handleCosign = async (id: string) => {
    await cosign.mutateAsync(id);
    setExpanded(null);
  };

  if (isLoading) return <div className="space-y-3 p-4">{[1, 2, 3].map(i => <div key={i} className="bg-gray-100 dark:bg-dark-card rounded-2xl h-20 animate-pulse" />)}</div>;

  if (sessions.length === 0) return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mb-4">
        <Egg className="w-8 h-8 text-green-600" />
      </div>
      <h3 className="font-bold text-gray-700 dark:text-gray-300">All Clear</h3>
      <p className="text-sm text-gray-400 mt-1">No egg collection sessions pending verification or co-sign.</p>
    </div>
  );

  const pendingCount = sessions.filter((s: any) => s.status === 'PENDING').length;
  const cosignCount = sessions.filter((s: any) => s.status === 'APPROVED' && !s.storeSignedById).length;

  return (
    <div className="space-y-4">
      {(pendingCount > 0 || cosignCount > 0) && (
        <div className="flex gap-2 flex-wrap text-xs">
          {pendingCount > 0 && <span className="bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-3 py-1 rounded-full font-semibold">{pendingCount} awaiting approval</span>}
          {cosignCount > 0 && <span className="bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-3 py-1 rounded-full font-semibold">{cosignCount} awaiting co-sign</span>}
        </div>
      )}
      <div className="space-y-3">
        {sessions.map((session: any) => (
          <EggSessionRow key={session.id} session={session} isExpanded={expanded === session.id}
            onToggle={() => setExpanded(expanded === session.id ? null : session.id)}
            onApprove={() => handleApprove(session.id)}
            onReturn={(reason) => handleReturn(session.id, reason)}
            onCosign={() => handleCosign(session.id)}
            isPending={verify.isPending}
            isCosigning={cosign.isPending}
          />
        ))}
      </div>
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export function VerificationQueue() {
  const [activeTab, setActiveTab] = useState<'flock' | 'eggs'>('flock');

  const { data: flockPending = [] } = usePendingEntries();
  const { data: eggSessionsPending = [] } = useEggSessionsNeedingAttention();

  const flockCount = (flockPending as any[]).length;
  const eggCount = (eggSessionsPending as any[]).length;
  const totalPending = flockCount + eggCount;

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Verification Queue</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Review and approve pending entries from attendants and store
          </p>
        </div>
        {totalPending > 0 && (
          <span className="bg-amber-500 text-white text-sm font-bold px-3 py-1.5 rounded-full shrink-0">
            {totalPending} pending
          </span>
        )}
      </div>

      

      {/* Egg Sessions */}
      <EggSessionsTab />
    </div>
  );
}
