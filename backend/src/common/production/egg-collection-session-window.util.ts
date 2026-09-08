// backend/src/common/production/egg-collection-session-window.util.ts
//
// Egg collection is two shifts a day, each with its own submission deadline:
//   AM — locked at 12:00pm (noon). Past that, the AM slot for today can no
//        longer be submitted through the normal flow.
//   PM — locked at 4:30pm. Past that, both shifts for today are closed —
//        the next thing that opens is tomorrow's AM session at midnight.
//
// Same convention as the brooder 3-popup log (see
// common/brooder/brooder-session-window.util.ts): windows are evaluated
// against the FARM's local time (Africa/Nairobi, fixed UTC+3, no DST) via
// farmNow()/farmTodayUtcMidnight() from feed-standard.util — the
// container's own OS clock is UTC, not the farm's timezone.
//
// The lock only applies to TODAY's session. createEggCollection() has
// always accepted a `sessionDate` in the past for backdated corrections —
// this deliberately does NOT reach into that: a PM/Store correction to
// yesterday's data isn't "past 12pm today", it's a different day, and
// backdating still needs to work regardless of what time it is right now.
import { BadRequestException } from '@nestjs/common';
import { farmNow, farmTodayUtcMidnight } from '../feed/feed-standard.util';

export type EggCollectionShift = 'AM' | 'PM';

export interface EggCollectionSessionWindow {
  shift: EggCollectionShift;
  label: string;
  /** Hour (0-23, farm local time, may be fractional e.g. 16.5 = 4:30pm) the shift becomes available. */
  opensHour: number;
  /** Hour (0-23, farm local time) the shift locks — exclusive upper bound. */
  closesHour: number;
  opensLabel: string;
  closesLabel: string;
}

export const EGG_COLLECTION_SESSION_WINDOWS: Record<EggCollectionShift, EggCollectionSessionWindow> = {
  AM: {
    shift: 'AM', label: 'AM egg collection',
    opensHour: 0, closesHour: 12,
    opensLabel: '12:00am', closesLabel: '12:00pm',
  },
  PM: {
    shift: 'PM', label: 'PM egg collection',
    opensHour: 12, closesHour: 16.5,
    opensLabel: '12:00pm', closesLabel: '4:30pm',
  },
};

/** Farm-local hour-of-day as a decimal (e.g. 16.5 = 4:30pm), from farmNow(). */
function farmHourOfDay(now: Date): number {
  return now.getUTCHours() + now.getUTCMinutes() / 60;
}

export function isEggCollectionSessionOpen(shift: EggCollectionShift, now: Date = farmNow()): boolean {
  const w = EGG_COLLECTION_SESSION_WINDOWS[shift];
  if (!w) return false;
  const hour = farmHourOfDay(now);
  return hour >= w.opensHour && hour < w.closesHour;
}

/** Whether `sessionDate` (YYYY-MM-DD or Date) is today, farm-local. */
function isTodayFarmLocal(sessionDate: string | Date, today: Date = farmTodayUtcMidnight()): boolean {
  const todayStr = today.toISOString().slice(0, 10);
  const given = typeof sessionDate === 'string' ? sessionDate.slice(0, 10) : sessionDate.toISOString().slice(0, 10);
  return given === todayStr;
}

/**
 * Throws BadRequestException if `shift` is locked for right now — but only
 * when `sessionDate` is today (farm-local); a backdated sessionDate always
 * passes through untouched, since the clock-based lock only makes sense for
 * "today's" submission window.
 */
export function assertEggCollectionSessionOpen(
  shift: EggCollectionShift, sessionDate: string | Date, now: Date = farmNow(),
) {
  if (!isTodayFarmLocal(sessionDate)) return; // backdated correction — not subject to the daily clock lock

  const w = EGG_COLLECTION_SESSION_WINDOWS[shift];
  if (!w) throw new BadRequestException(`Unknown egg collection shift "${shift}"`);
  if (!isEggCollectionSessionOpen(shift, now)) {
    const hh = String(now.getUTCHours()).padStart(2, '0');
    const mm = String(now.getUTCMinutes()).padStart(2, '0');
    const reopenNote = shift === 'PM'
      ? ' The next window to open is tomorrow\'s AM session at midnight.'
      : '';
    throw new BadRequestException(
      `${w.label} is only open from ${w.opensLabel} to ${w.closesLabel} — it is currently ${hh}:${mm}.${reopenNote}`,
    );
  }
}

/** Snapshot the frontend can poll to show/gate the AM/PM buttons without
 *  trusting the viewer's own device clock — mirrors
 *  getBrooderSessionStatus(). Only meaningful for TODAY; a backdated entry
 *  screen doesn't need this. */
export function getEggCollectionSessionStatus(now: Date = farmNow()) {
  const hh = String(now.getUTCHours()).padStart(2, '0');
  const mm = String(now.getUTCMinutes()).padStart(2, '0');
  const shifts = Object.values(EGG_COLLECTION_SESSION_WINDOWS).map(w => ({
    shift: w.shift,
    label: w.label,
    opensLabel: w.opensLabel,
    closesLabel: w.closesLabel,
    open: isEggCollectionSessionOpen(w.shift, now),
  }));
  return { farmTime: `${hh}:${mm}`, farmDate: farmTodayUtcMidnight().toISOString().slice(0, 10), shifts };
}
