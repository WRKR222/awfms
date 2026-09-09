// src/pages/attendant/BrooderPage.tsx
//
// Redesigned brooder control — cage map and daily logs are unified on one page.
// No tabs. The cage map is always visible.
//
// Daily log is 3 SEPARATE time-gated popups (<BrooderSessionLogModal>, one
// per BrooderSessionKey) instead of one combined form:
//   • Morning  (open until 9am)     — 3am+6am readings, water, vaccines/
//     supplements/treatment, feed, mortalities.
//   • 11am     (11am–1pm)           — one reading, water, vaccines/
//     supplements, mortalities.
//   • 3pm      (3pm–5pm)            — one reading, water, vaccines/
//     supplements, feed, mortalities.
// Which popup is open is decided server-side (farm-local time) via
// useBrooderSessionStatus — the batch panel's buttons and the cage map's
// tap-to-log flow both defer to it rather than the viewer's own clock.
// Cage Reassignment is a separate, always-available action
// (<BrooderReassignModal>) — it isn't part of the daily log any more.
//   • Log history grouped by date with sessions shown as a compact timeline.

import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import dayjs from '../../lib/dayjs';
import {
  Thermometer, Droplets, Sun, AlertTriangle,
  ChevronDown, ChevronUp, Flame, Clock, HeartCrack,
  Syringe, Pill, FlaskConical, CheckCircle2,
  Gauge, ClipboardList,
} from 'lucide-react';
import { BrooderCageMapGrid }        from '../../components/shared/BrooderCageMapGrid';
import { BrooderFeedRequirement }    from '../../components/shared/BrooderFeedRequirement';
import { BrooderLevelAssignModal }   from '../../components/shared/BrooderLevelAssignModal';
import { BrooderSessionLogModal, type BrooderLogPresetScope } from '../../components/shared/BrooderSessionLogModal';
import { BrooderReassignModal }      from '../../components/shared/BrooderReassignModal';
import { BrooderControlStandardPanel } from '../../components/shared/BrooderControlStandardPanel';
import { useBrooderCageMap } from '../../hooks/useBrooderCageMap';
import type { BrooderLevelData, BrooderRowData } from '../../hooks/useBrooderCageMap';
import { useBrooderSessionStatus, type BrooderSessionKey } from '../../hooks/useBrooderSessionStatus';

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

// `dose` is always the dosage exactly as the report/attendant wrote it
// (e.g. "SOLVITA(12MLS/120LTS)") — never a converted figure. `quantityUsed`
// + `unit`, when present, are the amount actually deducted from stock, in
// the store item's own unit (e.g. 0.012 / "L") — see writeHealthUsageLog()
// in production-report-reconciliation.service.ts. Kept as two separate
// fields rather than folded into `dose` so the UI never pairs a converted
// number with the report's un-converted unit (e.g. showing "0.012MLS",
// which is neither the report's dosage nor a correct quantity).
interface VaccineEntry    { name: string; dose: string; route?: string; quantityUsed?: number | null; unit?: string | null; }
interface SupplementEntry { name: string; dose: string; quantityUsed?: number | null; unit?: string | null; }

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
  source:         'GENERAL' | 'ROW_LEVEL' | 'CONFLICT' | null;
  feedKg:         number;
  mortalityCount: number;
  cullingCount:   number;
  // Only present when source === 'CONFLICT' — both a general (whole-batch)
  // and a row/level feed entry exist for this date, which should never
  // happen. feedKg above is the row/level figure; this shows both so it's
  // obvious there's a duplicate to clean up rather than a real double ration.
  feedConflict?:  { generalKg: number; levelKg: number };
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
                {v.quantityUsed != null && (
                  <span className="text-gray-400 dark:text-gray-500">
                    {' '}({v.quantityUsed}{v.unit ?? ''} used)
                  </span>
                )}
              </span>
            ))}
            {(log.supplementsJson && log.supplementsJson.length > 0
              ? log.supplementsJson
              : log.supplement ? [{ name: log.supplement, dose: log.supplementDose ?? '' }] : []
            ).map((s, i) => (
              <span key={i} className="flex items-center gap-1 text-teal-600 dark:text-teal-400">
                <FlaskConical className="w-3 h-3 flex-shrink-0" />
                {s.name}{s.dose ? ` · ${s.dose}` : ''}
                {s.quantityUsed != null && (
                  <span className="text-gray-400 dark:text-gray-500">
                    {' '}({s.quantityUsed}{s.unit ?? ''} used)
                  </span>
                )}
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
  const isGeneral  = record.source === 'GENERAL';
  const isConflict = record.source === 'CONFLICT';
  return (
    <div className="flex gap-2 items-start">
      <div className="flex flex-col items-center pt-0.5">
        <ClipboardList className={`w-3.5 h-3.5 ${isConflict ? 'text-red-500' : 'text-gray-500'}`} />
        <div className="w-px flex-1 bg-gray-200 dark:bg-gray-700 mt-1 min-h-[8px]" />
      </div>
      <div className="pb-3 flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">
            Feed &amp; Mortality
          </span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
            isConflict
              ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'
              : isGeneral
              ? 'bg-gray-100 dark:bg-gray-700 text-gray-500'
              : 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
          }`}>
            {isConflict ? 'Duplicate — general + row/level both logged' : isGeneral ? 'General Record — whole batch' : 'Row/Level breakdown'}
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
        {isConflict && record.feedConflict && (
          <p className="mt-1 text-[10px] text-red-500">
            General record shows {record.feedConflict.generalKg.toFixed(2)}kg and row/level entries show{' '}
            {record.feedConflict.levelKg.toFixed(2)}kg for this date — only the row/level figure is being
            counted above. Delete the general entry for this date (or the row/level ones, whichever is wrong)
            to clear this.
          </p>
        )}
      </div>
    </div>
  );
}

// NOTE: the "Backfill Report" panel that used to live here (and its
// /brooder/batches/:id/backfill-report + backfill-apply calls) has been
// removed — it let Store-issued-but-unlogged quantities be written straight
// into the attendant's own feed/vaccine/supplement/treatment logs, i.e.
// brooder management data being auto-filled/changed from Store's side.
// Store's production reports are informational only for the Director now.

// ── Batch panel — inline below the cage map ───────────────────────────────────

function BatchPanel({ batch }: { batch: BrooderBatch }) {
  const [openSession,   setOpenSession]   = useState<BrooderSessionKey | null>(null);
  const [showReassign,  setShowReassign]  = useState(false);
  const [historyOpen,   setHistoryOpen]   = useState(false);
  const [treatHistOpen, setTreatHistOpen] = useState(false);
  const { data: sessionStatus } = useBrooderSessionStatus();

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

  // Sections the Production Manager has returned for re-recording — surfaced
  // here so the attendant knows exactly what to fix without re-doing the
  // whole day's entry.
  const { data: outstandingReturns = [] } = useQuery<{
    logDate: string;
    sections: { section: string; returnReason: string | null }[];
  }[]>({
    queryKey: ['brooder-outstanding-returns', batch.id],
    queryFn: () => api.get(`/brooder/batches/${batch.id}/outstanding-returns?days=14`).then(r => r.data).catch(() => []),
    staleTime: 30_000,
  });

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

  // Union of every date that has EITHER an environmental log OR a
  // feed/mortality rollup entry, so a day logged only via General Record
  // still shows up in History.
  const allDates = useMemo(() => {
    const dates = new Set<string>([...grouped.map(([d]) => d), ...Object.keys(populationByDate)]);
    return Array.from(dates).sort((a, b) => (a < b ? 1 : -1));
  }, [grouped, populationByDate]);

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

      {/* Sections the Production Manager returned for re-recording */}
      {outstandingReturns.length > 0 && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-xl px-3 py-2 space-y-1">
          <p className="text-[11px] font-bold text-red-700 dark:text-red-400 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" /> Returned for re-recording
          </p>
          {outstandingReturns.map(o => (
            <p key={o.logDate} className="text-[11px] text-red-600 dark:text-red-300">
              {dayjs(o.logDate).format('D MMM')} — {o.sections.map(s => s.section.charAt(0) + s.section.slice(1).toLowerCase()).join(', ')}
              {o.sections[0]?.returnReason ? `: ${o.sections[0].returnReason}` : ''}
            </p>
          ))}
        </div>
      )}

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

      {/* Action buttons — 3 time-gated daily-log popups + reassign */}
      <div className="flex gap-2 flex-wrap">
        {(['MORNING', 'MIDDAY', 'EVENING'] as BrooderSessionKey[]).map(key => {
          const info = sessionStatus?.sessions.find(s => s.key === key);
          const open = info ? info.open : false;
          const shortLabel = key === 'MORNING' ? 'Morning' : key === 'MIDDAY' ? '11am' : '3pm';
          return (
            <button key={key} onClick={() => open && setOpenSession(key)} disabled={!open}
              className={`flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-xs font-semibold transition-colors ${
                open ? 'bg-amber-500 text-white hover:bg-amber-600' : 'bg-gray-100 dark:bg-dark-bg text-gray-400 cursor-not-allowed'
              }`}
              title={info ? (open ? `Open — closes ${info.closesLabel}` : `Opens ${info.opensLabel}, locks ${info.closesLabel}`) : undefined}>
              <ClipboardList className="w-3.5 h-3.5" />
              {shortLabel} Log{open ? '' : ' (closed)'}
            </button>
          );
        })}
        <button onClick={() => setShowReassign(true)}
          className="flex items-center gap-1.5 border border-emerald-200 dark:border-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-xl px-4 py-2.5 text-xs font-semibold hover:bg-emerald-50 dark:hover:bg-emerald-900/10 transition-colors">
          Reassign
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
                          popRecord.source === 'CONFLICT'
                            ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'
                            : popRecord.source === 'GENERAL'
                            ? 'bg-gray-100 dark:bg-gray-700 text-gray-500'
                            : 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                        }`}>
                          {popRecord.source === 'CONFLICT' ? 'Duplicate' : popRecord.source === 'GENERAL' ? 'General Record' : 'Row/Level'}
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

      {openSession && (
        <BrooderSessionLogModal batch={batch} session={openSession} onClose={() => setOpenSession(null)} />
      )}
      {showReassign && (
        <BrooderReassignModal batch={batch} onClose={() => setShowReassign(false)} />
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
  // Tapping a cage on the map opens whichever of the 3 daily-log popups is
  // currently open (server-decided) — pre-scoped to that row/level.
  const { data: sessionStatus } = useBrooderSessionStatus();
  const openSessionKey = sessionStatus?.sessions.find(s => s.open)?.key ?? null;
  const today = sessionStatus?.farmDate ?? dayjs().format('YYYY-MM-DD');

  // ── Auto-pop the current time-slot's daily log ──────────────────────────
  // The attendant shouldn't have to hunt for the right button — as soon as
  // this page opens (e.g. from the "Brooder Management" card), whichever
  // popup is open right now (Morning/11am/3pm) should already be on screen
  // for any batch that hasn't had it recorded yet today. One batch's popup
  // is shown at a time; closing/submitting it advances to the next batch
  // still missing that same popup, if any.
  const batchIdsKey = brooderBatches.map(b => b.id).join(',');
  const { data: sessionCoverage } = useQuery<Record<string, boolean>>({
    queryKey: ['brooder-session-coverage', openSessionKey, today, batchIdsKey],
    queryFn: async () => {
      const entries = await Promise.all(brooderBatches.map(async (b) => {
        const rows: BrooderLog[] = await api.get(`/flock/brooder-logs?batchId=${b.id}&limit=5`)
          .then(r => r.data).catch(() => []);
        const logged = rows.some(l =>
          l.logSession === openSessionKey && dayjs(l.logDate).format('YYYY-MM-DD') === today
        );
        return [b.id, logged] as const;
      }));
      return Object.fromEntries(entries);
    },
    enabled: !!openSessionKey && brooderBatches.length > 0,
    staleTime: 15_000,
  });

  const [autoLogState, setAutoLogState] = useState<{
    session: BrooderSessionKey; queue: BrooderBatch[]; index: number;
  } | null>(null);

  useEffect(() => {
    if (!openSessionKey || !sessionCoverage) return;
    setAutoLogState(prev => {
      // Already built the queue for whichever popup is open right now —
      // don't clobber the attendant's progress through it just because this
      // effect re-ran (e.g. sessionCoverage refetched).
      if (prev && prev.session === openSessionKey) return prev;
      const pending = brooderBatches.filter(b => sessionCoverage[b.id] === false);
      return { session: openSessionKey, queue: pending, index: 0 };
    });
  }, [openSessionKey, sessionCoverage, brooderBatches]);

  const autoLogBatch =
    autoLogState && autoLogState.session === openSessionKey
      ? autoLogState.queue[autoLogState.index] ?? null
      : null;

  const handleAutoLogClose = () => {
    setAutoLogState(prev => (prev ? { ...prev, index: prev.index + 1 } : prev));
  };

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
          onOpenLog={(level, row) => {
            if (!openSessionKey) {
              alert('No daily-log popup is open right now. The Morning popup opens at 12am (closes 9am), the 11am popup opens at 11am (locks 1pm), and the 3pm popup opens at 3pm (closes 5pm).');
              return;
            }
            setLogTarget({ level, row });
          }}
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
      {logTarget && logTargetBatch && logTargetScope && openSessionKey && (
        <BrooderSessionLogModal
          batch={logTargetBatch}
          session={openSessionKey}
          presetScope={logTargetScope}
          onClose={() => setLogTarget(null)}
        />
      )}

      {/* Auto-popped current time-slot log — shown on top, first thing the
          attendant sees, for the first active batch still missing today's
          open popup. Suppressed while the attendant has deliberately opened
          a cage-map-scoped log (logTarget) so the two never stack. */}
      {!logTarget && autoLogBatch && openSessionKey && (
        <BrooderSessionLogModal
          batch={autoLogBatch}
          session={openSessionKey}
          onClose={handleAutoLogClose}
        />
      )}
    </div>
  );
}
