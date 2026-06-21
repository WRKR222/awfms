// src/lib/dayjs.ts
//
// Single source of truth for the dayjs instance and its plugins.
//
// Why this file exists:
// Previously every page extended whatever plugin it happened to need
// (e.g. `dayjs.extend(relativeTime)` in NotificationsPage.tsx,
// `dayjs.extend(isoWeek)` in IssuancePlanTab.tsx, etc). That works at
// runtime because dayjs.extend() is global, but the TypeScript types for
// plugin methods (e.g. `.utc()`, `.fromNow()`, `.isoWeek()`) are only
// added in files that imported that specific plugin — so a file using
// `.utc()` without importing `dayjs/plugin/utc` compiles fine in every
// other file but fails in its own with TS2339.
//
// Fix: extend every plugin the app uses exactly once, here, and have
// every other file import `dayjs` FROM THIS FILE instead of from the
// 'dayjs' package directly. That guarantees the types are always
// available, no matter which file you're in.
//
// Usage:
//   import dayjs from '../../lib/dayjs'; // adjust relative path as needed
//   dayjs().format('YYYY-MM-DD');
//   dayjs(someDate).fromNow();
//   dayjs(weekStart).utc(true).format('YYYY-MM-DD');
//
// Adding a new plugin:
//   1. `npm install dayjs` already covers it — plugins ship with the package.
//   2. Import it below and add it to the extend list.
//   3. Do NOT add a per-file `dayjs.extend(...)` anywhere else — if you
//      find yourself doing that, you've missed this file.

import dayjs from 'dayjs';

import relativeTime from 'dayjs/plugin/relativeTime'; // .fromNow(), .toNow()
import isoWeek from 'dayjs/plugin/isoWeek';             // .isoWeek(), .isoWeekday()
import utc from 'dayjs/plugin/utc';                     // .utc(), .utc(true) keep-local-time

dayjs.extend(relativeTime);
dayjs.extend(isoWeek);
dayjs.extend(utc);

export default dayjs;
