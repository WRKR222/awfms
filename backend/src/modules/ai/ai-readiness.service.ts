// src/modules/ai/ai-readiness.service.ts
//
// Decides whether an AI report is worth paying for. Two questions:
//
//  1. Is the data complete enough to reason over?
//     A batch-day counts as RECORDED when any of these holds:
//       • brooder:    all 3 session logs (Morning / 11am / 3pm) AND feed logged
//                     (a legacy once-a-day log counts for the 3 sessions)
//       • production: AM and PM recorded for every production-house block the
//                     batch had sessions in during the window
//       • Store's uploaded production report has a row for that date
//     Completeness = recorded days ÷ expected days (from placement — or the
//     window start — up to yesterday, or the batch's close date). A batch is
//     READY at ≥ AI_MIN_DATA_COMPLETENESS_PCT (default 80%) with at least
//     AI_MIN_DATA_DAYS (default 3) expected days. A few missed sessions don't
//     block a report; a big gap does.
//
//  2. Has anything changed since the last report of this kind?
//     If no record in scope was created/updated after that report, the old
//     report is reused instead of calling the AI again.
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import dayjs from 'dayjs';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface DayGap {
  date: string;
  missing: string[];
}

export interface BatchReadiness {
  batchId: string;
  batchCode: string;
  stage: string;
  expectedDays: number;
  recordedDays: number;
  completenessPct: number;
  ready: boolean;
  reason: string | null;
  missingDays: DayGap[];
}

const SESSIONS = ['MORNING', 'MIDDAY', 'EVENING'];
const SESSION_LABEL: Record<string, string> = { MORNING: 'Morning log', MIDDAY: '11am log', EVENING: '3pm log' };

@Injectable()
export class AiReadinessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  get minCompletenessPct() {
    return Number(this.config.get('AI_MIN_DATA_COMPLETENESS_PCT') ?? 80);
  }

  get minDays() {
    return Number(this.config.get('AI_MIN_DATA_DAYS') ?? 3);
  }

  /** Completeness for one batch over [start, end] (dates inclusive). */
  async assessBatch(batchId: string, start: Date, end: Date): Promise<BatchReadiness | null> {
    const batch = await this.prisma.batch.findUnique({
      where: { id: batchId },
      select: {
        id: true, batchCode: true, stage: true, dateReceived: true,
        closedAt: true, soldAt: true, discardedAt: true,
      },
    });
    if (!batch) return null;

    // Window: never before placement, never today (still in progress), never after closing.
    const yesterday = dayjs().subtract(1, 'day').endOf('day');
    const closed = [batch.closedAt, batch.soldAt, batch.discardedAt].filter(Boolean).map(d => dayjs(d!));
    let to = dayjs(end).isAfter(yesterday) ? yesterday : dayjs(end);
    for (const c of closed) if (c.isBefore(to)) to = c;
    let from = dayjs(start).isBefore(dayjs(batch.dateReceived)) ? dayjs(batch.dateReceived) : dayjs(start);
    from = from.startOf('day');
    to = to.endOf('day');

    const days: string[] = [];
    for (let d = from; !d.isAfter(to); d = d.add(1, 'day')) days.push(d.format('YYYY-MM-DD'));

    const base = { batchId: batch.id, batchCode: batch.batchCode, stage: batch.stage };
    if (days.length === 0) {
      return { ...base, expectedDays: 0, recordedDays: 0, completenessPct: 0, ready: false, reason: 'No completed days in this period yet.', missingDays: [] };
    }

    const range = { gte: from.toDate(), lte: to.toDate() };
    const [brooderLogs, generalFeed, levelFeed, sessions, report] = await Promise.all([
      this.prisma.brooderLog.findMany({ where: { batchId, logDate: range }, select: { logDate: true, logSession: true } }),
      this.prisma.brooderGeneralFeedLog.findMany({ where: { batchId, entryDate: range }, select: { entryDate: true } }),
      // Level feed logs are mirrored per batch into FeedIntakeLog.
      this.prisma.feedIntakeLog.findMany({ where: { batchId, entryDate: range }, select: { entryDate: true } }),
      this.prisma.eggCollectionSession.findMany({
        where: { batchId, sessionDate: range, deletedAt: null },
        select: { sessionDate: true, shift: true, block: true },
      }),
      this.prisma.storeProductionReport.findUnique({ where: { batchId }, select: { status: true, rawRows: true } }),
    ]);

    const key = (d: Date) => dayjs(d).format('YYYY-MM-DD');
    const brooderSessions = new Map<string, Set<string>>();
    for (const l of brooderLogs) {
      const set = brooderSessions.get(key(l.logDate)) ?? new Set<string>();
      if (l.logSession) set.add(l.logSession);
      else SESSIONS.forEach(s => set.add(s)); // legacy once-a-day log
      brooderSessions.set(key(l.logDate), set);
    }
    const feedDays = new Set([...generalFeed, ...levelFeed].map(f => key(f.entryDate)));
    const shiftsByDay = new Map<string, Set<string>>();
    const blocks = new Set<string>();
    for (const s of sessions) {
      blocks.add(s.block);
      const set = shiftsByDay.get(key(s.sessionDate)) ?? new Set<string>();
      set.add(`${s.block}:${s.shift}`);
      shiftsByDay.set(key(s.sessionDate), set);
    }
    const reportDays = new Set<string>(
      report && report.status !== 'REJECTED'
        ? ((report.rawRows as any[]) ?? []).map(r => r?.date).filter((d: unknown): d is string => typeof d === 'string')
        : [],
    );
    const isProduction = batch.stage === 'PRODUCTION' || sessions.length > 0;
    if (isProduction && blocks.size === 0) blocks.add('BLOCK1');

    const missingDays: DayGap[] = [];
    let recorded = 0;
    for (const day of days) {
      if (reportDays.has(day)) { recorded++; continue; }

      const bs = brooderSessions.get(day);
      const brooderMissing = [
        ...SESSIONS.filter(s => !bs?.has(s)).map(s => SESSION_LABEL[s]),
        ...(feedDays.has(day) ? [] : ['Feed']),
      ];
      const shifts = shiftsByDay.get(day);
      const productionMissing: string[] = [];
      for (const b of blocks) {
        for (const shift of ['AM', 'PM']) {
          if (!shifts?.has(`${b}:${shift}`)) productionMissing.push(`${b === 'BLOCK2' ? 'Block 2' : 'Block 1'} ${shift} collection`);
        }
      }

      const brooderOk = brooderMissing.length === 0;
      const productionOk = isProduction && productionMissing.length === 0;
      if (brooderOk || productionOk) { recorded++; continue; }
      missingDays.push({ date: day, missing: isProduction ? productionMissing : brooderMissing });
    }

    const completenessPct = Math.round((recorded / days.length) * 1000) / 10;
    let reason: string | null = null;
    if (days.length < this.minDays) {
      reason = `Only ${days.length} completed day(s) since placement — at least ${this.minDays} are needed for a meaningful report.`;
    } else if (completenessPct < this.minCompletenessPct) {
      reason = `${days.length - recorded} of ${days.length} day(s) are missing records (${completenessPct}% complete, ${this.minCompletenessPct}% needed).`;
    }
    return {
      ...base,
      expectedDays: days.length,
      recordedDays: recorded,
      completenessPct,
      ready: reason == null,
      reason,
      missingDays: missingDays.slice(-14),
    };
  }

  /** Every active batch over a window (used for the farm-wide reports). */
  async assessActiveBatches(start: Date, end: Date) {
    const batches = await this.prisma.batch.findMany({
      where: { isActive: true, deletedAt: null },
      select: { id: true },
    });
    const results = (await Promise.all(batches.map(b => this.assessBatch(b.id, start, end))))
      .filter((r): r is BatchReadiness => !!r && r.expectedDays > 0);
    const expected = results.reduce((s, r) => s + r.expectedDays, 0);
    const recordedDays = results.reduce((s, r) => s + r.recordedDays, 0);
    const ready = results.filter(r => r.ready);
    return {
      batches: results,
      readyBatchIds: ready.map(r => r.batchId),
      completenessPct: expected ? Math.round((recordedDays / expected) * 1000) / 10 : 0,
      ready: ready.length > 0,
      minCompletenessPct: this.minCompletenessPct,
    };
  }

  /** Latest create/update time of any record that feeds an AI report, in scope. */
  async latestActivityAt(batchIds: string[] | null, since: Date): Promise<Date | null> {
    const b = batchIds ? { batchId: { in: batchIds } } : {};
    const max = (rows: Array<Date | null | undefined>) =>
      rows.filter((d): d is Date => !!d).reduce<Date | null>((m, d) => (!m || d > m ? d : m), null);
    const latest = async (p: Promise<any>) => p.catch(() => null);
    const [s, f, bl, gf, h, v, w, r] = await Promise.all([
      latest(this.prisma.eggCollectionSession.aggregate({ where: { ...b, sessionDate: { gte: since } }, _max: { updatedAt: true } })),
      latest(this.prisma.feedIntakeLog.aggregate({ where: { ...b, entryDate: { gte: since } }, _max: { updatedAt: true } })),
      latest(this.prisma.brooderLog.aggregate({ where: { ...b, logDate: { gte: since } }, _max: { createdAt: true } })),
      latest(this.prisma.brooderGeneralFeedLog.aggregate({ where: { ...b, entryDate: { gte: since } }, _max: { createdAt: true } })),
      latest(this.prisma.healthEvent.aggregate({ where: { ...b, eventDate: { gte: since } }, _max: { updatedAt: true } })),
      latest(this.prisma.vaccinationRecord.aggregate({ where: { ...b, administeredDate: { gte: since } }, _max: { createdAt: true } })),
      latest(this.prisma.birdWeightSample.aggregate({ where: { ...b }, _max: { createdAt: true } })),
      latest(this.prisma.storeProductionReport.aggregate({ where: batchIds ? { batchId: { in: batchIds } } : {}, _max: { uploadedAt: true } })),
    ]);
    return max([
      s?._max.updatedAt, f?._max.updatedAt, bl?._max.createdAt, gf?._max.createdAt,
      h?._max.updatedAt, v?._max.createdAt, w?._max.createdAt, r?._max.uploadedAt,
    ]);
  }

  /** True when nothing in scope changed after `reportAt` (so a new report would repeat it). */
  async unchangedSince(reportAt: Date, batchIds: string[] | null, since: Date) {
    const last = await this.latestActivityAt(batchIds, since);
    return !last || last <= reportAt;
  }

  /** Human-readable summary of why batches aren't ready (for errors / notifications). */
  static describe(rs: BatchReadiness[], limit = 5) {
    return rs
      .filter(r => !r.ready)
      .slice(0, limit)
      .map(r => {
        const sample = r.missingDays.slice(-3).map(d => `${dayjs(d.date).format('D MMM')}: ${d.missing.join(', ')}`).join('; ');
        return `${r.batchCode} — ${r.reason}${sample ? ` Recent gaps: ${sample}.` : ''}`;
      })
      .join('\n');
  }
}
