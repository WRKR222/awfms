// src/modules/brooder/brooder.service.ts
//
// Brooder Cage Map — fixed 6 rows/decks x 4 levels (bottom→top) grid.
// Mirrors the production-house CageMapService pattern (FarmBlock/Section/Row
// → BatchCageAssignment) but at brooder granularity, so:
//   • A chick population can be tracked from the moment a batch is keyed
//     into the brooder (placed on specific levels) through to the moment it
//     transfers to the production house cage map.
//   • An issue (disease, heat failure, etc.) can be isolated to one level
//     without describing the whole row or brooder as affected.
//   • Heating is tracked per row: CHARCOAL logs a quantity used; HEAT_BULB
//     logs a start/stop timer so total minutes-on is known.
//   • Required feed per row/level = population on that level × the standard
//     g/bird/day rate (age + feed type aware) × 7, so the PM and Director
//     can see at a glance whether the exact required amount was issued.

import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DASHBOARD_REFRESH_EVENT } from '../../common/events/app-event-bus';
import { HeatSourceType } from '@prisma/client';
import { brooderGramsPerBirdPerDay } from '../../common/feed/feed-standard.util';
import {
  AssignLevelSchema, CreateHeatLogSchema, StopBulbHeatLogSchema, CreateLevelFeedLogSchema,
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private refresh() {
    this.eventEmitter.emit(DASHBOARD_REFRESH_EVENT, { roles: ['ATTENDANT', 'MANAGER', 'OWNER'] });
  }

  // ── Cage map: full 6x4 grid with assignments, heating, feed status ──────

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
            currentBirdCount: true, dateOfHatch: true, dateReceived: true, isActive: true,
          },
        })
      : [];
    const batchMap = Object.fromEntries(batches.map(b => [b.id, b]));

    // Today's heat log per row (most recent open/closed entry)
    const today = dayjs().startOf('day').toDate();
    const heatLogs = await this.prisma.brooderHeatLog.findMany({
      where: { rowId: { in: rows.map(r => r.id) }, logDate: { gte: today } },
      orderBy: { createdAt: 'desc' },
    });
    const heatByRow: Record<string, typeof heatLogs[number]> = {};
    for (const h of heatLogs) {
      if (!heatByRow[h.rowId]) heatByRow[h.rowId] = h;
    }

    // This week's feed logged per level (for required-vs-actual)
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

    const mappedRows = rows.map(row => {
      const heat = heatByRow[row.id] ?? null;
      const levels = row.levels.map(level => {
        const a = level.assignment;
        const batch = a ? batchMap[a.batchId] : null;
        let requiredKgThisWeek: number | null = null;
        let feedType: string | null = null;
        if (batch && a) {
          const ageWeeks = dayjs().diff(dayjs(batch.dateOfHatch), 'week');
          feedType = ageWeeks < 4 ? 'CHICK_MASH' : 'GROWER_MASH';
          const perDay = brooderGramsPerBirdPerDay(feedType, ageWeeks);
          requiredKgThisWeek = Math.round(((a.birdCount * perDay * 7) / 1000) * 100) / 100;
        }
        const dispensedThisWeek = feedByLevel[level.id] ?? 0;

        return {
          levelId: level.id,
          levelNumber: level.levelNumber,
          label: level.label,
          isActive: level.isActive,
          assignment: a
            ? {
                batchId: a.batchId,
                birdCount: a.birdCount,
                placedDate: a.placedDate,
                notes: a.notes,
              }
            : null,
          batch: batch
            ? {
                batchCode: batch.batchCode,
                strain: batch.strain,
                stage: batch.stage,
                ageWeeks: dayjs().diff(dayjs(batch.dateOfHatch), 'week'),
              }
            : null,
          feedType,
          requiredKgThisWeek,
          dispensedKgThisWeek: Math.round(dispensedThisWeek * 100) / 100,
          feedVariancePercent:
            requiredKgThisWeek && requiredKgThisWeek > 0
              ? Math.round(((dispensedThisWeek - requiredKgThisWeek) / requiredKgThisWeek) * 1000) / 10
              : null,
        };
      });

      const rowBirdTotal = levels.reduce((s, l) => s + (l.assignment?.birdCount ?? 0), 0);

      return {
        rowId: row.id,
        rowNumber: row.rowNumber,
        label: row.label,
        isActive: row.isActive,
        birdTotal: rowBirdTotal,
        heatToday: heat
          ? {
              id: heat.id,
              sourceType: heat.sourceType,
              charcoalKg: heat.charcoalKg,
              bulbStartedAt: heat.bulbStartedAt,
              bulbStoppedAt: heat.bulbStoppedAt,
              bulbMinutesOn: heat.bulbMinutesOn
                ?? (heat.bulbStartedAt && !heat.bulbStoppedAt
                      ? dayjs().diff(dayjs(heat.bulbStartedAt), 'minute')
                      : null),
              bulbCount: heat.bulbCount,
              isRunning: heat.sourceType === HeatSourceType.HEAT_BULB
                && !!heat.bulbStartedAt && !heat.bulbStoppedAt,
            }
          : null,
        levels,
      };
    });

    const totalChicks = mappedRows.reduce((s, r) => s + r.birdTotal, 0);

    return { rows: mappedRows, totalChicks, generatedAt: new Date() };
  }

  // ── Level assignment ─────────────────────────────────────────────────

  async assignLevel(levelId: string, input: unknown, userId: string) {
    const dto = parseOrThrow(AssignLevelSchema, input);

    const level = await this.prisma.brooderLevel.findUnique({ where: { id: levelId } });
    if (!level) throw new NotFoundException('Brooder level not found');

    const batch = await this.prisma.batch.findUnique({ where: { id: dto.batchId } });
    if (!batch) throw new NotFoundException('Batch not found');

    // ── Validate: only BROODER-location batches (or unplaced batches being
    //    placed for the first time, which have no location yet) can be assigned.
    //    Once a batch is placed on any level its location becomes 'BROODER'.
    //    We allow batches that are not yet placed (location != 'BROODER') only
    //    on their very first assignment — subsequent assignments must already
    //    be BROODER.  We determine "first assignment" by checking existing
    //    assignments for this batch.
    const existingAssignmentsForBatch = await this.prisma.brooderLevelAssignment.findMany({
      where: { batchId: dto.batchId },
    });
    const isAlreadyPlaced = batch.location === 'BROODER';
    const hasAnyAssignment = existingAssignmentsForBatch.length > 0;
    if (!isAlreadyPlaced && hasAnyAssignment) {
      throw new BadRequestException(
        'Only batches currently in the Brooder can be assigned to a level.',
      );
    }

    // ── Validate: total birds across all levels for this batch (excluding
    //    the current level being upserted) must not exceed quantityReceived.
    const siblingsTotal = existingAssignmentsForBatch
      .filter(a => a.levelId !== levelId)      // exclude THIS level (upsert)
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
      const result = await tx.brooderLevelAssignment.upsert({
        where: { levelId },
        create: {
          levelId,
          batchId: dto.batchId,
          birdCount: dto.birdCount,
          placedDate: new Date(dto.placedDate),
          notes: dto.notes ?? null,
          assignedById: userId,
        },
        update: {
          batchId: dto.batchId,
          birdCount: dto.birdCount,
          placedDate: new Date(dto.placedDate),
          notes: dto.notes ?? null,
          assignedById: userId,
        },
      });
      // Batch location flips to BROODER the moment it has any level assignment.
      await tx.batch.update({
        where: { id: dto.batchId },
        data: { location: 'BROODER' },
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

  /** All level assignments for a batch — used to trace a batch end-to-end
   *  from brooder placement through to production-house transfer. */
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

  // ── Heat logs ─────────────────────────────────────────────────────────

  async listHeatLogs(rowId: string, limit = 30) {
    return this.prisma.brooderHeatLog.findMany({
      where: { rowId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { loggedBy: { select: { id: true, fullName: true } } },
    });
  }

  /** Log a CHARCOAL quantity, or START a HEAT_BULB timer for a row. */
  async createHeatLog(input: unknown, userId: string) {
    const dto = parseOrThrow(CreateHeatLogSchema, input);

    const row = await this.prisma.brooderRow.findUnique({ where: { id: dto.rowId } });
    if (!row) throw new NotFoundException('Brooder row not found');

    if (dto.sourceType === 'CHARCOAL') {
      const result = await this.prisma.brooderHeatLog.create({
        data: {
          rowId: dto.rowId,
          logDate: new Date(dto.logDate),
          sourceType: HeatSourceType.CHARCOAL,
          charcoalKg: dto.charcoalKg,
          notes: dto.notes ?? null,
          loggedById: userId,
        },
      });
      this.refresh();
      return result;
    }

    // HEAT_BULB — start the timer
    const result = await this.prisma.brooderHeatLog.create({
      data: {
        rowId: dto.rowId,
        logDate: new Date(dto.logDate),
        sourceType: HeatSourceType.HEAT_BULB,
        bulbStartedAt: new Date(),
        bulbCount: dto.bulbCount,
        notes: dto.notes ?? null,
        loggedById: userId,
      },
    });
    this.refresh();
    return result;
  }

  /** Stop a running HEAT_BULB timer — freezes bulbMinutesOn. */
  async stopBulbHeatLog(heatLogId: string, input: unknown, userId: string) {
    const dto = parseOrThrow(StopBulbHeatLogSchema, input);

    const log = await this.prisma.brooderHeatLog.findUnique({ where: { id: heatLogId } });
    if (!log) throw new NotFoundException('Heat log not found');
    if (log.sourceType !== HeatSourceType.HEAT_BULB) {
      throw new BadRequestException('Only HEAT_BULB logs can be stopped');
    }
    if (!log.bulbStartedAt) throw new BadRequestException('Bulb timer was never started');
    if (log.bulbStoppedAt) throw new BadRequestException('Bulb timer is already stopped');

    const stoppedAt = new Date();
    const minutesOn = Math.max(0, dayjs(stoppedAt).diff(dayjs(log.bulbStartedAt), 'minute'));

    const result = await this.prisma.brooderHeatLog.update({
      where: { id: heatLogId },
      data: {
        bulbStoppedAt: stoppedAt,
        bulbMinutesOn: minutesOn,
        notes: dto.notes ? `${log.notes ? log.notes + ' | ' : ''}${dto.notes}` : log.notes,
      },
    });
    this.refresh();
    return result;
  }

  // ── Per-level feed logs ──────────────────────────────────────────────

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
      where: { id: dto.levelId },
      include: { assignment: true },
    });
    if (!level) throw new NotFoundException('Brooder level not found');

    let requiredKgForWeek: number | null = null;
    if (level.assignment) {
      const batch = await this.prisma.batch.findUnique({ where: { id: level.assignment.batchId } });
      if (batch) {
        const ageWeeks = dayjs(dto.entryDate).diff(dayjs(batch.dateOfHatch), 'week');
        const perDay = brooderGramsPerBirdPerDay(dto.feedType, ageWeeks);
        requiredKgForWeek = Math.round(((level.assignment.birdCount * perDay * 7) / 1000) * 100) / 100;
      }
    }

    const result = await this.prisma.brooderLevelFeedLog.create({
      data: {
        levelId: dto.levelId,
        feedType: dto.feedType,
        entryDate: new Date(dto.entryDate),
        quantityDispensedKg: dto.quantityDispensedKg,
        requiredKgForWeek,
        notes: dto.notes ?? null,
        loggedById: userId,
      },
    });

    // Mirror into FeedIntakeLog so farm-wide feed stock keeps deducting
    // consistently with the rest of the system (FeedService). A batch can
    // be split across several brooder levels, all logged on the same day,
    // so this accumulates onto the existing batch/date/feedType entry
    // (which is unique per FeedService's own constraint) rather than
    // creating a duplicate.
    if (level.assignment) {
      const batch = await this.prisma.batch.findUnique({ where: { id: level.assignment.batchId } });
      if (batch) {
        const entryDate = new Date(dto.entryDate);
        const existing = await this.prisma.feedIntakeLog.findUnique({
          where: {
            batchId_entryDate_feedType: {
              batchId: batch.id,
              entryDate,
              feedType: dto.feedType as any,
            },
          },
        });
        if (existing) {
          await this.prisma.feedIntakeLog.update({
            where: { id: existing.id },
            data: {
              quantityDispensedKg: { increment: dto.quantityDispensedKg },
              notes: existing.notes
                ? `${existing.notes} | +${dto.quantityDispensedKg}kg via ${level.label}`
                : `Logged from Brooder cage map — ${level.label}`,
            },
          });
        } else {
          await this.prisma.feedIntakeLog.create({
            data: {
              batchId: batch.id,
              houseId: batch.houseId,
              feedType: dto.feedType as any,
              entryDate,
              quantityDispensedKg: dto.quantityDispensedKg,
              wastageKg: 0,
              recommendedMinKg: 0,
              recommendedMaxKg: requiredKgForWeek ?? 0,
              notes: `Logged from Brooder cage map — ${level.label}`,
              recordedById: userId,
            },
          });
        }
      }
    }

    this.refresh();
    return result;
  }

  // ── Required feed summary — used by attendant/PM/director dashboards ───

  /** Returns required-vs-dispensed feed for the current week, broken down
   *  by row and level, plus a farm-wide rollup. This is the canonical
   *  source for "did this row/level get the exact required amount". */
  async getFeedRequirementSummary() {
    const map = await this.getCageMap();

    const rows = map.rows.map(row => {
      const levels = row.levels.filter(l => l.assignment);
      const requiredKg = levels.reduce((s, l) => s + (l.requiredKgThisWeek ?? 0), 0);
      const dispensedKg = levels.reduce((s, l) => s + (l.dispensedKgThisWeek ?? 0), 0);
      return {
        rowId: row.rowId,
        rowNumber: row.rowNumber,
        label: row.label,
        birdTotal: row.birdTotal,
        requiredKgThisWeek: Math.round(requiredKg * 100) / 100,
        dispensedKgThisWeek: Math.round(dispensedKg * 100) / 100,
        exactMatch: levels.length > 0 && levels.every(l => l.feedVariancePercent === 0),
        levels: levels.map(l => ({
          levelId: l.levelId,
          levelNumber: l.levelNumber,
          label: l.label,
          batchCode: l.batch?.batchCode ?? null,
          birdCount: l.assignment?.birdCount ?? 0,
          feedType: l.feedType,
          requiredKgThisWeek: l.requiredKgThisWeek,
          dispensedKgThisWeek: l.dispensedKgThisWeek,
          feedVariancePercent: l.feedVariancePercent,
          exactMatch: l.feedVariancePercent === 0,
        })),
      };
    });

    const totalRequiredKg = rows.reduce((s, r) => s + r.requiredKgThisWeek, 0);
    const totalDispensedKg = rows.reduce((s, r) => s + r.dispensedKgThisWeek, 0);

    return {
      weekStart: dayjs().startOf('week').toDate(),
      totalChicks: map.totalChicks,
      totalRequiredKgThisWeek: Math.round(totalRequiredKg * 100) / 100,
      totalDispensedKgThisWeek: Math.round(totalDispensedKg * 100) / 100,
      rows,
    };
  }
}
