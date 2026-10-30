// src/modules/production/production-cage.service.ts
//
// Production house map (Block 1 and Block 2), recorded per row · level.
//
// Layout of each house: sections A, B, C × rows 1, 2 (A1 … C2). Every row has
// 4 levels (1 = bottom … 4 = top, same order as the brooder), each level has
// `tiersPerLevel` tiers (Block 1: 24, Block 2: 38) of 4 cages, 4 birds per
// cage. That arrangement still sets the capacity, but records (placements,
// mortalities, moves) are kept per row · level: one unit per level, code
// BLK1-A1-L4, capacity = cages on the level × birds per cage. A level may hold
// several batches. Plus 8 isolation cages per house, still kept per cage; they
// always record where their birds came from (`origin`).
//
// BatchCageAssignment (one batch per row) is kept as an automatic per-row
// rollup so existing row-level reports, HDP and culling logic keep working.

import {
  BadRequestException, Injectable, Logger, NotFoundException, OnApplicationBootstrap,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BatchStage, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../../common/notifications/notifications.service';
import { BATCH_TRANSFERRED_EVENT, DASHBOARD_REFRESH_EVENT } from '../../common/events/app-event-bus';
import { RequestUser } from '../../auth/types/request-user.type';
import { CageRef, parseProductionCageText } from './production-cage-text.util';

type Db = Prisma.TransactionClient | PrismaService;

export type HouseCode = 'BLK1' | 'BLK2';
export const HOUSE_CODES: HouseCode[] = ['BLK1', 'BLK2'];

/** Egg-collection session block ('BLOCK1') ↔ FarmBlock code ('BLK1'). */
export function houseCodeForSessionBlock(block?: string | null): HouseCode {
  return block === 'BLOCK2' ? 'BLK2' : 'BLK1';
}
export function sessionBlockForHouseCode(code: string): 'BLOCK1' | 'BLOCK2' {
  return code === 'BLK2' ? 'BLOCK2' : 'BLOCK1';
}

export function levelLabel(level: number, levelCount = 4) {
  if (level === 1) return 'Level 1 (Bottom)';
  if (level === levelCount) return `Level ${level} (Top)`;
  return `Level ${level}`;
}

/** Where a bird died: a level (or isolation cage) code, plus the batch when
 *  the level holds more than one. */
export interface MortalityUnitEntry {
  cageCode: string;
  count: number;
  cause?: string | null;
  batchId?: string | null;
}

/** A level or isolation cage while a reassignment is being worked out. */
export interface SimUnit {
  id: string;
  code: string;
  label: string;
  rowId: string | null;
  capacity: number;
  isIsolation: boolean;
  /** batchId → birds of that batch here */
  batches: Map<string, number>;
  isolationReason: string | null;
  origin: string | null;
}

export interface PlannedChange {
  cageId: string;
  cageCode: string;
  cageLabel: string;
  rowId: string | null;
  batchId: string;
  beforeCount: number;
  afterCount: number;
  isolationReason: string | null;
  origin: string | null;
}

/** Active record units: levels and isolation cages (per-cage rows are history). */
const UNIT: Prisma.ProductionCageWhereInput = { isActive: true, OR: [{ isLevel: true }, { isIsolation: true }] };

const used = (u: { assignments: { birdCount: number }[] }) => u.assignments.reduce((s, a) => s + a.birdCount, 0);
const simUsed = (u: SimUnit) => [...u.batches.values()].reduce((s, n) => s + n, 0);
const houseName = (code: string) => (code === 'BLK2' ? 'Block 2' : 'Block 1');

/** Joins source labels into a short origin text ("A1 · Level 4; …"). */
function originText(labels: string[]) {
  const uniq = [...new Set(labels)];
  return uniq.length > 3 ? `${uniq.slice(0, 3).join('; ')} and ${uniq.length - 3} more` : uniq.join('; ');
}

const toDate = (s?: string | null) => {
  const d = s ? new Date(s) : new Date();
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`Invalid date: ${s}`);
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
};

@Injectable()
export class ProductionCageService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ProductionCageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly notifications: NotificationsService,
  ) {}

  private refresh() {
    this.eventEmitter.emit(DASHBOARD_REFRESH_EVENT, { roles: ['MANAGER', 'OWNER', 'ATTENDANT'] });
  }

  private async getBlockOrThrow(code: string, db: Db = this.prisma) {
    const block = await db.farmBlock.findUnique({ where: { code: code.toUpperCase() } });
    if (!block) throw new NotFoundException(`Production house ${code} not found`);
    return block;
  }

  // ── Capacity ───────────────────────────────────────────────────────────

  async capacity(code: string, db: Db = this.prisma, rowCodes?: string[]) {
    const block = await this.getBlockOrThrow(code, db);
    const levels = await db.productionCage.findMany({
      where: {
        blockId: block.id, isActive: true, isLevel: true,
        ...(rowCodes?.length ? { row: { rowCode: { in: rowCodes.map(r => r.toUpperCase()) } } } : {}),
      },
      select: { capacity: true, assignments: { select: { birdCount: true } } },
    });
    const open = block.isActive && !block.isUnderConstruction;
    const birds = levels.reduce((s, l) => s + used(l), 0);
    const capacityBirds = levels.reduce((s, l) => s + l.capacity, 0);
    return {
      code: block.code,
      name: block.name,
      isActive: open,
      totalLevels: levels.length,
      occupiedLevels: levels.filter(l => used(l) > 0).length,
      fullLevels: levels.filter(l => used(l) >= l.capacity).length,
      cagesPerLevel: block.tiersPerLevel * block.cagesPerTier,
      birds,
      capacityBirds,
      /** Birds that can still be placed (room left on every level). */
      freeSpaces: open ? levels.reduce((s, l) => s + Math.max(0, l.capacity - used(l)), 0) : 0,
    };
  }

  async listHouses() {
    const blocks = await this.prisma.farmBlock.findMany({ orderBy: { code: 'asc' } });
    return Promise.all(blocks.map(async b => ({
      ...(await this.capacity(b.code)),
      levelsPerRow: b.levelsPerRow,
      tiersPerLevel: b.tiersPerLevel,
      cagesPerTier: b.cagesPerTier,
      birdsPerCage: b.birdsPerCage,
      isolationCageCount: b.isolationCageCount,
    })));
  }

  // ── Map ────────────────────────────────────────────────────────────────

  async getHouseMap(code: string) {
    const block = await this.prisma.farmBlock.findUnique({
      where: { code: code.toUpperCase() },
      include: {
        farm_sections: {
          orderBy: { sortOrder: 'asc' },
          include: { farm_rows: { orderBy: { rowCode: 'asc' }, select: { id: true, rowCode: true, isActive: true } } },
        },
      },
    });
    if (!block) throw new NotFoundException(`Production house ${code} not found`);

    const units = await this.prisma.productionCage.findMany({
      where: { blockId: block.id, ...UNIT },
      include: {
        row: { select: { rowCode: true } },
        assignments: {
          include: { batch: { select: { id: true, batchCode: true, currentBirdCount: true, dateOfHatch: true, stage: true } } },
          orderBy: { placedDate: 'asc' },
        },
      },
    });

    const since = new Date();
    since.setDate(since.getDate() - 7);
    const mortality = await this.prisma.productionCageMortalityLog.groupBy({
      by: ['cageId'],
      where: { cage: { blockId: block.id }, logDate: { gte: since } },
      _sum: { count: true },
    });
    const mortalityByUnit = new Map(mortality.map(m => [m.cageId, m._sum.count ?? 0]));

    const batches = new Map<string, { id: string; batchCode: string; birds: number; levels: number; currentBirdCount: number; dateOfHatch: Date; stage: BatchStage }>();
    for (const u of units) {
      for (const a of u.assignments) {
        const b = batches.get(a.batchId) ?? {
          id: a.batch.id, batchCode: a.batch.batchCode, birds: 0, levels: 0,
          currentBirdCount: a.batch.currentBirdCount, dateOfHatch: a.batch.dateOfHatch, stage: a.batch.stage,
        };
        b.birds += a.birdCount;
        if (u.isLevel) b.levels += 1;
        batches.set(a.batchId, b);
      }
    }

    const occupants = (u: (typeof units)[number]) => u.assignments.map(a => ({
      batchId: a.batchId, batchCode: a.batch.batchCode, birdCount: a.birdCount, placedDate: a.placedDate,
    }));
    const cap = await this.capacity(block.code);
    return {
      block: {
        id: block.id, code: block.code, name: block.name,
        isActive: block.isActive, isUnderConstruction: block.isUnderConstruction,
        levelsPerRow: block.levelsPerRow, tiersPerLevel: block.tiersPerLevel,
        cagesPerTier: block.cagesPerTier, birdsPerCage: block.birdsPerCage,
        cagesPerLevel: block.tiersPerLevel * block.cagesPerTier,
        isolationCageCount: block.isolationCageCount,
      },
      sections: block.farm_sections.map(s => ({
        code: s.code,
        rows: s.farm_rows.map(r => ({ rowId: r.id, rowCode: r.rowCode, isActive: r.isActive })),
      })),
      levels: units.filter(u => u.isLevel).map(u => ({
        unitId: u.id,
        code: u.code,
        label: u.label,
        rowCode: u.row?.rowCode ?? null,
        level: u.levelNumber,
        capacity: u.capacity,
        birds: used(u),
        batches: occupants(u),
        mortality7d: mortalityByUnit.get(u.id) ?? 0,
      })),
      isolation: units.filter(u => u.isIsolation).sort((a, b) => a.cageNumber - b.cageNumber).map(u => {
        const a = u.assignments[0];
        return {
          unitId: u.id,
          code: u.code,
          label: u.label,
          cageNo: u.cageNumber,
          capacity: u.capacity,
          birds: used(u),
          batches: occupants(u),
          isolationReason: a?.isolationReason ?? null,
          origin: a?.origin ?? null,
          mortality7d: mortalityByUnit.get(u.id) ?? 0,
        };
      }),
      batches: [...batches.values()],
      totals: cap,
    };
  }

  /** Finds one active level / isolation cage of a house by its code. */
  private async unitByCode(db: Db, blockId: string, code: string) {
    const unit = await db.productionCage.findFirst({
      where: { blockId, code: code.toUpperCase(), ...UNIT },
      include: { assignments: true, block: { select: { code: true } } },
    });
    if (!unit) throw new BadRequestException(`Unknown level or isolation cage: ${code}`);
    return unit;
  }

  // ── Row rollup (BatchCageAssignment) ───────────────────────────────────

  /** Per row: the batch with the most birds on that row's levels becomes the
   *  row's BatchCageAssignment, birdCount = that batch's birds in the row. A
   *  row with no birds loses its rollup. */
  async recomputeRowRollups(db: Db, rowIds: Iterable<string>, userId: string) {
    for (const rowId of new Set(rowIds)) {
      if (!rowId) continue;
      const assignments = await db.productionCageAssignment.findMany({
        where: { cage: { rowId } },
        select: { batchId: true, birdCount: true, placedDate: true },
      });
      if (assignments.length === 0) {
        await db.batchCageAssignment.deleteMany({ where: { rowId } });
        continue;
      }
      const byBatch = new Map<string, { birds: number; placed: Date }>();
      for (const a of assignments) {
        const cur = byBatch.get(a.batchId) ?? { birds: 0, placed: a.placedDate };
        cur.birds += a.birdCount;
        if (a.placedDate < cur.placed) cur.placed = a.placedDate;
        byBatch.set(a.batchId, cur);
      }
      const [batchId, top] = [...byBatch.entries()].sort((a, b) => b[1].birds - a[1].birds)[0];
      await db.batchCageAssignment.upsert({
        where: { rowId },
        create: {
          rowId, batchId, birdCount: top.birds, transferDate: top.placed,
          notes: 'Auto-maintained rollup of this row\'s levels.', assignedById: userId,
        },
        update: { batchId, birdCount: top.birds },
      });
    }
  }

  /** A batch that has left the farm (sold / discarded / closed) gives up
   *  every level and isolation cage it held, and its row rollups.
   *  Returns the number of level / isolation records freed. */
  async releaseBatch(db: Db, batchId: string, userId: string) {
    const units = await db.productionCage.findMany({
      where: { assignments: { some: { batchId } } }, select: { rowId: true },
    });
    const { count } = await db.productionCageAssignment.deleteMany({ where: { batchId } });
    await this.recomputeRowRollups(db, units.map(u => u.rowId!).filter(Boolean), userId);
    await db.batchCageAssignment.deleteMany({ where: { batchId } });
    if (count > 0) this.refresh();
    return count;
  }

  /** Self-heal on start-up: frees space still held by batches that are no
   *  longer live (sold / discarded / closed / deleted before releaseBatch
   *  existed on every exit path). */
  async onApplicationBootstrap() {
    try {
      const stale = await this.prisma.productionCageAssignment.findMany({
        where: {
          batch: {
            OR: [
              { isActive: false },
              { deletedAt: { not: null } },
              { stage: { in: [BatchStage.SOLD, BatchStage.DISCARDED, BatchStage.CLOSED] } },
            ],
          },
        },
        distinct: ['batchId'],
        select: { batchId: true, batch: { select: { batchCode: true, createdById: true } } },
      });
      for (const s of stale) {
        const freed = await this.prisma.$transaction(tx => this.releaseBatch(tx, s.batchId, s.batch.createdById));
        this.logger.warn(`Freed ${freed} production level/isolation record(s) still held by ended batch ${s.batch.batchCode}`);
      }
    } catch (e) {
      this.logger.error(`Stale production clean-up failed: ${(e as Error).message}`);
    }
  }

  // ── Manual set / empty ────────────────────────────────────────────────

  /**
   * Sets how many birds of one batch are on a level (0 removes it), or
   * fills / changes an isolation cage. Birds going INTO an isolation cage are
   * always taken from a named level (or isolation cage), which drops.
   */
  async setUnit(code: string, input: any, userId: string) {
    const unitCode = String(input?.unitCode ?? '').trim();
    if (!unitCode) throw new BadRequestException('Pick a level or isolation cage');
    const birdCount = Number(input?.birdCount);
    if (!Number.isInteger(birdCount) || birdCount < 0) throw new BadRequestException('birdCount must be a whole number ≥ 0');
    const placedDate = toDate(input?.placedDate);
    const block = await this.getBlockOrThrow(code);
    const fromCode: string | undefined = input?.fromCode ? String(input.fromCode).toUpperCase() : undefined;

    const result = await this.prisma.$transaction(async (tx) => {
      const unit = await this.unitByCode(tx, block.id, unitCode);
      const rows = new Set<string>(unit.rowId ? [unit.rowId] : []);

      if (!unit.isIsolation) {
        const batchId = String(input?.batchId ?? '');
        if (!batchId) throw new BadRequestException(`Pick the batch on ${unit.label}`);
        const mine = unit.assignments.find(a => a.batchId === batchId);
        const others = unit.assignments.filter(a => a.batchId !== batchId).reduce((s, a) => s + a.birdCount, 0);
        if (others + birdCount > unit.capacity) {
          throw new BadRequestException(
            `${unit.label} holds at most ${unit.capacity} birds — ${others} already there from other batches.`,
          );
        }
        if (birdCount === 0) {
          if (mine) await tx.productionCageAssignment.delete({ where: { id: mine.id } });
        } else {
          if (!mine) await this.assertPlaceableBatch(tx, batchId);
          await tx.productionCageAssignment.upsert({
            where: { cageId_batchId: { cageId: unit.id, batchId } },
            create: { cageId: unit.id, batchId, birdCount, placedDate, notes: input?.notes ?? null, assignedById: userId },
            update: { birdCount, notes: input?.notes ?? undefined, assignedById: userId },
          });
        }
        await this.recomputeRowRollups(tx, rows, userId);
        return { unit: unit.code, birdCount };
      }

      // Isolation cage: one batch, at most `capacity` birds.
      if (birdCount > unit.capacity) throw new BadRequestException(`${unit.label} holds at most ${unit.capacity} birds`);
      const current = unit.assignments[0] ?? null;
      const before = current?.birdCount ?? 0;
      if (birdCount === 0) {
        await tx.productionCageAssignment.deleteMany({ where: { cageId: unit.id } });
        return { unit: unit.code, birdCount };
      }
      let batchId = current?.batchId ?? null;
      let origin = current?.origin ?? null;
      if (birdCount > before) {
        if (!fromCode) throw new BadRequestException(`Say which level the birds moved into ${unit.label} came from`);
        const src = await this.unitByCode(tx, block.id, fromCode);
        if (src.id === unit.id) throw new BadRequestException('Pick a different level to take the birds from');
        const wanted = batchId ?? (input?.batchId ? String(input.batchId) : null);
        const srcRow = wanted
          ? src.assignments.find(a => a.batchId === wanted)
          : src.assignments.length === 1 ? src.assignments[0] : undefined;
        if (!srcRow) {
          throw new BadRequestException(src.assignments.length > 1 && !wanted
            ? `${src.label} holds several batches — pick which batch the birds belong to`
            : `${src.label} has no birds of that batch on the map`);
        }
        const moving = birdCount - before;
        if (srcRow.birdCount < moving) {
          throw new BadRequestException(`${src.label} has ${srcRow.birdCount} bird(s) of that batch — ${moving} needed`);
        }
        if (srcRow.birdCount > moving) {
          await tx.productionCageAssignment.update({ where: { id: srcRow.id }, data: { birdCount: srcRow.birdCount - moving } });
        } else {
          await tx.productionCageAssignment.delete({ where: { id: srcRow.id } });
        }
        if (src.rowId) rows.add(src.rowId);
        batchId = srcRow.batchId;
        origin = originText([...(origin ? origin.split('; ') : []), `${houseName(src.block.code)} ${src.label}`]) || null;
      }
      if (!batchId) throw new BadRequestException(`${unit.label} is empty — say where the birds came from`);
      const isolationReason = input?.isolationReason?.trim() || current?.isolationReason || 'Isolation';
      await tx.productionCageAssignment.upsert({
        where: { cageId_batchId: { cageId: unit.id, batchId } },
        create: { cageId: unit.id, batchId, birdCount, placedDate, isolationReason, origin, notes: input?.notes ?? null, assignedById: userId },
        update: { birdCount, isolationReason, origin, assignedById: userId },
      });
      await this.recomputeRowRollups(tx, rows, userId);
      return { unit: unit.code, birdCount };
    });
    this.refresh();
    return result;
  }

  /** Empties a level (one batch when batchId is given) or an isolation cage. */
  async clearUnit(code: string, unitCode: string, batchId: string | undefined, userId: string) {
    const block = await this.getBlockOrThrow(code);
    const result = await this.prisma.$transaction(async (tx) => {
      const unit = await this.unitByCode(tx, block.id, unitCode);
      const { count } = await tx.productionCageAssignment.deleteMany({
        where: { cageId: unit.id, ...(batchId ? { batchId } : {}) },
      });
      if (unit.rowId) await this.recomputeRowRollups(tx, [unit.rowId], userId);
      return { unit: unit.code, removed: count };
    });
    this.refresh();
    return result;
  }

  private async assertPlaceableBatch(db: Db, batchId: string) {
    const batch = await db.batch.findFirst({ where: { id: batchId, deletedAt: null }, select: { stage: true, batchCode: true, isActive: true } });
    if (!batch) throw new NotFoundException('Batch not found');
    if (!batch.isActive || batch.stage !== BatchStage.PRODUCTION) {
      throw new BadRequestException(`Batch ${batch.batchCode} is not a production-stage batch`);
    }
  }

  /**
   * Places birds of a batch into the free space of a house's levels, row by
   * row, top level first. Each placement may be pinned to a row; unpinned
   * placements use any row.
   */
  async placeBatchInHouse(db: Db, args: {
    batchId: string; houseCode: string; placements: { rowCode?: string | null; birds: number }[];
    placedDate: Date; userId: string;
  }) {
    const block = await this.getBlockOrThrow(args.houseCode, db);
    if (!block.isActive || block.isUnderConstruction) {
      throw new BadRequestException(`${block.name} is not open for birds yet`);
    }
    const touchedRows = new Set<string>();
    let placedTotal = 0;
    for (const p of args.placements) {
      if (!(p.birds > 0)) continue;
      const levels = await db.productionCage.findMany({
        where: {
          blockId: block.id, isActive: true, isLevel: true,
          ...(p.rowCode ? { row: { rowCode: p.rowCode.toUpperCase() } } : {}),
        },
        include: {
          assignments: { select: { birdCount: true } },
          row: { select: { rowCode: true, section: { select: { sortOrder: true } } } },
        },
      });
      levels.sort((a, b) =>
        (a.row!.section.sortOrder - b.row!.section.sortOrder) ||
        a.row!.rowCode.localeCompare(b.row!.rowCode) ||
        ((b.levelNumber ?? 0) - (a.levelNumber ?? 0)));
      const space = levels.reduce((s, l) => s + Math.max(0, l.capacity - used(l)), 0);
      if (p.birds > space) {
        throw new BadRequestException(
          `${block.name}${p.rowCode ? ` row ${p.rowCode.toUpperCase()}` : ''} has room for ${space} more birds — ${p.birds} requested.`,
        );
      }
      let remaining = p.birds;
      for (const l of levels) {
        if (remaining <= 0) break;
        const n = Math.min(Math.max(0, l.capacity - used(l)), remaining);
        if (n <= 0) continue;
        await db.productionCageAssignment.upsert({
          where: { cageId_batchId: { cageId: l.id, batchId: args.batchId } },
          create: {
            cageId: l.id, batchId: args.batchId, birdCount: n, placedDate: args.placedDate,
            assignedById: args.userId, notes: 'Placed on transfer into the production house',
          },
          update: { birdCount: { increment: n } },
        });
        remaining -= n;
        if (l.rowId) touchedRows.add(l.rowId);
      }
      placedTotal += p.birds;
    }
    await this.recomputeRowRollups(db, touchedRows, args.userId);
    return { placed: placedTotal };
  }

  // ── Transfer from brooder ──────────────────────────────────────────────

  /**
   * Moves birds of a brooder batch into Block 1 or Block 2. Moving every live
   * bird moves the batch itself (stage → PRODUCTION). Moving only some splits
   * them off into a new production batch (`<code>-B1` / `-B2`, parentBatchId
   * set) and the rest stay in the brooder under the original batch. Refused
   * when the chosen house — or both houses — have no free space left.
   */
  async transferFromBrooder(input: any, user: RequestUser) {
    const batchId = String(input?.batchId ?? '');
    const houseCode = String(input?.houseCode ?? input?.blockCode ?? '').toUpperCase();
    const birdCount = Number(input?.birdCount);
    const rowCodes: string[] = Array.isArray(input?.rowCodes) ? input.rowCodes.map((r: any) => String(r).toUpperCase()) : [];
    const transferDate = toDate(input?.transferDate);
    if (!HOUSE_CODES.includes(houseCode as HouseCode)) throw new BadRequestException('Choose Production House Block 1 or Block 2');

    const batch = await this.prisma.batch.findFirst({ where: { id: batchId, deletedAt: null } });
    if (!batch) throw new NotFoundException('Batch not found');
    if (!batch.isActive || (batch.stage !== BatchStage.BROODING && batch.stage !== BatchStage.GROWER)) {
      throw new BadRequestException(`Batch ${batch.batchCode} is not in the brooder`);
    }
    if (!Number.isInteger(birdCount) || birdCount < 1) throw new BadRequestException('Enter how many birds to transfer');
    if (birdCount > batch.currentBirdCount) {
      throw new BadRequestException(`${batch.batchCode} only has ${batch.currentBirdCount} live birds`);
    }

    const [b1, b2] = await Promise.all([this.capacity('BLK1'), this.capacity('BLK2')]);
    if (b1.freeSpaces === 0 && b2.freeSpaces === 0) {
      throw new BadRequestException('Both production houses are full — no birds can be transferred until space is freed.');
    }
    const target = houseCode === 'BLK1' ? b1 : b2;
    const free = rowCodes.length ? (await this.capacity(houseCode, this.prisma, rowCodes)).freeSpaces : target.freeSpaces;
    if (birdCount > free) {
      throw new BadRequestException(
        `${target.name} only has room for ${free} more birds${rowCodes.length ? ` in rows ${rowCodes.join(', ')}` : ''}` +
        ` — transfer ${free} or fewer, or use the other house.`,
      );
    }

    const full = birdCount === batch.currentBirdCount;
    const result = await this.prisma.$transaction(async (tx) => {
      let productionBatchId = batch.id;
      let productionBatchCode = batch.batchCode;

      if (full) {
        await tx.batch.update({
          where: { id: batch.id },
          data: { stage: BatchStage.PRODUCTION, location: 'PRODUCTION_HOUSE' },
        });
        await tx.brooderCageAssignment.deleteMany({ where: { batchId: batch.id } });
        await tx.brooderLevelAssignment.deleteMany({ where: { batchId: batch.id } });
      } else {
        const suffix = houseCode === 'BLK2' ? 'B2' : 'B1';
        let code = `${batch.batchCode}-${suffix}`;
        for (let n = 2; await tx.batch.findUnique({ where: { batchCode: code }, select: { id: true } }); n++) {
          code = `${batch.batchCode}-${suffix}-${n}`;
        }
        const day = transferDate.toISOString().slice(0, 10);
        const child = await tx.batch.create({
          data: {
            batchCode: code,
            supplierId: batch.supplierId,
            houseId: batch.houseId,
            birdType: batch.birdType,
            strain: batch.strain,
            quantityReceived: birdCount,
            currentBirdCount: birdCount,
            dateOfHatch: batch.dateOfHatch,
            dateReceived: transferDate,
            stage: BatchStage.PRODUCTION,
            location: 'PRODUCTION_HOUSE',
            vaccinationOnArrival: batch.vaccinationOnArrival,
            mortalityOnArrival: 0,
            notes: `Split from ${batch.batchCode} on ${day}: ${birdCount} birds transferred from the brooder to ${target.name}.`,
            parentBatchId: batch.id,
            createdById: user.id,
            // Same birds, same breed guide and recording plan as the parent.
            breedId: batch.breedId,
            breedVariety: batch.breedVariety,
            untrackedMetrics: batch.untrackedMetrics,
            recordingPlanSetAt: batch.recordingPlanSetAt,
            housingType: batch.housingType,
            housingDescription: batch.housingDescription,
            declaredLightHours: batch.declaredLightHours,
            nutritionProgram: batch.nutritionProgram,
          },
        });
        productionBatchId = child.id;
        productionBatchCode = child.batchCode;
        // The parent keeps the birds that stay behind. Its quantityReceived
        // drops by the same amount so survival/mortality rates for both
        // batches stay true (parent + child = what was originally received).
        await tx.batch.update({
          where: { id: batch.id },
          data: {
            currentBirdCount: { decrement: birdCount },
            quantityReceived: { decrement: birdCount },
            notes: `${batch.notes ? batch.notes + '\n' : ''}${day}: ${birdCount} birds transferred to ${target.name} as batch ${code}.`,
          },
        });
        await this.removeBirdsFromBrooder(tx, batch.id, birdCount, user.id);
      }

      const placements = rowCodes.length
        ? this.splitAcrossRows(birdCount, rowCodes)
        : [{ birds: birdCount }];
      await this.placeBatchInHouse(tx, {
        batchId: productionBatchId, houseCode, placements, placedDate: transferDate, userId: user.id,
      });

      return {
        transferred: birdCount,
        houseCode,
        houseName: target.name,
        fullTransfer: full,
        productionBatchId,
        productionBatchCode,
        remainingInBrooder: batch.currentBirdCount - birdCount,
      };
    }, { timeout: 30_000 });

    this.refresh();
    // Breed standards check the transfer age against the guide.
    this.eventEmitter.emit(BATCH_TRANSFERRED_EVENT, {
      batchId: result.productionBatchId, sourceBatchId: batchId, transferDate, userId: user.id,
    });
    return result;
  }

  /** Spreads birds over the chosen rows, filling earlier rows first. */
  private splitAcrossRows(birds: number, rowCodes: string[]) {
    // Each row holds the same number of cages; let placeBatchInHouse fill
    // rows in order by splitting into per-row chunks it can validate.
    return rowCodes.map((rowCode, i) => ({
      rowCode,
      birds: i === rowCodes.length - 1 ? birds - Math.floor(birds / rowCodes.length) * (rowCodes.length - 1) : Math.floor(birds / rowCodes.length),
    }));
  }

  /** Takes `count` birds out of a batch's brooder cages (last row / top
   *  level / highest cage first) and refreshes the level rollups — the same
   *  rollup rule BrooderService.recomputeLevelRollup applies. */
  private async removeBirdsFromBrooder(tx: Prisma.TransactionClient, batchId: string, count: number, userId: string) {
    const cages = await tx.brooderCageAssignment.findMany({
      where: { batchId },
      include: { cage: { select: { levelId: true, cageNumber: true, level: { select: { levelNumber: true, row: { select: { rowNumber: true } } } } } } },
    });
    cages.sort((a, b) =>
      (b.cage.level.row.rowNumber - a.cage.level.row.rowNumber) ||
      (b.cage.level.levelNumber - a.cage.level.levelNumber) ||
      (b.cage.cageNumber - a.cage.cageNumber));
    let remaining = count;
    const levels = new Set<string>();
    for (const a of cages) {
      if (remaining <= 0) break;
      const take = Math.min(a.birdCount, remaining);
      remaining -= take;
      levels.add(a.cage.levelId);
      if (take === a.birdCount) await tx.brooderCageAssignment.delete({ where: { id: a.id } });
      else await tx.brooderCageAssignment.update({ where: { id: a.id }, data: { birdCount: a.birdCount - take } });
    }
    for (const levelId of levels) {
      const left = await tx.brooderCageAssignment.findMany({ where: { cage: { levelId } } });
      if (!left.length) {
        await tx.brooderLevelAssignment.deleteMany({ where: { levelId } });
        continue;
      }
      await tx.brooderLevelAssignment.upsert({
        where: { levelId },
        create: {
          levelId, batchId: left[0].batchId, birdCount: left.reduce((s, a) => s + a.birdCount, 0),
          placedDate: left[0].placedDate, assignedById: userId,
          notes: 'Auto-maintained rollup of this level\'s cage assignments.',
        },
        update: { birdCount: left.reduce((s, a) => s + a.birdCount, 0) },
      });
    }
  }

  // ── Mortality per level (egg collection) ──────────────────────────────

  /** Validates an attendant's per-level mortality list against the house and
   *  returns it with level ids/labels and batches resolved (stored on the
   *  session). */
  async resolveMortalityEntries(houseCode: string, entries: MortalityUnitEntry[]) {
    const clean = (entries ?? []).filter(e => e && e.cageCode && Number(e.count) > 0);
    if (!clean.length) return [];
    const block = await this.getBlockOrThrow(houseCode);
    const merged = new Map<string, {
      cageId: string; cageCode: string; cageLabel: string; count: number; cause: string | null;
      batchId: string; batchCode: string;
    }>();
    const birdsThere = new Map<string, number>();
    for (const e of clean) {
      const unit = await this.prisma.productionCage.findFirst({
        where: { blockId: block.id, code: String(e.cageCode).toUpperCase(), ...UNIT },
        include: { assignments: { include: { batch: { select: { batchCode: true } } } } },
      });
      if (!unit) throw new BadRequestException(`Unknown level or isolation cage: ${e.cageCode}`);
      if (!Number.isInteger(Number(e.count))) throw new BadRequestException(`Mortality for ${unit.label} must be a whole number`);
      if (!unit.assignments.length) throw new BadRequestException(`${unit.label} is empty on the map — record the birds there first`);
      const a = e.batchId
        ? unit.assignments.find(x => x.batchId === e.batchId)
        : unit.assignments.length === 1 ? unit.assignments[0] : undefined;
      if (!a) {
        throw new BadRequestException(e.batchId
          ? `${unit.label} has no birds of that batch`
          : `${unit.label} holds several batches — pick which batch the bird was from`);
      }
      const key = `${unit.id}:${a.batchId}`;
      const cur = merged.get(key) ?? {
        cageId: unit.id, cageCode: unit.code, cageLabel: unit.label, count: 0,
        cause: e.cause?.trim() || null, batchId: a.batchId, batchCode: a.batch.batchCode,
      };
      cur.count += Number(e.count);
      merged.set(key, cur);
      birdsThere.set(key, a.birdCount);
    }
    for (const [key, m] of merged) {
      if (m.count > birdsThere.get(key)!) {
        throw new BadRequestException(`${m.cageLabel} only has ${birdsThere.get(key)} bird(s) of ${m.batchCode} — ${m.count} mortalities entered`);
      }
    }
    return [...merged.values()];
  }

  /** Applies a session's per-level mortalities once the Manager approves it:
   *  level counts drop, a mortality log is written per level, the batch's
   *  live count drops and the row rollups are refreshed. Idempotent. Entries
   *  saved before records went per level (a single cage) count against that
   *  cage's level. */
  async applySessionMortalities(sessionId: string, userId: string) {
    const session = await this.prisma.eggCollectionSession.findUnique({ where: { id: sessionId } });
    if (!session || session.mortalitiesAppliedAt) return null;
    const entries = (Array.isArray(session.mortalityCagesJson) ? session.mortalityCagesJson : []) as any[];
    if (!entries.length) return null;

    const result = await this.prisma.$transaction(async (tx) => {
      const rows = new Set<string>();
      const byBatch = new Map<string, number>();
      for (const e of entries) {
        let unit = await tx.productionCage.findUnique({ where: { id: String(e.cageId) }, include: { assignments: true } });
        if (unit && !unit.isLevel && !unit.isIsolation) {
          unit = await tx.productionCage.findFirst({
            where: { rowId: unit.rowId, levelNumber: unit.levelNumber, isLevel: true },
            include: { assignments: true },
          });
        }
        if (!unit) continue;
        const count = Math.max(0, Number(e.count) || 0);
        if (!count) continue;
        const a = e.batchId
          ? unit.assignments.find(x => x.batchId === e.batchId)
          : unit.assignments.length === 1 ? unit.assignments[0] : unit.assignments.find(x => x.batchId === session.batchId);
        const batchId = a?.batchId ?? e.batchId ?? session.batchId;
        if (a) {
          const left = a.birdCount - count;
          if (left > 0) await tx.productionCageAssignment.update({ where: { id: a.id }, data: { birdCount: left } });
          else await tx.productionCageAssignment.delete({ where: { id: a.id } });
        }
        await tx.productionCageMortalityLog.create({
          data: {
            cageId: unit.id, batchId, sessionId, logDate: session.sessionDate, count,
            cause: e.cause ?? null, notes: `${session.shift} egg collection`, recordedById: session.collectedById,
          },
        });
        if (unit.rowId) rows.add(unit.rowId);
        byBatch.set(batchId, (byBatch.get(batchId) ?? 0) + count);
      }
      for (const [batchId, n] of byBatch) {
        const b = await tx.batch.findUnique({ where: { id: batchId }, select: { currentBirdCount: true } });
        if (b) await tx.batch.update({ where: { id: batchId }, data: { currentBirdCount: Math.max(0, b.currentBirdCount - n) } });
      }
      await this.recomputeRowRollups(tx, rows, userId);
      await tx.eggCollectionSession.update({ where: { id: sessionId }, data: { mortalitiesAppliedAt: new Date() } });
      return { levels: entries.length, birds: [...byBatch.values()].reduce((s, n) => s + n, 0) };
    });
    this.refresh();
    return result;
  }

  async listCageMortality(houseCode: string, days = 30) {
    const block = await this.getBlockOrThrow(houseCode);
    const since = new Date();
    since.setDate(since.getDate() - (Number(days) > 0 ? Number(days) : 30));
    return this.prisma.productionCageMortalityLog.findMany({
      where: { cage: { blockId: block.id }, logDate: { gte: since } },
      include: { cage: { select: { code: true, label: true } } },
      orderBy: [{ logDate: 'desc' }, { createdAt: 'desc' }],
      take: 300,
    });
  }

  // ── Free-text reassignment ────────────────────────────────────────────

  private async loadSim(db: Db) {
    const blocks = await db.farmBlock.findMany({ where: { code: { in: HOUSE_CODES } } });
    return { blocks, units: new Map<string, SimUnit>() };
  }

  /** Levels (cage / tier numbers are only physical places on the level and
   *  are ignored) or isolation cages a reference names. */
  private async resolveRef(db: Db, sim: { blocks: any[]; units: Map<string, SimUnit> }, ref: CageRef, defaultCode: string): Promise<SimUnit[] | string> {
    const code = ref.blockCode ?? defaultCode;
    const block = sim.blocks.find(b => b.code === code);
    if (!block) return `Production house ${code} not found.`;
    if (!ref.isolation && !ref.rowCode) return 'Say which row (A1, A2, B1, B2, C1, C2) or isolation cage.';
    const where: Prisma.ProductionCageWhereInput = ref.isolation
      ? { blockId: block.id, isActive: true, isIsolation: true, ...(ref.cages?.length ? { cageNumber: { in: ref.cages } } : {}) }
      : {
          blockId: block.id, isActive: true, isLevel: true, row: { rowCode: ref.rowCode },
          ...(ref.levels?.length ? { levelNumber: { in: ref.levels } } : {}),
        };
    const units = await db.productionCage.findMany({
      where, include: { assignments: true },
      orderBy: [{ levelNumber: 'desc' }, { cageNumber: 'asc' }],
    });
    if (!units.length) {
      const bits = [ref.isolation ? 'isolation cage' : ref.rowCode,
        ref.isolation && ref.cages?.length ? ref.cages.join(',') : '',
        !ref.isolation && ref.levels?.length ? `level ${ref.levels.join(',')}` : ''].filter(Boolean).join(' ');
      return `No such level or isolation cage in ${block.name}: ${bits}.`;
    }
    return units.map(u => {
      const existing = sim.units.get(u.id);
      if (existing) return existing;
      const s: SimUnit = {
        id: u.id, code: u.code, label: `${houseName(block.code)} ${u.label}`,
        rowId: u.rowId, capacity: u.capacity, isIsolation: u.isIsolation,
        batches: new Map(u.assignments.map(a => [a.batchId, a.birdCount])),
        isolationReason: u.assignments[0]?.isolationReason ?? null,
        origin: u.assignments[0]?.origin ?? null,
      };
      sim.units.set(u.id, s);
      return s;
    });
  }

  /** Works out every level / isolation change a description implies, without writing. */
  private async planReassignment(db: Db, houseCode: string, description: string, fallbackBatchId?: string) {
    const parsed = parseProductionCageText(description);
    const sim = await this.loadSim(db);
    const original = new Map<string, Map<string, number>>();
    const remember = (us: SimUnit[]) => us.forEach(u => {
      if (!original.has(u.id)) original.set(u.id, new Map(u.batches));
    });
    const steps: { clause: string; summary: string }[] = [];
    const problems = [...parsed.problems];
    const names = (us: SimUnit[]) => `${us.map(u => u.label).slice(0, 3).join(', ')}${us.length > 3 ? '…' : ''}`;

    for (const op of parsed.ops) {
      if (op.kind === 'MOVE') {
        const src = await this.resolveRef(db, sim, op.from, houseCode);
        const dst = await this.resolveRef(db, sim, op.to, houseCode);
        if (typeof src === 'string') { problems.push({ clause: op.clause, reason: `From: ${src}` }); continue; }
        if (typeof dst === 'string') { problems.push({ clause: op.clause, reason: `To: ${dst}` }); continue; }
        if (dst.every(d => src.some(s => s.id === d.id))) {
          problems.push({ clause: op.clause, reason: 'Birds stay on the same level — records are per level, so nothing changes.' });
          continue;
        }
        remember(src); remember(dst);
        const available = src.filter(u => simUsed(u) > 0);
        const have = available.reduce((s, u) => s + simUsed(u), 0);
        const want = op.count ?? have;
        if (have === 0) { problems.push({ clause: op.clause, reason: 'The level(s) moved from have no birds on the map.' }); continue; }
        if (want > have) { problems.push({ clause: op.clause, reason: `Only ${have} bird(s) where they were moved from — ${want} stated.` }); continue; }
        const batchIds = new Set(available.flatMap(u => [...u.batches.keys()]));
        const destSpace = dst.reduce((s, u) => s + (u.isIsolation && [...u.batches.keys()].some(b => !batchIds.has(b))
          ? 0 : u.capacity - simUsed(u)), 0);
        if (want > destSpace) {
          problems.push({ clause: op.clause, reason: `Not enough room where the birds went (space for ${destSpace}, ${want} moved).` });
          continue;
        }
        let toTake = want;
        const taken: { batchId: string; n: number }[] = [];
        const fromLabels: string[] = [];
        for (const u of available) {
          for (const [batchId, count] of u.batches) {
            if (toTake <= 0) break;
            const n = Math.min(count, toTake);
            toTake -= n;
            taken.push({ batchId, n });
            fromLabels.push(u.label);
            if (count - n > 0) u.batches.set(batchId, count - n); else u.batches.delete(batchId);
          }
          if (!u.batches.size) { u.isolationReason = null; u.origin = null; }
        }
        for (const t of taken) {
          let left = t.n;
          for (const u of dst) {
            if (left <= 0) break;
            if (u.isIsolation && [...u.batches.keys()].some(b => b !== t.batchId)) continue;
            const n = Math.min(u.capacity - simUsed(u), left);
            if (n <= 0) continue;
            u.batches.set(t.batchId, (u.batches.get(t.batchId) ?? 0) + n);
            left -= n;
            if (u.isIsolation) {
              u.isolationReason = op.isolationReason ?? u.isolationReason ?? 'Isolation';
              u.origin = originText([...(u.origin ? u.origin.split('; ') : []), ...fromLabels]);
            }
          }
        }
        steps.push({ clause: op.clause, summary: `Move ${want} bird(s): ${names(available)} → ${names(dst)}` });
      } else {
        const target = await this.resolveRef(db, sim, op.target, houseCode);
        if (typeof target === 'string') { problems.push({ clause: op.clause, reason: target }); continue; }
        const onLevels = !target[0].isIsolation;
        if (onLevels && (op.target.cages?.length || op.target.tiers?.length) && op.birdsPerCage > 0) {
          problems.push({
            clause: op.clause,
            reason: 'Records are per level — say how many birds are on the whole level, e.g. "A1 level 4 has 380 birds".',
          });
          continue;
        }
        remember(target);
        const n = op.birdsPerCage;
        const over = target.find(u => n > u.capacity);
        if (over) { problems.push({ clause: op.clause, reason: `${over.label} holds at most ${over.capacity} birds — ${n} stated.` }); continue; }
        // Isolation needs a source: birds can't appear in isolation without
        // saying where they were taken from.
        if (n > 0 && target.some(u => u.isIsolation && n > simUsed(u))) {
          problems.push({
            clause: op.clause,
            reason: 'Say where the isolated birds came from, e.g. "moved 2 birds from A1 level 3 to isolation cage 1".',
          });
          continue;
        }
        if (n > 0 && target.some(u => u.batches.size > 1)) {
          problems.push({ clause: op.clause, reason: 'That level holds several batches — change each batch on the map instead.' });
          continue;
        }
        if (n > 0 && target.some(u => u.batches.size === 0) && !fallbackBatchId) {
          problems.push({ clause: op.clause, reason: 'Some of these levels are empty — pick which batch the birds belong to.' });
          continue;
        }
        for (const u of target) {
          if (n === 0) { u.batches.clear(); u.isolationReason = null; u.origin = null; continue; }
          const batchId = [...u.batches.keys()][0] ?? fallbackBatchId!;
          u.batches = new Map([[batchId, n]]);
          if (u.isIsolation) u.isolationReason = op.isolationReason ?? u.isolationReason ?? 'Isolation';
        }
        const what = onLevels ? 'level' : 'isolation cage';
        steps.push({
          clause: op.clause,
          summary: n === 0
            ? `Empty ${target.length} ${what}(s) (${names(target)})`
            : `Set ${target.length} ${what}(s) to ${n} bird(s) each (${names(target)})`,
        });
      }
    }

    const changes: PlannedChange[] = [];
    for (const [id, before] of original) {
      const u = sim.units.get(id)!;
      for (const batchId of new Set([...before.keys(), ...u.batches.keys()])) {
        const b = before.get(batchId) ?? 0, a = u.batches.get(batchId) ?? 0;
        if (a === b) continue;
        changes.push({
          cageId: id, cageCode: u.code, cageLabel: u.label, rowId: u.rowId, batchId, beforeCount: b, afterCount: a,
          isolationReason: u.isIsolation ? u.isolationReason : null, origin: u.isIsolation ? u.origin : null,
        });
      }
    }
    changes.sort((a, b) => a.cageCode.localeCompare(b.cageCode, undefined, { numeric: true }));
    return { parsed, steps, problems, changes, ignored: parsed.ignored };
  }

  async previewReassignment(houseCode: string, input: any) {
    const description = String(input?.description ?? '').trim();
    if (!description) throw new BadRequestException('Describe where the birds were moved');
    await this.getBlockOrThrow(houseCode);
    const plan = await this.planReassignment(this.prisma, houseCode.toUpperCase(), description, input?.batchId || undefined);
    const birdsMoved = plan.changes.reduce((s, c) => s + Math.max(0, c.afterCount - c.beforeCount), 0);
    const codes = new Map((await this.prisma.batch.findMany({
      where: { id: { in: [...new Set(plan.changes.map(c => c.batchId))] } }, select: { id: true, batchCode: true },
    })).map(b => [b.id, b.batchCode]));
    return {
      steps: plan.steps,
      problems: plan.problems,
      ignored: plan.ignored,
      changes: plan.changes.map(c => ({ ...c, batchCode: codes.get(c.batchId) ?? null })),
      canApply: plan.problems.length === 0 && plan.changes.length > 0,
      birdsMoved,
    };
  }

  /**
   * Records a reassignment description. When everything in it is understood
   * it is applied to the map in one transaction; otherwise (or when the user
   * chooses) it is saved as a written note only — nothing typed is lost.
   */
  async recordReassignment(houseCode: string, input: any, userId: string) {
    const code = houseCode.toUpperCase();
    const description = String(input?.description ?? '').trim();
    if (!description) throw new BadRequestException('Describe where the birds were moved');
    await this.getBlockOrThrow(code);
    const effectiveDate = toDate(input?.effectiveDate);
    const noteOnly = input?.noteOnly === true;

    if (noteOnly) {
      return this.prisma.productionCageReassignment.create({
        data: {
          blockCode: code, batchId: input?.batchId || null, description, applied: false,
          appliedSummary: 'Saved as a note — map not changed.', effectiveDate, recordedById: userId,
        },
      });
    }

    const record = await this.prisma.$transaction(async (tx) => {
      const plan = await this.planReassignment(tx, code, description, input?.batchId || undefined);
      if (plan.problems.length) {
        throw new BadRequestException(
          'Some parts could not be applied — fix them or save as a note: ' +
          plan.problems.map(p => `"${p.clause}" — ${p.reason}`).join(' | '),
        );
      }
      if (!plan.changes.length) throw new BadRequestException('Nothing in the description changes the map — save it as a note instead.');
      const rows = new Set<string>();
      for (const ch of plan.changes) {
        if (ch.rowId) rows.add(ch.rowId);
        if (ch.afterCount === 0) {
          await tx.productionCageAssignment.deleteMany({ where: { cageId: ch.cageId, batchId: ch.batchId } });
          continue;
        }
        await tx.productionCageAssignment.upsert({
          where: { cageId_batchId: { cageId: ch.cageId, batchId: ch.batchId } },
          create: {
            cageId: ch.cageId, batchId: ch.batchId, birdCount: ch.afterCount, placedDate: effectiveDate,
            isolationReason: ch.isolationReason, origin: ch.origin, assignedById: userId, notes: 'Reassignment',
          },
          update: { birdCount: ch.afterCount, isolationReason: ch.isolationReason, origin: ch.origin, assignedById: userId },
        });
      }
      await this.recomputeRowRollups(tx, rows, userId);
      return tx.productionCageReassignment.create({
        data: {
          blockCode: code, batchId: input?.batchId || null, description,
          parsedJson: { steps: plan.steps, changes: plan.changes } as any,
          applied: true,
          appliedSummary: plan.steps.map(s => s.summary).join('; '),
          effectiveDate, recordedById: userId,
        },
      });
    }, { timeout: 30_000 });

    await this.flagOverCapacity(code);
    this.refresh();
    return record;
  }

  async listReassignments(houseCode: string) {
    return this.prisma.productionCageReassignment.findMany({
      where: { blockCode: houseCode.toUpperCase() },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
  }

  /** Director heads-up when a batch's placed birds exceed its live count. */
  private async flagOverCapacity(houseCode: string) {
    try {
      const block = await this.getBlockOrThrow(houseCode);
      const sums = await this.prisma.productionCageAssignment.groupBy({
        by: ['batchId'], where: { cage: { blockId: block.id } }, _sum: { birdCount: true },
      });
      for (const s of sums) {
        const total = await this.prisma.productionCageAssignment.aggregate({ where: { batchId: s.batchId }, _sum: { birdCount: true } });
        const batch = await this.prisma.batch.findUnique({ where: { id: s.batchId }, select: { batchCode: true, currentBirdCount: true } });
        const placed = total._sum.birdCount ?? 0;
        if (batch && placed > batch.currentBirdCount) {
          await this.notifications.notifyRole(
            UserRole.OWNER, 'BROODER_CAGE_REASSIGN_OVER_CAPACITY' as any,
            `Production house map exceeds live bird count — ${batch.batchCode}`,
            `After a reassignment, ${batch.batchCode} has ${placed} birds on the production house map but ` +
            `${batch.currentBirdCount} live birds on record. Please review.`,
            { entityId: s.batchId, entityType: 'Batch' },
          ).catch(() => {});
        }
      }
    } catch (err) {
      this.logger.warn(`Over-capacity check failed: ${(err as Error).message}`);
    }
  }
}
