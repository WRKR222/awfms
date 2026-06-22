// src/common/feed/feed-standard.util.ts
//
// Single source of truth for "how much feed should a bird eat" — used by
// FeedService (production-house intake recommendations) and BrooderService
// (per-row/per-level required feed for the brooder cage map).
//
// `gramsPerBirdPerDay` preserves FeedService's original table exactly
// (LAYER_MASH age bands, KIENYEJI* age bands, 90g/day generic fallback for
// everything else, including CHICK_MASH/GROWER_MASH) so existing
// production-house recommendations are byte-for-byte unchanged.
//
// `brooderGramsPerBirdPerDay` is the finer-grained brooder-specific table —
// CHICK_MASH/GROWER_MASH get real age bands instead of falling into the
// generic 90g/day bucket — used only by BrooderService's per-level required
// feed calculation, which has no prior behaviour to preserve.

import { FeedType } from '@prisma/client';

/** Standard grams of feed per bird per day, by feed type and age in weeks.
 *  Matches FeedService's original getRecommendedIntake table exactly. */
export function gramsPerBirdPerDay(feedType: FeedType | string, ageWeeks: number): number {
  const type = String(feedType);

  if (type === FeedType.LAYER_MASH) {
    if (ageWeeks < 6) return 30;
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

/** Brooder-specific grams/bird/day — gives CHICK_MASH and GROWER_MASH their
 *  own age bands instead of the generic 90g/day fallback. Used for the
 *  brooder cage map's per-level required-feed display only. */
export function brooderGramsPerBirdPerDay(feedType: FeedType | string, ageWeeks: number): number {
  const type = String(feedType);

  if (type === FeedType.CHICK_MASH) {
    if (ageWeeks < 1) return 12;
    if (ageWeeks < 2) return 18;
    if (ageWeeks < 4) return 28;
    return 45;
  }
  if (type === FeedType.GROWER_MASH) {
    return 65;
  }
  return gramsPerBirdPerDay(feedType, ageWeeks);
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

/** Min/max recommended intake band (±10%) for a given quantity, matching FeedService's existing tolerance. */
export function withTolerance(kg: number, tolerance = 0.1): { min: number; max: number } {
  return {
    min: Math.round(kg * (1 - tolerance) * 100) / 100,
    max: Math.round(kg * (1 + tolerance) * 100) / 100,
  };
}
