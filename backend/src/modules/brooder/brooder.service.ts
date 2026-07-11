// src/modules/brooder/brooder.service.ts
//
// Brooder Cage Map + Control Standards (HyLine Brown, weeks 1-19).
//
// Control requirements implemented:
//   Req 1 — Mortality/culling recorded by Row, Level, count. On save:
//            BrooderLevelAssignment.birdCount decremented,
//            Batch.currentBirdCount decremented.
//   Req 2 — After every mortality event the feed allocation for the
//            following day is recalculated from the new population count
//            (no explicit daily record needed — the cage-map feed-summary
//            endpoint always derives from live birdCount).
//   Req 3 — createLevelFeedLog blocks issuance that would exceed the daily
//            HyLine ration; a BadRequestException is thrown before the DB write.
//   Req 4 — getFeedRequirementSummary carries the current week's residual
//            balance from the last approved IssuancePlan into the next plan.
//   Req 5 — Feed control uses HyLine g/bird/day per week (not a fixed 90g).
//   Req 6 — checkWeightSample and getCumulativeMortalityCheck use HyLine bands.
//   Req 7 — All three control checks (feed, weight, mortality) emit
//            BROODER_* notification types to MANAGER and OWNER on violation.

import {
  BadRequestException, ConflictException, Injectable,
  Logger, NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../../common/notifications/notifications.service';
import { StoreInventoryService } from '../store/store-inventory.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DASHBOARD_REFRESH_EVENT } from '../../common/events/app-event-bus';
import { HeatSourceType, UserRole } from '@prisma/client';
import {
  hylineStandard,
  brooderRequiredFeedKg,
  brooderAdjustedWeeklyFeedKgWithMortality,
  MortalityDayEvent,
  brooderWeekStart,
  batchAgeWeeks,
  checkWeightViolation,
  checkMortalityViolation,
  isEarlyPhaseNotEating,
  NOT_EATING_ALERT_DAYS,
  farmNow,
  farmTodayUtcMidnight,
  apportionByShare,
} from '../../common/feed/feed-standard.util';
import {
  AssignLevelSchema,
  CreateHeatLogSchema,
  StopBulbHeatLogSchema,
  CreateLevelFeedLogSchema,
  CreateLevelMortalityLogSchema,
  CreateBrooderWeightSampleSchema,
  CreateGeneralFeedLogSchema,
  CreateGeneralMortalityLogSchema,
} from './brooder.dto';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
dayjs.extend(isoWeek);
import { ZodError } from 'zod';

function parseOrThrow<T>(schema: { parse: (v: unknown) => T }, value: unknown): T {
  try {
    return schema.parse(value);
  } catch (e) {
    if (e instanceof ZodError) {
      throw new BadRequestException({
        message: e.issues.map(i => `${i.path.join('.')}: ${i.message}`),
        error: 'Validation Failed',
      });
    }
    throw e;
  }
}

@Injectable()
export class BrooderService {
  private readonly logger = new Logger(BrooderService.name);

  constructor(
    private readonly prisma:        PrismaService,
    private readonly notifications: NotificationsService,
    private readonly eventEmitter:  EventEmitter2,
    private readonly storeInventory: StoreInventoryService,
  ) {}

  private refresh() {
    this.eventEmitter.emit(DASHBOARD_REFRESH_EVENT, { roles: ['ATTENDANT', 'MANAGER', 'OWNER'] });
  }

  // ── Notify MANAGER + OWNER ────────────────────────────────────────────────
  private async alertRoles(
    type: 'BROODER_FEED_OVERISSUE' | 'BROODER_WEIGHT_ANOMALY' | 'BROODER_MORTALITY_HIGH',
    title: string,
    message: string,
    entityId?: string,
  ) {
    await Promise.all([
      this.notifications.notifyRole(UserRole.MANAGER, type as any, title, message, { entityId, entityType: 'Brooder' }),
      this.notifications.notifyRole(UserRole.OWNER,   type as any, title, message, { entityId, entityType: 'Brooder' }),
    ]);
  }

  // ── General-population vs. row/level clash guards ────────────────────────
  //
  // The "general population record sheet" lets a Lead Attendant who cannot
  // break feed/mortality down by row+level record it against the whole
  // batch instead. Because BrooderLevelFeedLog/BrooderLevelMortalityLog and
  // BrooderGeneralFeedLog/BrooderGeneralMortalityLog are separate tables
  // that both ultimately roll up into the same batch totals, the two must
  // never both hold data for the same (batch, date) — that would double
  // count. These four guards enforce that mutual exclusion in both
  // directions, at write time, in the application layer.

  /** All row/level IDs currently assigned to a batch (current occupancy only —
   *  mirrors the same limitation as the rest of the cage-map code, which has
   *  no historical-assignment table to look further back than "now"). */
  private async getBatchLevelIds(batchId: string): Promise<string[]> {
    const assignments = await this.prisma.brooderLevelAssignment.findMany({
      where:  { batchId },
      select: { levelId: true },
    });
    return assignments.map(a => a.levelId);
  }

  private async assertNoLevelSpecificFeedLog(batchId: string, entryDate: Date) {
    const levelIds = await this.getBatchLevelIds(batchId);
    if (levelIds.length === 0) return;
    const existing = await this.prisma.brooderLevelFeedLog.findFirst({
      where: { levelId: { in: levelIds }, entryDate },
    });
    if (existing) {
      throw new ConflictException(
        'Feed has already been logged at row/level detail for this batch on this date. ' +
        'To avoid double counting, continue logging by row/level for this date instead of ' +
        'using the general population sheet.',
      );
    }
  }

  private async assertNoGeneralFeedLog(batchId: string, entryDate: Date) {
    const existing = await this.prisma.brooderGeneralFeedLog.findFirst({
      where: { batchId, entryDate },
    });
    if (existing) {
      throw new ConflictException(
        'A general population feed entry already exists for this batch on this date. ' +
        'To avoid double counting, edit or delete that entry instead of logging by row/level.',
      );
    }
  }

  private async assertNoLevelSpecificMortalityLog(batchId: string, logDate: Date) {
    const existing = await this.prisma.brooderLevelMortalityLog.findFirst({
      where: { batchId, logDate },
    });
    if (existing) {
      throw new ConflictException(
        'Mortality has already been logged at row/level detail for this batch on this date. ' +
        'To avoid double counting, continue logging by row/level for this date instead of ' +
        'using the general population sheet.',
      );
    }
  }

  private async assertNoGeneralMortalityLog(batchId: string, logDate: Date) {
    const existing = await this.prisma.brooderGeneralMortalityLog.findFirst({
      where: { batchId, logDate },
    });
    if (existing) {
      throw new ConflictException(
        'A general population mortality entry already exists for this batch on this date. ' +
        'To avoid double counting, edit or delete that entry instead of logging by row/level.',
      );
    }
  }

  // ── Control standard reference table ─────────────────────────────────────

  /** Returns the full HyLine rearing schedule (weeks 1-19) for display
   *  in the Director and Production Manager dashboards. */
  async getControlStandards() {
    // Prefer DB rows (overridable by owner); fall back to in-memory schedule.
    const rows = await this.prisma.brooderControlStandard.findMany({
      orderBy: { week: 'asc' },
    }).catch(() => []);

    if (rows.length > 0) return rows;

    // In-memory fallback — identical to migration seed.
    return Array.from({ length: 19 }, (_, i) => {
      const std = hylineStandard(i + 1);
      return {
        week:                   std.week,
        deheusPhase:            std.phase,
        feedingGramsPerBird:    std.feedingGramsPerBird,
        deheusWeeklyIntakeKg:   std.weeklyIntakeKgPerBird,
        expectedWeightMinG:     std.weightMinG,
        expectedWeightMaxG:     std.weightMaxG,
        cumulativeMortalityPct: std.cumulativeMortalityPct,
      };
    });
  }

  // ── Cage map: full 6x4 grid with assignments, heating, feed status ───────

  /** Lightweight grid for the registration modal: returns rows + levels with
   *  occupancy flag so the PM can see which cells are free before placing birds. */
  async getRowsAndLevels() {
    const rows = await this.prisma.brooderRow.findMany({
      orderBy: { rowNumber: 'asc' },
      where:   { isActive: true },
      select: {
        id: true, rowNumber: true, label: true,
        levels: {
          orderBy: { levelNumber: 'asc' },
          where:   { isActive: true },
          select: {
            id: true, levelNumber: true, label: true,
            assignment: {
              select: { batchId: true, birdCount: true },
            },
          },
        },
      },
    });
    return rows.map(r => ({
      rowId:     r.id,
      rowNumber: r.rowNumber,
      label:     r.label,
      levels: r.levels.map(l => ({
        levelId:     l.id,
        levelNumber: l.levelNumber,
        label:       l.label,
        isOccupied:  !!l.assignment,
        currentBirdCount: l.assignment?.birdCount ?? 0,
      })),
    }));
  }

  async getCageMap() {
    const rows = await this.prisma.brooderRow.findMany({
      orderBy: { rowNumber: 'asc' },
      include: {
        levels: {
          orderBy: { levelNumber: 'asc' },
          include: { assignment: true },
        },
      },
    });

    const batchIds = Array.from(new Set(
      rows.flatMap(r => r.levels).flatMap(l => (l.assignment ? [l.assignment.batchId] : [])),
    ));

    const batches = batchIds.length
      ? await this.prisma.batch.findMany({
          where: { id: { in: batchIds } },
          select: {
            id: true, batchCode: true, strain: true, stage: true, birdType: true,
            currentBirdCount: true, quantityReceived: true,
            mortalityOnArrival: true,
            dateOfHatch: true, dateReceived: true, isActive: true,
          },
        })
      : [];
    const batchMap = Object.fromEntries(batches.map(b => [b.id, b]));

    // Today's heat log per row — farm-local calendar day (see farmTodayUtcMidnight
    // for why this can't just be dayjs().startOf('day') on the server clock).
    const today = farmTodayUtcMidnight();
    const todayStr = dayjs(today).format('YYYY-MM-DD');
    const heatLogs = await this.prisma.brooderHeatLog.findMany({
      where: { rowId: { in: rows.map(r => r.id) }, logDate: { gte: today } },
      orderBy: { createdAt: 'desc' },
    });
    const heatByRow: Record<string, typeof heatLogs[number]> = {};
    for (const h of heatLogs) {
      if (!heatByRow[h.rowId]) heatByRow[h.rowId] = h;
    }

    // This week's feed dispensed per level — anchored to each batch's OWN
    // arrival-relative "brooder week" (Week 1 = days 0-6 since the birds
    // were RECEIVED on the farm, Week 2 = days 7-13, etc.), not the
    // calendar week and not hatch date. Feed control is about what the
    // farm has actually been feeding these birds since it took custody of
    // them, which starts on dateReceived — dateOfHatch may be days earlier
    // (transit time) and isn't when feeding at this farm began. Birds also
    // rarely arrive exactly on a calendar week boundary, so a calendar-week
    // window can silently exclude a feed log backdated to a day that's
    // still within the batch's first week on the farm but has rolled into a
    // new calendar week. See brooderWeekStart() in feed-standard.util.ts.
    const levelIds = rows.flatMap(r => r.levels).map(l => l.id);

    const weekStartByLevel: Record<string, Date> = {};
    for (const row of rows) {
      for (const level of row.levels) {
        const a = level.assignment;
        const batch = a ? batchMap[a.batchId] : null;
        if (batch) weekStartByLevel[level.id] = brooderWeekStart(batch.dateReceived);
      }
    }
    const weekStartValues = Object.values(weekStartByLevel);
    // Fetch from the earliest relevant brooder-week-start across all levels
    // in one query, then filter per-level (each may have a different start).
    const earliestWeekStart = weekStartValues.length
      ? new Date(Math.min(...weekStartValues.map(d => d.getTime())))
      : dayjs(farmNow()).startOf('week').toDate();

    const feedLogs = levelIds.length
      ? await this.prisma.brooderLevelFeedLog.findMany({
          where: { levelId: { in: levelIds }, entryDate: { gte: earliestWeekStart } },
        })
      : [];
    const feedByLevel: Record<string, number> = {};
    for (const f of feedLogs) {
      const levelWeekStart = weekStartByLevel[f.levelId];
      if (levelWeekStart && f.entryDate.getTime() >= levelWeekStart.getTime()) {
        feedByLevel[f.levelId] = (feedByLevel[f.levelId] ?? 0) + f.quantityDispensedKg;
      }
    }

    // ── General-population feed, folded into the same live-status view ────
    //
    // A Lead Attendant who can't attribute feed to a specific row/level logs
    // it against the whole batch instead (BrooderGeneralFeedLog — see
    // createGeneralFeedLog). assertNoLevelSpecificFeedLog/assertNoGeneralFeedLog
    // guarantee a batch never has BOTH sources for the same date, but until
    // now this endpoint only ever read BrooderLevelFeedLog, so a batch fed
    // entirely via the general sheet showed up here as if nothing had been
    // fed at all. Fixed by reading BrooderGeneralFeedLog too, apportioning
    // it pro-rata across the batch's levels (by live bird count) so each
    // level's "dispensed" figure reflects reality either way.
    //
    // The apportioned amount can't be checked against any one row/level's
    // schedule with confidence though — a general entry says nothing about
    // how much of it actually reached THIS row — so any level whose batch
    // has a general entry in the current brooder week gets its schedule %
    // (feedVariancePercent) suppressed rather than shown as a possibly
    // misleading number.
    const batchWeekStart: Record<string, Date> = {};
    const batchBirdTotal: Record<string, number> = {};
    for (const row of rows) {
      for (const level of row.levels) {
        const a = level.assignment;
        if (!a) continue;
        const batch = batchMap[a.batchId];
        if (batch && !batchWeekStart[a.batchId]) {
          batchWeekStart[a.batchId] = brooderWeekStart(batch.dateReceived);
        }
        batchBirdTotal[a.batchId] = (batchBirdTotal[a.batchId] ?? 0) + a.birdCount;
      }
    }

    const generalFeedLogs = batchIds.length
      ? await this.prisma.brooderGeneralFeedLog.findMany({
          where: { batchId: { in: batchIds }, entryDate: { gte: earliestWeekStart } },
        })
      : [];
    const generalFeedThisWeekByBatch: Record<string, number> = {};
    const generalFeedTodayByBatch: Record<string, number> = {};
    const hasGeneralThisWeekByBatch: Record<string, boolean> = {};
    for (const f of generalFeedLogs) {
      const start = batchWeekStart[f.batchId];
      if (start && f.entryDate.getTime() >= start.getTime()) {
        generalFeedThisWeekByBatch[f.batchId] =
          (generalFeedThisWeekByBatch[f.batchId] ?? 0) + f.quantityDispensedKg;
        hasGeneralThisWeekByBatch[f.batchId] = true;
      }
      if (dayjs(f.entryDate).format('YYYY-MM-DD') === todayStr) {
        generalFeedTodayByBatch[f.batchId] =
          (generalFeedTodayByBatch[f.batchId] ?? 0) + f.quantityDispensedKg;
      }
    }

    // This week's mortality/culling events per level — needed to reconstruct
    // the day-by-day population for brooderAdjustedWeeklyFeedKgWithMortality
    // (see feed-standard.util.ts). Same earliest-week-start batching trick as
    // feedLogs above; filtered per-level below since each batch's brooder
    // week can start on a different date.
    const mortalityLogs = levelIds.length
      ? await (this.prisma as any).brooderLevelMortalityLog.findMany({
          where: { levelId: { in: levelIds }, logDate: { gte: earliestWeekStart } },
        })
      : [];
    const mortalityEventsByLevel: Record<string, MortalityDayEvent[]> = {};
    for (const m of mortalityLogs) {
      const levelWeekStart = weekStartByLevel[m.levelId];
      if (levelWeekStart && m.logDate.getTime() >= levelWeekStart.getTime()) {
        const count = (m.mortalityCount ?? 0) + (m.cullingCount ?? 0);
        if (count <= 0) continue;
        (mortalityEventsByLevel[m.levelId] ??= []).push({
          date: m.logDate,
          count,
          occurredAt: m.createdAt,
        });
      }
    }

    // ── General-population mortality, folded into the same day-by-day
    // reconstruction used for the weekly schedule ──────────────────────────
    //
    // A batch whose deaths were recorded on the general sheet (no row/level
    // breakdown — see assertNoLevelSpecificMortalityLog/assertNoGeneralMortalityLog,
    // which guarantee a batch never has BOTH sources for the same date) would
    // otherwise never show up in mortalityEventsByLevel at all, so
    // requiredKgThisWeek below kept costing every day of the week at the full
    // pre-death population — including backdated general entries for days
    // that have already passed and days feed simply hasn't been issued for
    // yet. Apportion each general entry across the batch's levels pro-rata
    // by live bird count (same signal used above for general feed, and now
    // also used to decrement each level's birdCount at log-creation time —
    // see createGeneralMortalityLog) and add it into the same per-level event
    // list so it's priced exactly like a row/level entry would have been.
    const levelWeightsByBatch: Record<string, Record<string, number>> = {};
    for (const row of rows) {
      for (const level of row.levels) {
        const a = level.assignment;
        if (!a) continue;
        (levelWeightsByBatch[a.batchId] ??= {})[level.id] = a.birdCount;
      }
    }

    const generalMortalityLogs = batchIds.length
      ? await (this.prisma as any).brooderGeneralMortalityLog.findMany({
          where: { batchId: { in: batchIds }, logDate: { gte: earliestWeekStart } },
        })
      : [];
    for (const m of generalMortalityLogs) {
      const count = (m.mortalityCount ?? 0) + (m.cullingCount ?? 0);
      if (count <= 0) continue;
      const weights = levelWeightsByBatch[m.batchId] ?? {};
      const apportioned = apportionByShare(count, weights);
      for (const [levelId, share] of Object.entries(apportioned)) {
        if (share <= 0) continue;
        const levelWeekStart = weekStartByLevel[levelId];
        if (!levelWeekStart || m.logDate.getTime() < levelWeekStart.getTime()) continue;
        (mortalityEventsByLevel[levelId] ??= []).push({
          date: m.logDate,
          count: share,
          occurredAt: m.createdAt,
        });
      }
    }

    // Today's feed dispensed per level (for over-issue guard display)
    const todayFeedByLevel: Record<string, number> = {};
    for (const f of feedLogs) {
      if (dayjs(f.entryDate).format('YYYY-MM-DD') === todayStr) {
        todayFeedByLevel[f.levelId] = (todayFeedByLevel[f.levelId] ?? 0) + f.quantityDispensedKg;
      }
    }

    // This week's weight samples per level — used to flag birds outside the
    // HyLine min/max band for their age, wherever they were weighed.
    // (Weight sampling cadence isn't part of the brooder-week feed fix above —
    // calendar week is fine here.)
    const calendarWeekStart = dayjs().startOf('week').toDate();
    const weightSamples = levelIds.length
      ? await this.prisma.birdWeightSample.findMany({
          where: { levelId: { in: levelIds }, sampleDate: { gte: calendarWeekStart } },
          orderBy: { sampleDate: 'desc' },
        })
      : [];
    const latestWeightByLevel: Record<string, typeof weightSamples[number]> = {};
    for (const w of weightSamples) {
      if (w.levelId && !latestWeightByLevel[w.levelId]) latestWeightByLevel[w.levelId] = w;
    }

    const mappedRows = rows.map(row => {
      const heat = heatByRow[row.id] ?? null;
      const levels = row.levels.map(level => {
        const a = level.assignment;
        const batch = a ? batchMap[a.batchId] : null;
        let requiredKgThisWeek: number | null = null;
        let dailyRationKg: number | null = null;
        let ageWeeks: number | null = null;
        let hylineWeek: number | null = null;

        if (batch && a) {
          // Feed schedule age/week is anchored to dateReceived, not
          // dateOfHatch — see the weekStartByLevel comment above.
          ageWeeks = batchAgeWeeks(batch.dateReceived);
          const std = hylineStandard(ageWeeks);
          hylineWeek = std.week;
          // Use adjusted weekly feed (early/transition days contribute 0 or 50%),
          // windowed to this batch's OWN arrival-relative brooder week so it
          // matches dispensedKgThisWeek's window above.
          //
          // This projects the FULL 7-day week (not just days elapsed so far),
          // so "Schedule" reads as a true weekly total that lines up with
          // birds × g/bird/day × 7. Days that have already happened are still
          // priced at whatever the actual population was that day — mortality
          // events are applied on the specific day they're logged against
          // (logDate), whether entered live or backdated — and any days still
          // ahead in the week are projected at the current (latest known)
          // population, since no future mortality can be known yet.
          const levelWeekStart = brooderWeekStart(batch.dateReceived);
          const levelWeekEnd = new Date(levelWeekStart);
          levelWeekEnd.setUTCDate(levelWeekEnd.getUTCDate() + 6);
          requiredKgThisWeek = brooderAdjustedWeeklyFeedKgWithMortality(
            a.birdCount, ageWeeks, levelWeekStart, levelWeekEnd,
            mortalityEventsByLevel[level.id] ?? [],
          );
          // Daily ration is always the standard HyLine figure — enforcement
          // is relaxed in early/transition phases but the figure is still
          // shown as an advisory reference on the UI.
          dailyRationKg = brooderRequiredFeedKg(a.birdCount, ageWeeks, 1);
        }
        // Pro-rata share of this batch's general-population feed, by this
        // level's share of the batch's live bird count (only relevant when
        // the batch has any general-sheet entries in-window — see above).
        const usedGeneralThisWeek = a ? !!hasGeneralThisWeekByBatch[a.batchId] : false;
        const birdShare = a && batchBirdTotal[a.batchId] > 0
          ? a.birdCount / batchBirdTotal[a.batchId]
          : 0;
        const generalShareThisWeek = a
          ? (generalFeedThisWeekByBatch[a.batchId] ?? 0) * birdShare
          : 0;
        const generalShareToday = a
          ? (generalFeedTodayByBatch[a.batchId] ?? 0) * birdShare
          : 0;

        const rowLevelDispensedThisWeek = feedByLevel[level.id] ?? 0;
        const dispensedThisWeek = rowLevelDispensedThisWeek + generalShareThisWeek;
        const dispensedToday    = (todayFeedByLevel[level.id] ?? 0) + generalShareToday;
        const feedSource: 'ROW_LEVEL' | 'GENERAL' | 'MIXED' | null =
          rowLevelDispensedThisWeek > 0 && usedGeneralThisWeek ? 'MIXED'
          : usedGeneralThisWeek ? 'GENERAL'
          : rowLevelDispensedThisWeek > 0 ? 'ROW_LEVEL'
          : null;

        // ── Weight check (this week, this exact row/level) ─────────────────
        const latestWeight = latestWeightByLevel[level.id] ?? null;
        let weightCheck: {
          sampleDate:     Date;
          averageWeightG: number;
          ageWeeks:       number;
          minG:           number;
          maxG:           number;
          withinBounds:   boolean;
        } | null = null;
        if (latestWeight) {
          const wStd = hylineStandard(latestWeight.ageWeeks);
          const avg  = Number(latestWeight.averageWeightG);
          weightCheck = {
            sampleDate:     latestWeight.sampleDate,
            averageWeightG: avg,
            ageWeeks:       latestWeight.ageWeeks,
            minG:           wStd.weightMinG,
            maxG:           wStd.weightMaxG,
            withinBounds:   avg >= wStd.weightMinG && avg <= wStd.weightMaxG,
          };
        }

        return {
          levelId:       level.id,
          levelNumber:   level.levelNumber,
          label:         level.label,
          isActive:      level.isActive,
          assignment: a ? {
            batchId:   a.batchId,
            birdCount: a.birdCount,
            placedDate: a.placedDate,
            notes:     a.notes,
          } : null,
          batch: batch ? {
            batchCode:        batch.batchCode,
            strain:           batch.strain,
            stage:            batch.stage,
            ageWeeks:         batchAgeWeeks(batch.dateOfHatch),
            quantityReceived: batch.quantityReceived,
            dateOfHatch:      dayjs(batch.dateOfHatch).format('YYYY-MM-DD'),
            dateReceived:     dayjs(batch.dateReceived).format('YYYY-MM-DD'),
          } : null,
          hylineWeek,
          dailyRationKg,
          requiredKgThisWeek,
          dispensedKgThisWeek: Math.round(dispensedThisWeek * 100) / 100,
          dispensedKgToday:    Math.round(dispensedToday    * 100) / 100,
          feedSource,
          // Schedule % is only meaningful when we know feed actually reached
          // THIS row/level. A general-population entry is batch-wide — this
          // level's share above is only an estimate, apportioned pro-rata by
          // bird count — so it isn't scored against the standard for weeks
          // where general logging was used instead of row/level logging.
          // The (apportioned) dispensed total above is still shown either way.
          feedVariancePercent:
            !usedGeneralThisWeek && requiredKgThisWeek && requiredKgThisWeek > 0
              ? Math.round(((dispensedThisWeek - requiredKgThisWeek) / requiredKgThisWeek) * 1000) / 10
              : null,
          weightCheck,
        };
      });

      const rowBirdTotal = levels.reduce((s, l) => s + (l.assignment?.birdCount ?? 0), 0);

      return {
        rowId:     row.id,
        rowNumber: row.rowNumber,
        label:     row.label,
        isActive:  row.isActive,
        birdTotal: rowBirdTotal,
        heatToday: heat ? {
          id:           heat.id,
          sourceType:   heat.sourceType,
          charcoalKg:   heat.charcoalKg,
          bulbStartedAt: heat.bulbStartedAt,
          bulbStoppedAt: heat.bulbStoppedAt,
          bulbMinutesOn: heat.bulbMinutesOn
            ?? (heat.bulbStartedAt && !heat.bulbStoppedAt
                  ? dayjs().diff(dayjs(heat.bulbStartedAt), 'minute')
                  : null),
          bulbCount:   heat.bulbCount,
          isRunning:   heat.sourceType === HeatSourceType.HEAT_BULB
            && !!heat.bulbStartedAt && !heat.bulbStoppedAt,
        } : null,
        levels,
      };
    });

    const totalChicks = mappedRows.reduce((s, r) => s + r.birdTotal, 0);
    return { rows: mappedRows, totalChicks, generatedAt: new Date() };
  }

  // ── Level assignment ──────────────────────────────────────────────────────

  async assignLevel(levelId: string, input: unknown, userId: string) {
    const dto = parseOrThrow(AssignLevelSchema, input);
    const level = await this.prisma.brooderLevel.findUnique({ where: { id: levelId } });
    if (!level) throw new NotFoundException('Brooder level not found');
    const batch = await this.prisma.batch.findUnique({ where: { id: dto.batchId } });
    if (!batch) throw new NotFoundException('Batch not found');

    const existingAssignmentsForBatch = await this.prisma.brooderLevelAssignment.findMany({
      where: { batchId: dto.batchId },
    });
    const isAlreadyPlaced  = batch.location === 'BROODER';
    const hasAnyAssignment = existingAssignmentsForBatch.length > 0;
    if (!isAlreadyPlaced && hasAnyAssignment) {
      throw new BadRequestException(
        'Only batches currently in the Brooder can be assigned to a level.',
      );
    }

    // FIX: when a sourceLevelId is provided the birds are being MOVED (not added),
    // so the source level must be excluded from siblingsTotal — otherwise the check
    // double-counts those birds and incorrectly throws a quantityReceived overflow.
    // Example: moving 2990 from R3L2 → R3L3(2984).  Without the fix:
    //   siblingsTotal = 2990 (R3L2 still counted) + 2990 (dto) = 5980 > quantityReceived → throws.
    // With the fix:
    //   siblingsTotal = 0 (R3L2 excluded) + 2990 (dto) = 2990 ≤ quantityReceived → passes.
    const siblingsTotal = existingAssignmentsForBatch
      .filter(a => a.levelId !== levelId && a.levelId !== dto.sourceLevelId)
      .reduce((s, a) => s + a.birdCount, 0);
    const newTotal = siblingsTotal + dto.birdCount;
    if (newTotal > batch.quantityReceived) {
      throw new BadRequestException(
        `Cannot assign ${dto.birdCount} birds to this level: total would be ${newTotal} ` +
        `but batch ${batch.batchCode} only received ${batch.quantityReceived} birds. ` +
        `You can place at most ${batch.quantityReceived - siblingsTotal} birds here.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // ── Decrement the source level (bird reassignment) ──────────────────
      if (dto.sourceLevelId) {
        const sourceAssignment = await tx.brooderLevelAssignment.findUnique({
          where: { levelId: dto.sourceLevelId },
        });
        if (!sourceAssignment) {
          throw new BadRequestException(
            'The specified source level has no active assignment. Cannot move birds from it.',
          );
        }
        const newSourceCount = sourceAssignment.birdCount - dto.birdCount;
        if (newSourceCount < 0) {
          throw new BadRequestException(
            `Cannot move ${dto.birdCount} birds from the source level — it only has ${sourceAssignment.birdCount}.`,
          );
        }
        if (newSourceCount === 0) {
          // Source level is now empty — remove the assignment entirely
          await tx.brooderLevelAssignment.delete({ where: { levelId: dto.sourceLevelId } });
        } else {
          await tx.brooderLevelAssignment.update({
            where: { levelId: dto.sourceLevelId },
            data:  { birdCount: newSourceCount },
          });
        }

        // ── Carry over partial-day feed when birds move mid-day ────────────
        // If feed was already dispensed to the source level TODAY before this
        // reassignment, that feed was eaten by the population as it stood at
        // feeding time (oldSourceBirdCount = sourceAssignment.birdCount).
        // Moving dto.birdCount of those birds out must move their proportional
        // share of today's already-eaten feed to the destination level too —
        // otherwise:
        //   • the source level's remaining ration looks artificially used up,
        //     penalising the birds that stayed behind, and
        //   • the destination level looks un-fed, letting the incoming birds
        //     be issued a full fresh day's ration on top of what they already
        //     ate before the move.
        // Carryover entries are dated "today" so they also flow correctly into
        // this week's dispensed total for both levels.
        const oldSourceBirdCount = sourceAssignment.birdCount;
        const todayDate     = new Date(dayjs().format('YYYY-MM-DD'));
        const tomorrowDate  = dayjs(todayDate).add(1, 'day').toDate();
        const todaysSourceLogs = await tx.brooderLevelFeedLog.findMany({
          where: {
            levelId:   dto.sourceLevelId,
            entryDate: { gte: todayDate, lt: tomorrowDate },
          },
        });
        if (todaysSourceLogs.length > 0 && oldSourceBirdCount > 0) {
          const dispensedByFeedType = new Map<string, number>();
          for (const log of todaysSourceLogs) {
            dispensedByFeedType.set(
              log.feedType,
              (dispensedByFeedType.get(log.feedType) ?? 0) + log.quantityDispensedKg,
            );
          }
          for (const [feedType, totalKg] of dispensedByFeedType) {
            const movedShareKg = Math.round(
              (totalKg * dto.birdCount / oldSourceBirdCount) * 1000,
            ) / 1000;
            if (!movedShareKg) continue;
            await tx.brooderLevelFeedLog.create({
              data: {
                levelId:             dto.sourceLevelId,
                feedType,
                entryDate:           todayDate,
                quantityDispensedKg: -movedShareKg,
                requiredKgForWeek:   null,
                notes: `Reassignment carryover: ${dto.birdCount} of ${oldSourceBirdCount} birds moved out — ` +
                       `their share of today's already-dispensed ${feedType} transferred to the destination level.`,
                loggedById: userId,
              },
            });
            await tx.brooderLevelFeedLog.create({
              data: {
                levelId,
                feedType,
                entryDate:           todayDate,
                quantityDispensedKg: movedShareKg,
                requiredKgForWeek:   null,
                notes: `Reassignment carryover: ${dto.birdCount} birds received from another level, already ` +
                       `having eaten ${movedShareKg.toFixed(3)}kg of ${feedType} today before the move.`,
                loggedById: userId,
              },
            });
          }
        }
      }

      // ── Place / update the target level ────────────────────────────────
      // If the target level already has birds, ADD the incoming count to the
      // existing count (moving birds into an occupied level merges them).
      // If the target is empty, this is a fresh placement.
      const existingTargetAssignment = await tx.brooderLevelAssignment.findUnique({
        where: { levelId },
      });
      const finalBirdCount = existingTargetAssignment
        ? existingTargetAssignment.birdCount + dto.birdCount
        : dto.birdCount;

      // FIX: both create and update branches must use finalBirdCount so that
      // incoming birds are always ADDED to whatever already exists on the target
      // level — whether the upsert ends up inserting or updating.
      const result = await tx.brooderLevelAssignment.upsert({
        where:  { levelId },
        create: {
          levelId, batchId: dto.batchId, birdCount: finalBirdCount,
          placedDate: new Date(dto.placedDate), notes: dto.notes ?? null, assignedById: userId,
        },
        update: {
          batchId: dto.batchId, birdCount: finalBirdCount,
          placedDate: new Date(dto.placedDate), notes: dto.notes ?? null, assignedById: userId,
        },
      });
      await tx.batch.update({
        where: { id: dto.batchId },
        data:  { location: 'BROODER' },
      });
      this.refresh();
      return result;
    }).catch((e: any) => {
      if (e?.code === 'P2002') throw new ConflictException('Active assignment already exists for this level');
      throw e;
    });
  }

  async removeLevelAssignment(levelId: string) {
    const result = await this.prisma.brooderLevelAssignment.deleteMany({ where: { levelId } });
    this.refresh();
    return result;
  }

  async getAssignmentsByBatch(batchId: string) {
    return this.prisma.brooderLevelAssignment.findMany({
      where: { batchId },
      include: {
        level: {
          select: {
            levelNumber: true, label: true, isActive: true,
            row: { select: { id: true, rowNumber: true, label: true } },
          },
        },
      },
    });
  }

  // ── Heat logs ─────────────────────────────────────────────────────────────

  async listHeatLogs(rowId: string, limit = 30) {
    return this.prisma.brooderHeatLog.findMany({
      where: { rowId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { loggedBy: { select: { id: true, fullName: true } } },
    });
  }

  async createHeatLog(input: unknown, userId: string) {
    const dto = parseOrThrow(CreateHeatLogSchema, input);
    const row = await this.prisma.brooderRow.findUnique({ where: { id: dto.rowId } });
    if (!row) throw new NotFoundException('Brooder row not found');

    if (dto.sourceType === 'CHARCOAL') {
      const result = await this.prisma.brooderHeatLog.create({
        data: {
          rowId: dto.rowId, logDate: new Date(dto.logDate),
          sourceType: HeatSourceType.CHARCOAL,
          charcoalKg: dto.charcoalKg, notes: dto.notes ?? null, loggedById: userId,
        },
      });
      this.refresh();
      return result;
    }

    const result = await this.prisma.brooderHeatLog.create({
      data: {
        rowId: dto.rowId, logDate: new Date(dto.logDate),
        sourceType: HeatSourceType.HEAT_BULB,
        bulbStartedAt: new Date(), bulbCount: dto.bulbCount,
        notes: dto.notes ?? null, loggedById: userId,
      },
    });
    this.refresh();
    return result;
  }

  async stopBulbHeatLog(heatLogId: string, input: unknown, userId: string) {
    const dto = parseOrThrow(StopBulbHeatLogSchema, input);
    const log = await this.prisma.brooderHeatLog.findUnique({ where: { id: heatLogId } });
    if (!log) throw new NotFoundException('Heat log not found');
    if (log.sourceType !== HeatSourceType.HEAT_BULB) throw new BadRequestException('Only HEAT_BULB logs can be stopped');
    if (!log.bulbStartedAt) throw new BadRequestException('Bulb timer was never started');
    if (log.bulbStoppedAt)  throw new BadRequestException('Bulb timer is already stopped');

    const stoppedAt  = new Date();
    const minutesOn  = Math.max(0, dayjs(stoppedAt).diff(dayjs(log.bulbStartedAt), 'minute'));
    const result = await this.prisma.brooderHeatLog.update({
      where: { id: heatLogId },
      data:  {
        bulbStoppedAt: stoppedAt, bulbMinutesOn: minutesOn,
        notes: dto.notes ? `${log.notes ? log.notes + ' | ' : ''}${dto.notes}` : log.notes,
      },
    });
    this.refresh();
    return result;
  }

  // ── Per-level feed logs (Req 3 — strict issuance control) ────────────────

  async listLevelFeedLogs(levelId: string, limit = 30) {
    return this.prisma.brooderLevelFeedLog.findMany({
      where: { levelId },
      orderBy: { entryDate: 'desc' },
      take: limit,
      include: { loggedBy: { select: { id: true, fullName: true } } },
    });
  }

  async createLevelFeedLog(input: unknown, userId: string) {
    const dto = parseOrThrow(CreateLevelFeedLogSchema, input);

    // Guard against double counting: if the whole batch has already been
    // fed on the general population sheet for this date, a row/level entry
    // for the same date would count that feeding twice when totals roll up.
    const levelForClashCheck = await this.prisma.brooderLevel.findUnique({
      where: { id: dto.levelId },
      select: { assignment: { select: { batchId: true } } },
    });
    if (levelForClashCheck?.assignment) {
      await this.assertNoGeneralFeedLog(
        levelForClashCheck.assignment.batchId,
        new Date(`${dto.entryDate}T00:00:00.000Z`),
      );
    }

    // A feed type can only be logged against a store item Store has actually
    // issued (stock-out) this week — keeps the attendant from logging feed
    // that was never physically handed to them, and keeps residual math
    // (issued - dispensed) accurate. Mon–Sun window matches the issuance plan.
    // The unit is snapshotted from the store item itself (never trusted from
    // the client) so quantityDispensedKg is always diffed against the same
    // unit the stock-out was recorded in.
    let feedItemUnit: string | null = null;
    let residualAfterKg: number | null = null;
    if (dto.storeItemId) {
      // All-time check, matching the residual ledger model in
      // StoreInventoryService.getIssuableStoreItems — an item issued in any
      // prior week that still has unconsumed stock is still legitimately
      // issuable today. A calendar-week bound here would reject a
      // perfectly valid backdated entry (e.g. logging a feeding from a day
      // that falls in the previous Mon–Sun window).
      const [issued, item] = await Promise.all([
        this.prisma.storeStockOut.aggregate({
          where: { storeItemId: dto.storeItemId },
          _sum: { quantityOut: true },
        }),
        this.prisma.storeItem.findUnique({ where: { id: dto.storeItemId }, select: { unit: true } }),
      ]);
      if (!issued._sum.quantityOut || Number(issued._sum.quantityOut) <= 0) {
        throw new BadRequestException(
          'This feed item has never been issued from the store and cannot be logged. Ask Store to issue it first.',
        );
      }
      feedItemUnit = item?.unit ?? null;

      // Hard stock check: this only confirmed the item was issued at all —
      // it does not confirm anything is actually LEFT of it. Without this,
      // an attendant can keep logging feed against a store item long after
      // its issued stock has been fully consumed, and the residual shown
      // on the Store/attendant screens never reaches a real floor of 0.
      const residualInfo = await this.storeInventory.getResidualForItem(dto.storeItemId);
      const residualBefore = residualInfo?.residual ?? 0;
      if (dto.quantityDispensedKg > residualBefore) {
        throw new BadRequestException(
          `Not enough of this item left to log. Residual remaining: ${residualBefore.toFixed(3)} ` +
          `${feedItemUnit ?? 'kg'}, requested: ${dto.quantityDispensedKg}. ` +
          `Ask Store to issue more before logging further.`,
        );
      }
      residualAfterKg = Math.round((residualBefore - dto.quantityDispensedKg) * 1000) / 1000;
    }

    const level = await this.prisma.brooderLevel.findUnique({
      where:   { id: dto.levelId },
      include: { assignment: true },
    });
    if (!level) throw new NotFoundException('Brooder level not found');

    let requiredKgForWeek:  number | null = null;
    let dailyRationKg:      number | null = null;
    let ageWeeks = 0;

    if (level.assignment) {
      const batch = await this.prisma.batch.findUnique({ where: { id: level.assignment.batchId } });
      if (batch) {
        const entryDateObj = new Date(dto.entryDate);
        // Anchored to the batch's own dateReceived (day the farm took
        // custody), not dateOfHatch and not the calendar week — see
        // weekStartByLevel comment in getCageMap() and brooderWeekStart()
        // in feed-standard.util.ts.
        ageWeeks          = batchAgeWeeks(batch.dateReceived, entryDateObj);
        const weekStart   = brooderWeekStart(batch.dateReceived, entryDateObj);
        const weekMortalityLogs = await (this.prisma as any).brooderLevelMortalityLog.findMany({
          where: { levelId: dto.levelId, logDate: { gte: weekStart, lte: entryDateObj } },
        });
        const weekMortalityEvents: MortalityDayEvent[] = weekMortalityLogs
          .map((m: any) => ({
            date: m.logDate,
            count: (m.mortalityCount ?? 0) + (m.cullingCount ?? 0),
            occurredAt: m.createdAt,
          }))
          .filter((e: MortalityDayEvent) => e.count > 0);
        requiredKgForWeek = brooderAdjustedWeeklyFeedKgWithMortality(
          level.assignment.birdCount, ageWeeks, weekStart, entryDateObj,
          weekMortalityEvents,
        );
        dailyRationKg     = brooderRequiredFeedKg(level.assignment.birdCount, ageWeeks, 1);

        // ── Req 3: Control over-issuance ──────────────────────────────────
        // Hard-blocked at the daily ration for every day of a batch's life —
        // no more EARLY/TRANSITION leniency window. Batches that genuinely
        // aren't eating yet are caught separately by the
        // BROODER_EARLY_PHASE_NOT_EATING alert (checkEarlyPhaseNotEating),
        // not by relaxing this guard.
        const entryDateStart = new Date(`${dto.entryDate}T00:00:00.000Z`);
        const entryDateEnd   = new Date(`${dto.entryDate}T23:59:59.999Z`);
        const todayIssued = await this.prisma.brooderLevelFeedLog.aggregate({
          where: {
            levelId:   dto.levelId,
            entryDate: { gte: entryDateStart, lte: entryDateEnd },
          },
          _sum: { quantityDispensedKg: true },
        });
        const alreadyIssuedKg = todayIssued._sum.quantityDispensedKg ?? 0;
        const totalAfterKg    = Number(alreadyIssuedKg) + dto.quantityDispensedKg;

        if (dailyRationKg !== null && totalAfterKg > dailyRationKg) {
          throw new BadRequestException(
            `Feed issuance blocked: this level's daily ration is ${dailyRationKg.toFixed(2)} kg ` +
            `for ${level.assignment.birdCount} birds at week ${ageWeeks} (HyLine standard). ` +
            `Already issued today: ${Number(alreadyIssuedKg).toFixed(2)} kg. ` +
            `Requested ${dto.quantityDispensedKg} kg would bring total to ${totalAfterKg.toFixed(2)} kg ` +
            `(+${(totalAfterKg - dailyRationKg).toFixed(2)} kg over ration). ` +
            `Reduce the quantity or use the excess to offset tomorrow's issuance.`,
          );
        }
      }
    }

    // Note: feedingPhase / isAdvisoryOnly will be written once migration
    // 20260629000000_brooder_early_phase_feed has run and prisma generate
    // has been re-executed. Until then those columns are intentionally omitted.

    const result = await this.prisma.brooderLevelFeedLog.create({
      data: {
        levelId:             dto.levelId,
        feedType:            dto.feedType,
        storeItemId:         dto.storeItemId ?? null,
        unit:                feedItemUnit,
        entryDate:           new Date(`${dto.entryDate}T00:00:00.000Z`),
        quantityDispensedKg: dto.quantityDispensedKg,
        requiredKgForWeek,
        notes:               dto.notes ?? null,
        loggedById:          userId,
        // feedingPhase and isAdvisoryOnly are added by migration
        // 20260629000000_brooder_early_phase_feed — omit until that migration
        // has run in this environment to avoid PrismaClientValidationError.
      },
    });

    // Mirror into FeedIntakeLog so farm-wide stock deduction stays consistent.
    // This is best-effort — a failure here must never surface as a 500 to the
    // attendant. Failures are logged for the PM to reconcile if needed.
    if (level.assignment) {
      try {
        const batch = await this.prisma.batch.findUnique({ where: { id: level.assignment.batchId } });
        if (batch) {
          // Use a date-only value normalised to UTC midnight to match the
          // @db.Date column exactly, regardless of server timezone.
          // new Date("YYYY-MM-DD") without time is parsed as UTC midnight,
          // which is correct for @db.Date columns.
          const entryDate = new Date(`${dto.entryDate}T00:00:00.000Z`);

          // Atomic upsert on the (batchId, entryDate, feedType) unique key.
          // The previous findFirst → create/update pattern was a
          // check-then-act race: two feed logs for the same batch/date/
          // feedType submitted close together (two levels feeding the same
          // batch, a double-submit, etc.) could both see "no existing row"
          // and both attempt a create, so the second one failed with P2002.
          // upsert lets Postgres resolve the race atomically — the DB
          // itself decides which writer "wins" the insert and which one
          // falls through to the update branch, and increments are additive
          // either way so no dispensed feed is lost.
          const mirrored = await this.prisma.feedIntakeLog.upsert({
            where: {
              batchId_entryDate_feedType: {
                batchId:   batch.id,
                entryDate,
                feedType:  dto.feedType as any,
              },
            },
            create: {
              batchId:             batch.id,
              houseId:             batch.houseId,
              feedType:            dto.feedType as any,
              entryDate,
              quantityDispensedKg: dto.quantityDispensedKg,
              wastageKg:           0,
              recommendedMinKg:    0,
              recommendedMaxKg:    requiredKgForWeek ?? 0,
              notes:               `Logged from Brooder cage map — ${level.label}`,
              recordedById:        userId,
            },
            update: {
              quantityDispensedKg: { increment: dto.quantityDispensedKg },
            },
          });

          // Best-effort, non-critical note-history append. This is a
          // separate, non-atomic read-then-write, but it only affects the
          // human-readable audit note text — never the quantity totals or
          // the row's existence — so a lost race here just means a slightly
          // less detailed note, not a data-integrity problem.
          if (mirrored.notes && !mirrored.notes.includes(level.label)) {
            try {
              await this.prisma.feedIntakeLog.update({
                where: { id: mirrored.id },
                data: {
                  notes: `${mirrored.notes} | +${dto.quantityDispensedKg}kg via ${level.label}`,
                },
              });
            } catch {
              // Non-critical — ignore.
            }
          }
        }
      } catch (mirrorErr: any) {
        // Best-effort mirror — log but do not rethrow.
        // The brooder feed log was already saved successfully above.
        this.logger.warn(
          `[BrooderFeedLog] FeedIntakeLog mirror failed for level ${dto.levelId} ` +
          `on ${dto.entryDate} (${mirrorErr?.code ?? mirrorErr?.message}). ` +
          `Brooder log was saved. PM should reconcile stock manually if needed.`,
        );
      }
    }

    this.refresh();
    return { ...result, residualAfterKg };
  }

  // ── Per-level mortality log (Req 1 + Req 2 + Req 7) ─────────────────────

  async createLevelMortalityLog(input: unknown, userId: string) {
    const dto = parseOrThrow(CreateLevelMortalityLogSchema, input);

    const level = await this.prisma.brooderLevel.findUnique({
      where:   { id: dto.levelId },
      include: { assignment: true, row: true },
    });
    if (!level) throw new NotFoundException('Brooder level not found');
    if (!level.assignment) {
      throw new BadRequestException('No batch is currently assigned to this level');
    }
    if (level.assignment.batchId !== dto.batchId) {
      throw new BadRequestException('Batch ID does not match the batch assigned to this level');
    }

    // Guard against double counting against the general population sheet.
    await this.assertNoGeneralMortalityLog(dto.batchId, new Date(dto.logDate));

    const totalLost = dto.mortalityCount + dto.cullingCount;
    if (totalLost > level.assignment.birdCount) {
      throw new BadRequestException(
        `Cannot record ${totalLost} deaths/cullings — this level only has ${level.assignment.birdCount} birds.`,
      );
    }

    const batch = await this.prisma.batch.findUnique({ where: { id: dto.batchId } });
    if (!batch) throw new NotFoundException('Batch not found');

    // ── Req 1: Record with Row+Level precision; Req 2: update counts ─────
    const [log] = await this.prisma.$transaction([
      // 1. Mortality log
      (this.prisma as any).brooderLevelMortalityLog.create({
        data: {
          levelId:        dto.levelId,
          batchId:        dto.batchId,
          logDate:        new Date(dto.logDate),
          mortalityCount: dto.mortalityCount,
          cullingCount:   dto.cullingCount,
          cause:          dto.cause ?? null,
          notes:          dto.notes ?? null,
          loggedById:     userId,
        },
      }),
      // 2. Decrement level bird count (Req 2 — feed recalculates from this)
      this.prisma.brooderLevelAssignment.update({
        where: { levelId: dto.levelId },
        data:  { birdCount: { decrement: totalLost } },
      }),
      // 3. Decrement batch-level bird count
      this.prisma.batch.update({
        where: { id: dto.batchId },
        data:  { currentBirdCount: { decrement: totalLost } },
      }),
    ]);

    // ── Req 7: Check cumulative mortality against HyLine standard ─────────
    // Mortalities on arrival (DOA birds) are excluded from the farm's
    // responsibility.  The effective starting population is:
    //   quantityReceived − mortalityOnArrival
    // and farm deaths are counted only from that adjusted baseline.
    const ageWeeks = batchAgeWeeks(batch.dateOfHatch, new Date(dto.logDate));
    const effectiveBirdsReceived = batch.quantityReceived - (batch.mortalityOnArrival ?? 0);
    // currentBirdCount has already been decremented by totalLost in the
    // transaction above, so we must add totalLost back to get the pre-event
    // count, then derive farm deaths from the arrival-adjusted baseline.
    const farmDeaths = effectiveBirdsReceived - (batch.currentBirdCount - totalLost);
    const mortalityCheck = checkMortalityViolation(farmDeaths, effectiveBirdsReceived, ageWeeks);

    if (mortalityCheck.violated) {
      const rowLabel = level.row
        ? `Row ${level.row.rowNumber}`
        : 'Unknown Row';
      const title   = `⚠ Brooder Mortality Alert — ${batch.batchCode}`;
      const message = `${mortalityCheck.message} (${rowLabel}, ${level.label}). Actual: ${mortalityCheck.actualPct}%, Standard: ≤${mortalityCheck.standardPct}%.`;
      await this.alertRoles('BROODER_MORTALITY_HIGH', title, message, dto.batchId);
      this.logger.warn(`[BrooderControl] ${title}: ${message}`);
    }

    // ── Farm Events: emit HealthEvent so mortality appears in manager's
    //    Farm Events History with full row/level context. ─────────────────
    try {
      const rowLabel   = level.row   ? level.row.label   : 'Unknown Row';
      const levelLabel = level.label ?? 'Unknown Level';
      const causeNote  = dto.cause ? ` (${dto.cause})` : '';
      const eventNotes =
        `Brooder mortality — ${rowLabel}, ${levelLabel}.` +
        (dto.mortalityCount > 0 ? ` Deaths: ${dto.mortalityCount}.` : '') +
        (dto.cullingCount   > 0 ? ` Culled: ${dto.cullingCount}.`   : '') +
        causeNote +
        (dto.notes ? ` Notes: ${dto.notes}` : '');

      await this.prisma.healthEvent.create({
        data: {
          batchId:       dto.batchId,
          eventType:     'BIRD_MORTALITY' as any,
          eventDate:     new Date(dto.logDate),
          affectedCount: totalLost,
          outcome:       eventNotes,
          recordedById:  userId,
        },
      });
    } catch (_) { /* best-effort — mortality log itself already succeeded */ }

    this.refresh();
    return {
      ...log,
      updatedBirdCount: level.assignment.birdCount - totalLost,
      mortalityViolation: mortalityCheck.violated ? mortalityCheck : null,
    };
  }

  async listLevelMortalityLogs(levelId: string, limit = 30) {
    return (this.prisma as any).brooderLevelMortalityLog.findMany({
      where:   { levelId },
      orderBy: { logDate: 'desc' },
      take:    limit,
      include: { loggedBy: { select: { id: true, fullName: true } } },
    });
  }

  async getBatchMortalityLogs(batchId: string) {
    return (this.prisma as any).brooderLevelMortalityLog.findMany({
      where:   { batchId },
      orderBy: { logDate: 'desc' },
      include: {
        level: {
          select: {
            levelNumber: true, label: true,
            row: { select: { rowNumber: true, label: true } },
          },
        },
        loggedBy: { select: { id: true, fullName: true } },
      },
    });
  }

  // ── General (batch-wide) population feed log ─────────────────────────────
  //
  // For a Lead Attendant who cannot break feed dispensed down by row/level.
  // Records against the whole batch's live population instead. Refused if
  // row/level-specific feed already exists for the same batch + date.
  // Supports backdating like its row/level counterpart.

  async createGeneralFeedLog(input: unknown, userId: string) {
    const dto = parseOrThrow(CreateGeneralFeedLogSchema, input);
    const entryDate = new Date(`${dto.entryDate}T00:00:00.000Z`);

    const batch = await this.prisma.batch.findUnique({ where: { id: dto.batchId } });
    if (!batch) throw new NotFoundException('Batch not found');

    // ── Clash guard: block only if row/level data already covers this date.
    // Multiple general feed entries on the same date (e.g. morning + evening)
    // ARE allowed — this mirrors BrooderLevelFeedLog, which has no per-day
    // uniqueness either. The only thing that must never happen is BOTH a
    // general and a row/level entry existing for the same batch + date.
    await this.assertNoLevelSpecificFeedLog(dto.batchId, entryDate);

    // Same store-item residual bookkeeping as the row/level version — a
    // feed type can only be logged against a store item Store has actually
    // issued, and only up to whatever residual is left of it.
    let feedItemUnit: string | null = null;
    let residualAfterKg: number | null = null;
    if (dto.storeItemId) {
      const [issued, item] = await Promise.all([
        this.prisma.storeStockOut.aggregate({
          where: { storeItemId: dto.storeItemId },
          _sum: { quantityOut: true },
        }),
        this.prisma.storeItem.findUnique({ where: { id: dto.storeItemId }, select: { unit: true } }),
      ]);
      if (!issued._sum.quantityOut || Number(issued._sum.quantityOut) <= 0) {
        throw new BadRequestException(
          'This feed item has never been issued from the store and cannot be logged. Ask Store to issue it first.',
        );
      }
      feedItemUnit = item?.unit ?? null;

      const residualInfo = await this.storeInventory.getResidualForItem(dto.storeItemId);
      const residualBefore = residualInfo?.residual ?? 0;
      if (dto.quantityDispensedKg > residualBefore) {
        throw new BadRequestException(
          `Not enough of this item left to log. Residual remaining: ${residualBefore.toFixed(3)} ` +
          `${feedItemUnit ?? 'kg'}, requested: ${dto.quantityDispensedKg}. ` +
          `Ask Store to issue more before logging further.`,
        );
      }
      residualAfterKg = Math.round((residualBefore - dto.quantityDispensedKg) * 1000) / 1000;
    }

    // Whole-batch daily ration reference (advisory — mirrors the "schedule
    // is a reference, not an enforced cap" principle already used for
    // row/level feed logs' informational banners).
    const ageWeeks = batchAgeWeeks(batch.dateReceived, entryDate);
    const dailyRationKg = brooderRequiredFeedKg(batch.currentBirdCount, ageWeeks, 1);

    const result = await this.prisma.brooderGeneralFeedLog.create({
      data: {
        batchId:             dto.batchId,
        feedType:            dto.feedType,
        storeItemId:         dto.storeItemId ?? null,
        unit:                feedItemUnit,
        entryDate,
        quantityDispensedKg: dto.quantityDispensedKg,
        requiredKgForDay:    dailyRationKg,
        notes:               dto.notes ?? null,
        loggedById:          userId,
      },
    });

    // Mirror into FeedIntakeLog so farm-wide stock deduction stays consistent
    // with the row/level path. Best-effort — never surfaces as a 500.
    try {
      const mirrored = await this.prisma.feedIntakeLog.upsert({
        where: {
          batchId_entryDate_feedType: {
            batchId:   dto.batchId,
            entryDate,
            feedType:  dto.feedType as any,
          },
        },
        create: {
          batchId:             dto.batchId,
          houseId:             batch.houseId,
          feedType:            dto.feedType as any,
          entryDate,
          quantityDispensedKg: dto.quantityDispensedKg,
          wastageKg:           0,
          notes:               `General population sheet entry${dto.notes ? ` | ${dto.notes}` : ''}`,
          recordedById:        userId,
        },
        update: {
          quantityDispensedKg: { increment: dto.quantityDispensedKg },
        },
      });
      if (mirrored.notes && !mirrored.notes.includes('General population')) {
        try {
          await this.prisma.feedIntakeLog.update({
            where: { id: mirrored.id },
            data: { notes: `${mirrored.notes} | +${dto.quantityDispensedKg}kg via General population sheet` },
          });
        } catch { /* non-critical */ }
      }
    } catch (mirrorErr: any) {
      this.logger.warn(
        `[BrooderGeneralFeedLog] FeedIntakeLog mirror failed for batch ${dto.batchId} ` +
        `on ${dto.entryDate} (${mirrorErr?.code ?? mirrorErr?.message}). ` +
        `Brooder log was saved. PM should reconcile stock manually if needed.`,
      );
    }

    this.refresh();
    return { ...result, residualAfterKg };
  }

  async listGeneralFeedLogs(batchId: string, limit = 30) {
    return this.prisma.brooderGeneralFeedLog.findMany({
      where:   { batchId },
      orderBy: { entryDate: 'desc' },
      take:    limit,
      include: { loggedBy: { select: { id: true, fullName: true } } },
    });
  }

  // ── General (batch-wide) population mortality log ────────────────────────
  //
  // Same escape hatch as above, for mortality/culling. Decrements
  // Batch.currentBirdCount directly (there's no level to decrement) and
  // runs the same Req 7 cumulative-mortality check as the row/level path.

  async createGeneralMortalityLog(input: unknown, userId: string) {
    const dto = parseOrThrow(CreateGeneralMortalityLogSchema, input);
    const logDate = new Date(dto.logDate);

    const batch = await this.prisma.batch.findUnique({ where: { id: dto.batchId } });
    if (!batch) throw new NotFoundException('Batch not found');

    const totalLost = dto.mortalityCount + dto.cullingCount;
    if (totalLost > batch.currentBirdCount) {
      throw new BadRequestException(
        `Cannot record ${totalLost} deaths/cullings — this batch only has ${batch.currentBirdCount} birds.`,
      );
    }

    // ── Clash guard: block only if row/level data already covers this date.
    // Multiple general mortality entries on the same date ARE allowed (a
    // morning check and an evening check, for example) — this mirrors how
    // row/level mortality logs already behave (no per-day uniqueness there
    // either). The only thing that must never happen is BOTH a general and
    // a row/level entry existing for the same batch + date, since that
    // would double count when totals are rolled up.
    await this.assertNoLevelSpecificMortalityLog(dto.batchId, logDate);

    // ── Apportion the loss across this batch's levels ────────────────────
    // The general sheet has no row/level breakdown, but every level's
    // BrooderLevelAssignment.birdCount still needs to reflect these deaths —
    // otherwise it silently drifts from Batch.currentBirdCount forever, and
    // every downstream feed-schedule figure for that level (dailyRationKg,
    // requiredKgThisWeek, the birdCount shown on the cage map) keeps costing
    // birds that are no longer alive. Split it pro-rata by each level's
    // current live bird count (best available signal for where the birds
    // actually are), using the largest-remainder method so the shares sum
    // to exactly `totalLost` with no birds gained or lost to rounding.
    const levelAssignments = await this.prisma.brooderLevelAssignment.findMany({
      where: { batchId: dto.batchId },
    });
    const weights = Object.fromEntries(levelAssignments.map(la => [la.levelId, la.birdCount]));
    const apportioned = apportionByShare(totalLost, weights);
    const levelDecrementOps = levelAssignments
      .map(la => ({ levelId: la.levelId, share: Math.min(apportioned[la.levelId] ?? 0, la.birdCount) }))
      .filter(x => x.share > 0)
      .map(x =>
        this.prisma.brooderLevelAssignment.update({
          where: { levelId: x.levelId },
          data:  { birdCount: { decrement: x.share } },
        }),
      );

    const [log] = await this.prisma.$transaction([
      this.prisma.brooderGeneralMortalityLog.create({
        data: {
          batchId:        dto.batchId,
          logDate,
          mortalityCount: dto.mortalityCount,
          cullingCount:   dto.cullingCount,
          cause:          dto.cause ?? null,
          notes:          dto.notes ?? null,
          loggedById:     userId,
        },
      }),
      this.prisma.batch.update({
        where: { id: dto.batchId },
        data:  { currentBirdCount: { decrement: totalLost } },
      }),
      ...levelDecrementOps,
    ]);

    // ── Req 7: cumulative mortality vs. HyLine standard (same as row/level) ─
    const ageWeeks = batchAgeWeeks(batch.dateOfHatch, logDate);
    const effectiveBirdsReceived = batch.quantityReceived - (batch.mortalityOnArrival ?? 0);
    const farmDeaths = effectiveBirdsReceived - (batch.currentBirdCount - totalLost);
    const mortalityCheck = checkMortalityViolation(farmDeaths, effectiveBirdsReceived, ageWeeks);

    if (mortalityCheck.violated) {
      const title   = `⚠ Brooder Mortality Alert — ${batch.batchCode}`;
      const message = `${mortalityCheck.message} (General population sheet). Actual: ${mortalityCheck.actualPct}%, Standard: ≤${mortalityCheck.standardPct}%.`;
      await this.alertRoles('BROODER_MORTALITY_HIGH', title, message, dto.batchId);
      this.logger.warn(`[BrooderControl] ${title}: ${message}`);
    }

    // Farm Events: emit HealthEvent so this appears in the manager's Farm
    // Events history alongside row/level entries. Best-effort.
    try {
      const causeNote  = dto.cause ? ` (${dto.cause})` : '';
      const eventNotes =
        `Brooder mortality — General population sheet.` +
        (dto.mortalityCount > 0 ? ` Deaths: ${dto.mortalityCount}.` : '') +
        (dto.cullingCount   > 0 ? ` Culled: ${dto.cullingCount}.`   : '') +
        causeNote +
        (dto.notes ? ` Notes: ${dto.notes}` : '');

      await this.prisma.healthEvent.create({
        data: {
          batchId:       dto.batchId,
          eventType:     'BIRD_MORTALITY' as any,
          eventDate:     logDate,
          affectedCount: totalLost,
          outcome:       eventNotes,
          recordedById:  userId,
        },
      });
    } catch (_) { /* best-effort — mortality log itself already succeeded */ }

    this.refresh();
    return {
      ...log,
      updatedBirdCount:   batch.currentBirdCount - totalLost,
      mortalityViolation: mortalityCheck.violated ? mortalityCheck : null,
    };
  }

  async listGeneralMortalityLogs(batchId: string, limit = 30) {
    return this.prisma.brooderGeneralMortalityLog.findMany({
      where:   { batchId },
      orderBy: { logDate: 'desc' },
      take:    limit,
      include: { loggedBy: { select: { id: true, fullName: true } } },
    });
  }

  // ── Combined population record sheet ─────────────────────────────────────
  //
  // Per-calendar-day rollup of feed + mortality for a batch, merging
  // general-population entries with row/level entries so the Lead
  // Attendant can see, at a glance, which days already have data and by
  // which method — useful for spotting gaps before backdating an entry.
  async getPopulationRecordSheet(batchId: string, days = 30) {
    const since = dayjs().subtract(days, 'day').startOf('day').toDate();

    const levelIds = await this.getBatchLevelIds(batchId);

    const [generalFeed, levelFeed, generalMortality, levelMortality] = await Promise.all([
      this.prisma.brooderGeneralFeedLog.findMany({
        where: { batchId, entryDate: { gte: since } },
      }),
      levelIds.length
        ? this.prisma.brooderLevelFeedLog.findMany({
            where: { levelId: { in: levelIds }, entryDate: { gte: since } },
          })
        : Promise.resolve([]),
      this.prisma.brooderGeneralMortalityLog.findMany({
        where: { batchId, logDate: { gte: since } },
      }),
      this.prisma.brooderLevelMortalityLog.findMany({
        where: { batchId, logDate: { gte: since } },
      }),
    ]);

    const byDate = new Map<string, {
      date: string;
      source: 'GENERAL' | 'ROW_LEVEL' | null;
      feedKg: number;
      mortalityCount: number;
      cullingCount: number;
    }>();

    const ensure = (date: string) => {
      if (!byDate.has(date)) {
        byDate.set(date, { date, source: null, feedKg: 0, mortalityCount: 0, cullingCount: 0 });
      }
      return byDate.get(date)!;
    };

    for (const f of generalFeed) {
      const key = dayjs(f.entryDate).format('YYYY-MM-DD');
      const row = ensure(key);
      row.source = 'GENERAL';
      row.feedKg += f.quantityDispensedKg;
    }
    for (const f of levelFeed) {
      const key = dayjs(f.entryDate).format('YYYY-MM-DD');
      const row = ensure(key);
      row.source = 'ROW_LEVEL';
      row.feedKg += f.quantityDispensedKg;
    }
    for (const m of generalMortality) {
      const key = dayjs(m.logDate).format('YYYY-MM-DD');
      const row = ensure(key);
      row.source = 'GENERAL';
      row.mortalityCount += m.mortalityCount;
      row.cullingCount   += m.cullingCount;
    }
    for (const m of levelMortality) {
      const key = dayjs(m.logDate).format('YYYY-MM-DD');
      const row = ensure(key);
      row.source = 'ROW_LEVEL';
      row.mortalityCount += m.mortalityCount;
      row.cullingCount   += m.cullingCount;
    }

    return Array.from(byDate.values()).sort((a, b) => b.date.localeCompare(a.date));
  }

  // ── Bird weight — check against HyLine standard (Req 6 + Req 7) ─────────

  async checkWeightSample(input: unknown, userId: string) {
    const dto = parseOrThrow(CreateBrooderWeightSampleSchema, input);

    let batchId:    string | null = dto.batchId ?? null;
    let rowId:      string | null = null;
    let levelId:    string | null = null;
    let rowLabel:   string | null = null;
    let levelLabel: string | null = null;

    if (dto.levelId) {
      const level = await this.prisma.brooderLevel.findUnique({
        where:   { id: dto.levelId },
        include: { assignment: true, row: true },
      });
      if (!level) throw new NotFoundException('Brooder level not found');
      if (!level.assignment) {
        throw new BadRequestException(
          `${level.row.label} · ${level.label} has no birds assigned — ` +
          `weight can only be logged on an occupied row and level.`,
        );
      }
      batchId    = level.assignment.batchId;
      rowId      = level.rowId;
      levelId    = level.id;
      rowLabel   = level.row.label;
      levelLabel = level.label;
    }

    if (!batchId) throw new BadRequestException('Either levelId or batchId is required');

    const batch = await this.prisma.batch.findUnique({ where: { id: batchId } });
    if (!batch) throw new NotFoundException('Batch not found');

    const ageWeeks     = batchAgeWeeks(batch.dateOfHatch, new Date(dto.sampleDate));
    const averageG     = dto.totalWeightG / dto.sampleCount;
    const weightCheck  = checkWeightViolation(averageG, ageWeeks);
    const std          = weightCheck.standard;

    // Persist the weight sample (uses existing BirdWeightSample model)
    const saved = await this.prisma.birdWeightSample.create({
      data: {
        batchId,
        rowId, levelId,
        sampleDate:    new Date(dto.sampleDate),
        sampleCount:   dto.sampleCount,
        totalWeightG:  dto.totalWeightG,
        averageWeightG: averageG,
        ageWeeks,
        notes: dto.notes ?? null,
        recordedById: userId,
      },
    });

    // ── Req 7: Alert on violation ─────────────────────────────────────────
    if (weightCheck.violated) {
      const location = levelLabel ? ` (${rowLabel} · ${levelLabel})` : '';
      const title   = `⚠ Brooder Weight Alert — ${batch.batchCode}${location}`;
      const message = `${weightCheck.message} Sample: ${dto.sampleCount} birds avg ${averageG.toFixed(0)}g (week ${ageWeeks}).`;
      await this.alertRoles('BROODER_WEIGHT_ANOMALY', title, message, batchId);
      this.logger.warn(`[BrooderControl] ${title}: ${message}`);
    }

    return {
      sample: saved,
      rowId, levelId, rowLabel, levelLabel,
      ageWeeks,
      averageWeightG: Math.round(averageG * 10) / 10,
      standard: { week: std.week, minG: std.weightMinG, maxG: std.weightMaxG, phase: std.phase },
      withinBounds: !weightCheck.violated,
      violation: weightCheck.violated ? weightCheck.message : null,
    };
  }

  /** Weight history for a specific occupied row/level (cage map weight log). */
  async getLevelWeightHistory(levelId: string) {
    const samples = await this.prisma.birdWeightSample.findMany({
      where:   { levelId },
      orderBy: { sampleDate: 'asc' },
    });

    return samples.map(s => {
      const std = hylineStandard(s.ageWeeks);
      const avg = Number(s.averageWeightG);
      return {
        ...s,
        averageWeightG: avg,
        standard:  { week: std.week, minG: std.weightMinG, maxG: std.weightMaxG, phase: std.phase },
        withinBounds: avg >= std.weightMinG && avg <= std.weightMaxG,
      };
    });
  }

  async getWeightHistory(batchId: string) {
    const samples = await this.prisma.birdWeightSample.findMany({
      where:   { batchId },
      orderBy: { sampleDate: 'asc' },
    });

    return samples.map(s => {
      const std = hylineStandard(s.ageWeeks);
      const avg = Number(s.averageWeightG);
      return {
        ...s,
        averageWeightG: avg,
        standard:  { week: std.week, minG: std.weightMinG, maxG: std.weightMaxG, phase: std.phase },
        withinBounds: avg >= std.weightMinG && avg <= std.weightMaxG,
      };
    });
  }

  // ── Cumulative mortality check for a batch (Req 6) ───────────────────────

  async getCumulativeMortalityCheck(batchId: string) {
    const batch = await this.prisma.batch.findUnique({ where: { id: batchId } });
    if (!batch) throw new NotFoundException('Batch not found');

    // A batch placed today has age 0 days, but is in its first week of
    // life — HyLine weeks are 1-indexed, so floor at 1 for display and lookup.
    const ageWeeks   = batchAgeWeeks(batch.dateOfHatch);
    // Mortalities on arrival (DOA birds) are not the farm's responsibility.
    // Exclude them from both the baseline population and the death count so
    // they do not inflate the cumulative mortality % or trigger HyLine alerts.
    const effectiveBirdsReceived = batch.quantityReceived - (batch.mortalityOnArrival ?? 0);
    const farmDeaths             = effectiveBirdsReceived - batch.currentBirdCount;
    const check = checkMortalityViolation(farmDeaths, effectiveBirdsReceived, ageWeeks);
    const std   = hylineStandard(ageWeeks);

    return {
      batchId,
      batchCode:              batch.batchCode,
      ageWeeks,
      originalCount:          batch.quantityReceived,
      mortalityOnArrival:     batch.mortalityOnArrival ?? 0,
      effectiveBirdsReceived,
      currentCount:           batch.currentBirdCount,
      farmDeaths,
      actualMortalityPct:     check.actualPct,
      standardCeilingPct:     std.cumulativeMortalityPct,
      phase:                  std.phase,
      violated:               check.violated,
      message:                check.violated ? check.message : null,
    };
  }

  // ── Feed requirement summary (Req 4 — residual carry-forward) ────────────

  async getFeedRequirementSummary() {
    const map = await this.getCageMap();

    // Req 4: Find last week's approved issuance plan to pull residual balance.
    const lastWeekStart = dayjs().subtract(1, 'week').startOf('week').toDate();
    const lastWeekEnd   = dayjs().subtract(1, 'week').endOf('week').toDate();

    let residualCarryForwardKg = 0;
    try {
      const lastPlan = await this.prisma.issuancePlan.findFirst({
        where: {
          weekStartDate: { gte: lastWeekStart, lte: lastWeekEnd },
          phase: 'DECIDED' as any,
        },
        include: {
          items: {
            where: { status: 'APPROVED' as any },
            select: { quantityPlanned: true, quantityIssued: true },
          },
        },
      });

      if (lastPlan) {
        for (const item of lastPlan.items) {
          const planned = Number(item.quantityPlanned);
          const issued  = Number(item.quantityIssued);
          if (planned > issued) residualCarryForwardKg += planned - issued;
        }
        residualCarryForwardKg = Math.round(residualCarryForwardKg * 100) / 100;
      }
    } catch (_) {
      // Graceful fallback — issuance plan data not critical to display
    }

    // Early-phase residual removed along with the EARLY/TRANSITION/STANDARD
    // phase system — it only ever applied to Week-1 batches, and the concern
    // it was meant to catch (feed placed but not eaten) is now handled by the
    // BROODER_EARLY_PHASE_NOT_EATING alert (checkEarlyPhaseNotEating) rather
    // than by discounting the schedule/residual figures. `earlyPhaseResidual`
    // is kept at 0 below purely so the API response shape (and the frontend
    // fields that read it) don't need to change.
    const earlyPhaseResidual = 0;

    // Combine standard carry-forward + early-phase residual (always 0 now)
    const totalResidualKg = Math.round((residualCarryForwardKg + earlyPhaseResidual) * 100) / 100;

    const rows = map.rows.map(row => {
      const levels            = row.levels.filter(l => l.assignment);
      const requiredKg        = levels.reduce((s, l) => s + (l.requiredKgThisWeek ?? 0), 0);
      const dispensedKg       = levels.reduce((s, l) => s + (l.dispensedKgThisWeek ?? 0), 0);
      // Daily aggregates — sum all levels in this row
      const dailyRationKgRow  = levels.reduce((s, l) => s + (l.dailyRationKg ?? 0), 0);
      const dispensedTodayRow = levels.reduce((s, l) => s + (l.dispensedKgToday ?? 0), 0);
      // A row's daily ration is met if every occupied level has been fully fed today
      const dailyExactMatch   = levels.length > 0 && levels.every(
        l => l.dailyRationKg !== null && l.dispensedKgToday >= l.dailyRationKg,
      );
      return {
        rowId:               row.rowId,
        rowNumber:           row.rowNumber,
        label:               row.label,
        birdTotal:           row.birdTotal,
        // ── weekly ──
        requiredKgThisWeek:  Math.round(requiredKg        * 100) / 100,
        dispensedKgThisWeek: Math.round(dispensedKg       * 100) / 100,
        exactMatch:          levels.length > 0 && levels.every(l => l.feedVariancePercent === 0),
        // ── daily (NEW) ──
        dailyRationKg:       Math.round(dailyRationKgRow  * 100) / 100,
        dispensedKgToday:    Math.round(dispensedTodayRow * 100) / 100,
        dailyExactMatch,
        levels: levels.map(l => {
          // Per-level daily variance percent vs today's ration
          const dailyVariancePct =
            l.dailyRationKg && l.dailyRationKg > 0
              ? Math.round(((l.dispensedKgToday - l.dailyRationKg) / l.dailyRationKg) * 1000) / 10
              : null;
          // ── This level's OWN batch-relative week window ───────────────────
          // `requiredKgThisWeek` / `dispensedKgThisWeek` above are computed
          // over THIS batch's arrival-anchored week (see brooderWeekStart()
          // in feed-standard.util.ts) — anchored to dateReceived (Day 1 =
          // the day the birds were received on the farm), not dateOfHatch.
          // This will differ from every other level's window unless their
          // batches happen to share the same intake date, and will differ
          // from the calendar week too. Surfacing the actual window here is
          // what lets the UI show "which days does this number actually
          // cover" instead of leaving the reader to assume it matches the
          // calendar-week panel elsewhere in the app (it usually won't).
          let weekStart: string | null = null;
          let weekEnd:   string | null = null;
          if (l.batch?.dateReceived) {
            const wStart = brooderWeekStart(new Date(`${l.batch.dateReceived}T00:00:00.000Z`));
            const wEnd   = new Date(wStart);
            wEnd.setUTCDate(wEnd.getUTCDate() + 6);
            weekStart = dayjs(wStart).format('YYYY-MM-DD');
            weekEnd   = dayjs(wEnd).format('YYYY-MM-DD');
          }
          return {
            levelId:             l.levelId,
            levelNumber:         l.levelNumber,
            label:               l.label,
            batchCode:           l.batch?.batchCode ?? null,
            birdCount:           l.assignment?.birdCount ?? 0,
            hylineWeek:          l.hylineWeek,
            // weekly
            dailyRationKg:       l.dailyRationKg,
            requiredKgThisWeek:  l.requiredKgThisWeek,
            dispensedKgThisWeek: l.dispensedKgThisWeek,
            weekStart,
            weekEnd,
            feedVariancePercent: l.feedVariancePercent,
            feedSource:          l.feedSource,
            exactMatch:          l.feedVariancePercent === 0,
            // daily (NEW)
            dispensedKgToday:    l.dispensedKgToday,
            dailyVariancePct,
            dailyMet:
              l.dailyRationKg !== null && l.dispensedKgToday >= l.dailyRationKg,
          };
        }),
      };
    });

    const totalRequiredKg         = rows.reduce((s, r) => s + r.requiredKgThisWeek, 0);
    const totalDispensedKg        = rows.reduce((s, r) => s + r.dispensedKgThisWeek, 0);
    // Daily grand totals (NEW)
    const totalDailyRationKg      = rows.reduce((s, r) => s + r.dailyRationKg, 0);
    const totalDispensedKgToday   = rows.reduce((s, r) => s + r.dispensedKgToday, 0);
    // Net amount Store still needs to issue this week: the full-week
    // schedule requirement, minus feed already issued this week, minus any
    // carry-forward/early-phase residual credit. Previously this omitted
    // totalDispensedKg entirely, so Net-to-Issue was showing the same figure
    // as Schedule even after feed had already gone out — this restores
    // "Schedule − Issued − Residual" as the actual outstanding need.
    const netToIssueKg = Math.max(
      0,
      Math.round((totalRequiredKg - totalDispensedKg - totalResidualKg) * 100) / 100,
    );

    return {
      // NOTE: this endpoint sums EVERY occupied row/level across ALL active
      // batches. Each level's own requiredKgThisWeek/dispensedKgThisWeek
      // (and now weekStart/weekEnd, added per-level above) is computed over
      // THAT batch's own hatch-anchored brooder week — batches started on
      // different dates have different week windows. There is deliberately
      // no single "weekStart" for the totals below; a previous version of
      // this endpoint returned `dayjs().startOf('week')` here, which looked
      // like the calendar week the totals covered but had no actual
      // relationship to how they were computed — removed to avoid that
      // false impression. Use `rows[].levels[].weekStart/weekEnd` for the
      // real per-batch window backing any individual figure.
      scope:                        'farm-wide-aggregate-per-batch-week' as const,
      today:                        dayjs().format('YYYY-MM-DD'),
      totalChicks:                  map.totalChicks,
      // weekly
      totalRequiredKgThisWeek:      Math.round(totalRequiredKg  * 100) / 100,
      totalDispensedKgThisWeek:     Math.round(totalDispensedKg * 100) / 100,
      residualCarryForwardKg:       totalResidualKg,
      earlyPhaseResidualKg:         earlyPhaseResidual,
      standardResidualKg:           residualCarryForwardKg,
      netToIssueKg,
      // daily (NEW)
      totalDailyRationKg:           Math.round(totalDailyRationKg    * 100) / 100,
      totalDispensedKgToday:        Math.round(totalDispensedKgToday * 100) / 100,
      rows,
    };
  }

  // ── Daily feed breakdown (PM analysis — spot skipped days) ────────────────
  //
  // Returns how much feed was actually dispensed farm-wide on each day of
  // the current CALENDAR week (Sun–Sat, same window as getFeedRequirementSummary's
  // `weekStart`) so the PM can see at a glance whether any day was skipped
  // entirely — e.g. an attendant missed a shift and no feed log exists for
  // that date at all.
  //
  // This is deliberately a plain per-calendar-date total, independent of the
  // per-batch hatch-anchored "brooder week" used elsewhere for schedule /
  // residual math — the PM wants "what happened each day this week", not a
  // per-batch-relative window that resets on a different day for every batch.
  //
  // Only days from the earliest active assignment's placedDate onward are
  // eligible to be flagged "skipped" (a day before any birds were placed
  // isn't a missed feeding, there was nothing to feed yet). Days after
  // today are never included.
  async getDailyFeedBreakdown() {
    const today      = dayjs(farmTodayUtcMidnight());
    const weekStart  = today.startOf('week');
    const numDays    = today.diff(weekStart, 'day') + 1;

    const [logs, generalLogs, earliestAssignment] = await Promise.all([
      this.prisma.brooderLevelFeedLog.findMany({
        where:  { entryDate: { gte: weekStart.toDate() } },
        select: { entryDate: true, quantityDispensedKg: true },
      }),
      this.prisma.brooderGeneralFeedLog.findMany({
        where:  { entryDate: { gte: weekStart.toDate() } },
        select: { entryDate: true, quantityDispensedKg: true },
      }),
      this.prisma.brooderLevelAssignment.findFirst({
        where:   { level: { isActive: true } },
        orderBy: { placedDate: 'asc' },
        select:  { placedDate: true },
      }).catch(() => null),
    ]);

    const totalsByDate: Record<string, number> = {};
    for (const log of [...logs, ...generalLogs]) {
      const key = dayjs(log.entryDate).format('YYYY-MM-DD');
      totalsByDate[key] = (totalsByDate[key] ?? 0) + log.quantityDispensedKg;
    }

    const eligibleFrom = earliestAssignment?.placedDate
      ? dayjs(earliestAssignment.placedDate).startOf('day')
      : null;

    const days: Array<{
      date:        string;
      dayLabel:    string;
      dispensedKg: number;
      skipped:     boolean;
    }> = [];

    for (let i = 0; i < numDays; i++) {
      const d   = weekStart.add(i, 'day');
      const key = d.format('YYYY-MM-DD');
      const dispensedKg = Math.round((totalsByDate[key] ?? 0) * 100) / 100;
      // Only eligible to be flagged if birds had already been placed by this date.
      const eligible = eligibleFrom ? !d.isBefore(eligibleFrom) : false;
      days.push({
        date:        key,
        dayLabel:    d.format('ddd D MMM'),
        dispensedKg,
        skipped:     eligible && dispensedKg === 0,
      });
    }

    const totalKg     = Math.round(days.reduce((s, d) => s + d.dispensedKg, 0) * 100) / 100;
    const skippedDays = days.filter(d => d.skipped).map(d => d.dayLabel);

    return {
      weekStart:  weekStart.format('YYYY-MM-DD'),
      days,
      totalKg,
      skippedDays,
    };
  }

  // ── Feed issuance calendar (PM analysis — current + past weeks) ───────────
  //
  // Multi-week version of getDailyFeedBreakdown, for the PM to review feed
  // issuance history rather than only the current calendar week. Returns one
  // entry per week (most recent first), each with the same per-day shape
  // used by the single-week widget so the frontend can reuse the same
  // day-cell rendering.
  //
  // Deliberately a separate endpoint (rather than adding a `weeks` param to
  // getDailyFeedBreakdown) so the existing single-week PM-home widget keeps
  // its small, fast payload — this heavier query is only fetched when the
  // PM opens the feed history panel, keeping the dashboard itself light.
  //
  // `weeks` is clamped to a sane range so a stray large value can't force a
  // huge scan of feed logs.
  async getFeedIssuanceCalendar(weeks = 4) {
    const clampedWeeks = Math.max(1, Math.min(12, Math.round(weeks) || 4));

    const today            = dayjs(farmTodayUtcMidnight());
    const currentWeekStart = today.startOf('week');
    const rangeStart       = currentWeekStart.subtract(clampedWeeks - 1, 'week');

    const [logs, generalLogs, earliestAssignment] = await Promise.all([
      this.prisma.brooderLevelFeedLog.findMany({
        where:  { entryDate: { gte: rangeStart.toDate() } },
        select: { entryDate: true, quantityDispensedKg: true },
      }),
      this.prisma.brooderGeneralFeedLog.findMany({
        where:  { entryDate: { gte: rangeStart.toDate() } },
        select: { entryDate: true, quantityDispensedKg: true },
      }),
      this.prisma.brooderLevelAssignment.findFirst({
        where:   { level: { isActive: true } },
        orderBy: { placedDate: 'asc' },
        select:  { placedDate: true },
      }).catch(() => null),
    ]);

    const totalsByDate: Record<string, number> = {};
    for (const log of [...logs, ...generalLogs]) {
      const key = dayjs(log.entryDate).format('YYYY-MM-DD');
      totalsByDate[key] = (totalsByDate[key] ?? 0) + log.quantityDispensedKg;
    }

    const eligibleFrom = earliestAssignment?.placedDate
      ? dayjs(earliestAssignment.placedDate).startOf('day')
      : null;

    const weekList: Array<{
      weekStart:     string;
      weekLabel:     string;
      isCurrentWeek: boolean;
      days: Array<{ date: string; dayLabel: string; dispensedKg: number; skipped: boolean }>;
      totalKg:       number;
      skippedDays:   string[];
    }> = [];

    for (let w = 0; w < clampedWeeks; w++) {
      const weekStart = rangeStart.add(w, 'week');
      if (weekStart.isAfter(today)) break; // don't emit future weeks

      const isCurrentWeek = weekStart.isSame(currentWeekStart, 'day');
      const days: Array<{ date: string; dayLabel: string; dispensedKg: number; skipped: boolean }> = [];

      for (let i = 0; i < 7; i++) {
        const d = weekStart.add(i, 'day');
        if (d.isAfter(today)) break; // stop at today within the current week
        const key = d.format('YYYY-MM-DD');
        const dispensedKg = Math.round((totalsByDate[key] ?? 0) * 100) / 100;
        const eligible = eligibleFrom ? !d.isBefore(eligibleFrom) : false;
        days.push({
          date:        key,
          dayLabel:    d.format('ddd D MMM'),
          dispensedKg,
          skipped:     eligible && dispensedKg === 0,
        });
      }

      const totalKg     = Math.round(days.reduce((s, d) => s + d.dispensedKg, 0) * 100) / 100;
      const skippedDays = days.filter(d => d.skipped).map(d => d.dayLabel);

      weekList.push({
        weekStart:     weekStart.format('YYYY-MM-DD'),
        weekLabel:     `${weekStart.format('D MMM')} – ${weekStart.add(6, 'day').format('D MMM YYYY')}`,
        isCurrentWeek,
        days,
        totalKg,
        skippedDays,
      });
    }

    // Most recent week first — the PM opens this to check "how are we doing
    // lately", not to scroll from the oldest week down.
    weekList.reverse();

    return { weeks: weekList };
  }

  // ── Missed-feed flagging (yesterday's ration not fully given) ────────────
  //
  // Surfaced on Lead Attendant and PM home pages so a shortfall is caught
  // the morning after it happens, instead of only being visible inside the
  // "this week" totals where a single bad day is easy to miss.
  // A level is flagged when yesterday's required ration (population ×
  // HyLine g/bird/day for that level's age yesterday) exceeds what was
  // actually dispensed to it on that calendar date.

  async getMissedFeedAlerts() {
    // Farm-local yesterday — not the server's, see farmTodayUtcMidnight().
    const yesterdayDate = new Date(farmTodayUtcMidnight().getTime() - 24 * 60 * 60 * 1000);
    const yesterdayStr  = dayjs(yesterdayDate).format('YYYY-MM-DD');

    // Fetch all currently-assigned active levels, then filter by placedDate in
    // the loop — Prisma does not allow scalar filters inside a nested-relation
    // existence check (isNot: null) without a separate `is` block, which would
    // require the relation filter API unavailable on this Prisma version.
    const allLevels = await this.prisma.brooderLevel.findMany({
      where: { isActive: true, assignment: { isNot: null } },
      select: {
        id: true, label: true,
        row:        { select: { id: true, label: true } },
        assignment: { select: { batchId: true, birdCount: true, placedDate: true } },
      },
    });

    // Only flag levels whose batch was placed strictly before yesterday —
    // a batch registered today (or on yesterday itself) hasn't had a chance
    // to receive a feed log for that date yet, so it must never appear as "missed".
    const levels = allLevels.filter(
      l => l.assignment && l.assignment.placedDate < yesterdayDate,
    );

    if (levels.length === 0) return { date: yesterdayStr, alertCount: 0, alerts: [] };

    const batchIds = Array.from(new Set(levels.map(l => l.assignment!.batchId)));
    const batches = await this.prisma.batch.findMany({
      where: { id: { in: batchIds } },
      select: { id: true, batchCode: true, dateOfHatch: true, dateReceived: true },
    });
    const batchMap = Object.fromEntries(batches.map(b => [b.id, b]));

    const levelIds = levels.map(l => l.id);
    const feedLogs = await this.prisma.brooderLevelFeedLog.findMany({
      where: { levelId: { in: levelIds }, entryDate: yesterdayDate },
      select: { levelId: true, quantityDispensedKg: true },
    });
    const dispensedByLevel: Record<string, number> = {};
    for (const f of feedLogs) {
      dispensedByLevel[f.levelId] = (dispensedByLevel[f.levelId] ?? 0) + f.quantityDispensedKg;
    }

    // A batch fed via the general-population sheet instead of row/level has
    // no per-level breakdown to check against the standard — that's the
    // whole point of the general sheet — so it must never be reported here
    // as having "missed" feed just because BrooderLevelFeedLog is empty for
    // it. Skip any batch that has a general entry for yesterday.
    const generalFeedYesterday = batchIds.length
      ? await this.prisma.brooderGeneralFeedLog.findMany({
          where: { batchId: { in: batchIds }, entryDate: yesterdayDate },
          select: { batchId: true },
        })
      : [];
    const batchesUsedGeneralYesterday = new Set(generalFeedYesterday.map(f => f.batchId));

    const alerts: Array<{
      levelId: string; levelLabel: string; rowId: string; rowLabel: string;
      batchId: string; batchCode: string; date: string;
      requiredKg: number; dispensedKg: number; shortfallKg: number;
    }> = [];

    for (const level of levels) {
      const a = level.assignment!;
      const batch = batchMap[a.batchId];
      if (!batch || a.birdCount <= 0) continue;
      if (batchesUsedGeneralYesterday.has(a.batchId)) continue;

      const ageWeeksYesterday = batchAgeWeeks(batch.dateReceived, yesterdayDate);

      const requiredKg  = brooderRequiredFeedKg(a.birdCount, ageWeeksYesterday, 1);
      const dispensedKg = Math.round((dispensedByLevel[level.id] ?? 0) * 100) / 100;

      // Uniform threshold for every day of a batch's life — allow 0.05 kg of
      // rounding noise, flag anything short of that. No more EARLY/TRANSITION
      // leniency window; a batch that genuinely isn't eating yet is caught by
      // the separate BROODER_EARLY_PHASE_NOT_EATING alert instead.
      const threshold = requiredKg - 0.05;

      if (requiredKg > 0 && dispensedKg < threshold) {
        alerts.push({
          levelId:     level.id,
          levelLabel:  level.label,
          rowId:       level.row.id,
          rowLabel:    level.row.label,
          batchId:     batch.id,
          batchCode:   batch.batchCode,
          date:        yesterdayStr,
          requiredKg:  Math.round(requiredKg * 100) / 100,
          dispensedKg,
          shortfallKg: Math.round((requiredKg - dispensedKg) * 100) / 100,
        });
      }
    }

    return { date: yesterdayStr, alertCount: alerts.length, alerts };
  }

  // ── Early-phase "not eating" check (flagged once per batch at Day 7) ─────
  //
  // If a batch has completed its first week (Day 7+) and zero feed has been
  // consumed, emit a BROODER_EARLY_PHASE_NOT_EATING alert to Manager/Owner.
  // This is a clinical concern — healthy chicks WILL start eating by Day 4–6
  // even if inconsistently.  Zero intake through Day 7 requires investigation.

  async checkEarlyPhaseNotEating(): Promise<void> {
    const now = farmNow();

    // Find all active batches that are at or past Day 7 since arrival.
    // Anchored to dateReceived, not dateOfHatch — a bird can't eat at this
    // farm before the farm has it, and transit time between hatch and
    // arrival would otherwise make this alert fire (or its "days old" text
    // read) too early relative to when the batch actually started feeding here.
    const batchCandidates = await this.prisma.batch.findMany({
      where: {
        isActive:     true,
        stage:        'BROODING' as any,
        dateReceived: {
          lte: new Date(now.getTime() - NOT_EATING_ALERT_DAYS * 24 * 60 * 60 * 1000),
        },
      },
      select: { id: true, batchCode: true, dateReceived: true },
    });

    for (const batch of batchCandidates) {
      // Sum all feed consumed by this batch since arrival — both row/level
      // entries AND general-population sheet entries. A batch fed entirely
      // via the general sheet has zero BrooderLevelFeedLog rows by design,
      // so checking that table alone would wrongly flag it as not eating.
      const [levelFeed, generalFeed] = await Promise.all([
        this.prisma.brooderLevelFeedLog.aggregate({
          where: {
            level: { assignment: { batchId: batch.id } },
            entryDate: { gte: batch.dateReceived },
          },
          _sum: { quantityDispensedKg: true },
        }),
        this.prisma.brooderGeneralFeedLog.aggregate({
          where: { batchId: batch.id, entryDate: { gte: batch.dateReceived } },
          _sum: { quantityDispensedKg: true },
        }),
      ]);
      const totalConsumedKg =
        Number(levelFeed._sum.quantityDispensedKg ?? 0) +
        Number(generalFeed._sum.quantityDispensedKg ?? 0);

      if (isEarlyPhaseNotEating(batch.dateReceived, totalConsumedKg, now)) {
        const ageInDays = Math.floor(
          (now.getTime() - batch.dateReceived.getTime()) / (1000 * 60 * 60 * 24),
        );
        await this.alertRoles(
          'BROODER_FEED_OVERISSUE' as any, // reuse closest existing type; extend enum if needed
          `Early-Phase Feeding Concern — ${batch.batchCode}`,
          `Batch ${batch.batchCode} is now ${ageInDays} days since arrival and has recorded ` +
          `zero feed consumption. Day-old chicks typically begin eating by Day 4–6. ` +
          `Please inspect the batch immediately — check feeder placement, feed quality, ` +
          `and chick health status.`,
          batch.id,
        );
      }
    }
  }
}
