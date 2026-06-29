// src/components/shared/BrooderLevelFeedLogModal.tsx
//
// Log feed dispensed to a specific brooder level.
//
// Phase-aware enforcement:
//   • EARLY phase (Days 1–2 of Week 1): HyLine ration is shown as ADVISORY only.
//     The hard-block is lifted on the server.  A clear info banner explains that
//     chicks are still learning to eat and the initial day-1 feed may last 2+ days.
//     No error is shown if the attendant enters less than the advisory amount.
//   • TRANSITION phase (Days 3–6): softer messaging — chicks should be eating
//     more regularly; partial shortfalls are expected.  Over-issue still warned.
//   • STANDARD phase (Week 2+): original hard-cap enforcement; server blocks
//     any issuance that exceeds the daily HyLine ration.
//
// Residual carry-forward note is shown in all phases so attendants understand
// that any unconsumed feed from early days will be deducted from next week's
// store issuance automatically.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { X, AlertTriangle, Info, CheckCircle, Sprout } from 'lucide-react';
import { api } from '../../lib/api';
import dayjs from '../../lib/dayjs';
import type { BrooderLevelData, BrooderRowData } from '../../hooks/useBrooderCageMap';

const FEED_TYPE_OPTIONS = [
  { value: 'CHICK_MASH',  label: 'Chick & Duckling Mash' },
  { value: 'GROWER_MASH', label: "Grower's Mash" },
  { value: 'LAYER_MASH',  label: "Layer's Mash" },
] as const;

// ── Phase helpers (mirror of feed-standard.util.ts constants) ────────────────
const EARLY_PHASE_DAYS      = 3;
const TRANSITION_END_DAYS   = 7;

type FeedingPhase = 'EARLY' | 'TRANSITION' | 'STANDARD';

function getFeedingPhase(dateOfHatch: string | null | undefined, today: string): FeedingPhase {
  if (!dateOfHatch) return 'STANDARD';
  const ageInDays = dayjs(today).diff(dayjs(dateOfHatch), 'day');
  if (ageInDays < EARLY_PHASE_DAYS)    return 'EARLY';
  if (ageInDays < TRANSITION_END_DAYS) return 'TRANSITION';
  return 'STANDARD';
}

// ── Props ────────────────────────────────────────────────────────────────────

interface Props {
  level:   BrooderLevelData;
  row:     BrooderRowData;
  onClose: () => void;
}

// ── Early-phase banner ───────────────────────────────────────────────────────

function EarlyPhaseBanner({ phase, advisoryKg, dispensedToday }: {
  phase: FeedingPhase;
  advisoryKg: number | null;
  dispensedToday: number;
}) {
  if (phase === 'STANDARD') return null;

  const isEarly      = phase === 'EARLY';
  const dayRange     = isEarly ? 'Days 1–2' : 'Days 3–6';
  const phaseName    = isEarly ? 'Early learning phase' : 'Transition phase';
  const bgClass      = isEarly
    ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300'
    : 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300';

  return (
    <div className={`mx-5 mt-4 rounded-xl p-3 text-xs flex items-start gap-2 border ${bgClass}`}>
      <Sprout className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
      <div className="space-y-1">
        <p className="font-semibold">
          {phaseName} ({dayRange}) — advisory issuance only
        </p>
        {isEarly ? (
          <p>
            Day-old chicks are still learning to eat. Feed placed on Day 1 often lasts
            2 or more days — <strong>no issuance may be needed today</strong> if there is
            still feed in the trough from earlier.
            {advisoryKg !== null && (
              <> The HyLine advisory cap is <strong>{advisoryKg.toFixed(2)} kg</strong>; the
              server will accept up to this amount and log any excess as carry-over.</>
            )}
          </p>
        ) : (
          <p>
            Chicks should be eating more regularly now. Small carry-overs from
            early days are still normal.
            {advisoryKg !== null && (
              <> Advisory daily cap: <strong>{advisoryKg.toFixed(2)} kg</strong>
              {dispensedToday > 0 && <> · Dispensed today: <strong>{dispensedToday.toFixed(2)} kg</strong></>}.</>
            )}
          </p>
        )}
        <p className="opacity-80">
          Any unconsumed feed from these early days is automatically tracked and
          deducted from next week&rsquo;s store issuance request — no waste.
        </p>
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export function BrooderLevelFeedLogModal({ level, row, onClose }: Props) {
  const qc    = useQueryClient();
  const today = dayjs().format('YYYY-MM-DD');

  const dateOfHatch   = level.batch?.dateOfHatch ?? null;
  const feedingPhase  = getFeedingPhase(dateOfHatch, today);
  const isStandard    = feedingPhase === 'STANDARD';

  const dailyRationKg  = level.dailyRationKg    ?? null;
  const dispensedToday = level.dispensedKgToday  ?? 0;
  const remainingKg    = (isStandard && dailyRationKg !== null)
    ? Math.max(0, Math.round((dailyRationKg - dispensedToday) * 100) / 100)
    : null;

  const iCls = 'w-full border border-gray-200 dark:border-dark-border rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-green';
  const lCls = 'block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1';

  const { register, handleSubmit, watch, formState: { errors } } = useForm({
    defaultValues: {
      feedType:            '',
      entryDate:           today,
      quantityDispensedKg: '',
      notes:               '',
    },
  });

  const qty = Number(watch('quantityDispensedKg') || 0);

  // In STANDARD mode: warn and block client-side if over ration.
  // In EARLY/TRANSITION: only warn (no block) if over advisory cap.
  const wouldExceedRation = isStandard && dailyRationKg !== null && (dispensedToday + qty) > dailyRationKg;
  const overByKg = (isStandard && dailyRationKg !== null)
    ? Math.max(0, Math.round(((dispensedToday + qty) - dailyRationKg) * 100) / 100)
    : 0;
  // Advisory soft-warn for early/transition
  const wouldExceedAdvisory = !isStandard && dailyRationKg !== null && (dispensedToday + qty) > dailyRationKg;
  const advisoryOverByKg = (!isStandard && dailyRationKg !== null)
    ? Math.max(0, Math.round(((dispensedToday + qty) - dailyRationKg) * 100) / 100)
    : 0;

  const submit = useMutation({
    mutationFn: (data: any) =>
      api.post('/brooder/feed-logs', {
        levelId:             level.levelId,
        feedType:            data.feedType,
        entryDate:           data.entryDate,
        quantityDispensedKg: Number(data.quantityDispensedKg),
        notes:               data.notes || undefined,
      }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['brooder-cage-map'] });
      qc.invalidateQueries({ queryKey: ['brooder-feed-summary'] });
      qc.invalidateQueries({ queryKey: ['brooder-level-feed-logs', level.levelId] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
      <div className="bg-white dark:bg-dark-card w-full md:max-w-lg rounded-t-3xl md:rounded-2xl shadow-2xl overflow-y-auto max-h-[95vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-dark-border sticky top-0 bg-white dark:bg-dark-card z-10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-brand-green rounded-xl flex items-center justify-center">
              <span className="text-white text-sm">🌾</span>
            </div>
            <div>
              <p className="font-bold text-gray-800 dark:text-gray-100">Log Feed Dispensed</p>
              <p className="text-xs text-gray-400">
                {row.label} · {level.label}
                {level.batch && ` · ${level.batch.batchCode}`}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-dark-bg transition-colors">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Early / Transition phase banner */}
        <EarlyPhaseBanner
          phase={feedingPhase}
          advisoryKg={dailyRationKg}
          dispensedToday={dispensedToday}
        />

        {/* Standard daily ration banner (Req 3) — only in STANDARD phase */}
        {isStandard && dailyRationKg !== null && level.hylineWeek !== null && (
          <div className={`mx-5 mt-4 rounded-xl p-3 text-xs flex items-start gap-2 ${
            remainingKg === 0
              ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400'
              : 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400'
          }`}>
            {remainingKg === 0
              ? <CheckCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              : <Info        className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />}
            <div className="space-y-0.5">
              <p className="font-semibold">
                HyLine Week {level.hylineWeek} ration — {dailyRationKg.toFixed(2)} kg/day
                ({level.assignment?.birdCount ?? 0} birds)
              </p>
              <p>
                Already dispensed today: <strong>{dispensedToday.toFixed(2)} kg</strong>
                {remainingKg !== null && remainingKg > 0 && (
                  <> · Remaining: <strong>{remainingKg.toFixed(2)} kg</strong></>
                )}
                {remainingKg === 0 && <> · Daily ration fully met</>}
              </p>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit(d => submit.mutate(d))} className="p-5 space-y-4">
          {/* Feed type */}
          <div>
            <label className={lCls}>Feed type</label>
            <select
              {...register('feedType', { required: 'Select a feed type' })}
              className={iCls}
            >
              <option value="">Select feed type…</option>
              {FEED_TYPE_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            {errors.feedType && (
              <p className="text-red-500 text-xs mt-1">{String(errors.feedType.message)}</p>
            )}
          </div>

          {/* Date */}
          <div>
            <label className={lCls}>Date</label>
            <input
              {...register('entryDate', { required: true })}
              type="date"
              max={today}
              className={iCls}
            />
          </div>

          {/* Quantity */}
          <div>
            <label className={lCls}>
              Quantity dispensed (kg)
              {!isStandard && (
                <span className="ml-1 font-normal text-blue-500 dark:text-blue-400 normal-case">
                  — advisory, not enforced
                </span>
              )}
            </label>
            <input
              {...register('quantityDispensedKg', {
                required: 'Enter a quantity',
                min: { value: 0.01, message: 'Must be > 0' },
                validate: v => {
                  // Hard-block client-side ONLY in STANDARD phase
                  if (isStandard && remainingKg !== null && Number(v) > (remainingKg + 0.001)) {
                    return `Exceeds remaining daily ration (${remainingKg.toFixed(2)} kg left)`;
                  }
                  return true;
                },
              })}
              type="number" step="0.01" min="0.01"
              className={`${iCls} ${wouldExceedRation ? 'border-red-400 ring-red-200' : ''}`}
              placeholder={
                isStandard && remainingKg !== null
                  ? `Max ${remainingKg.toFixed(2)} kg`
                  : dailyRationKg !== null
                  ? `Advisory max ${dailyRationKg.toFixed(2)} kg`
                  : 'e.g. 5.50'
              }
            />
            {errors.quantityDispensedKg && (
              <p className="text-red-500 text-xs mt-1">{String(errors.quantityDispensedKg.message)}</p>
            )}
          </div>

          {/* Hard over-issue warning — STANDARD phase (Req 3) */}
          {isStandard && wouldExceedRation && qty > 0 && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-3 text-xs text-red-700 dark:text-red-400 flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Feed over-issue — will be blocked by server</p>
                <p className="mt-0.5">
                  This quantity exceeds the daily ration by{' '}
                  <strong>{overByKg.toFixed(2)} kg</strong>.
                  Reduce to {remainingKg?.toFixed(2) ?? '—'} kg or less.
                  Any excess from previous logs should be deducted from tomorrow&rsquo;s issuance.
                </p>
              </div>
            </div>
          )}

          {/* Soft advisory warning — EARLY / TRANSITION phase */}
          {!isStandard && wouldExceedAdvisory && qty > 0 && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-3 text-xs text-amber-700 dark:text-amber-400 flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Above advisory cap (+{advisoryOverByKg.toFixed(2)} kg)</p>
                <p className="mt-0.5">
                  This is above the HyLine advisory cap for the {feedingPhase.toLowerCase()} phase,
                  but <strong>will still be accepted</strong> since chicks are still learning to eat.
                  The excess will be logged as early-phase carry-over and deducted from the next
                  store issuance automatically.
                </p>
              </div>
            </div>
          )}

          {/* Notes */}
          <div>
            <label className={lCls}>Notes (optional)</label>
            <textarea
              {...register('notes')}
              rows={2}
              className={`${iCls} resize-none`}
              placeholder={
                feedingPhase === 'EARLY'
                  ? 'e.g. Feed still present from Day 1, only topped up…'
                  : 'Any observations…'
              }
            />
          </div>

          {/* Server error */}
          {submit.isError && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-3 text-sm text-red-600 dark:text-red-400">
              {(submit.error as any)?.response?.data?.message ?? 'Failed to save. Please try again.'}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button" onClick={onClose}
              className="flex-1 border border-gray-200 dark:border-dark-border text-gray-600 dark:text-gray-400 rounded-xl py-3 font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submit.isPending || (isStandard && wouldExceedRation)}
              className="flex-1 bg-brand-green text-white rounded-xl py-3 font-semibold disabled:opacity-60"
            >
              {submit.isPending ? 'Saving…' : 'Log Feed'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
