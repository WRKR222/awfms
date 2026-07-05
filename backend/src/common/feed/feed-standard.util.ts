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
// ── Early-Phase Feeding (Days 1–3 of Week 1) ────────────────────────────────
//
// Day-old chicks are still learning to eat. Their feed intake in the first
// 2–3 days is highly inconsistent and does NOT follow the HyLine standard
// table.  A common pattern: the initial feed placed on Day 1 may last 2 or
// more days without a second issuance being needed.
//
// Rules encoded here:
//   • Days 1–3  (ageInDays 0–2): "early phase" — HyLine daily ration is an
//     advisory upper bound only.  The over-issuance hard-block is lifted;
//     a warning is shown instead.  Zero or partial issuance on a given day
//     is expected and does NOT trigger a missed-feed alert.
//   • Days 4–7  (ageInDays 3–6): "transition phase" — standard ration
//     applies but the missed-feed alert still has a softer threshold (50 %
//     of ration) to allow for partial day-1 carry-over still being consumed.
//   • Week 2+  (ageInDays ≥ 7): full standard schedule, hard-block enforced.
//
// If chicks have not started eating consistently by end of Day 7 the system
// flags this as BROODER_EARLY_PHASE_NOT_EATING (surfaced on Manager/Owner).
//
// Residual carry-forward in issuance plans:
//   Any feed placed but not consumed during the early phase is tracked as
//   a residual and automatically deducted from the next week's store issuance
//   request (same Req 4 mechanism used for standard weekly carry-forward).

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

// ── Early-Phase Feeding Helpers ───────────────────────────────────────────────
//
// The early phase covers the first EARLY_PHASE_DAYS of a batch's life.
// During this window the standard daily ration is advisory only — chicks
// often don't finish the first day's feed for 2+ days, so over-issue
// enforcement is relaxed and missed-feed alerts are suppressed.

/** Number of calendar days from hatch at which chicks are considered to be
 *  in the "early / learning to eat" phase.  Day 0 = hatch day. */
export const EARLY_PHASE_DAYS = 3; // Days 1, 2, 3 (0-indexed: 0, 1, 2)

/** Number of calendar days from hatch for the "transition" phase.
 *  From EARLY_PHASE_DAYS through TRANSITION_END_DAYS chicks should be
 *  eating more regularly but may still have some carry-over from earlier days.
 *  Set to 8 so that the full first 7-day week (Days 0–7) is covered by
 *  EARLY or TRANSITION — STANDARD enforcement only begins at Day 8 (Week 2+). */
export const TRANSITION_END_DAYS = 8; // Day 8 = start of week 2 → STANDARD

export type FeedingPhase = 'EARLY' | 'TRANSITION' | 'STANDARD';

/**
 * Returns the feeding phase for a batch given its hatch date and a reference date.
 *
 * @param dateOfHatch  - The batch's date of hatch (UTC midnight)
 * @param referenceDate - The date to evaluate (defaults to today)
 */
export function getFeedingPhase(dateOfHatch: Date, referenceDate: Date = new Date()): FeedingPhase {
  const ageInDays = Math.floor(
    (referenceDate.getTime() - dateOfHatch.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (ageInDays < EARLY_PHASE_DAYS)    return 'EARLY';
  if (ageInDays < TRANSITION_END_DAYS) return 'TRANSITION';
  return 'STANDARD';
}

/** True when the batch is in the early learning-to-eat window on a given date. */
export function isEarlyPhase(dateOfHatch: Date, referenceDate: Date = new Date()): boolean {
  return getFeedingPhase(dateOfHatch, referenceDate) === 'EARLY';
}

/** True when the batch is in the transition window on a given date. */
export function isTransitionPhase(dateOfHatch: Date, referenceDate: Date = new Date()): boolean {
  return getFeedingPhase(dateOfHatch, referenceDate) === 'TRANSITION';
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
 * Advisory (non-enforced) daily feed upper bound for the early phase.
 *
 * During the early phase the full HyLine standard ration is used as the
 * UPPER BOUND only — it is never enforced as a hard cap.  The server will
 * warn but not block.  Returns the standard daily ration kg.
 */
export function earlyPhaseAdvisoryDailyKg(birdCount: number, ageWeeks: number): number {
  return brooderRequiredFeedKg(birdCount, ageWeeks, 1);
}

/**
 * Computes the adjusted weekly feed requirement for a batch that started
 * mid-week or is still in the early / transition phase this week.
 *
 * Logic:
 *   • For each calendar day in the current ISO week, determine whether it
 *     falls in EARLY, TRANSITION, or STANDARD phase for the batch.
 *   • EARLY days: contribute the FULL standard daily ration to the schedule
 *     total.  Feed is physically issued on Day 1 and birds do eat some of it.
 *     Using 0 previously caused "no feed scheduled" / "net to issue = 0" for
 *     any batch ≤ 2 days old (see inline comment in the function body).
 *   • TRANSITION days: contribute 50% of the standard daily ration as the
 *     minimum expected intake (birds are learning but eating inconsistently).
 *   • STANDARD days: contribute the full daily ration.
 *
 * This is the figure used in getFeedRequirementSummary and store issuance
 * planning to avoid requesting more feed than chicks will realistically eat.
 *
 * IMPORTANT — only days up to and including `upToDate` are counted. This
 * prevents future days inside the batch's current brooder-week from being
 * treated as already consumed, which would make a 2-day-old batch look like
 * it has eaten a near-full week's worth of feed and produce a large false
 * residual carry-forward.
 *
 * @param birdCount    - live bird count for the level
 * @param ageWeeks     - age of batch in completed weeks (used for g/bird/day lookup)
 * @param dateOfHatch  - batch hatch date (used to classify each day of the week)
 * @param weekStart    - start of the batch-relative brooder week (from brooderWeekStart())
 * @param upToDate     - only count days ≤ this date (defaults to today)
 */
export function brooderAdjustedWeeklyFeedKg(
  birdCount: number,
  ageWeeks: number,
  dateOfHatch: Date,
  weekStart: Date,
  upToDate: Date = new Date(),
): number {
  const standardDailyKg = brooderRequiredFeedKg(birdCount, ageWeeks, 1);

  // Normalise upToDate to UTC midnight so day-boundary comparisons are exact.
  const cutoff = new Date(upToDate);
  cutoff.setUTCHours(0, 0, 0, 0);

  let totalKg = 0;

  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const day = new Date(weekStart);
    day.setUTCHours(0, 0, 0, 0);
    day.setDate(day.getDate() + dayOffset);

    // Do not count days that haven't happened yet — a 2-day-old batch must
    // not have days 3–6 of the week counted as already consumed feed.
    if (day.getTime() > cutoff.getTime()) break;

    const phase = getFeedingPhase(dateOfHatch, day);

    if (phase === 'EARLY') {
      // Early phase: count the full standard daily ration for schedule display.
      // Feed IS issued on Day 1 and birds DO eat some; using 0 here caused the
      // brooder control panel to show "no feed scheduled" and "net to issue = 0"
      // for batches ≤ 2 days old (totalRequiredKgThisWeek became 0, and
      // earlyPhaseResidualKg(issuedKg, 0) = issuedKg inflated residual to 100%
      // of issued feed, pushing netToIssueKg to 0).  Using the full ration fixes
      // both display problems; genuine over-issuance is still caught by the
      // soft-warn in createLevelFeedLog (hard-block is lifted for EARLY/TRANSITION).
      totalKg += standardDailyKg;
    } else if (phase === 'TRANSITION') {
      // Transition: count 50% of standard ration for planning purposes.
      totalKg += standardDailyKg * 0.5;
    } else {
      totalKg += standardDailyKg;
    }
  }

  return Math.round(totalKg * 100) / 100;
}

/**
 * Computes the expected early-phase feed provision (the initial "starter" feed
 * placed on Day 1) and compares it against what was actually consumed to derive
 * the residual carry-over into the next week's issuance plan.
 *
 * Rule:
 *   - On Day 1 the attendant places `initialIssuedKg` from the store.
 *   - Over Days 1–(EARLY_PHASE_DAYS - 1) the birds consume `actualConsumedKg`.
 *   - Residual = initialIssuedKg − actualConsumedKg  (floored at 0).
 *   - The residual is deducted from the next week's net issuance request.
 *
 * @param initialIssuedKg    - total feed issued during the early phase (kg)
 * @param actualConsumedKg   - total feed actually consumed during early phase (kg)
 */
export function earlyPhaseResidualKg(
  initialIssuedKg: number,
  actualConsumedKg: number,
): number {
  return Math.max(0, Math.round((initialIssuedKg - actualConsumedKg) * 100) / 100);
}

/**
 * Returns true if the batch has entered Week 2 (Day 8+) and has shown no
 * feed consumption at all — a clinical concern that warrants a
 * BROODER_EARLY_PHASE_NOT_EATING alert to managers.
 *
 * The alert fires at Day 8 (start of Week 2) rather than Day 7, because
 * the entire first week is covered by EARLY/TRANSITION leniency. By Day 8
 * full standard enforcement begins, and zero intake through that point
 * requires immediate investigation.
 *
 * @param dateOfHatch       - batch hatch date
 * @param totalConsumedKg   - total feed consumed in Week 1 across all early days
 * @param referenceDate     - evaluation date (defaults to today)
 */
export function isEarlyPhaseNotEating(
  dateOfHatch: Date,
  totalConsumedKg: number,
  referenceDate: Date = new Date(),
): boolean {
  const ageInDays = Math.floor(
    (referenceDate.getTime() - dateOfHatch.getTime()) / (1000 * 60 * 60 * 24),
  );
  // Only flag once the batch has entered Week 2 (TRANSITION_END_DAYS = 8)
  return ageInDays >= TRANSITION_END_DAYS && totalConsumedKg <= 0;
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
