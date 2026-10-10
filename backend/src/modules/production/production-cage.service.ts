// src/modules/production/production-cage.service.ts
//
// Per-cage production house map (Block 1 and Block 2).
//
// Layout of each house: sections A, B, C × rows 1, 2 (A1 … C2). Every row has
// 4 levels (1 = bottom … 4 = top, same order as the brooder), each level has
// `tiersPerLevel` tiers (Block 1: 24, Block 2: 38) and every tier has 4 cages.
// Plus 8 isolation cages per house. A cage holds at most 4 birds.
//
// Cages are addressed by a stable code — BLK1-A1-L4-T07-C2, BLK2-ISO-3 — so
// the UI can build the full grid from the block dimensions and only needs the
// occupied cages from the server. BatchCageAssignment (one batch per row) is
// kept as an automatic per-row rollup so existing row-level reports, HDP and
// culling logic keep working.

import {
  BadRequestException, ConflictException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BatchStage, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../../common/notifications/notifications.service';
import { DASHBOARD_REFRESH_EVENT } from '../../common/events/app-event-bus';
import { RequestUser } from '../../auth/types/request-user.type';
import { CageRef, ParsedCageOp, parseProductionCageText } from './production-cage-text.util';

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

export interface MortalityCageEntry {
  cageCode: string;
  count: number;
  cause?: string | null;
}

export interface SimCage {
  id: string;
  code: string;
  label: string;
  rowId: string | null;
  capacity: number;
  isIsolation: boolean;
  batchId: string | null;
  birdCount: number;
  isolationReason: string | null;
}

export interface PlannedChange {
  cageId: string;
  cageCode: string;
  cageLabel: string;
  beforeBatchId: string | null;
  beforeCount: number;
  afterBatchId: string | null;
  afterCount: number;
  isolationReason: string | null;
}

const toDate = (s?: string | null) => {
  const d = s ? new Date(s) : new Date();
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`Invalid date: ${s}`);
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
};

@Injectable()
export class ProductionCageService {
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
    const where: Prisma.ProductionCageWhereInput = {
      blockId: block.id, isActive: true, isIsolation: false,
      ...(rowCodes?.length ? { row: { rowCode: { in: rowCodes.map(r => r.toUpperCase()) } } } : {}),
    };
    const [totalCages, emptyCages, birds] = await Promise.all([
      db.productionCage.count({ where }),
      db.productionCage.count({ where: { ...where, assignment: { is: null } } }),
      db.productionCageAssignment.aggregate({ where: { cage: where }, _sum: { birdCount: true } }),
    ]);
    return {
      code: block.code,
      name: block.name,
      isActive: block.isActive && !block.isUnderConstruction,
      totalCages,
      occupiedCages: totalCages - emptyCages,
      emptyCages,
      birds: birds._sum.birdCount ?? 0,
      capacityBirds: totalCages * block.birdsPerCage,
      /** Birds that can still be placed into completely empty cages. */
      freeSpaces: block.isActive && !block.isUnderConstruction ? emptyCages * block.birdsPerCage : 0,
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

    const assignments = await this.prisma.productionCageAssignment.findMany({
      where: { cage: { blockId: block.id } },
      include: {
        cage: {
          select: {
            id: true, code: true, label: true, levelNumber: true, tierNumber: true, cageNumber: true,
            isIsolation: true, capacity: true, row: { select: { rowCode: true } },
          },
        },
        batch: { select: { id: true, batchCode: true, currentBirdCount: true, dateOfHatch: true, stage: true } },
      },
    });

    const since = new Date();
    since.setDate(since.getDate() - 7);
    const mortality = await this.prisma.productionCageMortalityLog.groupBy({
      by: ['cageId'],
      where: { cage: { blockId: block.id }, logDate: { gte: since } },
      _sum: { count: true },
    });
    const mortalityByCage = new Map(mortality.map(m => [m.cageId, m._sum.count ?? 0]));

    const batches = new Map<string, { id: string; batchCode: string; birds: number; cages: number; currentBirdCount: number; dateOfHatch: Date; stage: BatchStage }>();
    for (const a of assignments) {
      const b = batches.get(a.batchId) ?? {
        id: a.batch.id, batchCode: a.batch.batchCode, birds: 0, cages: 0,
        currentBirdCount: a.batch.currentBirdCount, dateOfHatch: a.batch.dateOfHatch, stage: a.batch.stage,
      };
      b.birds += a.birdCount;
      b.cages += 1;
      batches.set(a.batchId, b);
    }

    const cap = await this.capacity(block.code);
    return {
      block: {
        id: block.id, code: block.code, name: block.name,
        isActive: block.isActive, isUnderConstruction: block.isUnderConstruction,
        levelsPerRow: block.levelsPerRow, tiersPerLevel: block.tiersPerLevel,
        cagesPerTier: block.cagesPerTier, birdsPerCage: block.birdsPerCage,
        isolationCageCount: block.isolationCageCount,
      },
      sections: block.farm_sections.map(s => ({
        code: s.code,
        rows: s.farm_rows.map(r => ({ rowId: r.id, rowCode: r.rowCode, isActive: r.isActive })),
      })),
      occupied: assignments.map(a => ({
        cageId: a.cage.id,
        code: a.cage.code,
        label: a.cage.label,
        rowCode: a.cage.row?.rowCode ?? null,
        level: a.cage.levelNumber,
        tier: a.cage.tierNumber,
        cage: a.cage.cageNumber,
        isIsolation: a.cage.isIsolation,
        capacity: a.cage.capacity,
        batchId: a.batchId,
        batchCode: a.batch.batchCode,
        birdCount: a.birdCount,
        isolationReason: a.isolationReason,
        placedDate: a.placedDate,
        mortality7d: mortalityByCage.get(a.cage.id) ?? 0,
      })),
      batches: [...batches.values()],
      totals: cap,
    };
  }

  /** Cage codes are deterministic; resolve a list of them inside one block. */
  private async cagesByCode(db: Db, blockId: string, codes: string[]) {
    const cages = await db.productionCage.findMany({
      where: { blockId, code: { in: codes.map(c => c.toUpperCase()) }, isActive: true },
      include: { assignment: true },
    });
    const missing = codes.filter(c => !cages.some(cg => cg.code === c.toUpperCase()));
    if (missing.length) throw new BadRequestException(`Unknown cage(s): ${missing.join(', ')}`);
    return cages;
  }

  // ── Row rollup (BatchCageAssignment) ───────────────────────────────────

  /** Per row: the batch with the most birds in that row's cages becomes the
   *  row's BatchCageAssignment, birdCount = that batch's birds in the row. A
   *  row whose cages are all empty loses its rollup. */
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
          notes: 'Auto-maintained rollup of this row\'s cages.', assignedById: userId,
        },
        update: { batchId, birdCount: top.birds },
      });
    }
  }

  // ── Manual assign / fill / remove ─────────────────────────────────────

  async assignCages(code: string, input: any, userId: string) {
    const cageCodes: string[] = Array.isArray(input?.cageCodes) ? input.cageCodes.map(String) : [];
    if (!cageCodes.length) throw new BadRequestException('Pick at least one cage');
    const birdCount = Number(input?.birdCount);
    if (!Number.isInteger(birdCount) || birdCount < 0) throw new BadRequestException('birdCount must be a whole number ≥ 0');
    const placedDate = toDate(input?.placedDate);
    const block = await this.getBlockOrThrow(code);
    if (birdCount > block.birdsPerCage) {
      throw new BadRequestException(`A cage holds at most ${block.birdsPerCage} birds`);
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const cages = await this.cagesByCode(tx, block.id, cageCodes);
      const batchId: string | undefined = input?.batchId || undefined;
      if (birdCount > 0) {
        for (const c of cages) {
          const target = batchId ?? c.assignment?.batchId;
          if (!target) throw new BadRequestException(`Pick a batch for ${c.label}`);
          if (c.assignment && c.assignment.batchId !== target) {
            throw new ConflictException(`${c.label} already holds another batch — empty it first`);
          }
        }
        if (batchId) await this.assertPlaceableBatch(tx, batchId);
      }
      for (const c of cages) {
        if (birdCount === 0) {
          await tx.productionCageAssignment.deleteMany({ where: { cageId: c.id } });
          continue;
        }
        const target = (batchId ?? c.assignment!.batchId) as string;
        const isolationReason = c.isIsolation ? (input?.isolationReason?.trim() || c.assignment?.isolationReason || 'Isolation') : null;
        await tx.productionCageAssignment.upsert({
          where: { cageId: c.id },
          create: {
            cageId: c.id, batchId: target, birdCount, placedDate, isolationReason,
            notes: input?.notes ?? null, assignedById: userId,
          },
          update: { batchId: target, birdCount, isolationReason, notes: input?.notes ?? undefined, assignedById: userId },
        });
      }
      await this.recomputeRowRollups(tx, cages.map(c => c.rowId!).filter(Boolean), userId);
      return { cagesUpdated: cages.length, birdCount };
    });
    this.refresh();
    return result;
  }

  async removeCage(code: string, cageCode: string, userId: string) {
    return this.assignCages(code, { cageCodes: [cageCode], birdCount: 0 }, userId);
  }

  /** Fills EMPTY cages within a row/level/tier scope for one batch. */
  async fillCages(code: string, input: any, userId: string) {
    const block = await this.getBlockOrThrow(code);
    const batchId = String(input?.batchId ?? '');
    if (!batchId) throw new BadRequestException('Pick a batch');
    const birdsPerCage = Number(input?.birdsPerCage ?? block.birdsPerCage);
    if (!Number.isInteger(birdsPerCage) || birdsPerCage < 1 || birdsPerCage > block.birdsPerCage) {
      throw new BadRequestException(`Birds per cage must be between 1 and ${block.birdsPerCage}`);
    }
    const totalBirds = input?.totalBirds != null && input.totalBirds !== '' ? Number(input.totalBirds) : null;
    const placedDate = toDate(input?.placedDate);

    const result = await this.prisma.$transaction(async (tx) => {
      await this.assertPlaceableBatch(tx, batchId);
      const cages = await tx.productionCage.findMany({
        where: {
          blockId: block.id, isActive: true, isIsolation: false, assignment: { is: null },
          ...(input?.rowCode ? { row: { rowCode: String(input.rowCode).toUpperCase() } } : {}),
          ...(input?.level ? { levelNumber: Number(input.level) } : {}),
          ...(input?.tier ? { tierNumber: Number(input.tier) } : {}),
        },
        orderBy: [{ levelNumber: 'desc' }, { tierNumber: 'asc' }, { cageNumber: 'asc' }],
      });
      if (!cages.length) throw new BadRequestException('No empty cages in that part of the house');
      let remaining = totalBirds ?? cages.length * birdsPerCage;
      if (totalBirds != null && totalBirds > cages.length * birdsPerCage) {
        throw new BadRequestException(
          `Only ${cages.length} empty cages here (${cages.length * birdsPerCage} birds at ${birdsPerCage}/cage) — ${totalBirds} requested`,
        );
      }
      let placed = 0, used = 0;
      for (const c of cages) {
        if (remaining <= 0) break;
        const n = Math.min(birdsPerCage, remaining);
        await tx.productionCageAssignment.create({
          data: { cageId: c.id, batchId, birdCount: n, placedDate, assignedById: userId, notes: input?.notes ?? null },
        });
        remaining -= n; placed += n; used += 1;
      }
      await this.recomputeRowRollups(tx, cages.map(c => c.rowId!).filter(Boolean), userId);
      return { cagesFilled: used, birdsPlaced: placed };
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
   * Places birds of a batch into EMPTY cages of a house, 4 per cage (the last
   * cage takes the remainder), top level first, tier 1 onwards. Each
   * placement may be pinned to a row; unpinned placements use any row.
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
      const cages = await db.productionCage.findMany({
        where: {
          blockId: block.id, isActive: true, isIsolation: false, assignment: { is: null },
          ...(p.rowCode ? { row: { rowCode: p.rowCode.toUpperCase() } } : {}),
        },
        include: { row: { select: { rowCode: true, section: { select: { sortOrder: true } } } } },
      });
      cages.sort((a, b) =>
        (a.row!.section.sortOrder - b.row!.section.sortOrder) ||
        a.row!.rowCode.localeCompare(b.row!.rowCode) ||
        ((b.levelNumber ?? 0) - (a.levelNumber ?? 0)) ||
        ((a.tierNumber ?? 0) - (b.tierNumber ?? 0)) ||
        (a.cageNumber - b.cageNumber));
      const space = cages.length * block.birdsPerCage;
      if (p.birds > space) {
        throw new BadRequestException(
          `${block.name}${p.rowCode ? ` row ${p.rowCode.toUpperCase()}` : ''} has room for ${space} more birds ` +
          `(${cages.length} empty cages × ${block.birdsPerCage}) — ${p.birds} requested.`,
        );
      }
      let remaining = p.birds;
      const rows: Prisma.ProductionCageAssignmentCreateManyInput[] = [];
      for (const c of cages) {
        if (remaining <= 0) break;
        const n = Math.min(block.birdsPerCage, remaining);
        rows.push({
          cageId: c.id, batchId: args.batchId, birdCount: n, placedDate: args.placedDate,
          assignedById: args.userId, notes: 'Placed on transfer into the production house',
        });
        remaining -= n;
        if (c.rowId) touchedRows.add(c.rowId);
      }
      await db.productionCageAssignment.createMany({ data: rows });
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
   * when the chosen house — or both houses — have no empty cages left.
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
      throw new BadRequestException('Both production houses are full — no birds can be transferred until cages are freed.');
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

  // ── Per-cage mortality (egg collection) ───────────────────────────────

  /** Validates an attendant's per-cage mortality list against the house and
   *  returns it with cage ids/labels resolved (stored on the session). */
  async resolveMortalityEntries(houseCode: string, entries: MortalityCageEntry[]) {
    const clean = (entries ?? []).filter(e => e && e.cageCode && Number(e.count) > 0);
    if (!clean.length) return [];
    const block = await this.getBlockOrThrow(houseCode);
    const cages = await this.cagesByCode(this.prisma, block.id, clean.map(e => e.cageCode));
    const byCode = new Map(cages.map(c => [c.code, c]));
    const merged = new Map<string, { cageId: string; cageCode: string; cageLabel: string; count: number; cause: string | null; batchId: string | null }>();
    for (const e of clean) {
      const c = byCode.get(e.cageCode.toUpperCase())!;
      if (!Number.isInteger(Number(e.count))) throw new BadRequestException(`Mortality for ${c.label} must be a whole number`);
      const cur = merged.get(c.id) ?? {
        cageId: c.id, cageCode: c.code, cageLabel: c.label, count: 0,
        cause: e.cause?.trim() || null, batchId: c.assignment?.batchId ?? null,
      };
      cur.count += Number(e.count);
      merged.set(c.id, cur);
    }
    for (const m of merged.values()) {
      const c = byCode.get(m.cageCode)!;
      if (!c.assignment) throw new BadRequestException(`${c.label} is empty on the cage map — record the bird there first`);
      if (m.count > c.assignment.birdCount) {
        throw new BadRequestException(`${c.label} only has ${c.assignment.birdCount} bird(s) — ${m.count} mortalities entered`);
      }
    }
    return [...merged.values()];
  }

  /** Applies a session's per-cage mortalities once the Manager approves it:
   *  cage counts drop, a mortality log is written per cage, the batch's live
   *  count drops and the row rollups are refreshed. Idempotent. */
  async applySessionMortalities(sessionId: string, userId: string) {
    const session = await this.prisma.eggCollectionSession.findUnique({ where: { id: sessionId } });
    if (!session || session.mortalitiesAppliedAt) return null;
    const entries = (Array.isArray(session.mortalityCagesJson) ? session.mortalityCagesJson : []) as any[];
    if (!entries.length) return null;

    const result = await this.prisma.$transaction(async (tx) => {
      const rows = new Set<string>();
      const byBatch = new Map<string, number>();
      for (const e of entries) {
        const cage = await tx.productionCage.findUnique({ where: { id: String(e.cageId) }, include: { assignment: true } });
        if (!cage) continue;
        const count = Math.max(0, Number(e.count) || 0);
        if (!count) continue;
        const batchId = cage.assignment?.batchId ?? e.batchId ?? session.batchId;
        if (cage.assignment) {
          const left = cage.assignment.birdCount - count;
          if (left > 0) await tx.productionCageAssignment.update({ where: { id: cage.assignment.id }, data: { birdCount: left } });
          else await tx.productionCageAssignment.delete({ where: { id: cage.assignment.id } });
        }
        await tx.productionCageMortalityLog.create({
          data: {
            cageId: cage.id, batchId, sessionId, logDate: session.sessionDate, count,
            cause: e.cause ?? null, notes: `${session.shift} egg collection`, recordedById: session.collectedById,
          },
        });
        if (cage.rowId) rows.add(cage.rowId);
        byBatch.set(batchId, (byBatch.get(batchId) ?? 0) + count);
      }
      for (const [batchId, n] of byBatch) {
        const b = await tx.batch.findUnique({ where: { id: batchId }, select: { currentBirdCount: true } });
        if (b) await tx.batch.update({ where: { id: batchId }, data: { currentBirdCount: Math.max(0, b.currentBirdCount - n) } });
      }
      await this.recomputeRowRollups(tx, rows, userId);
      await tx.eggCollectionSession.update({ where: { id: sessionId }, data: { mortalitiesAppliedAt: new Date() } });
      return { cages: entries.length, birds: [...byBatch.values()].reduce((s, n) => s + n, 0) };
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
    return { blocks, cages: new Map<string, SimCage>() };
  }

  private async resolveRef(db: Db, sim: { blocks: any[]; cages: Map<string, SimCage> }, ref: CageRef, defaultCode: string): Promise<SimCage[] | string> {
    const code = ref.blockCode ?? defaultCode;
    const block = sim.blocks.find(b => b.code === code);
    if (!block) return `Production house ${code} not found.`;
    if (!ref.isolation && !ref.rowCode) return 'Say which row (A1, A2, B1, B2, C1, C2) or isolation cage.';
    const where: Prisma.ProductionCageWhereInput = {
      blockId: block.id, isActive: true, isIsolation: !!ref.isolation,
      ...(ref.rowCode ? { row: { rowCode: ref.rowCode } } : {}),
      ...(ref.levels?.length ? { levelNumber: { in: ref.levels } } : {}),
      ...(ref.tiers?.length ? { tierNumber: { in: ref.tiers } } : {}),
      ...(ref.cages?.length ? { cageNumber: { in: ref.cages } } : {}),
    };
    const cages = await db.productionCage.findMany({
      where, include: { assignment: true },
      orderBy: [{ levelNumber: 'desc' }, { tierNumber: 'asc' }, { cageNumber: 'asc' }],
    });
    if (!cages.length) {
      const bits = [ref.isolation ? 'isolation' : ref.rowCode,
        ref.levels?.length ? `level ${ref.levels.join(',')}` : '',
        ref.tiers?.length ? `tier ${ref.tiers.join(',')}` : '',
        ref.cages?.length ? `cage ${ref.cages.join(',')}` : ''].filter(Boolean).join(' ');
      return `No such cage in ${block.name}: ${bits}.`;
    }
    return cages.map(c => {
      const existing = sim.cages.get(c.id);
      if (existing) return existing;
      const s: SimCage = {
        id: c.id, code: c.code, label: `${block.code === 'BLK2' ? 'Block 2' : 'Block 1'} ${c.label}`,
        rowId: c.rowId, capacity: c.capacity, isIsolation: c.isIsolation,
        batchId: c.assignment?.batchId ?? null, birdCount: c.assignment?.birdCount ?? 0,
        isolationReason: c.assignment?.isolationReason ?? null,
      };
      sim.cages.set(c.id, s);
      return s;
    });
  }

  /** Works out every cage change a description implies, without writing. */
  private async planReassignment(db: Db, houseCode: string, description: string, fallbackBatchId?: string) {
    const parsed = parseProductionCageText(description);
    const sim = await this.loadSim(db);
    const original = new Map<string, { batchId: string | null; birdCount: number }>();
    const remember = (cs: SimCage[]) => cs.forEach(c => {
      if (!original.has(c.id)) original.set(c.id, { batchId: c.batchId, birdCount: c.birdCount });
    });
    const steps: { clause: string; summary: string }[] = [];
    const problems = [...parsed.problems];

    for (const op of parsed.ops) {
      if (op.kind === 'MOVE') {
        const src = await this.resolveRef(db, sim, op.from, houseCode);
        const dst = await this.resolveRef(db, sim, op.to, houseCode);
        if (typeof src === 'string') { problems.push({ clause: op.clause, reason: `From: ${src}` }); continue; }
        if (typeof dst === 'string') { problems.push({ clause: op.clause, reason: `To: ${dst}` }); continue; }
        remember(src); remember(dst);
        const available = src.filter(c => c.birdCount > 0);
        const have = available.reduce((s, c) => s + c.birdCount, 0);
        const want = op.count ?? have;
        if (have === 0) { problems.push({ clause: op.clause, reason: 'The cage(s) moved from have no birds on the map.' }); continue; }
        if (want > have) { problems.push({ clause: op.clause, reason: `Only ${have} bird(s) in the cage(s) moved from — ${want} stated.` }); continue; }
        const batchIds = new Set(available.map(c => c.batchId));
        const destSpace = dst.reduce((s, c) =>
          s + (c.batchId && !batchIds.has(c.batchId) ? 0 : c.capacity - c.birdCount), 0);
        if (want > destSpace) {
          problems.push({ clause: op.clause, reason: `Not enough room where the birds went (space for ${destSpace}, ${want} moved; 4 birds max per cage).` });
          continue;
        }
        let toTake = want;
        const taken: { batchId: string; n: number }[] = [];
        for (const c of available) {
          if (toTake <= 0) break;
          const n = Math.min(c.birdCount, toTake);
          c.birdCount -= n; toTake -= n;
          taken.push({ batchId: c.batchId!, n });
          if (c.birdCount === 0) { c.batchId = null; c.isolationReason = null; }
        }
        for (const t of taken) {
          let left = t.n;
          for (const c of dst) {
            if (left <= 0) break;
            if (c.batchId && c.batchId !== t.batchId) continue;
            const n = Math.min(c.capacity - c.birdCount, left);
            if (n <= 0) continue;
            c.batchId = t.batchId; c.birdCount += n; left -= n;
            if (c.isIsolation) c.isolationReason = op.isolationReason ?? c.isolationReason ?? 'Isolation';
          }
        }
        steps.push({
          clause: op.clause,
          summary: `Move ${want} bird(s): ${available.map(c => c.label).slice(0, 3).join(', ')}${available.length > 3 ? '…' : ''} → ` +
            `${dst.map(c => c.label).slice(0, 3).join(', ')}${dst.length > 3 ? '…' : ''}`,
        });
      } else {
        const target = await this.resolveRef(db, sim, op.target, houseCode);
        if (typeof target === 'string') { problems.push({ clause: op.clause, reason: target }); continue; }
        remember(target);
        if (op.birdsPerCage > Math.min(...target.map(c => c.capacity))) {
          problems.push({ clause: op.clause, reason: `A cage holds at most ${target[0].capacity} birds — ${op.birdsPerCage} stated.` });
          continue;
        }
        const needsBatch = op.birdsPerCage > 0 && target.some(c => !c.batchId) && !fallbackBatchId;
        if (needsBatch) {
          problems.push({ clause: op.clause, reason: 'Some of these cages are empty — pick which batch the birds belong to.' });
          continue;
        }
        for (const c of target) {
          if (op.birdsPerCage === 0) { c.batchId = null; c.birdCount = 0; c.isolationReason = null; continue; }
          c.batchId = c.batchId ?? fallbackBatchId!;
          c.birdCount = op.birdsPerCage;
          if (c.isIsolation) c.isolationReason = op.isolationReason ?? c.isolationReason ?? 'Isolation';
        }
        steps.push({
          clause: op.clause,
          summary: op.birdsPerCage === 0
            ? `Empty ${target.length} cage(s) (${target[0].label}${target.length > 1 ? ' …' : ''})`
            : `Set ${target.length} cage(s) to ${op.birdsPerCage} bird(s) each (${target[0].label}${target.length > 1 ? ' …' : ''})`,
        });
      }
    }

    const changes: PlannedChange[] = [];
    for (const [id, before] of original) {
      const c = sim.cages.get(id)!;
      if (before.batchId === c.batchId && before.birdCount === c.birdCount) continue;
      changes.push({
        cageId: id, cageCode: c.code, cageLabel: c.label,
        beforeBatchId: before.batchId, beforeCount: before.birdCount,
        afterBatchId: c.batchId, afterCount: c.birdCount, isolationReason: c.isolationReason,
      });
    }
    changes.sort((a, b) => a.cageCode.localeCompare(b.cageCode, undefined, { numeric: true }));
    return { parsed, steps, problems, changes, ignored: parsed.ignored };
  }

  async previewReassignment(houseCode: string, input: any) {
    const description = String(input?.description ?? '').trim();
    if (!description) throw new BadRequestException('Describe where the birds were moved');
    await this.getBlockOrThrow(houseCode);
    const plan = await this.planReassignment(this.prisma, houseCode.toUpperCase(), description, input?.batchId || undefined);
    const birdsMoved = plan.changes.reduce((s, c) => s + Math.max(0, c.afterCount - (c.beforeBatchId === c.afterBatchId ? c.beforeCount : 0)), 0);
    return {
      steps: plan.steps,
      problems: plan.problems,
      ignored: plan.ignored,
      changes: plan.changes,
      canApply: plan.problems.length === 0 && plan.changes.length > 0,
      birdsMoved,
    };
  }

  /**
   * Records a reassignment description. When everything in it is understood
   * it is applied to the cage map in one transaction; otherwise (or when the
   * user chooses) it is saved as a written note only — nothing typed is lost.
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
          appliedSummary: 'Saved as a note — cage map not changed.', effectiveDate, recordedById: userId,
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
      if (!plan.changes.length) throw new BadRequestException('Nothing in the description changes the cage map — save it as a note instead.');
      const rows = new Set<string>();
      for (const ch of plan.changes) {
        const cage = await tx.productionCage.findUnique({ where: { id: ch.cageId }, select: { rowId: true } });
        if (cage?.rowId) rows.add(cage.rowId);
        if (!ch.afterBatchId || ch.afterCount === 0) {
          await tx.productionCageAssignment.deleteMany({ where: { cageId: ch.cageId } });
          continue;
        }
        await tx.productionCageAssignment.upsert({
          where: { cageId: ch.cageId },
          create: {
            cageId: ch.cageId, batchId: ch.afterBatchId, birdCount: ch.afterCount, placedDate: effectiveDate,
            isolationReason: ch.isolationReason, assignedById: userId, notes: 'Cage reassignment',
          },
          update: { batchId: ch.afterBatchId, birdCount: ch.afterCount, isolationReason: ch.isolationReason, assignedById: userId },
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

  /** Director heads-up when a batch's caged birds exceed its live count. */
  private async flagOverCapacity(houseCode: string) {
    try {
      const block = await this.getBlockOrThrow(houseCode);
      const sums = await this.prisma.productionCageAssignment.groupBy({
        by: ['batchId'], where: { cage: { blockId: block.id } }, _sum: { birdCount: true },
      });
      for (const s of sums) {
        const total = await this.prisma.productionCageAssignment.aggregate({ where: { batchId: s.batchId }, _sum: { birdCount: true } });
        const batch = await this.prisma.batch.findUnique({ where: { id: s.batchId }, select: { batchCode: true, currentBirdCount: true } });
        const caged = total._sum.birdCount ?? 0;
        if (batch && caged > batch.currentBirdCount) {
          await this.notifications.notifyRole(
            UserRole.OWNER, 'BROODER_CAGE_REASSIGN_OVER_CAPACITY' as any,
            `Production cage map exceeds live bird count — ${batch.batchCode}`,
            `After a cage reassignment, ${batch.batchCode} has ${caged} birds on the production cage map but ` +
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
