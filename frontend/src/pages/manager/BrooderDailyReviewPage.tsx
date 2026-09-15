// src/pages/manager/BrooderDailyReviewPage.tsx
//
// Production Manager — reviews what the attendant recorded in the brooder
// each day, section by section (Environment, Feed, Mortality, Vaccines,
// Supplements, Treatments). The PM can approve a section, or return just
// that one section with a reason so the attendant re-records only that
// part — the rest of the day's entry is untouched.
//
// Backed by:
//   GET  /brooder/batches/:batchId/daily-review?date=YYYY-MM-DD
//   POST /brooder/batches/:batchId/daily-review   { date, section, status, returnReason? }
//   GET  /brooder/batches/:batchId/outstanding-returns?days=30
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CalendarDays, CheckCircle2, RotateCcw, AlertTriangle, Loader2,
  Droplets, Wheat, HeartCrack, Syringe, FlaskConical, Stethoscope,
} from 'lucide-react';
import { api } from '../../lib/api/client';
import dayjs from '../../lib/dayjs';

interface BrooderBatchLite {
  id: string;
  batchCode: string;
  location: string;
  isActive: boolean;
}

interface ReviewRow {
  id: string | null;
  batchId: string;
  logDate: string;
  section: 'ENVIRONMENT' | 'FEED' | 'MORTALITY' | 'VACCINES' | 'SUPPLEMENTS' | 'TREATMENTS';
  status: 'PENDING' | 'APPROVED' | 'RETURNED';
  reviewedById: string | null;
  reviewedBy?: { id: string; username: string } | null;
  reviewedAt: string | null;
  returnReason: string | null;
  // The actual attendant-recorded data for this batch+day, sourced live
  // from BrooderLog / feed / mortality / treatment tables — independent of
  // review status, so it's populated for backdated days too (see
  // BrooderService.getDailyReviewSectionData on the backend).
  data?: unknown;
}

const SESSION_LABEL: Record<string, string> = {
  MORNING: 'Morning', MIDDAY: 'Midday', EVENING: 'Evening',
};

function fmtNum(n: unknown, suffix = ''): string | null {
  if (n === null || n === undefined || n === '') return null;
  const num = Number(n);
  return Number.isFinite(num) ? `${num}${suffix}` : null;
}

/** Renders the real recorded figures for one section so a reviewed OR
 *  unreviewed day (backdated included) shows actual data, not just a bare
 *  status pill. Each section's `data` shape comes from
 *  BrooderService.getDailyReviewSectionData. */
function SectionData({ section, data }: { section: ReviewRow['section']; data: unknown }) {
  const rows = Array.isArray(data) ? data : [];
  if (rows.length === 0) {
    return <p className="text-xs text-gray-400 italic mb-2">No data recorded for this day.</p>;
  }

  if (section === 'ENVIRONMENT') {
    return (
      <ul className="text-xs text-gray-600 dark:text-gray-300 space-y-1 mb-2">
        {rows.map((r: any, i: number) => {
          // Morning popup records two readings (3am + 6am) instead of one.
          const has3am6am = r.reading3amTemperature != null || r.reading6amTemperature != null
            || r.reading3amHumidityPercent != null || r.reading6amHumidityPercent != null;
          const parts = has3am6am ? [] : [
            fmtNum(r.temperature, '°C'),
            fmtNum(r.humidityPercent, '% RH'),
            fmtNum(r.lightIntensityLux, ' lux'),
          ].filter(Boolean);
          const reading3am = [
            fmtNum(r.reading3amTemperature, '°C'),
            fmtNum(r.reading3amHumidityPercent, '% RH'),
            fmtNum(r.reading3amLightIntensityLux, ' lux'),
          ].filter(Boolean);
          const reading6am = [
            fmtNum(r.reading6amTemperature, '°C'),
            fmtNum(r.reading6amHumidityPercent, '% RH'),
            fmtNum(r.reading6amLightIntensityLux, ' lux'),
          ].filter(Boolean);
          const water = fmtNum(r.waterConsumptionL, ' L water');
          return (
            <li key={i} className="flex items-start gap-1.5">
              <span className="font-semibold text-gray-500 dark:text-gray-400 shrink-0">
                {SESSION_LABEL[r.logSession] ?? 'Daily'}:
              </span>
              <span>
                {has3am6am ? (
                  <>
                    {reading3am.length > 0 && <span>3am: {reading3am.join(' · ')}</span>}
                    {reading3am.length > 0 && reading6am.length > 0 && ' · '}
                    {reading6am.length > 0 && <span>6am: {reading6am.join(' · ')}</span>}
                    {(reading3am.length === 0 && reading6am.length === 0) && '—'}
                  </>
                ) : (parts.length > 0 ? parts.join(' · ') : '—')}
                {water ? ` · ${water}` : ''}
                {r.lightingOk === false ? ' · ⚠ lighting issue' : ''}
              </span>
            </li>
          );
        })}
      </ul>
    );
  }

  if (section === 'FEED') {
    const total = rows.reduce((s: number, r: any) => s + (Number(r.quantityDispensedKg) || 0), 0);
    return (
      <ul className="text-xs text-gray-600 dark:text-gray-300 space-y-1 mb-2">
        <li className="font-semibold text-gray-700 dark:text-gray-200">{total.toLocaleString()} total (units per item)</li>
        {rows.map((r: any, i: number) => (
          <li key={i} className="text-gray-500 dark:text-gray-400">
            {r.feedType} — {Number(r.quantityDispensedKg).toLocaleString()}{r.unit ? ` ${r.unit}` : ''}
            {r.source === 'ROW_LEVEL' && r.levelLabel ? ` (${r.levelLabel})` : ''}
          </li>
        ))}
      </ul>
    );
  }

  if (section === 'MORTALITY') {
    const totalDeaths = rows.reduce((s: number, r: any) => s + (Number(r.mortalityCount) || 0), 0);
    const totalCulls  = rows.reduce((s: number, r: any) => s + (Number(r.cullingCount) || 0), 0);
    return (
      <ul className="text-xs text-gray-600 dark:text-gray-300 space-y-1 mb-2">
        <li className="font-semibold text-gray-700 dark:text-gray-200">
          {totalDeaths} died{totalCulls > 0 ? `, ${totalCulls} culled` : ''}
        </li>
        {rows.map((r: any, i: number) => (
          <li key={i} className="text-gray-500 dark:text-gray-400">
            {r.mortalityCount} died{r.cullingCount ? `, ${r.cullingCount} culled` : ''}
            {r.cause ? ` — ${r.cause}` : ''}
            {r.source === 'ROW_LEVEL' && r.levelLabel ? ` (${r.levelLabel})` : ''}
          </li>
        ))}
      </ul>
    );
  }

  if (section === 'VACCINES' || section === 'SUPPLEMENTS') {
    return (
      <ul className="text-xs text-gray-600 dark:text-gray-300 space-y-1 mb-2">
        {rows.map((r: any, i: number) => (
          <li key={i}>
            <span className="font-semibold text-gray-700 dark:text-gray-200">{r.name || '—'}</span>
            {r.dose ? ` — ${r.dose}` : ''}
            {r.quantityUsed != null ? ` (${r.quantityUsed}${r.unit ? ` ${r.unit}` : ''})` : ''}
            {r.logSession ? ` · ${SESSION_LABEL[r.logSession] ?? r.logSession}` : ''}
          </li>
        ))}
      </ul>
    );
  }

  // TREATMENTS
  return (
    <ul className="text-xs text-gray-600 dark:text-gray-300 space-y-1 mb-2">
      {rows.map((r: any, i: number) => (
        <li key={i}>
          <span className="font-semibold text-gray-700 dark:text-gray-200">{r.drugName}</span>
          {' — '}{r.dose}{r.doseUnit ? ` ${r.doseUnit}` : ''} via {r.route?.replace(/_/g, ' ').toLowerCase() ?? '—'}
          {r.durationDays ? ` · ${r.durationDays}d` : ''}
          {r.quantityUsed != null ? ` · ${r.quantityUsed}${r.quantityUsedUnit ? ` ${r.quantityUsedUnit}` : ''} used from store` : ''}
        </li>
      ))}
    </ul>
  );
}

const SECTION_META: Record<ReviewRow['section'], { label: string; icon: React.ElementType; accent: string }> = {
  ENVIRONMENT: { label: 'Environmental Data', icon: Droplets,   accent: 'text-blue-500' },
  FEED:        { label: 'Feed',               icon: Wheat,      accent: 'text-amber-600' },
  MORTALITY:   { label: 'Mortality',          icon: HeartCrack, accent: 'text-red-500' },
  VACCINES:    { label: 'Vaccines',           icon: Syringe,    accent: 'text-purple-600' },
  SUPPLEMENTS: { label: 'Supplements',        icon: FlaskConical, accent: 'text-teal-600' },
  TREATMENTS:  { label: 'Treatments',         icon: Stethoscope, accent: 'text-rose-500' },
};

const cardCls = 'bg-white dark:bg-dark-card rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-dark-border';
const inputCls = 'w-full border border-gray-200 dark:border-dark-border rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-green';

function StatusPill({ status }: { status: ReviewRow['status'] }) {
  const map = {
    PENDING:  'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300',
    APPROVED: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    RETURNED: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  } as const;
  return (
    <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${map[status]}`}>
      {status}
    </span>
  );
}

function SectionCard({
  row, onApprove, onReturn, busy,
}: {
  row: ReviewRow;
  onApprove: () => void;
  onReturn: (reason: string) => void;
  busy: boolean;
}) {
  const meta = SECTION_META[row.section];
  const Icon = meta.icon;
  const [returning, setReturning] = useState(false);
  const [reason, setReason] = useState('');

  return (
    <div className={cardCls}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
          <Icon className={`w-4 h-4 ${meta.accent}`} /> {meta.label}
        </p>
        <StatusPill status={row.status} />
      </div>

      {row.status === 'RETURNED' && row.returnReason && (
        <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/10 rounded-lg px-2 py-1.5 mb-2">
          Returned: {row.returnReason}
        </p>
      )}
      {row.status === 'APPROVED' && row.reviewedBy?.username && (
        <p className="text-[11px] text-gray-400 mb-2">
          Approved by {row.reviewedBy.username}
          {row.reviewedAt ? ` · ${dayjs(row.reviewedAt).format('D MMM, HH:mm')}` : ''}
        </p>
      )}

      <SectionData section={row.section} data={row.data} />

      {!returning ? (
        <div className="flex gap-2">
          <button
            type="button" disabled={busy || row.status === 'APPROVED'} onClick={onApprove}
            className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold rounded-xl py-2 bg-brand-green/10 text-brand-green disabled:opacity-40"
          >
            <CheckCircle2 className="w-3.5 h-3.5" /> Approve
          </button>
          <button
            type="button" disabled={busy} onClick={() => setReturning(true)}
            className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold rounded-xl py-2 bg-red-50 dark:bg-red-900/20 text-red-600 disabled:opacity-40"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Return for re-recording
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <textarea
            value={reason} onChange={e => setReason(e.target.value)} rows={2}
            className={`${inputCls} resize-none`} placeholder="Reason the attendant needs to re-record this section..."
          />
          <div className="flex gap-2">
            <button
              type="button" disabled={busy || !reason.trim()}
              onClick={() => { onReturn(reason.trim()); setReturning(false); setReason(''); }}
              className="flex-1 text-xs font-semibold rounded-xl py-2 bg-red-600 text-white disabled:opacity-40"
            >
              Confirm return
            </button>
            <button
              type="button" onClick={() => { setReturning(false); setReason(''); }}
              className="flex-1 text-xs font-semibold rounded-xl py-2 bg-gray-100 dark:bg-dark-bg text-gray-500"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function BrooderDailyReviewPage() {
  const qc = useQueryClient();
  const [selectedDate, setSelectedDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [selectedBatchId, setSelectedBatchId] = useState('');

  const { data: allBatches = [] } = useQuery<BrooderBatchLite[]>({
    queryKey: ['batches'],
    queryFn: () => api.get('/flock/batches').then(r => r.data),
    staleTime: 60_000,
  });
  const brooderBatches = allBatches.filter(b => b.location === 'BROODER' && b.isActive);
  const batchId = selectedBatchId || brooderBatches[0]?.id || '';

  const { data: reviewRows = [], isLoading } = useQuery<ReviewRow[]>({
    queryKey: ['brooder-daily-review', batchId, selectedDate],
    queryFn: () => api.get(`/brooder/batches/${batchId}/daily-review`, { params: { date: selectedDate } }).then(r => r.data),
    enabled: !!batchId,
  });

  const { data: outstanding = [] } = useQuery<{ logDate: string; sections: { section: string; returnReason: string | null; reviewedAt: string | null }[] }[]>({
    queryKey: ['brooder-outstanding-returns', batchId],
    queryFn: () => api.get(`/brooder/batches/${batchId}/outstanding-returns`, { params: { days: 30 } }).then(r => r.data),
    enabled: !!batchId,
  });

  const { mutate: setReview, isPending: saving } = useMutation({
    mutationFn: (vars: { section: string; status: 'APPROVED' | 'RETURNED'; returnReason?: string }) =>
      api.post(`/brooder/batches/${batchId}/daily-review`, { date: selectedDate, ...vars }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['brooder-daily-review', batchId, selectedDate] });
      qc.invalidateQueries({ queryKey: ['brooder-outstanding-returns', batchId] });
    },
  });

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto pb-10 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
          <CalendarDays className="w-5 h-5 text-brand-green" /> Brooder Daily Review
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Review what was recorded each day, section by section. Return just the section that's wrong —
          the rest of the day's entry stays as recorded.
        </p>
      </div>

      <div className={cardCls}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Batch</label>
            <select value={batchId} onChange={e => setSelectedBatchId(e.target.value)} className={inputCls}>
              {brooderBatches.length === 0 && <option value="">No active brooder batches</option>}
              {brooderBatches.map(b => (
                <option key={b.id} value={b.id}>{b.batchCode}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Date</label>
            <input type="date" value={selectedDate} max={dayjs().format('YYYY-MM-DD')}
              onChange={e => setSelectedDate(e.target.value)} className={inputCls} />
          </div>
        </div>
      </div>

      {outstanding.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-2xl p-4">
          <p className="text-xs font-bold text-amber-700 dark:text-amber-400 flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4" /> Outstanding returns (last 30 days)
          </p>
          <ul className="space-y-1">
            {outstanding.map(o => (
              <li key={o.logDate} className="text-xs text-amber-700 dark:text-amber-300">
                <button type="button" className="underline font-semibold" onClick={() => setSelectedDate(dayjs(o.logDate).format('YYYY-MM-DD'))}>
                  {dayjs(o.logDate).format('D MMM YYYY')}
                </button>
                {' — '}{o.sections.map(s => SECTION_META[s.section as ReviewRow['section']]?.label ?? s.section).join(', ')}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!batchId ? (
        <p className="text-sm text-gray-400 italic text-center py-10">Select a batch to review its daily entries.</p>
      ) : isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {reviewRows.map(row => (
            <SectionCard
              key={row.section}
              row={row}
              busy={saving}
              onApprove={() => setReview({ section: row.section, status: 'APPROVED' })}
              onReturn={(reason) => setReview({ section: row.section, status: 'RETURNED', returnReason: reason })}
            />
          ))}
        </div>
      )}
    </div>
  );
}
