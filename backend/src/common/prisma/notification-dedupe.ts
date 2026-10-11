// src/common/prisma/notification-dedupe.ts
//
// One place that stops notifications repeating themselves, whichever of the
// ~20 call sites (services, crons, report uploads, transactions) creates
// them. Wired into PrismaService as a query extension on
// notification.create / notification.createMany, so nothing has to opt in.
//
// Rules
//  • Caller-supplied key (data.dedupeKey, stored as "k:<key>") — the same
//    recipient never gets that key twice. Used for "this data point was
//    already flagged" (e.g. a breed-standard deviation run, an unchanged
//    report re-upload).
//  • Otherwise a content hash ("h:<sha1 of type|entity|title|message>") —
//    an identical notification is skipped while the earlier one is still
//    unread, or was created within NOTIFICATION_REPEAT_WINDOW_HOURS
//    (default 168 h = 7 days). Anything whose text changed (new date, new
//    count) is new information and goes through.
import { createHash } from 'crypto';

export const DEFAULT_REPEAT_WINDOW_HOURS = 168;

export interface NotificationLike {
  userId: string;
  type: string;
  title: string;
  message: string;
  entityId?: string | null;
  entityType?: string | null;
  dedupeKey?: string | null;
}

const norm = (s: string | null | undefined) => String(s ?? '').replace(/\s+/g, ' ').trim();

export function notificationDedupeKey(n: NotificationLike): string {
  if (n.dedupeKey) return n.dedupeKey.startsWith('k:') || n.dedupeKey.startsWith('h:') ? n.dedupeKey : `k:${n.dedupeKey}`;
  const hash = createHash('sha1')
    .update([n.type, n.entityType ?? '', n.entityId ?? '', norm(n.title), norm(n.message)].join('|'))
    .digest('hex');
  return `h:${hash}`;
}

export function repeatWindowHours(): number {
  const v = Number(process.env.NOTIFICATION_REPEAT_WINDOW_HOURS);
  return Number.isFinite(v) && v >= 0 ? v : DEFAULT_REPEAT_WINDOW_HOURS;
}

/** Prisma `where` matching an earlier notification that makes `key` a repeat. */
export function duplicateWhere(userIds: string[], keys: string[], now = new Date()) {
  const since = new Date(now.getTime() - repeatWindowHours() * 3_600_000);
  const permanent = keys.filter(k => k.startsWith('k:'));
  const hashed = keys.filter(k => k.startsWith('h:'));
  const or: any[] = [];
  if (permanent.length) or.push({ dedupeKey: { in: permanent } });
  if (hashed.length) or.push({ dedupeKey: { in: hashed }, OR: [{ isRead: false }, { createdAt: { gte: since } }] });
  return { userId: { in: userIds }, OR: or };
}

interface Finder {
  notification: { findMany(args: any): Promise<{ userId: string; dedupeKey: string | null }[]> };
}

/** Splits rows into the ones to insert (with dedupeKey set) and repeats.
 *  Also collapses duplicates within the same batch of rows. */
export async function filterNewNotifications<T extends NotificationLike>(
  db: Finder,
  rows: T[],
): Promise<{ fresh: (T & { dedupeKey: string })[]; skipped: number }> {
  const keyed = rows.map(r => ({ ...r, dedupeKey: notificationDedupeKey(r) }));
  if (keyed.length === 0) return { fresh: [], skipped: 0 };
  const existing = await db.notification.findMany({
    where: duplicateWhere([...new Set(keyed.map(r => r.userId))], [...new Set(keyed.map(r => r.dedupeKey))]),
    select: { userId: true, dedupeKey: true },
  });
  const seen = new Set(existing.map(e => `${e.userId}|${e.dedupeKey}`));
  const fresh: (T & { dedupeKey: string })[] = [];
  for (const r of keyed) {
    const k = `${r.userId}|${r.dedupeKey}`;
    if (seen.has(k)) continue;
    seen.add(k);
    fresh.push(r);
  }
  return { fresh, skipped: rows.length - fresh.length };
}

/** Marker on the object returned for a skipped notification.create. */
export const DEDUPED = Symbol('notificationDeduped');
