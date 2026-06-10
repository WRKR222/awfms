// src/pages/attendant/EggCollectionPage.tsx
//
// Lead Attendant — single submission page for the shift.
// IMPLEMENTATION PLAN CHANGES:
//   • Removed local `submitted` / `wasQueued` as the gating mechanism.
//   • Page mode is now derived entirely from `todaySessions` server state.
//   • Shift radio selector removed — shift is hardcoded based on pageMode.
//   • `useShiftLocks()` hook removed.
//   • Five display modes: AM_FORM, AM_PENDING, AM_RETURNED, PM_FORM, PM_PENDING,
//     PM_RETURNED, DAY_LOCKED.
//   • RETURNED sessions pre-populate form from returnedSession.rowData.
//   • `localSubmitPending` flag prevents flash back to form during API round-trip.
import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle, Egg, AlertCircle, WifiOff, ChevronDown,
  Droplet, Thermometer, Wheat, Syringe, Plus, X, Lock,
} from 'lucide-react';
import { api } from '../../lib/api/client';
import { useOfflineMutation } from '../../hooks/useOfflineSync';
import { useOfflineStore } from '../../stores/offline.store';
import dayjs from 'dayjs';

const inputCls  = 'w-full border border-gray-200 dark:border-dark-border rounded-xl px-3 py-2.5 text-base bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-green';
const numInput  = 'w-full text-center border border-gray-200 dark:border-dark-border rounded-lg px-1 py-2 text-sm bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-green';
const cardCls   = 'bg-white dark:bg-dark-card rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-dark-border';
const sectionLbl = 'text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3';

const FEED_TYPE_OPTIONS = [
  { value: 'CHICK_MASH',  label: "Chick & Duckling Mash" },
  { value: 'GROWER_MASH', label: "Grower's Mash" },
  { value: 'LAYER_MASH',  label: "Layer's Mash" },
] as const;

function FeedTypeDropdown({ register, fieldName }: { register: any; fieldName: string }) {
  return (
    <select
      {...register(fieldName)}
      className="w-full border border-gray-200 dark:border-dark-border rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-green"
    >
      <option value="">Select feed type...</option>
      {FEED_TYPE_OPTIONS.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

function eggsToTrays(eggs: number): string {
  const trays = Math.floor(eggs / 30);
  const remainder = eggs % 30;
  if (trays === 0) return `${remainder} eggs`;
  if (remainder === 0) return `${trays} trays`;
  return `${trays} trays + ${remainder} eggs`;
}

const UNIT_LETTERS = ['A', 'B', 'C'] as const;
type UnitLetter = typeof UNIT_LETTERS[number];

interface RowEntry {
  rowCode: string;
  totalBirds: number;
  totalEggs: number;
  starterEggs: number;
  brokenUnsellable: number;
  brokenSellable: number;
  softShell: number;
  deformed: number;
  weightKg: number;
  attendantName: string;
}

interface VaccineEntry {
  kind: 'VACCINE' | 'SUPPLEMENT';
  name: string;
  dosage: string;
}

type BlockKey = 'BLOCK1' | 'BLOCK2';

function buildDefaultBlock(): { rows: RowEntry[] } {
  const rows: RowEntry[] = [];
  for (const letter of UNIT_LETTERS) {
    for (const rowNum of [1, 2]) {
      rows.push({
        rowCode: `${letter}${rowNum}`,
        totalBirds: 0, totalEggs: 0, starterEggs: 0,
        brokenUnsellable: 0, brokenSellable: 0,
        softShell: 0, deformed: 0,
        weightKg: 0, attendantName: '',
      });
    }
  }
  return { rows };
}

// ── Page Mode ──────────────────────────────────────────────────────────────────

type PageMode =
  | 'AM_FORM'
  | 'AM_PENDING'
  | 'AM_RETURNED'
  | 'PM_FORM'
  | 'PM_PENDING'
  | 'PM_RETURNED'
  | 'DAY_LOCKED';

function resolvePageMode(
  amSession: any,
  pmSession: any,
  localSubmitPending: boolean,
): PageMode {
  if (!amSession || amSession.status === 'RETURNED') {
    if (localSubmitPending) return 'AM_PENDING';
    return amSession?.status === 'RETURNED' ? 'AM_RETURNED' : 'AM_FORM';
  }
  if (amSession.status === 'PENDING') return 'AM_PENDING';
  if (amSession.status === 'APPROVED') {
    if (!pmSession || pmSession.status === 'RETURNED') {
      if (localSubmitPending) return 'PM_PENDING';
      return pmSession?.status === 'RETURNED' ? 'PM_RETURNED' : 'PM_FORM';
    }
    if (pmSession.status === 'PENDING') return 'PM_PENDING';
    if (pmSession.status === 'APPROVED') return 'DAY_LOCKED';
  }
  return 'AM_FORM';
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function PendingBanner({ shift, session, message }: { shift: 'AM' | 'PM'; session: any; message: string }) {
  return (
    <div className="p-6 flex flex-col items-center justify-center min-h-64 text-center max-w-5xl mx-auto mt-10">
      <CheckCircle className="w-16 h-16 text-brand-green mb-4" />
      <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">{shift} Session Submitted</h2>
      <p className="text-gray-500 dark:text-gray-400 mt-2 max-w-sm">{message}</p>
      <div className="mt-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl px-4 py-2">
        <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">
          Entry is now locked — awaiting Production Manager verification.
        </p>
      </div>
    </div>
  );
}

function ReturnAlert({ reason }: { reason: string }) {
  return (
    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-2xl p-4 flex items-start gap-3">
      <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
      <div>
        <p className="text-sm font-bold text-red-700 dark:text-red-400">Recount Required — Session Returned</p>
        <p className="text-sm text-red-600 dark:text-red-300 mt-0.5">Reason: {reason}</p>
        <p className="text-xs text-red-500 dark:text-red-400 mt-1">
          Please review the values below, make corrections, and resubmit.
        </p>
      </div>
    </div>
  );
}

function DayLockedPanel({ amSession, pmSession }: { amSession: any; pmSession: any }) {
  const navigate = useNavigate();
  const sessionDateLabel = amSession?.sessionDate
    ? dayjs(amSession.sessionDate).format('dddd, D MMMM YYYY')
    : dayjs().format('dddd, D MMMM YYYY');
  const nextDay = dayjs(amSession?.sessionDate ?? undefined).add(1, 'day').format('dddd, D MMMM');
  return (
    <div className="p-6 flex flex-col items-center justify-center min-h-64 text-center max-w-5xl mx-auto mt-10">
      <Lock className="w-16 h-16 text-gray-400 mb-4" />
      <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">Day Locked</h2>
      <p className="text-sm text-gray-400 mt-1">{sessionDateLabel}</p>
      <p className="text-gray-500 dark:text-gray-400 mt-2 max-w-sm">
        Both AM and PM sessions have been approved and locked. No further submissions are accepted for this day.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3 w-full max-w-xs">
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-xl p-3 text-center">
          <p className="text-xs font-bold text-green-600 dark:text-green-400">AM</p>
          <p className="text-sm font-semibold text-green-700 dark:text-green-300 mt-1">✓ Approved</p>
          {amSession?.totalGoodEggs != null && (
            <p className="text-[11px] text-green-600/70 mt-0.5">{amSession.totalGoodEggs.toLocaleString()} eggs</p>
          )}
        </div>
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-xl p-3 text-center">
          <p className="text-xs font-bold text-green-600 dark:text-green-400">PM</p>
          <p className="text-sm font-semibold text-green-700 dark:text-green-300 mt-1">✓ Approved</p>
          {pmSession?.totalGoodEggs != null && (
            <p className="text-[11px] text-green-600/70 mt-0.5">{pmSession.totalGoodEggs.toLocaleString()} eggs</p>
          )}
        </div>
      </div>
      <div className="mt-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-xl px-4 py-2 max-w-xs">
        <p className="text-xs text-blue-600 dark:text-blue-400">
          Next session opens on {nextDay}
        </p>
      </div>
      <button
        onClick={() => navigate('/attendant')}
        className="mt-6 bg-brand-green text-white rounded-xl px-8 py-3 font-semibold"
      >
        Back to Home
      </button>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function EggCollectionPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: allBatches = [] } = useQuery({
    queryKey: ['batches', 'active'],
    queryFn: () => api.get('/flock/batches?isActive=true').then(r => r.data),
  });

  // Include today's date in the query key so a new calendar day always gets a
  // fresh fetch instead of reading stale data from the previous day's cache.
  const today = dayjs().format('YYYY-MM-DD');
  const { data: todaySessions = [], refetch: refetchSessions } = useQuery({
    queryKey: ['egg-sessions-today', today],
    queryFn: () =>
      api.get(`/production/sessions?sessionDate=${today}`).then(r => r.data).catch(() => []),
    refetchInterval: 30_000,
    staleTime: 0,
  });

  const batches = (allBatches as any[]).filter((b: any) => b.stage === 'PRODUCTION');

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm({
    defaultValues: {
      openingPop: 0,
      mortalities: 0,
      remarks: '',
      batchId: '',
      feedKg: '' as string | number,
      feedTypeName: '',
      waterLiters: '' as string | number,
      houseTempC: '' as string | number,
    },
  });

  const { isOnline } = useOfflineStore();

  // Minimal in-flight flag — set true on mutate, cleared once server confirms
  const [localSubmitPending, setLocalSubmitPending] = useState(false);

  const [selectedBlock, setSelectedBlock] = useState<BlockKey | null>('BLOCK1');
  const [blockData, setBlockData] = useState<Record<'BLOCK1', { rows: RowEntry[] }>>({
    BLOCK1: buildDefaultBlock(),
  });
  const [vaccines, setVaccines] = useState<VaccineEntry[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Derive session state from server
  const amSession = (todaySessions as any[]).find((s: any) => s.shift === 'AM');
  const pmSession = (todaySessions as any[]).find((s: any) => s.shift === 'PM');

  const pageMode = resolvePageMode(amSession, pmSession, localSubmitPending);

  // Determine shift from pageMode — no user control
  const activeShift: 'AM' | 'PM' =
    pageMode === 'PM_FORM' || pageMode === 'PM_PENDING' || pageMode === 'PM_RETURNED'
      ? 'PM'
      : 'AM';

  // Clear localSubmitPending once server catches up
  useEffect(() => {
    if (localSubmitPending) {
      const mode = resolvePageMode(amSession, pmSession, false);
      if (mode === 'AM_PENDING' || mode === 'PM_PENDING') {
        setLocalSubmitPending(false);
      }
    }
  }, [amSession, pmSession, localSubmitPending]);

  // Pre-populate form for RETURNED sessions
  useEffect(() => {
    const returned = pageMode === 'AM_RETURNED' ? amSession : (pageMode === 'PM_RETURNED' ? pmSession : null);
    if (!returned?.rowData) return;
    setBlockData({ BLOCK1: { rows: returned.rowData } });
    if (returned.openingPop  != null) setValue('openingPop',  returned.openingPop);
    if (returned.mortalities  != null) setValue('mortalities',  returned.mortalities);
    if (returned.feedKg       != null) setValue('feedKg',       returned.feedKg);
    if (returned.feedTypeName)          setValue('feedTypeName', returned.feedTypeName);
    if (returned.waterLiters  != null) setValue('waterLiters',  returned.waterLiters);
    if (returned.houseTempC   != null) setValue('houseTempC',   returned.houseTempC);
    if (returned.remarks)               setValue('remarks',      returned.remarks);
  }, [pageMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const { mutate: offlineMutate } = useOfflineMutation({
    endpoint: '/production/sessions',
    method: 'POST',
    type: 'production',
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['production'] });
      qc.invalidateQueries({ queryKey: ['health'] });
      refetchSessions();
      setLocalSubmitPending(false);
    },
    onQueued: () => { setLocalSubmitPending(true); },
  });

  const batchId = watch('batchId');
  const openingPop = Number(watch('openingPop') ?? 0);
  const mortalities = Number(watch('mortalities') ?? 0);
  const closingStock = openingPop - mortalities;
  const allRows = blockData.BLOCK1.rows;
  const grandTotalEggs       = allRows.reduce((s, r) => s + Number(r.totalEggs ?? 0), 0);
  const grandStarterEggs     = allRows.reduce((s, r) => s + Number(r.starterEggs ?? 0), 0);
  const grandBrokenUnsellable = allRows.reduce((s, r) => s + Number(r.brokenUnsellable ?? 0), 0);
  const grandBrokenSellable  = allRows.reduce((s, r) => s + Number(r.brokenSellable ?? 0), 0);
  const grandSoftShell       = allRows.reduce((s, r) => s + Number(r.softShell ?? 0), 0);
  const grandDeformed        = allRows.reduce((s, r) => s + Number(r.deformed ?? 0), 0);
  const grandWeightKg        = allRows.reduce((s, r) => s + Number(r.weightKg ?? 0), 0);
  const hdp = closingStock > 0 ? ((grandTotalEggs / closingStock) * 100).toFixed(1) : '—';
  const selectedBatch = batches.find((b: any) => b.id === batchId);

  function updateRow(idx: number, field: keyof RowEntry, value: any) {
    setBlockData(prev => {
      const rows = [...prev.BLOCK1.rows];
      rows[idx] = { ...rows[idx], [field]: value };
      return { BLOCK1: { rows } };
    });
  }

  function onSubmit(data: any) {
    setSubmitError(null);

    const feedKg = Number(data.feedKg);
    const waterL = Number(data.waterLiters);
    const tempC  = Number(data.houseTempC);
    if (!data.feedTypeName?.trim() || !(feedKg > 0)) {
      setSubmitError('Session feed consumption is required (feed type and kg dispensed).');
      return;
    }
    if (!(waterL > 0) || !(tempC > 0)) {
      setSubmitError('Environmental data is required (water litres and house temperature °C).');
      return;
    }
    if (grandTotalEggs <= 0) {
      setSubmitError('At least one row must have an egg count before submission.');
      return;
    }
    const cleanedVaccines = vaccines
      .map(v => ({ kind: v.kind, name: v.name.trim(), dosage: v.dosage.trim() }))
      .filter(v => v.name || v.dosage);
    if (cleanedVaccines.some(v => !v.name || !v.dosage)) {
      setSubmitError('Each vaccine/supplement entry must have both a name and dosage.');
      return;
    }

    setLocalSubmitPending(true);

    offlineMutate({
      batchId: data.batchId,
      houseId: selectedBatch?.houseId,
      sessionDate: dayjs().format('YYYY-MM-DD'),
      shift: activeShift,  // hardcoded from pageMode — no user-controlled radio
      openingPop: Number(data.openingPop),
      mortalities: Number(data.mortalities),
      block: 'BLOCK1',
      rowData: allRows.map(r => ({
        rowCode: r.rowCode,
        totalBirds: Number(r.totalBirds),
        totalEggs: Number(r.totalEggs),
        starterEggs: Number(r.starterEggs),
        brokenUnsellable: Number(r.brokenUnsellable),
        brokenSellable: Number(r.brokenSellable),
        softShell: Number(r.softShell),
        deformed: Number(r.deformed),
        weightKg: Number(r.weightKg),
        attendantName: r.attendantName,
      })),
      sessionFeed: { feedKg, feedTypeName: data.feedTypeName.trim() },
      environment: { waterLiters: waterL, houseTempC: tempC },
      vaccinesGiven: cleanedVaccines,
      remarks: data.remarks || undefined,
    });
  }

  // ── Render by pageMode ────────────────────────────────────────────────────

  if (pageMode === 'DAY_LOCKED') {
    return <DayLockedPanel amSession={amSession} pmSession={pmSession} />;
  }

  if (pageMode === 'AM_PENDING' || pageMode === 'PM_PENDING') {
    const shift = pageMode === 'AM_PENDING' ? 'AM' : 'PM';
    return (
      <PendingBanner
        shift={shift}
        session={pageMode === 'AM_PENDING' ? amSession : pmSession}
        message="Submitted — awaiting Production Manager verification."
      />
    );
  }

  // AM_FORM, AM_RETURNED, PM_FORM, PM_RETURNED → show the collection form
  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto pb-10 space-y-4">
      <div className="flex items-center gap-3 mb-1">
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <Egg className="w-5 h-5 text-amber-500" />
            Egg Collection — <span className="text-brand-green">{activeShift} Session</span>
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {dayjs().format('dddd, D MMMM YYYY')}
          </p>
        </div>
      </div>

      {/* Return alert banner */}
      {(pageMode === 'AM_RETURNED' || pageMode === 'PM_RETURNED') && (
        <ReturnAlert reason={
          (pageMode === 'AM_RETURNED' ? amSession : pmSession)?.returnReason ?? ''
        } />
      )}

      {/* PM form — AM verified banner */}
      {(pageMode === 'PM_FORM' || pageMode === 'PM_RETURNED') && pageMode !== 'PM_RETURNED' && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-2xl p-4 flex items-center gap-3">
          <CheckCircle className="w-5 h-5 text-green-600 shrink-0" />
          <p className="text-sm font-semibold text-green-700 dark:text-green-400">
            AM session verified ✓ — You may now record the PM session.
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">

        {/* ── Batch (shift is no longer user-controlled) ── */}
        <div className={cardCls}>
          <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wide">
            Batch *
          </label>
          <select {...register('batchId', { required: true })} className={inputCls}>
            <option value="">Select batch...</option>
            {batches.length === 0 && (
              <option value="" disabled>No production-stage batches available</option>
            )}
            {batches.map((b: any) => (
              <option key={b.id} value={b.id}>
                {b.batchCode} — Production House ({b.house?.name ?? 'N/A'})
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs text-gray-400">
            Recording <span className="font-semibold text-brand-green">{activeShift} session</span>
            {activeShift === 'PM' && ' · AM session has been approved'}
          </p>
        </div>

        {/* ── Population ── */}
        <div className={cardCls}>
          <p className={sectionLbl}>Bird Population</p>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Opening Count</label>
              <input {...register('openingPop')} type="number" min="0" inputMode="numeric" className={inputCls} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Mortalities</label>
              <input {...register('mortalities')} type="number" min="0" inputMode="numeric" className={inputCls} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Closing Stock (Auto)</label>
              <div className={`${inputCls} bg-brand-green/10 text-brand-green font-bold text-center text-lg`}>
                {closingStock}
              </div>
            </div>
          </div>
        </div>

        {/* ── Block selection ── */}
        <div className={cardCls}>
          <p className={sectionLbl}>Select Block</p>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setSelectedBlock(selectedBlock === 'BLOCK1' ? null : 'BLOCK1')}
              className={`flex items-center justify-between rounded-xl p-4 border-2 transition-all ${
                selectedBlock === 'BLOCK1'
                  ? 'border-brand-green bg-brand-green/10'
                  : 'border-gray-200 dark:border-dark-border hover:border-gray-300'
              }`}
            >
              <div className="text-left">
                <p className={`font-bold text-base ${selectedBlock === 'BLOCK1' ? 'text-brand-green' : 'text-gray-800 dark:text-gray-100'}`}>
                  Block 1
                </p>
                <p className="text-xs text-gray-500 mt-0.5">Units A, B, C — 2 rows each</p>
              </div>
              <div className="flex items-center gap-2">
                {grandTotalEggs > 0 && (
                  <span className="text-xs font-semibold text-brand-green bg-brand-green/10 px-2 py-0.5 rounded-full">
                    {grandTotalEggs} eggs
                  </span>
                )}
                <ChevronDown className={`w-4 h-4 transition-transform ${
                  selectedBlock === 'BLOCK1' ? 'rotate-180 text-brand-green' : 'text-gray-400'
                }`} />
              </div>
            </button>

            <div
              aria-disabled
              className="flex items-center justify-between rounded-xl p-4 border-2 border-dashed border-gray-200 dark:border-dark-border bg-gray-50 dark:bg-dark-bg/40 opacity-70 cursor-not-allowed"
            >
              <div className="text-left">
                <p className="font-bold text-base text-gray-500 dark:text-gray-400">Block 2</p>
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5 font-medium">
                  Under construction
                </p>
              </div>
              <span className="text-[10px] uppercase tracking-wider font-bold text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30 px-2 py-1 rounded-full">
                Unavailable
              </span>
            </div>
          </div>
        </div>

        {/* ── Block 1 unit rows ── */}
        {selectedBlock === 'BLOCK1' && (
          <div className={cardCls}>
            <p className="font-bold text-gray-800 dark:text-gray-100 mb-4">
              Block 1 — Units A, B, C
            </p>
            {UNIT_LETTERS.map(letter => {
              const rowIdxOffset = UNIT_LETTERS.indexOf(letter) * 2;
              const row1 = blockData.BLOCK1.rows[rowIdxOffset];
              const row2 = blockData.BLOCK1.rows[rowIdxOffset + 1];
              const unitEggs = Number(row1?.totalEggs ?? 0) + Number(row2?.totalEggs ?? 0);
              return (
                <div
                  key={letter}
                  className="mb-5 pb-4 border-b border-gray-100 dark:border-dark-border last:border-0"
                >
                  <div className="flex items-center justify-between mb-2">
                    <p className="font-semibold text-sm text-gray-700 dark:text-gray-300">
                      Unit {letter}
                    </p>
                    {unitEggs > 0 && (
                      <span className="text-xs text-brand-green bg-brand-green/10 px-2 py-0.5 rounded-full font-medium">
                        {unitEggs} eggs · {eggsToTrays(unitEggs)}
                      </span>
                    )}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs min-w-[640px]">
                      <thead>
                        <tr>
                          {[
                            'Row', 'Total Birds', 'Total Eggs', 'Starter Eggs',
                            'Broken Unsellable', 'Broken Sellable',
                            'Soft Shell', 'Deformed', 'kg', 'Attendant',
                          ].map(h => (
                            <th key={h} className="text-center text-gray-400 font-medium pb-1.5 px-1">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {[0, 1].map(offset => {
                          const rowIdx = rowIdxOffset + offset;
                          const row = blockData.BLOCK1.rows[rowIdx];
                          return (
                            <tr key={row.rowCode}>
                              <td className="px-1 py-1">
                                <div className="flex items-center justify-center">
                                  <span className="text-xs font-bold text-brand-green bg-brand-green/10 rounded-lg px-2 py-1">
                                    {row.rowCode}
                                  </span>
                                </div>
                              </td>
                              <td className="px-1 py-1"><input type="number" min="0" inputMode="numeric" value={row.totalBirds || ''} onChange={e => updateRow(rowIdx, 'totalBirds', e.target.value)} className={numInput} placeholder="0" /></td>
                              <td className="px-1 py-1"><input type="number" min="0" inputMode="numeric" value={row.totalEggs || ''} onChange={e => updateRow(rowIdx, 'totalEggs', e.target.value)} className={numInput} placeholder="0" /></td>
                              <td className="px-1 py-1"><input type="number" min="0" inputMode="numeric" value={row.starterEggs || ''} onChange={e => updateRow(rowIdx, 'starterEggs', e.target.value)} className={numInput} placeholder="0" /></td>
                              <td className="px-1 py-1"><input type="number" min="0" inputMode="numeric" value={row.brokenUnsellable || ''} onChange={e => updateRow(rowIdx, 'brokenUnsellable', e.target.value)} className={numInput} placeholder="0" /></td>
                              <td className="px-1 py-1"><input type="number" min="0" inputMode="numeric" value={row.brokenSellable || ''} onChange={e => updateRow(rowIdx, 'brokenSellable', e.target.value)} className={numInput} placeholder="0" /></td>
                              <td className="px-1 py-1"><input type="number" min="0" inputMode="numeric" value={row.softShell || ''} onChange={e => updateRow(rowIdx, 'softShell', e.target.value)} className={numInput} placeholder="0" /></td>
                              <td className="px-1 py-1"><input type="number" min="0" inputMode="numeric" value={row.deformed || ''} onChange={e => updateRow(rowIdx, 'deformed', e.target.value)} className={numInput} placeholder="0" /></td>
                              <td className="px-1 py-1"><input type="number" min="0" step="0.1" inputMode="decimal" value={row.weightKg || ''} onChange={e => updateRow(rowIdx, 'weightKg', e.target.value)} className={numInput} placeholder="0" /></td>
                              <td className="px-1 py-1"><input type="text" value={row.attendantName} onChange={e => updateRow(rowIdx, 'attendantName', e.target.value)} placeholder="Name" className={`${numInput} text-left px-2`} /></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Session Feed Consumption ── */}
        <div className={cardCls}>
          <p className={sectionLbl + ' flex items-center gap-2'}>
            <Wheat className="w-4 h-4 text-brand-green" /> Session Feed Consumption ({activeShift}) *
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Feed Dispensed (kg)</label>
              <input {...register('feedKg')} type="number" min="0" step="0.1" inputMode="decimal" className={inputCls} placeholder="e.g. 45.5" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Feed Type Given</label>
              <FeedTypeDropdown register={register} fieldName="feedTypeName" />
            </div>
          </div>
          <p className="text-[11px] text-gray-400 mt-2">
            Production-house feed only. Brooder feed is logged by the Production Manager.
          </p>
        </div>

        {/* ── Environmental Data ── */}
        <div className={cardCls}>
          <p className={sectionLbl + ' flex items-center gap-2'}>
            <Droplet className="w-4 h-4 text-blue-500" /> Environmental Data *
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1 flex items-center gap-1">
                <Droplet className="w-3 h-3" /> Water Consumption (litres)
              </label>
              <input {...register('waterLiters')} type="number" min="0" step="0.1" inputMode="decimal" className={inputCls} placeholder="e.g. 120" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1 flex items-center gap-1">
                <Thermometer className="w-3 h-3" /> House Temperature (°C)
              </label>
              <input {...register('houseTempC')} type="number" min="0" step="0.1" inputMode="decimal" className={inputCls} placeholder="e.g. 24.5" />
            </div>
          </div>
        </div>

        {/* ── Vaccines / Supplements ── */}
        <div className={cardCls}>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide flex items-center gap-2">
              <Syringe className="w-4 h-4 text-rose-500" /> Vaccines &amp; Supplements (optional)
            </p>
            <button
              type="button"
              onClick={() => setVaccines(v => [...v, { kind: 'VACCINE', name: '', dosage: '' }])}
              className="text-xs font-semibold text-brand-green hover:underline flex items-center gap-1"
            >
              <Plus className="w-3 h-3" /> Add entry
            </button>
          </div>
          {vaccines.length === 0 && (
            <p className="text-xs text-gray-400 italic">
              No vaccines or supplements given this session. Entries here will appear in the
              Production Manager's Health page as a historical vaccination log.
            </p>
          )}
          {vaccines.map((v, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-end mb-2">
              <div className="col-span-3">
                <label className="block text-[11px] text-gray-500 mb-1">Type</label>
                <select
                  value={v.kind}
                  onChange={e => setVaccines(prev => prev.map((p, j) => j === i ? { ...p, kind: e.target.value as VaccineEntry['kind'] } : p))}
                  className={inputCls + ' py-2 text-sm'}
                >
                  <option value="VACCINE">Vaccine</option>
                  <option value="SUPPLEMENT">Supplement</option>
                </select>
              </div>
              <div className="col-span-5">
                <label className="block text-[11px] text-gray-500 mb-1">Name</label>
                <input
                  value={v.name}
                  onChange={e => setVaccines(prev => prev.map((p, j) => j === i ? { ...p, name: e.target.value } : p))}
                  className={inputCls + ' py-2 text-sm'}
                  placeholder="e.g. Newcastle ND"
                />
              </div>
              <div className="col-span-3">
                <label className="block text-[11px] text-gray-500 mb-1">Dosage</label>
                <input
                  value={v.dosage}
                  onChange={e => setVaccines(prev => prev.map((p, j) => j === i ? { ...p, dosage: e.target.value } : p))}
                  className={inputCls + ' py-2 text-sm'}
                  placeholder="e.g. 0.5 ml/bird"
                />
              </div>
              <div className="col-span-1 flex justify-end">
                <button
                  type="button"
                  onClick={() => setVaccines(prev => prev.filter((_, j) => j !== i))}
                  className="p-2 text-gray-400 hover:text-red-500"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* ── Grand Totals ── */}
        <div className={cardCls}>
          <p className={sectionLbl}>Grand Totals (auto)</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Total Eggs', value: grandTotalEggs.toLocaleString(), accent: 'text-brand-green' },
              { label: 'Trays', value: eggsToTrays(grandTotalEggs), accent: 'text-brand-green' },
              { label: 'HDP %', value: `${hdp}%`, accent: 'text-amber-600' },
              { label: 'Weight (kg)', value: grandWeightKg.toFixed(1), accent: 'text-gray-700 dark:text-gray-200' },
            ].map(({ label, value, accent }) => (
              <div key={label} className="bg-gray-50 dark:bg-dark-bg rounded-xl p-3 text-center">
                <p className="text-xs text-gray-500">{label}</p>
                <p className={`text-xl font-bold mt-0.5 ${accent}`}>{value}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
            <div className="text-center"><span className="text-gray-500">Starter: </span><span className="text-amber-600 font-semibold">{grandStarterEggs}</span></div>
            <div className="text-center"><span className="text-gray-500">Broken Unsellable: </span><span className="text-red-500 font-semibold">{grandBrokenUnsellable}</span></div>
            <div className="text-center"><span className="text-gray-500">Broken Sellable: </span><span className="text-orange-500 font-semibold">{grandBrokenSellable}</span></div>
            <div className="text-center"><span className="text-gray-500">Soft Shell: </span><span className="text-pink-500 font-semibold">{grandSoftShell}</span></div>
            <div className="text-center"><span className="text-gray-500">Deformed: </span><span className="text-rose-500 font-semibold">{grandDeformed}</span></div>
          </div>
        </div>

        {/* ── Remarks ── */}
        <div className={cardCls}>
          <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
            Remarks
          </label>
          <textarea {...register('remarks')} rows={2} className={`${inputCls} resize-none`} placeholder="Any additional observations..." />
        </div>

        {!isOnline && (
          <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-3 text-amber-700 dark:text-amber-400 text-sm">
            <WifiOff className="w-4 h-4 shrink-0" />
            You're offline. Data will sync when connection is restored.
          </div>
        )}

        {submitError && (
          <div className="flex items-center gap-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-xl p-3 text-red-700 dark:text-red-400 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" /> {submitError}
          </div>
        )}

        <button
          type="submit"
          disabled={!batchId}
          className="w-full bg-brand-green text-white rounded-2xl py-4 text-base font-bold shadow-lg disabled:opacity-60 hover:bg-green-800 transition-colors"
        >
          {isOnline
            ? `Submit ${activeShift} Session — ${grandTotalEggs} Eggs (${eggsToTrays(grandTotalEggs)}) →`
            : `Save Offline — ${grandTotalEggs} Eggs`}
        </button>
        <p className="text-[11px] text-center text-gray-400">
          Submission locks egg counts, feed, environmental and vaccine records together.
          Only the Production Manager may edit after this.
        </p>
      </form>
    </div>
  );
}
