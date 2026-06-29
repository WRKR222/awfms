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
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DASHBOARD_REFRESH_EVENT } from '../../common/events/app-event-bus';
import { HeatSourceType, UserRole } from '@prisma/client';
import {
  hylineStandard,
  brooderRequiredFeedKg,
  brooderAdjustedWeeklyFeedKg,
  checkWeightViolation,
  checkMortalityViolation,
  getFeedingPhase,
  isEarlyPhase,
  isEarlyPhaseNotEating,
  earlyPhaseResidualKg,
  EARLY_PHASE_DAYS,
  TRANSITION_END_DAYS,
} from '../../common/feed/feed-standard.util';
import {
  AssignLevelSchema,
  CreateHeatLogSchema,
  StopBulbHeatLogSchema,
  CreateLevelFeedLogSchema,
  CreateLevelMortalityLogSchema,
  CreateBrooderWeightSampleSchema,
} from './brooder.dto';
import dayjs from 'dayjs';
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

    // Today's heat log per row
    const today = dayjs().startOf('day').toDate();
    const heatLogs = await this.prisma.brooderHeatLog.findMany({
      where: { rowId: { in: rows.map(r => r.id) }, logDate: { gte: today } },
      orderBy: { createdAt: 'desc' },
    });
    const heatByRow: Record<string, typeof heatLogs[number]> = {};
    for (const h of heatLogs) {
      if (!heatByRow[h.rowId]) heatByRow[h.rowId] = h;
    }

    // This week's feed dispensed per level
    const weekStart = dayjs().startOf('week').toDate();
    const levelIds = rows.flatMap(r => r.levels).map(l => l.id);
    const feedLogs = levelIds.length
      ? await this.prisma.brooderLevelFeedLog.findMany({
          where: { levelId: { in: levelIds }, entryDate: { gte: weekStart } },
        })
      : [];
    const feedByLevel: Record<string, number> = {};
    for (const f of feedLogs) {
      feedByLevel[f.levelId] = (feedByLevel[f.levelId] ?? 0) + f.quantityDispensedKg;
    }

    // Today's feed dispensed per level (for over-issue guard display)
    const todayStr = dayjs().format('YYYY-MM-DD');
    const todayFeedByLevel: Record<string, number> = {};
    for (const f of feedLogs) {
      if (dayjs(f.entryDate).format('YYYY-MM-DD') === todayStr) {
        todayFeedByLevel[f.levelId] = (todayFeedByLevel[f.levelId] ?? 0) + f.quantityDispensedKg;
      }
    }

    // This week's weight samples per level — used to flag birds outside the
    // HyLine min/max band for their age, wherever they were weighed.
    const weightSamples = levelIds.length
      ? await this.prisma.birdWeightSample.findMany({
          where: { levelId: { in: levelIds }, sampleDate: { gte: weekStart } },
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
          ageWeeks = Math.max(1, dayjs().diff(dayjs(batch.dateOfHatch), 'week'));
          const std = hylineStandard(ageWeeks);
          hylineWeek = std.week;
          // Use adjusted weekly feed (early/transition days contribute 0 or 50%)
          const weekStart = dayjs().startOf('week').toDate();
          requiredKgThisWeek = brooderAdjustedWeeklyFeedKg(
            a.birdCount, ageWeeks, batch.dateOfHatch, weekStart,
          );
          // Daily ration is always the standard HyLine figure — enforcement
          // is relaxed in early/transition phases but the figure is still
          // shown as an advisory reference on the UI.
          dailyRationKg = brooderRequiredFeedKg(a.birdCount, ageWeeks, 1);
        }
        const dispensedThisWeek = feedByLevel[level.id] ?? 0;
        const dispensedToday    = todayFeedByLevel[level.id] ?? 0;

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
            ageWeeks:         Math.max(1, dayjs().diff(dayjs(batch.dateOfHatch), 'week')),
            quantityReceived: batch.quantityReceived,
            dateOfHatch:      dayjs(batch.dateOfHatch).format('YYYY-MM-DD'),
          } : null,
          hylineWeek,
          dailyRationKg,
          requiredKgThisWeek,
          dispensedKgThisWeek: Math.round(dispensedThisWeek * 100) / 100,
          dispensedKgToday:    Math.round(dispensedToday    * 100) / 100,
          feedVariancePercent:
            requiredKgThisWeek && requiredKgThisWeek > 0
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
        ageWeeks          = dayjs(dto.entryDate).diff(dayjs(batch.dateOfHatch), 'week');
        const weekStart   = dayjs(dto.entryDate).startOf('week').toDate();
        requiredKgForWeek = brooderAdjustedWeeklyFeedKg(
          level.assignment.birdCount, ageWeeks, batch.dateOfHatch, weekStart,
        );
        dailyRationKg     = brooderRequiredFeedKg(level.assignment.birdCount, ageWeeks, 1);

        const feedingPhase = getFeedingPhase(batch.dateOfHatch, entryDateObj);

        // ── Req 3 (phase-aware): Control over-issuance ───────────────────
        // • EARLY phase (Days 1–2): hard-block is LIFTED.  Chicks haven't
        //   established eating patterns.  The attendant may top up feed
        //   above the daily ration; a warning is logged but no exception.
        //   The over-issue is automatically tracked as early-phase residual
        //   and will be deducted from the next store issuance request.
        // • TRANSITION phase (Days 3–6): same relaxed rule — soft warn only.
        // • STANDARD phase (Week 2+): original hard-block enforced.
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
          if (feedingPhase === 'STANDARD') {
            // Week 2+: hard block
            throw new BadRequestException(
              `Feed issuance blocked: this level's daily ration is ${dailyRationKg.toFixed(2)} kg ` +
              `for ${level.assignment.birdCount} birds at week ${ageWeeks} (HyLine standard). ` +
              `Already issued today: ${Number(alreadyIssuedKg).toFixed(2)} kg. ` +
              `Requested ${dto.quantityDispensedKg} kg would bring total to ${totalAfterKg.toFixed(2)} kg ` +
              `(+${(totalAfterKg - dailyRationKg).toFixed(2)} kg over ration). ` +
              `Reduce the quantity or use the excess to offset tomorrow's issuance.`,
            );
          } else {
            // EARLY / TRANSITION: soft warn — allow issuance, log the event.
            this.logger.warn(
              `[EarlyPhase] Level ${dto.levelId} (${feedingPhase}) — over-advisory issuance. ` +
              `Advisory daily cap: ${dailyRationKg.toFixed(2)} kg, total after this entry: ` +
              `${totalAfterKg.toFixed(2)} kg (+${(totalAfterKg - dailyRationKg).toFixed(2)} kg). ` +
              `This excess will be tracked as a residual carry-forward.`,
            );
          }
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

          const existing = await this.prisma.feedIntakeLog.findFirst({
            where: {
              batchId:   batch.id,
              feedType:  dto.feedType as any,
              entryDate: {
                gte: new Date(`${dto.entryDate}T00:00:00.000Z`),
                lt:  new Date(`${dto.entryDate}T23:59:59.999Z`),
              },
            },
          });

          if (existing) {
            await this.prisma.feedIntakeLog.update({
              where: { id: existing.id },
              data:  {
                quantityDispensedKg: { increment: dto.quantityDispensedKg },
                notes: existing.notes
                  ? `${existing.notes} | +${dto.quantityDispensedKg}kg via ${level.label}`
                  : `Logged from Brooder cage map — ${level.label}`,
              },
            });
          } else {
            await this.prisma.feedIntakeLog.create({
              data: {
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
            });
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
    return result;
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
    const ageWeeks = dayjs(dto.logDate).diff(dayjs(batch.dateOfHatch), 'week');
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

    const ageWeeks     = dayjs(dto.sampleDate).diff(dayjs(batch.dateOfHatch), 'week');
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

    // A batch placed today has diff = 0 weeks, but is in its first week of
    // life — HyLine weeks are 1-indexed, so floor at 1 for display and lookup.
    const ageWeeks   = Math.max(1, dayjs().diff(dayjs(batch.dateOfHatch), 'week'));
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

    // ── Early-phase residual: feed placed in week 1 that birds didn't consume
    // If this week contains any levels still in EARLY or TRANSITION phase,
    // compute how much of the issued starter feed is sitting unconsumed.
    // This amount is added to residualCarryForwardKg so the net issuance
    // request to the store is reduced accordingly (no double-stocking).
    let earlyPhaseResidual = 0;
    try {
      const thisWeekStart = dayjs().startOf('week').toDate();
      const now           = new Date();

      // Gather all active assigned levels that are still in early/transition
      const earlyLevels = await this.prisma.brooderLevel.findMany({
        where: { isActive: true, assignment: { isNot: null } },
        select: {
          id: true,
          assignment: { select: { batchId: true, birdCount: true } },
        },
      });

      const batchIdsForEarly = Array.from(
        new Set(earlyLevels.map(l => l.assignment!.batchId)),
      );
      const earlyBatches = batchIdsForEarly.length
        ? await this.prisma.batch.findMany({
            where: { id: { in: batchIdsForEarly } },
            select: { id: true, dateOfHatch: true },
          })
        : [];
      const earlyBatchMap = Object.fromEntries(earlyBatches.map(b => [b.id, b]));

      for (const level of earlyLevels) {
        const a = level.assignment!;
        const batch = earlyBatchMap[a.batchId];
        if (!batch) continue;
        const phase = getFeedingPhase(batch.dateOfHatch, now);
        if (phase === 'STANDARD') continue; // not in early/transition — skip

        // Sum ALL feed issued to this level since batch hatch (early phase window)
        const earlyWindowStart = batch.dateOfHatch;
        const issued = await this.prisma.brooderLevelFeedLog.aggregate({
          where: {
            levelId:   level.id,
            entryDate: { gte: earlyWindowStart },
          },
          _sum: { quantityDispensedKg: true },
        });
        const issuedKg = Number(issued._sum.quantityDispensedKg ?? 0);

        // Estimate actual consumption: use the adjusted weekly figure
        // (which counts 0 for early days, 50% for transition days).
        // The difference is the residual still in the feeder.
        const ageWeeks   = dayjs().diff(dayjs(batch.dateOfHatch), 'week');
        const estimatedConsumedKg = brooderAdjustedWeeklyFeedKg(
          a.birdCount, ageWeeks, batch.dateOfHatch, thisWeekStart,
        );

        const residual = earlyPhaseResidualKg(issuedKg, estimatedConsumedKg);
        earlyPhaseResidual += residual;
      }
      earlyPhaseResidual = Math.round(earlyPhaseResidual * 100) / 100;
    } catch (_) {
      // Non-critical — graceful fallback
    }

    // Combine standard carry-forward + early-phase residual
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
            feedVariancePercent: l.feedVariancePercent,
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
    // Net amount Store should issue this week after deducting ALL residuals
    const netToIssueKg = Math.max(0, Math.round((totalRequiredKg - totalResidualKg) * 100) / 100);

    return {
      weekStart:                    dayjs().startOf('week').toDate(),
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

  // ── Missed-feed flagging (yesterday's ration not fully given) ────────────
  //
  // Surfaced on Lead Attendant and PM home pages so a shortfall is caught
  // the morning after it happens, instead of only being visible inside the
  // "this week" totals where a single bad day is easy to miss.
  // A level is flagged when yesterday's required ration (population ×
  // HyLine g/bird/day for that level's age yesterday) exceeds what was
  // actually dispensed to it on that calendar date.

  async getMissedFeedAlerts() {
    const yesterday    = dayjs().subtract(1, 'day').startOf('day');
    const yesterdayDate = yesterday.toDate();
    const yesterdayStr  = yesterday.format('YYYY-MM-DD');

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
      select: { id: true, batchCode: true, dateOfHatch: true },
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

    const alerts: Array<{
      levelId: string; levelLabel: string; rowId: string; rowLabel: string;
      batchId: string; batchCode: string; date: string;
      requiredKg: number; dispensedKg: number; shortfallKg: number;
      feedingPhase: string;
    }> = [];

    for (const level of levels) {
      const a = level.assignment!;
      const batch = batchMap[a.batchId];
      if (!batch || a.birdCount <= 0) continue;

      const ageWeeksYesterday = yesterday.diff(dayjs(batch.dateOfHatch), 'week');
      const feedingPhase = getFeedingPhase(batch.dateOfHatch, yesterdayDate);

      // EARLY phase (Days 1–2): never flag as missed — inconsistent eating is normal.
      if (feedingPhase === 'EARLY') continue;

      const requiredKg  = brooderRequiredFeedKg(a.birdCount, ageWeeksYesterday, 1);
      const dispensedKg = Math.round((dispensedByLevel[level.id] ?? 0) * 100) / 100;

      // TRANSITION phase (Days 3–6): alert only if less than 50% of ration was given.
      // Day-1 carry-over may still be in the feeder so partial issuance is expected.
      // STANDARD phase: alert if any shortfall > 0.05 kg (rounding tolerance).
      const threshold = feedingPhase === 'TRANSITION'
        ? requiredKg * 0.5  // 50% of ration must have been given
        : requiredKg - 0.05; // standard: allow 0.05 kg rounding noise

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
          feedingPhase,
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
    const now = new Date();

    // Find all active batches that are at or past Day 7
    const batchCandidates = await this.prisma.batch.findMany({
      where: {
        isActive:    true,
        stage:       'BROODING' as any,
        dateOfHatch: {
          lte: new Date(now.getTime() - TRANSITION_END_DAYS * 24 * 60 * 60 * 1000),
        },
      },
      select: { id: true, batchCode: true, dateOfHatch: true },
    });

    for (const batch of batchCandidates) {
      // Sum all feed consumed by this batch since hatch
      const feedLogs = await this.prisma.brooderLevelFeedLog.aggregate({
        where: {
          level: { assignment: { batchId: batch.id } },
          entryDate: { gte: batch.dateOfHatch },
        },
        _sum: { quantityDispensedKg: true },
      });
      const totalConsumedKg = Number(feedLogs._sum.quantityDispensedKg ?? 0);

      if (isEarlyPhaseNotEating(batch.dateOfHatch, totalConsumedKg, now)) {
        const ageInDays = Math.floor(
          (now.getTime() - batch.dateOfHatch.getTime()) / (1000 * 60 * 60 * 24),
        );
        await this.alertRoles(
          'BROODER_FEED_OVERISSUE' as any, // reuse closest existing type; extend enum if needed
          `Early-Phase Feeding Concern — ${batch.batchCode}`,
          `Batch ${batch.batchCode} is now ${ageInDays} days old and has recorded zero ` +
          `feed consumption since arrival. Day-old chicks typically begin eating by Day 4–6. ` +
          `Please inspect the batch immediately — check feeder placement, feed quality, ` +
          `and chick health status.`,
          batch.id,
        );
      }
    }
  }
}
