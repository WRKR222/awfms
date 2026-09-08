// backend/src/common/brooder/brooder-session-window.util.ts
//
// The attendant brooder daily log is 3 separate time-gated popups instead of
// one combined form:
//   MORNING — 3am + 6am environmental readings, feed, water, vaccines/
//             supplements/treatment, mortalities. Open all day up to 9:00am.
//   MIDDAY  — the "11am" check-in — environmental data, water, vaccines,
//             supplements, mortalities. Opens 11:00am, locked at 1:00pm.
//   EVENING — the "3pm" check-in — environmental data, water, vaccines,
//             supplements, feed, mortalities. Opens 3:00pm, closed by 5:00pm.
//
// This is intentionally the single source of truth for those windows so the
// backend and frontend never disagree about when a popup is open. Windows
// are evaluated against the FARM's local time (Africa/Nairobi, fixed UTC+3,
// no DST) via farmNow()/farmTodayUtcMidnight() from feed-standard.util —
// the same convention already used for "today"/"now" everywhere else in the
// brooder module (see farmNow's own comment for why: the container's OS
// clock is UTC, not the farm's timezone).
import { BadRequestException } from '@nestjs/common';
import { farmNow, farmTodayUtcMidnight } from '../feed/feed-standard.util';

export type BrooderSessionKey = 'MORNING' | 'MIDDAY' | 'EVENING';

export interface BrooderSessionWindow {
  key: BrooderSessionKey;
  label: string;
  /** Hour (0-23, farm local time) the popup becomes available. */
  opensHour: number;
  /** Hour (0-23, farm local time) the popup locks — exclusive upper bound. */
  closesHour: number;
  /** Human-readable "opens at / closes at" strings for the UI. */
  opensLabel: string;
  closesLabel: string;
}

export const BROODER_SESSION_WINDOWS: Record<BrooderSessionKey, BrooderSessionWindow> = {
  MORNING: {
    key: 'MORNING', label: 'Morning (3am & 6am readings)',
    opensHour: 0, closesHour: 9,
    opensLabel: '12:00am', closesLabel: '9:00am',
  },
  MIDDAY: {
    key: 'MIDDAY', label: '11am Check-in',
    opensHour: 11, closesHour: 13,
    opensLabel: '11:00am', closesLabel: '1:00pm',
  },
  EVENING: {
    key: 'EVENING', label: '3pm Check-in',
    opensHour: 15, closesHour: 17,
    opensLabel: '3:00pm', closesLabel: '5:00pm',
  },
};

/** Farm-local hour-of-day as a decimal (e.g. 13.5 = 1:30pm), from farmNow(). */
function farmHourOfDay(now: Date): number {
  return now.getUTCHours() + now.getUTCMinutes() / 60;
}

/** Which single session window (if any) contains the current farm time — null between windows. */
export function currentBrooderSession(now: Date = farmNow()): BrooderSessionKey | null {
  const hour = farmHourOfDay(now);
  for (const w of Object.values(BROODER_SESSION_WINDOWS)) {
    if (hour >= w.opensHour && hour < w.closesHour) return w.key;
  }
  return null;
}

export function isBrooderSessionOpen(session: BrooderSessionKey, now: Date = farmNow()): boolean {
  const w = BROODER_SESSION_WINDOWS[session];
  if (!w) return false;
  const hour = farmHourOfDay(now);
  return hour >= w.opensHour && hour < w.closesHour;
}

/** Throws BadRequestException if the given popup is not open right now (farm time). */
export function assertBrooderSessionOpen(session: BrooderSessionKey, now: Date = farmNow()) {
  const w = BROODER_SESSION_WINDOWS[session];
  if (!w) throw new BadRequestException(`Unknown brooder log session "${session}"`);
  if (!isBrooderSessionOpen(session, now)) {
    const hh = String(now.getUTCHours()).padStart(2, '0');
    const mm = String(now.getUTCMinutes()).padStart(2, '0');
    throw new BadRequestException(
      `The ${w.label} popup is only open from ${w.opensLabel} to ${w.closesLabel} — it is currently ${hh}:${mm}.`,
    );
  }
}

/**
 * Snapshot the frontend polls to gate the 3 popups without trusting the
 * viewer's own device clock/timezone — the popup that's "open" must always
 * agree with what the server will actually accept.
 */
export function getBrooderSessionStatus(now: Date = farmNow()) {
  const hh = String(now.getUTCHours()).padStart(2, '0');
  const mm = String(now.getUTCMinutes()).padStart(2, '0');
  const sessions = Object.values(BROODER_SESSION_WINDOWS).map(w => ({
    key: w.key,
    label: w.label,
    opensLabel: w.opensLabel,
    closesLabel: w.closesLabel,
    open: isBrooderSessionOpen(w.key, now),
  }));
  return { farmTime: `${hh}:${mm}`, farmDate: farmTodayUtcMidnight().toISOString().slice(0, 10), sessions };
}

/** Throws BadRequestException unless the given YYYY-MM-DD / Date is today (farm local date). */
export function assertIsToday(logDate: string | Date, today: Date = farmTodayUtcMidnight()) {
  const todayStr = today.toISOString().slice(0, 10);
  const given = typeof logDate === 'string' ? logDate.slice(0, 10) : logDate.toISOString().slice(0, 10);
  if (given !== todayStr) {
    throw new BadRequestException(
      'The 3 daily-log popups only accept entries for today — backdating is not supported through them.',
    );
  }
}
