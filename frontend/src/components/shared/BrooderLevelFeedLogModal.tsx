// src/components/shared/BrooderLevelFeedLogModal.tsx
//
// Log feed dispensed to a specific brooder level, or record that no new
// feed was issued because birds are still consuming carry-forward feed
// from an earlier day.
//
// KEY DESIGN PRINCIPLE — Feeding schedule is ADVISORY ONLY:
//   The HyLine ration (g/bird/day × population) is displayed as a daily
//   and weekly reference so the attendant knows the expected consumption.
//   It is NEVER enforced as a maximum.  The attendant records what was
//   actually issued; the system compares against the schedule to calculate
//   residual carry-forward feed for the store issuance plan.
//
// Two entry modes:
//   1. Feed issued     — standard entry with feed type and kg amount.
//   2. No feed issued  — attendant confirms no new feed was placed;
//                        selects the date of the dispensing whose feed is
//                        still in the trough.  quantityDispensedKg = 0.
//                        This lets the system correctly attribute daily
//                        and weekly consumption against the schedule.
//
// Phase banners (informational only):
//   EARLY (Days 1–2)       — chicks still learning; carry-forward very common.
//   TRANSITION (Days 3–6)  — eating more regularly; partial carry-overs normal.
//   STANDARD (Week 2+)     — established pattern; schedule closely followed.

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import { X, AlertTriangle, Info, CheckCircle, Sprout, Archive } from 'lucide-react';
import { api } from '../../lib/api';
import dayjs from '../../lib/dayjs';
import type { BrooderLevelData, BrooderRowData } from '../../hooks/useBrooderCageMap';
import { useIssuableStoreItems, FEED_CATEGORIES } from '../../hooks/useIssuableStoreItems';

// Brooder feed logs only accept these 3 feedType enum values server-side
// (see CreateLevelFeedLogSchema). Store items are matched to a feedType by
// SKU so a dynamically-issued item can still be logged correctly — SKUs
// match the ones seeded in prisma/seed.ts and used by IssuancePlanService.
const SKU_TO_FEED_TYPE: Record<string, 'CHICK_MASH' | 'GROWER_MASH' | 'LAYER_MASH'> = {
  'FEED-CHICK-MASH':  'CHICK_MASH',
  'FEED-GROWER-MASH': 'GROWER_MASH',
  'FEED-LAYER-MASH':  'LAYER_MASH',
};

// ── Phase helpers ────────────────────────────────────────────────────────────
const EARLY_PHASE_DAYS    = 3;
const TRANSITION_END_DAYS = 7;

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

// ── Phase info banner (informational only — no enforcement) ──────────────────
function PhaseBanner({ phase, scheduleKgDay }: {
  phase:         FeedingPhase;
  scheduleKgDay: number | null;
}) {
  if (phase === 'STANDARD') return null;

  const isEarly   = phase === 'EARLY';
  const dayRange  = isEarly ? 'Days 1–2' : 'Days 3–6';
  const name      = isEarly ? 'Early learning phase' : 'Transition phase';
  const cls       = isEarly
    ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300'
    : 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300';

  return (
    <div className={`mx-5 mt-4 rounded-xl p-3 text-xs flex items-start gap-2 border ${cls}`}>
      <Sprout className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
      <div className="space-y-1">
        <p className="font-semibold">{name} ({dayRange}) — schedule is advisory</p>
        {isEarly ? (
          <p>
            Day-old chicks are still learning to eat. Feed placed on Day 1 often
            lasts 2 or more days — <strong>no new issuance may be needed today</strong>.
            {scheduleKgDay !== null && (
              <> The daily schedule reference is <strong>{scheduleKgDay.toFixed(2)} kg</strong>.
              You may issue any amount; any surplus is tracked automatically.</>
            )}
          </p>
        ) : (
          <p>
            Chicks should be eating more regularly now. Small carry-overs from
            earlier days are still normal.
            {scheduleKgDay !== null && (
              <> Daily schedule reference: <strong>{scheduleKgDay.toFixed(2)} kg</strong>.</>
            )}
          </p>
        )}
        <p className="opacity-80">
          Any unconsumed feed is tracked and deducted from the next store
          issuance — no waste counted against the farm.
        </p>
      </div>
    </div>
  );
}

// ── Schedule reference banner (STANDARD phase, informational only) ───────────
function ScheduleBanner({
  scheduleKgDay,
  hylineWeek,
  birdCount,
  dispensedToday,
}: {
  scheduleKgDay:  number;
  hylineWeek:     number;
  birdCount:      number;
  dispensedToday: number;
}) {
  const remaining = Math.max(0, scheduleKgDay - dispensedToday);
  const overBy    = dispensedToday > scheduleKgDay
    ? Math.round((dispensedToday - scheduleKgDay) * 100) / 100
    : 0;

  return (
    <div className="mx-5 mt-4 rounded-xl p-3 text-xs flex items-start gap-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400">
      <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
      <div className="space-y-0.5">
        <p className="font-semibold">
          HyLine Week {hylineWeek} schedule — {scheduleKgDay.toFixed(2)} kg/day
          ({birdCount.toLocaleString()} birds) · <span className="font-normal opacity-75">advisory only</span>
        </p>
        <p>
          Dispensed today: <strong>{dispensedToday.toFixed(2)} kg</strong>
          {remaining > 0 && <> · Schedule balance: <strong>{remaining.toFixed(2)} kg</strong></>}
          {overBy > 0 && (
            <> · <span className="text-amber-600 dark:text-amber-300 font-semibold">
              +{overBy.toFixed(2)} kg above schedule
            </span> — surplus tracked as carry-forward</>
          )}
        </p>
        <p className="opacity-70 text-[10px]">
          You may issue any amount. The schedule is used only for planning store issuance and residual feed tracking.
        </p>
      </div>
    </div>
  );
}

// ── Recent feed-log dates for "carry-from" picker ────────────────────────────
function useRecentFeedLogDates(levelId: string) {
  return useQuery<{ id: string; entryDate: string; quantityDispensedKg: number }[]>({
    queryKey: ['brooder-level-feed-logs-recent', levelId],
    queryFn:  () =>
      api.get(`/brooder/levels/${levelId}/feed-logs?limit=10`).then(r =>
        // Filter to entries that actually dispensed feed (>0 kg)
        (r.data as any[]).filter((e: any) => Number(e.quantityDispensedKg) > 0),
      ),
    staleTime: 30_000,
  });
}

// ── Main component ───────────────────────────────────────────────────────────

export function BrooderLevelFeedLogModal({ level, row, onClose }: Props) {
  const qc    = useQueryClient();
  const today = dayjs().format('YYYY-MM-DD');

  const dateOfHatch  = level.batch?.dateOfHatch ?? null;
  const feedingPhase = getFeedingPhase(dateOfHatch, today);

  const scheduleKgDay  = level.dailyRationKg   ?? null;
  const dispensedToday = level.dispensedKgToday ?? 0;

  // ── Mode toggle ────────────────────────────────────────────────────────────
  const [noFeedIssued, setNoFeedIssued] = useState(false);

  // Recent dispense dates for the carry-from selector
  const { data: recentLogs } = useRecentFeedLogDates(level.levelId);

  // Feed items actually issued out of the store this week. Only items whose
  // SKU maps to a known feedType are selectable (see SKU_TO_FEED_TYPE above).
  const { data: issuableItemsRaw, isLoading: issuableLoading } = useIssuableStoreItems(FEED_CATEGORIES);
  const feedItems = (issuableItemsRaw ?? []).filter(i => SKU_TO_FEED_TYPE[i.sku]);

  const iCls = 'w-full border border-gray-200 dark:border-dark-border rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-dark-bg text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-green';
  const lCls = 'block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1';

  // ── Form (feed issued) ─────────────────────────────────────────────────────
  const issueForm = useForm({
    defaultValues: {
      storeItemId:         '',
      entryDate:           today,
      quantityDispensedKg: '',
      notes:               '',
    },
  });

  // ── Form (no feed issued) ──────────────────────────────────────────────────
  const noFeedForm = useForm({
    defaultValues: {
      storeItemId:  '',
      entryDate:    today,
      carryFromDate: recentLogs?.[0]?.entryDate ?? '',
      notes:        '',
    },
  });

  // ── Advisory variance display (issue form) ────────────────────────────────
  const qty      = Number(issueForm.watch('quantityDispensedKg') || 0);
  const totalAft = dispensedToday + qty;
  const overBy   = scheduleKgDay !== null && totalAft > scheduleKgDay
    ? Math.round((totalAft - scheduleKgDay) * 100) / 100
    : 0;
  const remaining = scheduleKgDay !== null
    ? Math.max(0, Math.round((scheduleKgDay - dispensedToday) * 100) / 100)
    : null;

  const selectedFeedItem = feedItems.find(i => i.id === issueForm.watch('storeItemId'));

  // ── Submit: feed issued ────────────────────────────────────────────────────
  const submitIssue = useMutation({
    mutationFn: (data: any) => {
      const item = feedItems.find(i => i.id === data.storeItemId);
      return api.post('/brooder/feed-logs', {
        noFeedIssued:        false,
        levelId:             level.levelId,
        feedType:            item ? SKU_TO_FEED_TYPE[item.sku] : undefined,
        storeItemId:         data.storeItemId,
        entryDate:           data.entryDate,
        quantityDispensedKg: Number(data.quantityDispensedKg),
        notes:               data.notes || undefined,
      }).then(r => r.data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['brooder-cage-map'] });
      qc.invalidateQueries({ queryKey: ['brooder-feed-summary'] });
      qc.invalidateQueries({ queryKey: ['brooder-level-feed-logs', level.levelId] });
      qc.invalidateQueries({ queryKey: ['brooder-level-feed-logs-recent', level.levelId] });
      qc.invalidateQueries({ queryKey: ['store-issuable-items'] });
      onClose();
    },
  });

  // ── Submit: no feed issued ─────────────────────────────────────────────────
  const submitNoFeed = useMutation({
    mutationFn: (data: any) => {
      const item = feedItems.find(i => i.id === data.storeItemId);
      return api.post('/brooder/feed-logs', {
        noFeedIssued:        true,
        levelId:             level.levelId,
        feedType:            item ? SKU_TO_FEED_TYPE[item.sku] : undefined,
        storeItemId:         data.storeItemId,
        entryDate:           data.entryDate,
        quantityDispensedKg: 0,
        carryFromDate:       data.carryFromDate,
        notes:               data.notes || undefined,
      }).then(r => r.data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['brooder-cage-map'] });
      qc.invalidateQueries({ queryKey: ['brooder-feed-summary'] });
      qc.invalidateQueries({ queryKey: ['brooder-level-feed-logs', level.levelId] });
      qc.invalidateQueries({ queryKey: ['brooder-level-feed-logs-recent', level.levelId] });
      qc.invalidateQueries({ queryKey: ['store-issuable-items'] });
      onClose();
    },
  });

  const isLoading = submitIssue.isPending || submitNoFeed.isPending;
  const serverError =
    (submitIssue.error as any)?.response?.data?.message ??
    (submitNoFeed.error as any)?.response?.data?.message ??
    null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
      <div className="bg-white dark:bg-dark-card w-full md:max-w-lg rounded-t-3xl md:rounded-2xl shadow-2xl overflow-y-auto max-h-[95vh]">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-dark-border sticky top-0 bg-white dark:bg-dark-card z-10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-brand-green rounded-xl flex items-center justify-center">
              <span className="text-white text-sm">🌾</span>
            </div>
            <div>
              <p className="font-bold text-gray-800 dark:text-gray-100">Log Feed</p>
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

        {/* ── Mode toggle ─────────────────────────────────────────────────── */}
        <div className="mx-5 mt-4 flex rounded-xl border border-gray-200 dark:border-dark-border overflow-hidden text-xs font-semibold">
          <button
            onClick={() => setNoFeedIssued(false)}
            className={`flex-1 py-2.5 transition-colors ${
              !noFeedIssued
                ? 'bg-brand-green text-white'
                : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-dark-bg'
            }`}
          >
            🌾 Feed Issued
          </button>
          <button
            onClick={() => setNoFeedIssued(true)}
            className={`flex-1 py-2.5 border-l border-gray-200 dark:border-dark-border transition-colors ${
              noFeedIssued
                ? 'bg-brand-green text-white'
                : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-dark-bg'
            }`}
          >
            <span className="flex items-center justify-center gap-1">
              <Archive className="w-3 h-3" />
              No New Feed
            </span>
          </button>
        </div>

        {/* ── Phase info banner ────────────────────────────────────────────── */}
        <PhaseBanner phase={feedingPhase} scheduleKgDay={scheduleKgDay} />

        {/* ── Standard schedule reference banner ──────────────────────────── */}
        {feedingPhase === 'STANDARD' && scheduleKgDay !== null && level.hylineWeek !== null && !noFeedIssued && (
          <ScheduleBanner
            scheduleKgDay={scheduleKgDay}
            hylineWeek={level.hylineWeek}
            birdCount={level.assignment?.birdCount ?? 0}
            dispensedToday={dispensedToday}
          />
        )}

        {/* ════════════════════════════════════════════════════════════════════
            MODE 1 — FEED ISSUED
        ════════════════════════════════════════════════════════════════════ */}
        {!noFeedIssued && (
          <form
            onSubmit={issueForm.handleSubmit(d => submitIssue.mutate(d))}
            className="p-5 space-y-4"
          >
            {/* Feed type */}
            <div>
              <label className={lCls}>Feed type</label>
              <select
                {...issueForm.register('storeItemId', { required: 'Select a feed type' })}
                className={iCls}
                disabled={issuableLoading}
              >
                <option value="">
                  {issuableLoading ? 'Loading issued feed…' : 'Select feed type…'}
                </option>
                {feedItems.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.name} — residual {item.residual.toFixed(2)} {item.unit.toLowerCase()}
                  </option>
                ))}
              </select>
              {issueForm.formState.errors.storeItemId && (
                <p className="text-red-500 text-xs mt-1">{String(issueForm.formState.errors.storeItemId.message)}</p>
              )}
              {!issuableLoading && feedItems.length === 0 && (
                <p className="text-amber-600 dark:text-amber-400 text-xs mt-1 flex items-start gap-1">
                  <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                  No feed has been issued from the store this week yet. Ask Store to stock-out feed before logging.
                </p>
              )}
              {selectedFeedItem && (
                <p className="text-xs mt-1 text-gray-500 dark:text-gray-400">
                  Issued this week: <strong>{selectedFeedItem.issuedThisWeek.toFixed(2)} {selectedFeedItem.unit.toLowerCase()}</strong>
                  {' · '}Already dispensed: <strong>{selectedFeedItem.dispensedThisWeek.toFixed(2)} {selectedFeedItem.unit.toLowerCase()}</strong>
                  {' · '}Residual: <strong className={selectedFeedItem.residual === 0 ? 'text-red-500' : ''}>
                    {selectedFeedItem.residual.toFixed(2)} {selectedFeedItem.unit.toLowerCase()}
                  </strong>
                </p>
              )}
            </div>

            {/* Date */}
            <div>
              <label className={lCls}>Date</label>
              <input
                {...issueForm.register('entryDate', { required: true })}
                type="date" max={today}
                className={iCls}
              />
            </div>

            {/* Quantity — no max enforced */}
            <div>
              <label className={lCls}>
                Quantity dispensed (kg)
                <span className="ml-1 font-normal text-green-600 dark:text-green-400 normal-case">
                  — no maximum enforced
                </span>
              </label>
              <input
                {...issueForm.register('quantityDispensedKg', {
                  required: 'Enter a quantity',
                  min: { value: 0.01, message: 'Must be > 0' },
                })}
                type="number" step="0.01" min="0.01"
                className={iCls}
                placeholder={
                  remaining !== null && remaining > 0
                    ? `Schedule balance: ${remaining.toFixed(2)} kg`
                    : scheduleKgDay !== null
                    ? `Schedule: ${scheduleKgDay.toFixed(2)} kg/day`
                    : 'e.g. 5.50'
                }
              />
              {issueForm.formState.errors.quantityDispensedKg && (
                <p className="text-red-500 text-xs mt-1">{String(issueForm.formState.errors.quantityDispensedKg.message)}</p>
              )}
            </div>

            {/* Advisory note when above schedule */}
            {overBy > 0 && qty > 0 && (
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-3 text-xs text-amber-700 dark:text-amber-400 flex items-start gap-2">
                <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Above schedule (+{overBy.toFixed(2)} kg) — allowed</p>
                  <p className="mt-0.5">
                    The schedule is advisory only. The extra {overBy.toFixed(2)} kg will be
                    automatically tracked as a carry-forward and deducted from the
                    next store issuance — no manual adjustment needed.
                  </p>
                </div>
              </div>
            )}

            {/* Notes */}
            <div>
              <label className={lCls}>Notes (optional)</label>
              <textarea
                {...issueForm.register('notes')}
                rows={2}
                className={`${iCls} resize-none`}
                placeholder={
                  feedingPhase === 'EARLY'
                    ? 'e.g. Topped up — some feed still present from Day 1…'
                    : 'Any observations…'
                }
              />
            </div>

            {serverError && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-3 text-sm text-red-600 dark:text-red-400">
                {serverError}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose}
                className="flex-1 border border-gray-200 dark:border-dark-border text-gray-600 dark:text-gray-400 rounded-xl py-3 font-semibold">
                Cancel
              </button>
              <button type="submit" disabled={isLoading}
                className="flex-1 bg-brand-green text-white rounded-xl py-3 font-semibold disabled:opacity-60">
                {isLoading ? 'Saving…' : 'Log Feed'}
              </button>
            </div>
          </form>
        )}

        {/* ════════════════════════════════════════════════════════════════════
            MODE 2 — NO NEW FEED ISSUED
        ════════════════════════════════════════════════════════════════════ */}
        {noFeedIssued && (
          <form
            onSubmit={noFeedForm.handleSubmit(d => submitNoFeed.mutate(d))}
            className="p-5 space-y-4"
          >
            {/* Explanation banner */}
            <div className="rounded-xl p-3 text-xs flex items-start gap-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400">
              <Archive className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-semibold">Birds are still eating carry-forward feed</p>
                <p>
                  Use this when the birds have feed remaining from a previous dispensing
                  and no new feed needs to be added today. Select the date the feed was
                  originally issued so the system can account for it correctly in the
                  store issuance plan.
                </p>
              </div>
            </div>

            {/* Feed type */}
            <div>
              <label className={lCls}>Feed type in trough</label>
              <select
                {...noFeedForm.register('storeItemId', { required: 'Select the feed type currently in the trough' })}
                className={iCls}
                disabled={issuableLoading}
              >
                <option value="">
                  {issuableLoading ? 'Loading issued feed…' : 'Select feed type…'}
                </option>
                {feedItems.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.name} — residual {item.residual.toFixed(2)} {item.unit.toLowerCase()}
                  </option>
                ))}
              </select>
              {noFeedForm.formState.errors.storeItemId && (
                <p className="text-red-500 text-xs mt-1">{String(noFeedForm.formState.errors.storeItemId.message)}</p>
              )}
            </div>

            {/* Today's date */}
            <div>
              <label className={lCls}>Check date (today)</label>
              <input
                {...noFeedForm.register('entryDate', { required: true })}
                type="date" max={today}
                className={iCls}
              />
            </div>

            {/* Carry-from date */}
            <div>
              <label className={lCls}>
                Feed was dispensed on…
                <span className="ml-1 font-normal text-gray-400">— which day's feed are the birds eating?</span>
              </label>
              {recentLogs && recentLogs.length > 0 ? (
                <select
                  {...noFeedForm.register('carryFromDate', { required: 'Select the dispensing date' })}
                  className={iCls}
                >
                  <option value="">Select dispensing date…</option>
                  {recentLogs.map(log => (
                    <option key={log.id} value={log.entryDate}>
                      {dayjs(log.entryDate).format('ddd D MMM YYYY')} — {Number(log.quantityDispensedKg).toFixed(2)} kg
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  {...noFeedForm.register('carryFromDate', {
                    required: 'Enter the date feed was dispensed',
                    pattern:  { value: /^\d{4}-\d{2}-\d{2}$/, message: 'Use YYYY-MM-DD format' },
                  })}
                  type="date" max={today}
                  className={iCls}
                />
              )}
              {noFeedForm.formState.errors.carryFromDate && (
                <p className="text-red-500 text-xs mt-1">{String(noFeedForm.formState.errors.carryFromDate.message)}</p>
              )}
            </div>

            {/* Notes */}
            <div>
              <label className={lCls}>Notes (optional)</label>
              <textarea
                {...noFeedForm.register('notes')}
                rows={2}
                className={`${iCls} resize-none`}
                placeholder="e.g. Trough still half-full from yesterday's morning dispense…"
              />
            </div>

            {serverError && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-3 text-sm text-red-600 dark:text-red-400">
                {serverError}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose}
                className="flex-1 border border-gray-200 dark:border-dark-border text-gray-600 dark:text-gray-400 rounded-xl py-3 font-semibold">
                Cancel
              </button>
              <button type="submit" disabled={isLoading}
                className="flex-1 bg-brand-green text-white rounded-xl py-3 font-semibold disabled:opacity-60">
                {isLoading ? 'Saving…' : 'Record — No Feed Issued'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
