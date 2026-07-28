// src/pages/attendant/BrooderPage.tsx
//
// Redesigned brooder control — cage map and daily logs are unified on one page.
// No tabs. The cage map is always visible.
//
// Changes from v2:
//   • Session Log, Daily Entry, Treatment, Feed, and Mortality are now ONE
//     combined form (<BrooderDailyLogModal>) submitted in a single action —
//     Treatment is optional (fill if any), Feed is always logged for the
//     whole unit, and Mortality can be logged either per row/level/cage or
//     against the whole batch (General), whichever the farm uses.
//   • The cage map's old "Reassign" action, and its separate Feed Log /
//     Weighing / Mortality / Log Heat actions, have been removed. Tapping
//     an occupied cage (or its one remaining action button) now opens the
//     combined Daily Log form, pre-scoped to that row/level.
//   • Log history grouped by date with sessions shown as a compact timeline.

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import dayjs from '../../lib/dayjs';
import {
  Thermometer, Droplets, Sun, AlertTriangle,
  ChevronDown, ChevronUp, Flame, Clock, HeartCrack,
  Syringe, Pill, FlaskConical, CheckCircle2,
  Gauge, ClipboardList, Scale,
} from 'lucide-react';
import { BrooderCageMapGrid }        from '../../components/shared/BrooderCageMapGrid';
import { BrooderFeedRequirement }    from '../../components/shared/BrooderFeedRequirement';
import { BrooderLevelAssignModal }   from '../../components/shared/BrooderLevelAssignModal';
import { BrooderDailyLogModal, type BrooderLogPresetScope } from '../../components/shared/BrooderDailyLogModal';
import { BrooderControlStandardPanel } from '../../components/shared/BrooderControlStandardPanel';
import { useBrooderCageMap } from '../../hooks/useBrooderCageMap';
import type { BrooderLevelData, BrooderRowData } from '../../hooks/useBrooderCageMap';

// ── Constants ─────────────────────────────────────────────────────────────────

const SESSION_OPTIONS = [
  { value: 'MORNING', label: 'Morning',  icon: '🌅', color: 'text-orange-500' },
  { value: 'MIDDAY',  label: 'Midday',   icon: '☀️',  color: 'text-amber-500'  },
  { value: 'EVENING', label: 'Evening',  icon: '🌙',  color: 'text-indigo-500' },
] as const;

// ── Types ─────────────────────────────────────────────────────────────────────

interface BrooderBatch {
  id:               string;
  batchCode:        string;
  currentBirdCount: number;
  quantityReceived: number;
  dateOfHatch:      string;
  stage:            string;
  location:         string;
  supplierName?:    string;
  supplier?:        { name: string };
  isActive:         boolean;
}

interface VaccineEntry    { name: string; dose: string; route?: string; }
interface SupplementEntry { name: string; dose: string; }

interface BrooderLog {
  id:                string;
  batchId:           string;
  logDate:           string;
  logSession?:       'MORNING' | 'MIDDAY' | 'EVENING' | null;
  waterConsumptionL?: number;
  temperature?:      number;
  humidityPercent?:  number;
  lightIntensityLux?: number;
  lightingOk:        boolean;
  // Legacy single-entry fields (still populated for backward compat)
  vaccineGiven?:     string;
  vaccineGivenDose?: string;
  supplement?:       string;
  supplementDose?:   string;
  // Preferred multi-entry JSON arrays
  vaccinesJson?:     VaccineEntry[]    | null;
  supplementsJson?:  SupplementEntry[] | null;
  notes?:            string;
  createdAt?:        string;
  loggedBy?:         { fullName: string };
  row?:              { label: string } | null;
  level?:            { label: string } | null;
}

// Per-day feed/mortality rollup from GET /brooder/batches/:id/population-record-sheet.
// `source` tells you which method covered that date — GENERAL means the Lead
// Attendant used General Record (whole batch, no row/level breakdown);
// ROW_LEVEL means it came from the per-row/level feed & mortality logs. The
// backend enforces these are mutually exclusive per (batch, date), so a date
// only ever has one source.
interface PopulationRecordDay {
  date:           string;
  source:         'GENERAL' | 'ROW_LEVEL' | null;
  feedKg:         number;
  mortalityCount: number;
  cullingCount:   number;
}

// Opening/closing stock reconciliation for a day, from
// GET /brooder/batches/:id/stock-counts.
interface StockCountDay {
  id:                   string;
  logDate:              string;
  openingStock:         number;
  expectedOpeningStock: number | null;
  variance:             number;
  varianceReason?:      string | null;
  closingStock:         number;
  mortalityCount:       number;
  cullingCount:         number;
  notes?:               string | null;
  loggedBy?:            { fullName: string };
}

interface TreatmentLog {
  id:            string;
  batchId:       string;
  treatmentDate: string;
  drugName:      string;
  dose:          string;
  doseUnit:      string;
  route:         string;
  durationDays?: number;
  notes?:        string;
  createdAt?:    string;
  loggedBy?:     { fullName: string };
  row?:          { label: string } | null;
  level?:        { label: string } | null;
}

// ── Session timeline (grouped log history display) ────────────────────────────

function sessionMeta(s?: string | null) {
  // NOTE: a null/missing logSession means this is a Daily Entry (environmental
  // readings logged once for the day rather than per MORNING/MIDDAY/EVENING
  // session) — NOT a "General Record". General Records are a separate concept
  // (batch-wide feed/mortality logged when birds can't be tracked per row/
  // level) rendered by <PopulationRecordSummary>, so the label here must stay
  // distinct from that term or the two get confused in the timeline.
  return SESSION_OPTIONS.find(o => o.value === s) ?? { icon: '📋', label: 'Daily', color: 'text-gray-500' };
}

function SessionEntry({ log }: { log: BrooderLog }) {
  const meta = sessionMeta(log.logSession);
  return (
    <div className="flex gap-2 items-start">
      {/* Timeline dot */}
      <div className="flex flex-col items-center pt-0.5">
        <span className="text-base leading-none">{meta.icon}</span>
        <div className="w-px flex-1 bg-gray-200 dark:bg-gray-700 mt-1 min-h-[8px]" />
      </div>
      {/* Content */}
      <div className="pb-3 flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[11px] font-bold uppercase tracking-wide ${meta.color}`}>
            {meta.label}
          </span>
          {log.createdAt && (
            <span className="text-[10px] text-gray-400 flex items-center gap-0.5">
              <Clock className="w-2.5 h-2.5" />
              {dayjs(log.createdAt).format('HH:mm')}
            </span>
          )}
          {log.loggedBy && (
            <span className="text-[10px] text-gray-400">· {log.loggedBy.fullName}</span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-600 dark:text-gray-300">
          {log.temperature    != null && <span className="flex items-center gap-1"><Thermometer className="w-3 h-3 text-orange-400" />{log.temperature}°C</span>}
          {log.humidityPercent != null && <span className="flex items-center gap-1"><Gauge className="w-3 h-3 text-blue-400" />{log.humidityPercent}%</span>}
          {log.waterConsumptionL != null && <span className="flex items-center gap-1"><Droplets className="w-3 h-3 text-sky-400" />{log.waterConsumptionL}L</span>}
          {log.lightIntensityLux != null && <span className="flex items-center gap-1"><Sun className="w-3 h-3 text-amber-400" />{log.lightIntensityLux} lux</span>}
          {!log.lightingOk && <span className="flex items-center gap-1 text-red-400"><AlertTriangle className="w-3 h-3" />Lighting issue</span>}
        </div>
        {(log.vaccineGiven || log.supplement || log.vaccinesJson?.length || log.supplementsJson?.length) && (
          <div className="mt-1 flex flex-col gap-1 text-[11px]">
            {/* Prefer JSON arrays; fall back to legacy single-entry fields */}
            {(log.vaccinesJson && log.vaccinesJson.length > 0
              ? log.vaccinesJson
              : log.vaccineGiven ? [{ name: log.vaccineGiven, dose: log.vaccineGivenDose ?? '' }] : []
            ).map((v, i) => (
              <span key={i} className="flex items-center gap-1 text-purple-600 dark:text-purple-400">
                <Syringe className="w-3 h-3 flex-shrink-0" />
                {v.name}{v.dose ? ` · ${v.dose}` : ''}
              </span>
            ))}
            {(log.supplementsJson && log.supplementsJson.length > 0
              ? log.supplementsJson
              : log.supplement ? [{ name: log.supplement, dose: log.supplementDose ?? '' }] : []
            ).map((s, i) => (
              <span key={i} className="flex items-center gap-1 text-teal-600 dark:text-teal-400">
                <FlaskConical className="w-3 h-3 flex-shrink-0" />
                {s.name}{s.dose ? ` · ${s.dose}` : ''}
              </span>
            ))}
          </div>
        )}
        {log.notes && <p className="mt-1 text-[10px] text-gray-400 italic">{log.notes}</p>}
      </div>
    </div>
  );
}

function PopulationRecordSummary({ record }: { record: PopulationRecordDay }) {
  const isGeneral = record.source === 'GENERAL';
  return (
    <div className="flex gap-2 items-start">
      <div className="flex flex-col items-center pt-0.5">
        <ClipboardList className="w-3.5 h-3.5 text-gray-500" />
        <div className="w-px flex-1 bg-gray-200 dark:bg-gray-700 mt-1 min-h-[8px]" />
      </div>
      <div className="pb-3 flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">
            Feed &amp; Mortality
          </span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
            isGeneral
              ? 'bg-gray-100 dark:bg-gray-700 text-gray-500'
              : 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
          }`}>
            {isGeneral ? 'General Record — whole batch' : 'Row/Level breakdown'}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-600 dark:text-gray-300">
          {record.feedKg > 0 && <span>Feed: <strong>{record.feedKg.toFixed(2)}kg</strong></span>}
          {record.mortalityCount > 0 && <span>Deaths: <strong>{record.mortalityCount}</strong></span>}
          {record.cullingCount > 0 && <span>Culled: <strong>{record.cullingCount}</strong></span>}
          {record.feedKg === 0 && record.mortalityCount === 0 && record.cullingCount === 0 && (
            <span className="text-gray-400 italic">No feed/mortality recorded</span>
          )}
        </div>
      </div>
    </div>
  );
}

function StockCountSummary({ record }: { record: StockCountDay }) {
  const mismatched = record.variance !== 0;
  return (
    <div className="flex gap-2 items-start">
      <div className="flex flex-col items-center pt-0.5">
        <Gauge className={`w-3.5 h-3.5 ${mismatched ? 'text-red-500' : 'text-indigo-500'}`} />
        <div className="w-px flex-1 bg-gray-200 dark:bg-gray-700 mt-1 min-h-[8px]" />
      </div>
      <div className="pb-3 flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-bold uppercase tracking-wide text-indigo-500">Stock Count</span>
          {mismatched && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 flex items-center gap-1">
              <AlertTriangle className="w-2.5 h-2.5" />
              {record.variance < 0 ? `${Math.abs(record.variance)} fewer than expected` : `${record.variance} more than expected`}
            </span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-600 dark:text-gray-300">
          <span>Opening: <strong>{record.openingStock.toLocaleString()}</strong></span>
          <span>Closing: <strong>{record.closingStock.toLocaleString()}</strong></span>
          {record.expectedOpeningStock != null && mismatched && (
            <span className="text-gray-400">Expected: {record.expectedOpeningStock.toLocaleString()}</span>
          )}
        </div>
        {mismatched && record.varianceReason && (
          <p className="mt-1 text-[10px] text-red-500 dark:text-red-400 italic">Reason: {record.varianceReason}</p>
        )}
        {record.notes && <p className="mt-1 text-[10px] text-gray-400 italic">{record.notes}</p>}
      </div>
    </div>
  );
}

// ── Batch panel — inline below the cage map ───────────────────────────────────

function BatchPanel({ batch }: { batch: BrooderBatch }) {
  const [showDailyLog,  setShowDailyLog]  = useState(false);
  const [historyOpen,   setHistoryOpen]   = useState(false);
  const [treatHistOpen, setTreatHistOpen] = useState(false);

  const ageDays   = dayjs().diff(dayjs(batch.dateOfHatch), 'day');
  // 1-indexed HyLine week (days 0-6 = week 1, 7-13 = week 2, ...). Must match
  // the canonical batchAgeWeeks() in backend/feed-standard.util.ts.
  const ageWeeks  = Math.max(1, Math.floor(Math.max(0, ageDays) / 7) + 1);
  const survival  = batch.quantityReceived > 0
    ? ((batch.currentBirdCount / batch.quantityReceived) * 100).toFixed(1)
    : '—';

  const { data: logs = [] } = useQuery<BrooderLog[]>({
    queryKey: ['brooder-logs', batch.id],
    queryFn:  () => api.get(`/flock/brooder-logs?batchId=${batch.id}&limit=30`).then(r => r.data).catch(() => []),
    enabled:  historyOpen,
    staleTime: 30_000,
  });

  const { data: treatments = [] } = useQuery<TreatmentLog[]>({
    queryKey: ['brooder-treatments', batch.id],
    queryFn:  () => api.get(`/flock/brooder-treatment-logs?batchId=${batch.id}`).then(r => r.data).catch(() => []),
    enabled:  treatHistOpen,
    staleTime: 30_000,
  });

  // Per-day feed/mortality rollup, merging General Record entries with
  // row/level entries and tagging which method covered each date. Using the
  // rollup endpoint (rather than fetching the two raw general-log lists
  // separately) means the "which days are covered, and how" logic lives in
  // one place on the backend instead of being re-derived in the UI.
  const { data: populationSheet = [] } = useQuery<PopulationRecordDay[]>({
    queryKey: ['brooder-population-record-sheet', batch.id],
    queryFn:  () => api.get(`/brooder/batches/${batch.id}/population-record-sheet?days=30`).then(r => r.data).catch(() => []),
    enabled:  historyOpen,
    staleTime: 30_000,
  });

  // Opening/closing stock reconciliation per day — flags days where a
  // physical bird count didn't match the previous day's closing stock.
  const { data: stockCounts = [] } = useQuery<StockCountDay[]>({
    queryKey: ['brooder-stock-counts', batch.id],
    queryFn:  () => api.get(`/brooder/batches/${batch.id}/stock-counts?days=30`).then(r => r.data).catch(() => []),
    staleTime: 30_000,
  });

  // Last log for header summary
  const { data: lastArr = [] } = useQuery<BrooderLog[]>({
    queryKey: ['brooder-last-log', batch.id],
    queryFn:  () => api.get(`/flock/brooder-logs?batchId=${batch.id}&limit=1`).then(r => r.data).catch(() => []),
    staleTime: 60_000,
  });
  const lastLog     = lastArr[0];
  const today       = dayjs().format('YYYY-MM-DD');
  const daysSince   = lastLog ? dayjs(today).diff(dayjs(lastLog.logDate).format('YYYY-MM-DD'), 'day') : null;
  const logOverdue  = daysSince === null || daysSince > 0;

  // Group logs by date
  const grouped = useMemo(() => {
    const map: Record<string, BrooderLog[]> = {};
    for (const log of logs) {
      const d = dayjs(log.logDate).format('YYYY-MM-DD');
      if (!map[d]) map[d] = [];
      map[d].push(log);
    }
    return Object.entries(map).sort(([a], [b]) => (a < b ? 1 : -1));
  }, [logs]);

  // Lookup by date for the feed/mortality rollup (population-record-sheet).
  // Kept separate from `grouped` since these aren't environmental readings —
  // a different data type entirely, and shouldn't count toward the
  // MORNING/MIDDAY/EVENING/Daily completeness tally above.
  const populationByDate = useMemo(() => {
    const map: Record<string, PopulationRecordDay> = {};
    for (const row of populationSheet) map[row.date] = row;
    return map;
  }, [populationSheet]);

  // Lookup by date for the opening/closing stock reconciliation.
  const stockByDate = useMemo(() => {
    const map: Record<string, StockCountDay> = {};
    for (const row of stockCounts) map[dayjs(row.logDate).format('YYYY-MM-DD')] = row;
    return map;
  }, [stockCounts]);

  // Most recent stock count with a variance — surfaced as a header badge so
  // a shrinkage doesn't get buried inside the collapsed history.
  const latestMismatch = useMemo(
    () => [...stockCounts].sort((a, b) => (a.logDate < b.logDate ? 1 : -1)).find(s => s.variance !== 0),
    [stockCounts],
  );

  // Union of every date that has EITHER an environmental log OR a
  // feed/mortality rollup entry OR a stock count, so a day logged only via
  // General Record or a stock count still shows up in History.
  const allDates = useMemo(() => {
    const dates = new Set<string>([...grouped.map(([d]) => d), ...Object.keys(populationByDate), ...Object.keys(stockByDate)]);
    return Array.from(dates).sort((a, b) => (a < b ? 1 : -1));
  }, [grouped, populationByDate, stockByDate]);

  return (
    <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border shadow-sm p-4 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-bold text-gray-800 dark:text-gray-100 text-lg font-mono">{batch.batchCode}</p>
            <span className="text-xs px-2.5 py-1 rounded-full font-semibold bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />Brooder
            </span>
            {logOverdue && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 font-semibold flex items-center gap-1">
                <AlertTriangle className="w-2.5 h-2.5" />
                {daysSince === null ? 'No logs yet' : `${daysSince}d overdue`}
              </span>
            )}
            {latestMismatch && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 font-semibold flex items-center gap-1"
                title={`Opening stock on ${dayjs(latestMismatch.logDate).format('D MMM')} was ${latestMismatch.openingStock.toLocaleString()}, expected ${latestMismatch.expectedOpeningStock?.toLocaleString() ?? '—'}`}>
                <Scale className="w-2.5 h-2.5" />
                Stock mismatch — {dayjs(latestMismatch.logDate).format('D MMM')}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-0.5">
            {batch.supplier?.name ?? batch.supplierName ?? 'Unknown supplier'} · wk {ageWeeks} ({ageDays}d)
          </p>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold text-brand-green">{batch.currentBirdCount.toLocaleString()}</p>
          <p className="text-[10px] text-gray-400">live · {survival}% survival</p>
        </div>
      </div>

      {/* Last log summary strip */}
      {lastLog && (
        <div className="bg-gray-50 dark:bg-dark-bg rounded-xl px-3 py-2 flex items-center gap-3 flex-wrap text-[11px] text-gray-500">
          <span className="font-semibold text-gray-600 dark:text-gray-300">
            Last: {dayjs(lastLog.logDate).format('D MMM')}{' '}
            {lastLog.logSession ? `(${sessionMeta(lastLog.logSession).label})` : ''}
          </span>
          {lastLog.temperature    != null && <span><Thermometer className="w-3 h-3 inline text-orange-400" /> {lastLog.temperature}°C</span>}
          {lastLog.humidityPercent != null && <span><Gauge className="w-3 h-3 inline text-blue-400" /> {lastLog.humidityPercent}%</span>}
          {lastLog.waterConsumptionL != null && <span><Droplets className="w-3 h-3 inline text-sky-400" /> {lastLog.waterConsumptionL}L</span>}
          {lastLog.lightIntensityLux != null && <span><Sun className="w-3 h-3 inline text-amber-400" /> {lastLog.lightIntensityLux}lux</span>}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => setShowDailyLog(true)}
          className="flex items-center gap-1.5 bg-amber-500 text-white rounded-xl px-4 py-2.5 text-xs font-semibold hover:bg-amber-600 transition-colors"
          title="Session log, daily entry, treatment, feed & mortality — one submission">
          <ClipboardList className="w-3.5 h-3.5" />
          {logOverdue && daysSince !== null ? `Daily Log (${daysSince}d missed)` : 'Daily Log'}
        </button>
        <button onClick={() => setHistoryOpen(o => !o)}
          className="flex items-center gap-1.5 border border-gray-200 dark:border-dark-border text-gray-600 dark:text-gray-400 rounded-xl px-4 py-2.5 text-xs font-semibold hover:bg-gray-50 dark:hover:bg-dark-bg transition-colors">
          History
          {historyOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
        <button onClick={() => setTreatHistOpen(o => !o)}
          className="flex items-center gap-1.5 border border-red-200 dark:border-red-900/30 text-red-600 dark:text-red-400 rounded-xl px-4 py-2.5 text-xs font-semibold hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors">
          Treatments
          {treatHistOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* ── Environment log history ── */}
      {historyOpen && (
        <div className="border-t border-gray-100 dark:border-dark-border pt-3 space-y-4">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Environment Log History</p>
          {allDates.length === 0
            ? <p className="text-xs text-gray-400 text-center py-4">No logs yet.</p>
            : allDates.map(date => {
                const dayLogs      = grouped.find(([d]) => d === date)?.[1] ?? [];
                const popRecord    = populationByDate[date];
                const stockRecord  = stockByDate[date];
                const isToday  = date === today;
                const daysAgo  = dayjs(today).diff(dayjs(date), 'day');
                const dateLabel = isToday ? 'Today' : daysAgo === 1 ? 'Yesterday' : `${daysAgo}d ago`;
                const sessionLogs = dayLogs.filter(l => l.logSession != null);
                const hasDailyLog = dayLogs.some(l => l.logSession == null);
                const totalLogged = sessionLogs.length + (hasDailyLog ? 1 : 0);
                const TOTAL_EXPECTED = 4; // MORNING + MIDDAY + EVENING + Daily — environmental readings only
                return (
                  <div key={date}>
                    {/* Day header */}
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className="text-xs font-bold text-gray-700 dark:text-gray-200">
                        {dayjs(date).format('ddd D MMM YYYY')}
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
                        isToday ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                        : daysAgo === 1 ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-500'
                      }`}>{dateLabel}</span>
                      <span className="text-[10px] text-gray-400">
                        {totalLogged}/{TOTAL_EXPECTED} environmental
                        {totalLogged < TOTAL_EXPECTED && (
                          <span className="ml-1 text-amber-500">· {TOTAL_EXPECTED - totalLogged} pending</span>
                        )}
                        {totalLogged >= TOTAL_EXPECTED && (
                          <span className="ml-1 text-green-500 flex items-center gap-0.5 inline-flex">
                            <CheckCircle2 className="w-2.5 h-2.5" /> complete
                          </span>
                        )}
                      </span>
                      {popRecord && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
                          popRecord.source === 'GENERAL'
                            ? 'bg-gray-100 dark:bg-gray-700 text-gray-500'
                            : 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                        }`}>
                          {popRecord.source === 'GENERAL' ? 'General Record' : 'Row/Level'}
                        </span>
                      )}
                    </div>
                    {/* Sessions as timeline (environmental readings — Morning/Midday/Evening/Daily) */}
                    {dayLogs.length > 0 && (
                      <div className="pl-2">
                        {dayLogs
                          .sort((a, b) => {
                            const order = { MORNING: 0, MIDDAY: 1, EVENING: 2 };
                            return (order[a.logSession as keyof typeof order] ?? 3) -
                                   (order[b.logSession as keyof typeof order] ?? 3);
                          })
                          .map(log => <SessionEntry key={log.id} log={log} />)}
                      </div>
                    )}
                    {/* Feed & mortality rollup for the day (General Record or Row/Level) */}
                    {popRecord && (
                      <div className="pl-2 mt-1">
                        <PopulationRecordSummary record={popRecord} />
                      </div>
                    )}
                    {/* Opening/closing stock reconciliation for the day */}
                    {stockRecord && (
                      <div className="pl-2 mt-1">
                        <StockCountSummary record={stockRecord} />
                      </div>
                    )}
                  </div>
                );
              })}
        </div>
      )}

      {/* ── Treatment history ── */}
      {treatHistOpen && (
        <div className="border-t border-gray-100 dark:border-dark-border pt-3 space-y-2">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Treatment History</p>
          {treatments.length === 0
            ? <p className="text-xs text-gray-400 text-center py-4">No treatments recorded.</p>
            : treatments.map(t => (
                <div key={t.id} className="bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30 rounded-xl p-3 text-xs space-y-1">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="font-bold text-red-700 dark:text-red-400 flex items-center gap-1.5">
                      <Pill className="w-3.5 h-3.5" />{t.drugName}
                    </span>
                    <span className="text-[10px] text-gray-400">{dayjs(t.treatmentDate).format('D MMM YYYY')}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-gray-600 dark:text-gray-300">
                    <span>Dose: <strong>{t.dose} {t.doseUnit}</strong></span>
                    <span>Route: {t.route.replace(/_/g, ' ')}</span>
                    {t.durationDays && <span>Duration: {t.durationDays} days</span>}
                    {t.row   && <span>Row: {t.row.label}</span>}
                    {t.level && <span>Level: {t.level.label}</span>}
                  </div>
                  {t.notes && <p className="text-gray-400 italic">{t.notes}</p>}
                  {t.loggedBy && <p className="text-[10px] text-gray-400">by {t.loggedBy.fullName}</p>}
                </div>
              ))}
        </div>
      )}

      {showDailyLog && (
        <BrooderDailyLogModal batch={batch} onClose={() => setShowDailyLog(false)} />
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function BrooderPage() {
  const { data: allBatches = [], isLoading } = useQuery<BrooderBatch[]>({
    queryKey: ['batches'],
    queryFn:  () => api.get('/flock/batches').then(r => r.data),
    staleTime: 60_000,
  });

  const brooderBatches   = allBatches.filter(b => b.location === 'BROODER' && b.isActive);
  const totalBrooderBirds = brooderBatches.reduce((s, b) => s + (b.currentBirdCount ?? 0), 0);

  const { data: cageMapData }                  = useBrooderCageMap();
  const [assignTarget, setAssignTarget]        = useState<{ level: BrooderLevelData; row: BrooderRowData } | null>(null);
  const [logTarget,    setLogTarget]           = useState<{ level: BrooderLevelData; row: BrooderRowData } | null>(null);

  const assignedCountByBatch: Record<string, number> = {};
  if (cageMapData) {
    for (const row of cageMapData.rows) {
      for (const level of row.levels) {
        if (level.assignment) {
          const { batchId, birdCount } = level.assignment;
          assignedCountByBatch[batchId] = (assignedCountByBatch[batchId] ?? 0) + birdCount;
        }
      }
    }
  }

  const handleSelectLevel = (level: BrooderLevelData, row: BrooderRowData) => {
    if (brooderBatches.length > 0) {
      setAssignTarget({ level, row });
    }
  };

  // Full batch record for whichever level's Daily Log form is open — the
  // cage map only gives us batchId/birdCount, so we look up the full
  // batch object (id, currentBirdCount, dateOfHatch, ...) the form needs.
  const logTargetBatch = logTarget?.level.assignment
    ? brooderBatches.find(b => b.id === logTarget.level.assignment!.batchId) ?? null
    : null;
  const logTargetScope: BrooderLogPresetScope | null = logTarget
    ? {
        rowId:      logTarget.row.rowId,
        rowLabel:   logTarget.row.label,
        levelId:    logTarget.level.levelId,
        levelLabel: logTarget.level.label,
        cages:      logTarget.level.cages
          .filter(c => c.assignment)
          .map(c => ({ cageId: c.cageId, label: c.label, birdCount: c.assignment!.birdCount })),
      }
    : null;

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">

      {/* Page header */}
      <div>
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Brooder</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          {brooderBatches.length} active batch{brooderBatches.length !== 1 ? 'es' : ''} ·{' '}
          <span className="font-semibold text-amber-600 dark:text-amber-400">
            {totalBrooderBirds.toLocaleString()} chicks
          </span>{' '}in brooder
        </p>
      </div>

      {/* ── SECTION 1: Control Standard ── */}
      <BrooderControlStandardPanel />

      {/* ── SECTION 2: Feed requirement (daily/weekly toggle) ── */}
      <div className="bg-white dark:bg-dark-card rounded-2xl border border-gray-100 dark:border-dark-border shadow-sm p-4">
        <BrooderFeedRequirement />
      </div>

      {/* ── SECTION 3: Cage Map — view & assign only, plus one Daily Log action ── */}
      <div className="space-y-2">
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-3 text-xs text-amber-700 dark:text-amber-400 flex items-start gap-2">
          <HeartCrack className="w-4 h-4 flex-shrink-0 mt-0.5 text-red-500" />
          <div>
            <p className="font-semibold">Cage Map — tap an empty cage to assign a batch · tap an occupied cage (or its <span className="text-amber-600">Daily Log</span> button) to record session, daily entry, treatment, feed &amp; mortality for that row/level</p>
            <p className="mt-0.5 text-amber-600 dark:text-amber-500">
              Feed is always logged for the whole unit. Mortality can be logged per row/level/cage from the Daily Log form, or against the whole batch from the batch panel below — whichever the farm uses.
            </p>
          </div>
        </div>

        <BrooderCageMapGrid
          onSelectLevel={handleSelectLevel}
          onOpenLog={(level, row) => setLogTarget({ level, row })}
        />
      </div>

      {/* ── SECTION 4: Batch panels — daily log + treatment ── */}
      <div className="space-y-2">
        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">
          Daily Logs &amp; Treatments — per batch
        </p>
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2].map(i => <div key={i} className="h-40 rounded-2xl bg-gray-100 dark:bg-dark-card animate-pulse" />)}
          </div>
        ) : brooderBatches.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <Flame className="w-10 h-10 mx-auto mb-3 opacity-20" />
            <p className="font-semibold">No active brooder batches</p>
            <p className="text-sm mt-1">Register a new batch and assign it to the Brooder from the Batches page.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {brooderBatches.map(b => <BatchPanel key={b.id} batch={b} />)}
          </div>
        )}
      </div>

      {/* Cage map modals */}
      {assignTarget && (
        <BrooderLevelAssignModal
          level={assignTarget.level}
          row={assignTarget.row}
          batches={brooderBatches.map(b => ({
            id: b.id,
            batchCode: b.batchCode,
            currentBirdCount: b.currentBirdCount,
            quantityReceived: b.quantityReceived,
            alreadyAssignedCount:
              (assignedCountByBatch[b.id] ?? 0) -
              (assignTarget.level.assignment?.batchId === b.id
                ? (assignTarget.level.assignment?.birdCount ?? 0)
                : 0),
          }))}
          allRows={cageMapData?.rows ?? []}
          onClose={() => setAssignTarget(null)}
        />
      )}
      {logTarget && logTargetBatch && logTargetScope && (
        <BrooderDailyLogModal
          batch={logTargetBatch}
          presetScope={logTargetScope}
          onClose={() => setLogTarget(null)}
        />
      )}
    </div>
  );
}
