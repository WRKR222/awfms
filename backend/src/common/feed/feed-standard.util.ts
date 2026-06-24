// src/common/feed/feed-standard.util.ts
//
// Single source of truth for "how much feed should a bird eat" — used by
// FeedService (production-house intake recommendations) and BrooderService
// (per-row/per-level required feed for the brooder cage map).
//
// `gramsPerBirdPerDay` preserves FeedService's original table exactly.
// `brooderGramsPerBirdPerDay` uses the HyLine Brown rearing chart.
// `hylineStandard` returns the full week row for threshold checking.

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

/** Check cumulative mortality % against HyLine standard. Returns violation or null. */
export function checkMortalityViolation(
  totalDeaths: number,
  originalBirdCount: number,
  ageWeeks: number,
): { violated: boolean; message: string; actualPct: number; standardPct: number } {
  const std = hylineStandard(ageWeeks);
  const actualPct = originalBirdCount > 0
    ? Math.round(((totalDeaths / originalBirdCount) * 100) * 100) / 100
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
