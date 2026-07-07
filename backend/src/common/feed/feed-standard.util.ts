// src/common/feed/feed-standard.util.ts
//
// Single source of truth for "how much feed should a bird eat" — used by
// FeedService (production-house intake recommendations) and BrooderService
// (per-row/per-level required feed for the brooder cage map).
//
// `gramsPerBirdPerDay` preserves FeedService's original table exactly.
// `brooderGramsPerBirdPerDay` uses the HyLine Brown rearing chart.
// `hylineStandard` returns the full week row for threshold checking.
//
// ── No more EARLY / TRANSITION / STANDARD phase discounting ────────────────
//
// This file used to apply a "phase" discount to the schedule for a batch's
// first ~8 days of life (0% enforcement Days 1-3, 50% ration Days 4-8), on
// the theory that day-old chicks eat inconsistently. That system only ever
// mattered in Week 1 (and the first day of Week 2, since the 8-day
// transition window didn't line up with the 7-day week buckets — a batch's
// very first "Week 2" day was still being counted as a half-ration
// transition day, which silently shrank every Week-2+ schedule total).
//
// It's been removed. Every day now counts at the full standard ration
// (`hylineGramsPerBirdPerDay`), so "Schedule" for any week is simply
// `birds × g/bird/day × 7`, adjusted only for actual recorded mortality —
// no more phase-based softening. The concern the phase system was meant to
// catch (chicks not eating yet) is handled separately by
// `isEarlyPhaseNotEating` / the BROODER_EARLY_PHASE_NOT_EATING alert, which
// flags a batch directly if it has recorded zero feed consumption by Day 8 —
// that's the actual clinical signal, not a reason to discount the schedule.

import { FeedType } from '@prisma/client';

// ── HyLine Brown rearing schedule (weeks 1-19) ───────────────────────────────
// Source: chart provided by farm management. "Surviving Birds" and
// "Total Weekly Feed for Flock (Bags)" columns are excluded per spec —
// they are batch-size-dependent. This table is the single truth used for:
//   • Feed consumption control (g/bird/day)
//   • Bird weight control (min/max g at end of week)
//   • Mortality rate control (cumulative %)

export interface HyLineWeekStandard {
  week: number;
  phase: string;
  feedingGramsPerBird: number;   // g/bird/day
  weeklyIntakeKgPerBird: number; // kg/bird/week (= feedingGramsPerBird × 7 / 1000)
  weightMinG: number;            // expected weight lower bound (g)
  weightMaxG: number;            // expected weight upper bound (g)
  cumulativeMortalityPct: number;// cumulative % ceiling at end of this week
}

const HYLINE_SCHEDULE: HyLineWeekStandard[] = [
  { week: 1,  phase: 'Starter Crumbs', feedingGramsPerBird: 16.5, weeklyIntakeKgPerBird: 0.12, weightMinG: 110,  weightMaxG: 117,  cumulativeMortalityPct: 0.4 },
  { week: 2,  phase: 'Starter Crumbs', feedingGramsPerBird: 18.5, weeklyIntakeKgPerBird: 0.13, weightMinG: 119,  weightMaxG: 126,  cumulativeMortalityPct: 0.6 },
  { week: 3,  phase: 'Starter Crumbs', feedingGramsPerBird: 22.0, weeklyIntakeKgPerBird: 0.15, weightMinG: 186,  weightMaxG: 197,  cumulativeMortalityPct: 0.7 },
  { week: 4,  phase: 'Starter Crumbs', feedingGramsPerBird: 27.0, weeklyIntakeKgPerBird: 0.19, weightMinG: 266,  weightMaxG: 281,  cumulativeMortalityPct: 0.8 },
  { week: 5,  phase: 'Starter Crumbs', feedingGramsPerBird: 32.0, weeklyIntakeKgPerBird: 0.22, weightMinG: 357,  weightMaxG: 377,  cumulativeMortalityPct: 0.9 },
  { week: 6,  phase: 'Starter Crumbs', feedingGramsPerBird: 38.5, weeklyIntakeKgPerBird: 0.27, weightMinG: 456,  weightMaxG: 482,  cumulativeMortalityPct: 1.0 },
  { week: 7,  phase: 'Grower',         feedingGramsPerBird: 44.5, weeklyIntakeKgPerBird: 0.31, weightMinG: 561,  weightMaxG: 593,  cumulativeMortalityPct: 1.1 },
  { week: 8,  phase: 'Grower',         feedingGramsPerBird: 50.0, weeklyIntakeKgPerBird: 0.35, weightMinG: 668,  weightMaxG: 706,  cumulativeMortalityPct: 1.2 },
  { week: 9,  phase: 'Grower',         feedingGramsPerBird: 55.0, weeklyIntakeKgPerBird: 0.39, weightMinG: 772,  weightMaxG: 816,  cumulativeMortalityPct: 1.3 },
  { week: 10, phase: 'Grower',         feedingGramsPerBird: 59.0, weeklyIntakeKgPerBird: 0.41, weightMinG: 871,  weightMaxG: 921,  cumulativeMortalityPct: 1.4 },
  { week: 11, phase: 'Developer',      feedingGramsPerBird: 63.0, weeklyIntakeKgPerBird: 0.44, weightMinG: 963,  weightMaxG: 1018, cumulativeMortalityPct: 1.5 },
  { week: 12, phase: 'Developer',      feedingGramsPerBird: 65.5, weeklyIntakeKgPerBird: 0.46, weightMinG: 1046, weightMaxG: 1105, cumulativeMortalityPct: 1.6 },
  { week: 13, phase: 'Developer',      feedingGramsPerBird: 68.0, weeklyIntakeKgPerBird: 0.48, weightMinG: 1120, weightMaxG: 1184, cumulativeMortalityPct: 1.6 },
  { week: 14, phase: 'Developer',      feedingGramsPerBird: 70.5, weeklyIntakeKgPerBird: 0.49, weightMinG: 1186, weightMaxG: 1254, cumulativeMortalityPct: 1.7 },
  { week: 15, phase: 'Developer',      feedingGramsPerBird: 72.5, weeklyIntakeKgPerBird: 0.51, weightMinG: 1246, weightMaxG: 1317, cumulativeMortalityPct: 1.8 },
  { week: 16, phase: 'Developer',      feedingGramsPerBird: 75.5, weeklyIntakeKgPerBird: 0.53, weightMinG: 1302, weightMaxG: 1377, cumulativeMortalityPct: 1.9 },
  { week: 17, phase: 'Prelayer',       feedingGramsPerBird: 79.5, weeklyIntakeKgPerBird: 0.56, weightMinG: 1357, weightMaxG: 1434, cumulativeMortalityPct: 2.0 },
  { week: 18, phase: 'Prelayer',       feedingGramsPerBird: 83.5, weeklyIntakeKgPerBird: 0.58, weightMinG: 1411, weightMaxG: 1492, cumulativeMortalityPct: 2.0 },
  { week: 19, phase: 'Prelayer',       feedingGramsPerBird: 89.0, weeklyIntakeKgPerBird: 0.62, weightMinG: 1467, weightMaxG: 1551, cumulativeMortalityPct: 2.1 },
];

/**
 * Canonical 1-indexed HyLine week number for a batch, given its hatch date.
 *
 * Week 1 = ageInDays 0-6, Week 2 = ageInDays 7-13, Week 3 = ageInDays 14-20, etc.
 * i.e. `Math.floor(ageInDays / 7) + 1`, clamped to a minimum of 1.
 *
 * IMPORTANT — do not compute this as `dayjs(a).diff(dayjs(b), 'week')` clamped
 * with `Math.max(1, ...)`. dayjs's week-diff is already the 0-indexed
 * "brooder week index" (0 for the first 7 days, 1 for the next 7, etc.), so
 * clamping it to a minimum of 1 silently freezes the result at 1 for the
 * *entire second week* too (both 0 and 1 clamp/pass-through to 1), and every
 * later week ends up one behind where it should be. This was happening at
 * several call sites — always compute the week number through this helper
 * instead so the whole app agrees on the same number.
 *
 * @param dateOfHatch   - batch hatch date
 * @param referenceDate - the date to evaluate the age at (defaults to today)
 */
export function batchAgeWeeks(dateOfHatch: Date, referenceDate: Date = new Date()): number {
  const ageInDays = Math.floor(
    (referenceDate.getTime() - dateOfHatch.getTime()) / (1000 * 60 * 60 * 24),
  );
  return Math.max(1, Math.floor(Math.max(0, ageInDays) / 7) + 1);
}

/** Returns the HyLine standard for a given age in weeks (1-indexed, clamped to 1-19). */
export function hylineStandard(ageWeeks: number): HyLineWeekStandard {
  const week = Math.max(1, Math.min(19, Math.round(ageWeeks)));
  return HYLINE_SCHEDULE[week - 1];
}

/** Standard grams of feed per bird per day by HyLine schedule (used for brooder). */
export function hylineGramsPerBirdPerDay(ageWeeks: number): number {
  return hylineStandard(ageWeeks).feedingGramsPerBird;
}

/** Standard grams of feed per bird per day, by feed type and age in weeks.
 *  Matches FeedService's original getRecommendedIntake table exactly. */
export function gramsPerBirdPerDay(feedType: FeedType | string, ageWeeks: number): number {
  const type = String(feedType);

  if (type === FeedType.LAYER_MASH) {
    if (ageWeeks < 6)  return 30;
    if (ageWeeks < 18) return 80;
    return 115; // production phase
  }
  if (type.startsWith('KIENYEJI')) {
    if (ageWeeks < 4) return 25;
    if (ageWeeks < 8) return 60;
    return 100;
  }
  return 90; // generic fallback (incl. CHICK_MASH / GROWER_MASH)
}

/** Brooder-specific grams/bird/day using the HyLine Brown rearing schedule.
 *  Replaces the earlier generic 90g/day fallback for chick/grower mash. */
export function brooderGramsPerBirdPerDay(feedType: FeedType | string, ageWeeks: number): number {
  // For Layer-destined chicks (Hy-Line Brown), use the HyLine schedule directly.
  // The schedule is feed-type-agnostic — the chart gives g/bird/day by week
  // regardless of which mash formulation is used.
  return hylineGramsPerBirdPerDay(ageWeeks);
}

/** Required feed (kg) for a given population, feed type, age, over `days` days. Defaults to a week. */
export function requiredFeedKg(
  birdCount: number,
  feedType: FeedType | string,
  ageWeeks: number,
  days = 7,
  gramsFn: (feedType: FeedType | string, ageWeeks: number) => number = gramsPerBirdPerDay,
): number {
  const perDay = gramsFn(feedType, ageWeeks);
  return Math.round(((birdCount * perDay * days) / 1000) * 100) / 100;
}

/** Required brooder feed (kg) for a level population, using HyLine schedule. */
export function brooderRequiredFeedKg(
  birdCount: number,
  ageWeeks: number,
  days = 7,
): number {
  const perDay = hylineGramsPerBirdPerDay(ageWeeks);
  return Math.round(((birdCount * perDay * days) / 1000) * 100) / 100;
}

/** Min/max recommended intake band (±10%) for a given quantity. */
export function withTolerance(kg: number, tolerance = 0.1): { min: number; max: number } {
  return {
    min: Math.round(kg * (1 - tolerance) * 100) / 100,
    max: Math.round(kg * (1 + tolerance) * 100) / 100,
  };
}

/**
 * Returns the start (UTC midnight) of the batch-relative "brooder week"
 * containing `referenceDate`.
 *
 * Weeks here are anchored to the batch's `dateOfHatch` rather than the
 * calendar (Mon–Sun / Sun–Sat) week: Week 1 = days 0–6 since hatch,
 * Week 2 = days 7–13, etc.
 *
 * Why this matters: chicks almost never hatch exactly on a calendar week
 * boundary, so the calendar week and the chicks' first week of life rarely
 * line up. If "this week's" dispensed/required feed totals are windowed by
 * calendar week, a feed log backdated to a day that has rolled into a new
 * calendar week — but is still within the same brooder week for that batch —
 * silently falls outside the window and never shows up in the weekly totals.
 * Anchoring the window to the hatch date instead fixes that for every batch,
 * and is most noticeable in Week 1 because that's the week most likely to
 * straddle a calendar boundary.
 *
 * @param dateOfHatch   - batch hatch date
 * @param referenceDate - the date whose containing brooder-week we want (defaults to today)
 */
export function brooderWeekStart(dateOfHatch: Date, referenceDate: Date = new Date()): Date {
  const ageInDays = Math.floor(
    (referenceDate.getTime() - dateOfHatch.getTime()) / (1000 * 60 * 60 * 24),
  );
  const weekIndex = Math.floor(Math.max(0, ageInDays) / 7); // 0-indexed brooder week number
  const start = new Date(dateOfHatch);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() + weekIndex * 7);
  return start;
}

/**
 * A single mortality/culling event, as recorded on `BrooderLevelMortalityLog`.
 *
 * `date` is the log's business day (matches `logDate`, a date-only column).
 * `occurredAt`, if provided, is used as a best-effort clock time for that
 * event (typically the log's `createdAt`) so a mid-day death can be prorated
 * against the feed already eaten that day. If `occurredAt` doesn't fall on
 * `date` (e.g. a death from last night logged the next morning), the event
 * is treated as having happened at the END of `date` — i.e. the population
 * drop only applies starting the following day. This is the safe default:
 * we only know the death happened "sometime that day," so we don't discount
 * feed for hours the bird may still have been alive and eating.
 */
export interface MortalityDayEvent {
  date: Date;
  count: number;
  occurredAt?: Date;
}

/**
 * Computes a batch's required feed (kg) for a window of days, reconstructing
 * the bird population day-by-day so mortality is priced accurately.
 *
 * Naively multiplying a single (current) bird count by the daily ration for
 * every day in the window would silently re-price days that have ALREADY
 * happened using today's (lower, post-mortality) bird count — e.g. a batch
 * that started the week at 100 birds and lost 5 on Day 1 would have Day 1
 * itself costed at 95 birds instead of the 100 that were actually present
 * and eating that day.
 *
 * This reconstructs the population day-by-day instead:
 *   • Day 1 is costed at the population alive during Day 1.
 *   • Once birds are lost, every subsequent day uses the reduced count.
 *   • A mid-day loss (has a same-day `occurredAt`) splits that single day
 *     between the pre-loss and post-loss population, weighted by time of
 *     day, instead of charging the whole day to one count or the other.
 *
 * @param currentBirdCount        - live bird count for the level RIGHT NOW
 *                                   (i.e. after all mortality to date, same
 *                                   value BrooderLevelAssignment.birdCount
 *                                   already holds)
 * @param ageWeeks                - batch age in completed weeks (ration lookup)
 * @param weekStart                - start of the batch-relative brooder week
 * @param upToDate                 - only count days up to and including this date
 * @param mortalityEventsThisWeek  - every mortality/culling event for this
 *                                   level with `date` in [weekStart, upToDate].
 *                                   Events outside that window are ignored.
 */
export function brooderAdjustedWeeklyFeedKgWithMortality(
  currentBirdCount: number,
  ageWeeks: number,
  weekStart: Date,
  upToDate: Date,
  mortalityEventsThisWeek: MortalityDayEvent[],
): number {
  const kgPerBirdPerDay = hylineGramsPerBirdPerDay(ageWeeks) / 1000;

  const wStart = new Date(weekStart);
  wStart.setUTCHours(0, 0, 0, 0);
  const cutoff = new Date(upToDate);
  cutoff.setUTCHours(0, 0, 0, 0);

  // Keep only events that actually fall inside the window we're pricing.
  const dayKey = (d: Date) => {
    const x = new Date(d);
    x.setUTCHours(0, 0, 0, 0);
    return x.getTime();
  };
  const events = mortalityEventsThisWeek.filter(
    e => dayKey(e.date) >= wStart.getTime() && dayKey(e.date) <= cutoff.getTime(),
  );

  // Population at the very start of the week = current population + every
  // bird lost during the week so far (currentBirdCount already has all of
  // this week's losses subtracted out, so we add them back to walk forward).
  const totalLossesThisWeek = events.reduce((s, e) => s + e.count, 0);
  let population = currentBirdCount + totalLossesThisWeek;

  const eventsByDay = new Map<number, MortalityDayEvent[]>();
  for (const e of events) {
    const key = dayKey(e.date);
    if (!eventsByDay.has(key)) eventsByDay.set(key, []);
    eventsByDay.get(key)!.push(e);
  }

  let totalKg = 0;

  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const day = new Date(wStart);
    day.setUTCDate(day.getUTCDate() + dayOffset);
    if (day.getTime() > cutoff.getTime()) break;

    const dayEvents = (eventsByDay.get(day.getTime()) ?? []).slice().sort((a, b) => {
      const at = a.occurredAt ? a.occurredAt.getTime() : Infinity;
      const bt = b.occurredAt ? b.occurredAt.getTime() : Infinity;
      return at - bt;
    });

    let runningPop = population;
    let segmentStartFraction = 0; // 0 = start of day, 1 = end of day

    for (const e of dayEvents) {
      let fraction = 1; // default: death priced as end-of-day (no proration)
      if (e.occurredAt) {
        const sameDay =
          e.occurredAt.getUTCFullYear() === day.getUTCFullYear() &&
          e.occurredAt.getUTCMonth() === day.getUTCMonth() &&
          e.occurredAt.getUTCDate() === day.getUTCDate();
        if (sameDay) {
          const secondsIntoDay =
            e.occurredAt.getUTCHours() * 3600 +
            e.occurredAt.getUTCMinutes() * 60 +
            e.occurredAt.getUTCSeconds();
          fraction = secondsIntoDay / 86400;
        }
      }
      fraction = Math.max(segmentStartFraction, Math.min(1, fraction));

      totalKg += runningPop * kgPerBirdPerDay * (fraction - segmentStartFraction);
      runningPop -= e.count;
      segmentStartFraction = fraction;
    }

    // Remainder of the day (or the whole day, if no events) at whatever the
    // population is after all of that day's losses have been applied.
    totalKg += runningPop * kgPerBirdPerDay * (1 - segmentStartFraction);

    population = runningPop; // carries forward into the next day
  }

  return Math.round(totalKg * 100) / 100;
}

/**
 * Returns true if a batch has recorded zero feed consumption at all by
 * Day 8 of life — a clinical concern (chicks should be eating inconsistently
 * by Day 4-6 even in the worst case) that warrants a
 * BROODER_EARLY_PHASE_NOT_EATING alert to managers.
 *
 * This is a standalone health-monitoring check — it does not discount or
 * adjust the feed schedule in any way, it purely watches for "no feed
 * logged at all" as a red flag worth investigating.
 *
 * @param dateOfHatch       - batch hatch date
 * @param totalConsumedKg   - total feed consumed since hatch
 * @param referenceDate     - evaluation date (defaults to today)
 */
export const NOT_EATING_ALERT_DAYS = 8; // flag if zero consumption by Day 8

export function isEarlyPhaseNotEating(
  dateOfHatch: Date,
  totalConsumedKg: number,
  referenceDate: Date = new Date(),
): boolean {
  const ageInDays = Math.floor(
    (referenceDate.getTime() - dateOfHatch.getTime()) / (1000 * 60 * 60 * 24),
  );
  return ageInDays >= NOT_EATING_ALERT_DAYS && totalConsumedKg <= 0;
}

// ── Threshold checkers (returns null if within bounds, or a descriptive message) ──

/** Check weight sample against HyLine standard. Returns violation message or null. */
export function checkWeightViolation(
  averageWeightG: number,
  ageWeeks: number,
): { violated: boolean; message: string; standard: HyLineWeekStandard } {
  const std = hylineStandard(ageWeeks);
  if (averageWeightG < std.weightMinG) {
    return {
      violated: true,
      message: `Week ${std.week} weight ${averageWeightG.toFixed(0)}g is below the HyLine minimum of ${std.weightMinG}g (${std.phase} phase).`,
      standard: std,
    };
  }
  if (averageWeightG > std.weightMaxG) {
    return {
      violated: true,
      message: `Week ${std.week} weight ${averageWeightG.toFixed(0)}g exceeds the HyLine maximum of ${std.weightMaxG}g (${std.phase} phase).`,
      standard: std,
    };
  }
  return { violated: false, message: '', standard: std };
}

/**
 * Check cumulative mortality % against HyLine standard. Returns violation or null.
 *
 * IMPORTANT — pass `effectiveBirdsReceived`, NOT raw `quantityReceived`.
 *
 *   effectiveBirdsReceived = batch.quantityReceived - batch.mortalityOnArrival
 *
 * Mortalities on arrival are DOA birds that died in transit before the farm
 * ever had custody of them.  They are NOT the farm's responsibility and must
 * NOT inflate the cumulative mortality % used in HyLine control comparisons.
 * The caller is responsible for subtracting `mortalityOnArrival` before
 * passing the baseline here.
 *
 * Similarly, `farmDeaths` should equal:
 *   effectiveBirdsReceived - batch.currentBirdCount
 * (i.e. deaths that occurred on the farm after arrival — arrival DOAs excluded).
 */
export function checkMortalityViolation(
  farmDeaths: number,
  effectiveBirdsReceived: number,
  ageWeeks: number,
): { violated: boolean; message: string; actualPct: number; standardPct: number } {
  const std = hylineStandard(ageWeeks);
  const actualPct = effectiveBirdsReceived > 0
    ? Math.round(((farmDeaths / effectiveBirdsReceived) * 100) * 100) / 100
    : 0;
  if (actualPct > std.cumulativeMortalityPct) {
    return {
      violated: true,
      message: `Cumulative mortality ${actualPct}% exceeds the HyLine week-${std.week} ceiling of ${std.cumulativeMortalityPct}%.`,
      actualPct,
      standardPct: std.cumulativeMortalityPct,
    };
  }
  return { violated: false, message: '', actualPct, standardPct: std.cumulativeMortalityPct };
}

/** Check if today's feed issuance for a level would exceed the daily ration.
 *  Returns the over-issue amount (kg) or 0 if within bounds. */
export function checkFeedOverIssue(
  proposedKg: number,
  alreadyIssuedTodayKg: number,
  birdCount: number,
  ageWeeks: number,
): { overIssue: boolean; overIssueKg: number; dailyRationKg: number } {
  const dailyRationKg = Math.round(((birdCount * hylineGramsPerBirdPerDay(ageWeeks)) / 1000) * 100) / 100;
  const totalAfter = alreadyIssuedTodayKg + proposedKg;
  const overIssueKg = Math.max(0, Math.round((totalAfter - dailyRationKg) * 100) / 100);
  return { overIssue: overIssueKg > 0, overIssueKg, dailyRationKg };
}
