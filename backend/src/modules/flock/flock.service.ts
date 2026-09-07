import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BatchStage, BirdType, EntryStatus, Prisma } from '@prisma/client';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import { StoreInventoryService } from '../store/store-inventory.service';

dayjs.extend(isoWeek);

/**
 * FlockService — handles batch lifecycle (registration, listing, culling) and
 * the daily entry workflow used by the Production Manager.
 *
 * The frontend submits a relaxed shape (supplierName instead of supplierId,
 * optional houseId, vaccinatedOnArrival vs vaccinationOnArrival). We normalise
 * here so the production manager's "New Batch" form actually persists.
 */
@Injectable()
export class FlockService {
  private readonly logger = new Logger(FlockService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storeInventory: StoreInventoryService,
  ) {}

  // A vaccine/supplement/treatment can be logged against any active store
  // item in the right category — it no longer has to have been issued
  // (stock-out'd) first. Feed, and bulk-issued supplements/treatments
  // especially, are often physically handed to the attendant before Store
  // gets round to logging the stock-out in the system (or a supplement is
  // issued once in bulk and drawn down across many later days). Blocking
  // the log entry until Store's record catches up just meant the attendant
  // couldn't record what actually happened; instead, once Store does log
  // the issuance, checkResidualOrWarn (below) ties the recorded amount back
  // to it and flags any surplus/over-issuance rather than gating on it.
  //
  // Still returns the store item so its `unit` can be snapshotted onto the
  // log entry server-side — the unit must come from the store item itself,
  // never from whatever the client happens to send, or the residual
  // subtraction (issued qty - dispensed qty) could silently compare
  // mismatched units.
  private async getIssuedStoreItemOrThrow(storeItemId: string) {
    const item = await this.prisma.storeItem.findUnique({
      where: { id: storeItemId },
      select: { unit: true, isActive: true },
    });
    if (!item || !item.isActive) throw new BadRequestException('Store item not found.');
    return item;
  }

  // Soft stock check — no longer blocks the write. It still computes the
  // residual (issued - dispensed, all-time, minus whatever this same
  // request has already reserved against the same item) and, if the
  // amount being recorded runs past it, logs a warning so Store/PM can see
  // the surplus/over-issuance and follow up — the attendant's entry is not
  // rejected for it. This matters most for feed and bulk-issued
  // supplements/treatments, which are routinely recorded before (or
  // independent of) that day's Store issuance.
  //
  // `alreadyReserved` lets callers account for other entries in the SAME
  // request that draw against the same storeItemId (e.g. two vaccines in
  // one daily log both linked to the same bottle) — the DB doesn't know
  // about those yet since none have been written when this runs.
  private async checkResidualOrWarn(
    storeItemId: string,
    quantityRequested: number,
    alreadyReserved: number,
    unit: string | null,
    context: string,
  ): Promise<number> {
    const residualInfo = await this.storeInventory.getResidualForItem(storeItemId);
    const residualBefore = (residualInfo?.residual ?? 0) - alreadyReserved;
    if (quantityRequested > residualBefore) {
      this.logger.warn(
        `[StockSurplus] ${context}: storeItemId=${storeItemId} requested=${quantityRequested}${unit ?? ''} ` +
        `exceeds residual=${Math.max(0, residualBefore).toFixed(3)}${unit ?? ''} — recorded anyway, ` +
        `flagged for Store/PM follow-up.`,
      );
    }
    return residualBefore - quantityRequested;
  }

  // ── Batches ────────────────────────────────────────────────────────────────

  async listBatches(filters: { isActive?: boolean; houseId?: string; stage?: string }) {
    return this.prisma.batch.findMany({
      where: {
        deletedAt: null,
        ...(filters.isActive !== undefined ? { isActive: filters.isActive } : {}),
        ...(filters.houseId ? { houseId: filters.houseId } : {}),
        ...(filters.stage ? { stage: filters.stage as any } : {}),
      },
      include: {
        house: { select: { id: true, name: true, code: true } },
        supplier: { select: { id: true, name: true } },
        _count: { select: { flockEntries: true, brooderLogs: true, eggCollectionSessions: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getBatch(id: string) {
    const batch = await this.prisma.batch.findUnique({
      where: { id },
      include: {
        house: true,
        supplier: true,
        _count: { select: { flockEntries: true, brooderLogs: true, eggCollectionSessions: true } },
      },
    });
    if (!batch) throw new NotFoundException('Batch not found');
    return batch;
  }

  async createBatch(input: any, userId: string) {
    if (!input?.batchCode) throw new BadRequestException('batchCode is required');
    if (!input?.birdType) throw new BadRequestException('birdType is required');

    const quantity = Number(input.quantityReceived);
    if (!Number.isFinite(quantity) || quantity < 1) {
      throw new BadRequestException('quantityReceived must be a positive number');
    }

    const dateOfHatch = input.dateOfHatch ? new Date(input.dateOfHatch) : null;
    if (!dateOfHatch || Number.isNaN(dateOfHatch.getTime())) {
      throw new BadRequestException('dateOfHatch is required (YYYY-MM-DD)');
    }
    const dateReceived = input.dateReceived ? new Date(input.dateReceived) : new Date();

    // Reject duplicate batch codes early with a clear message
    const dupe = await this.prisma.batch.findUnique({
      where: { batchCode: input.batchCode },
      select: { id: true },
    });
    if (dupe) throw new BadRequestException(`Batch code "${input.batchCode}" is already in use`);

    // Determine location first — needed for duplicate check and stage derivation
    const location: string = input.location ?? 'BROODER';

    // Prevent duplicate active production house batch (only one block exists)
    if (location === 'PRODUCTION_HOUSE') {
      const existingProductionBatch = await this.prisma.batch.findFirst({
        where: {
          location: 'PRODUCTION_HOUSE',
          isActive: true,
          deletedAt: null,
          stage: { notIn: ['SOLD', 'DISCARDED', 'CLOSED'] as BatchStage[] },
        },
        select: { batchCode: true },
      });
      if (existingProductionBatch) {
        throw new BadRequestException(
          `An active batch (${existingProductionBatch.batchCode}) already exists in the Production House. Sell, discard, or close it before creating a new one.`,
        );
      }
    }

    const supplier = await this.resolveSupplier(input.supplierId, input.supplierName);
    const house = await this.resolveHouse(input.houseId, input.birdType as BirdType);

    // Determine stage from location — production house chickens are NEVER brooding
    let stage: BatchStage;
    if (input.stage && Object.values(BatchStage).includes(input.stage as BatchStage)) {
      stage = input.stage as BatchStage;
    } else {
      stage = location === 'PRODUCTION_HOUSE' ? BatchStage.PRODUCTION : BatchStage.BROODING;
    }
    const vaccinationOnArrival = Boolean(
      input.vaccinationOnArrival ?? input.vaccinatedOnArrival ?? false,);

    const notesParts: string[] = [];
    if (input.notes) notesParts.push(String(input.notes));
    if (input.batchAge) notesParts.push(`Batch age on arrival: ${input.batchAge}`);
    if (input.birdBreed) notesParts.push(`Bird breed: ${input.birdBreed}`);
    if (input.arrivalWeightKg != null) notesParts.push(`Arrival weight: ${input.arrivalWeightKg} kg/bird`);
    if (vaccinationOnArrival && input.vaccinesGiven) {
      notesParts.push(`Vaccines on arrival: ${input.vaccinesGiven}`);
    }
    // FIX H1: Row placements stored in notes AND BatchCageAssignment records created.
    // Per PM Sequence Diagram – Register Batch: assignHouse() → allocateBirds()
    if (Array.isArray(input.rowPlacements) && input.rowPlacements.length) {
      notesParts.push(
        'Row placements: ' +
        input.rowPlacements
          .map((r: any) => `${r.rowCode}=${r.birdCount}`)
          .join(', '),
      );
    }

    // Brooder cage-map CAGE placements — stored in notes AND
    // BrooderCageAssignment records created atomically. Population,
    // mortality, reassignment, and weighing are tracked per cage; the
    // level's BrooderLevelAssignment is an auto-maintained rollup.
    // Format: [{ cageId: string, birdCount: number, notes?: string }]
    if (Array.isArray(input.brooderCagePlacements) && input.brooderCagePlacements.length) {
      // Validate total matches quantityReceived
      const placedTotal = input.brooderCagePlacements.reduce(
        (sum: number, p: any) => sum + (Number(p.birdCount) || 0),
        0,
      );
      // Allow partial placement (PM may leave some cells unassigned initially)
      // but reject if placed total exceeds quantity received
      if (placedTotal > quantity) {
        throw new BadRequestException(
          `Brooder cage placements total (${placedTotal}) exceeds Quantity Received (${quantity}).`,
        );
      }
      notesParts.push(
        'Brooder cage placements: ' +
        input.brooderCagePlacements
          .map((p: any) => `cage:${p.cageId}=${p.birdCount}`)
          .join(', '),
      );
    }

    try {
      // Transaction: batch creation + cage assignments are atomic
      const result = await this.prisma.$transaction(async (tx) => {
        const batch = await tx.batch.create({
          data: {
            batchCode: String(input.batchCode).trim(),
            supplierId: supplier.id,
            houseId: house.id,
            birdType: input.birdType as BirdType,
            strain: input.strain ?? String(input.birdType).replace(/_/g, ' '),
            quantityReceived: quantity,
            currentBirdCount: quantity - Number(input.mortalityOnArrival ?? 0),
            dateOfHatch,
            dateReceived,
            stage,
            location,
            vaccinationOnArrival,
            mortalityOnArrival: Number(input.mortalityOnArrival ?? 0),
            transportConditions: input.transportConditions ?? null,
            notes: notesParts.length ? notesParts.join('\n') : null,
            isActive: input.isActive ?? true,
            createdById: userId,
          },
          include: {
            house: { select: { id: true, name: true, code: true } },
            supplier: { select: { id: true, name: true } },
          },
        });

        // Create cage assignments for direct production-house registration.
        // FarmRow field: rowCode (NOT code) — schema: @@unique([sectionId, rowCode]).
        // BatchCageAssignment required fields: transferDate + assignedById (non-nullable).
        // Uses upsert (consistent with BatchLifecycleService.updateBatchStage).
        if (stage === BatchStage.PRODUCTION && Array.isArray(input.rowPlacements) && input.rowPlacements.length) {
          const rowCodes: string[] = input.rowPlacements.map((r: any) => String(r.rowCode));
          const rows = await tx.farmRow.findMany({
            where: { rowCode: { in: rowCodes } },
            select: { id: true, rowCode: true },
          });
          const rowIdByCode = Object.fromEntries(rows.map(r => [r.rowCode, r.id]));

          for (const placement of input.rowPlacements) {
            const rowId = rowIdByCode[placement.rowCode];
            if (!rowId) continue; // gracefully skip unknown rowCodes
            await tx.batchCageAssignment.upsert({
              where: { rowId },
              create: {
                rowId,
                batchId:      batch.id,
                birdCount:    Number(placement.birdCount) || 0,
                transferDate: new Date(),
                assignedById: userId,
              },
              update: {
                batchId:      batch.id,
                birdCount:    Number(placement.birdCount) || 0,
                transferDate: new Date(),
                assignedById: userId,
              },
            });
          }
        }

        // Create BrooderCageAssignment records for direct brooder registration
        // — population is now tracked per cage. Each level's
        // BrooderLevelAssignment rollup (batchId + summed birdCount) is
        // recomputed afterwards so existing feed-schedule/dashboard code
        // that reads at level granularity keeps working unchanged.
        // Each entry: { cageId: string, birdCount: number, notes?: string }
        // cageId is the UUID PK of brooder_cages (from the cage-map endpoint).
        if (location === 'BROODER' && Array.isArray(input.brooderCagePlacements) && input.brooderCagePlacements.length) {
          const placementDate = new Date();
          const affectedLevelIds = new Set<string>();
          for (const placement of input.brooderCagePlacements) {
            const birdCount = Number(placement.birdCount) || 0;
            if (birdCount <= 0) continue; // skip empty cells
            const cage = await tx.brooderCage.findUnique({ where: { id: placement.cageId } });
            if (!cage) continue; // gracefully skip unknown cageIds
            await tx.brooderCageAssignment.upsert({
              where:  { cageId: placement.cageId },
              create: {
                cageId:       placement.cageId,
                batchId:      batch.id,
                birdCount,
                placedDate:   placementDate,
                notes:        placement.notes ?? null,
                assignedById: userId,
              },
              update: {
                batchId:      batch.id,
                birdCount,
                placedDate:   placementDate,
                notes:        placement.notes ?? null,
                assignedById: userId,
              },
            });
            affectedLevelIds.add(cage.levelId);
          }
          // Roll each affected level up from its cages.
          for (const levelId of affectedLevelIds) {
            const cageAssignments = await tx.brooderCageAssignment.findMany({
              where: { cage: { levelId } },
            });
            const rollupBirdCount = cageAssignments.reduce((s, a) => s + a.birdCount, 0);
            if (rollupBirdCount === 0) {
              await tx.brooderLevelAssignment.deleteMany({ where: { levelId } });
              continue;
            }
            await tx.brooderLevelAssignment.upsert({
              where:  { levelId },
              create: {
                levelId, batchId: batch.id, birdCount: rollupBirdCount,
                placedDate: placementDate,
                notes: 'Auto-maintained rollup of this level\'s cage assignments.',
                assignedById: userId,
              },
              update: {
                batchId: batch.id, birdCount: rollupBirdCount,
                placedDate: placementDate, assignedById: userId,
              },
            });
          }
        }

        return batch;
      });
      return result;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException('A batch with this code already exists');
      }
      throw err;
    }
  }

  // ── Update batch (registration corrections) ──────────────────────────────
  //
  // Lets the PM fix mistakes made at registration (typo'd supplier name, wrong
  // bird type/strain, wrong dates, etc.) WITHOUT touching the two fields that
  // drive every downstream bird-count calculation:
  //   - quantityReceived: never editable here, by design (per product request).
  //   - currentBirdCount: only ever moved by the *delta* of a mortalityOnArrival
  //     correction, never reset wholesale — so any mortality/culling logged
  //     after registration is preserved instead of being silently erased.
  // location/stage are intentionally NOT editable here — moving a batch
  // between Brooder and Production House has its own dedicated transfer
  // workflow (row placements, cage assignments) via updateBatchStage().
  async updateBatch(id: string, input: any, userId: string) {
    const batch = await this.prisma.batch.findUnique({ where: { id } });
    if (!batch) throw new NotFoundException('Batch not found');

    const data: Prisma.BatchUpdateInput = {};

    if (input.batchCode !== undefined) {
      const newCode = String(input.batchCode).trim();
      if (!newCode) throw new BadRequestException('batchCode cannot be empty');
      if (newCode !== batch.batchCode) {
        const dupe = await this.prisma.batch.findUnique({ where: { batchCode: newCode } });
        if (dupe && dupe.id !== id) {
          throw new BadRequestException(`Batch code "${newCode}" is already in use`);
        }
        data.batchCode = newCode;
      }
    }

    if (input.supplierId || input.supplierName) {
      const supplier = await this.resolveSupplier(input.supplierId, input.supplierName);
      data.supplier = { connect: { id: supplier.id } };
    }

    if (input.houseId) {
      const house = await this.resolveHouse(input.houseId, (input.birdType ?? batch.birdType) as BirdType);
      data.house = { connect: { id: house.id } };
    }

    if (input.birdType !== undefined) {
      if (!Object.values(BirdType).includes(input.birdType as BirdType)) {
        throw new BadRequestException('Invalid birdType');
      }
      data.birdType = input.birdType as BirdType;
    }

    if (input.strain !== undefined) data.strain = String(input.strain).trim();

    if (input.dateOfHatch !== undefined) {
      const d = new Date(input.dateOfHatch);
      if (Number.isNaN(d.getTime())) throw new BadRequestException('Invalid dateOfHatch');
      data.dateOfHatch = d;
    }

    if (input.dateReceived !== undefined) {
      const d = new Date(input.dateReceived);
      if (Number.isNaN(d.getTime())) throw new BadRequestException('Invalid dateReceived');
      data.dateReceived = d;
    }

    if (input.vaccinationOnArrival !== undefined) {
      data.vaccinationOnArrival = Boolean(input.vaccinationOnArrival);
    }

    if (input.transportConditions !== undefined) {
      data.transportConditions = input.transportConditions || null;
    }

    if (input.notes !== undefined) {
      data.notes = input.notes || null;
    }

    // mortalityOnArrival correction:
    //
    // quantityReceived is fixed at intake (birds off the truck) and must NEVER
    // be derived from currentBirdCount on an edit — currentBirdCount decreases
    // over the batch's life as on-farm mortality/culling is logged (see the
    // `currentBirdCount: { decrement: delta }` calls elsewhere in this file),
    // so by the time anyone edits the batch, currentBirdCount no longer has
    // anything to do with what arrived off the truck.
    //
    // The previous version of this block ran
    //   newQuantityReceived = batch.currentBirdCount + newMortalityOnArrival
    // on every save where `mortalityOnArrival` was present in the payload —
    // which is EVERY save, since the edit form always submits this field
    // (it has a default value, it isn't conditionally included). That silently
    // rewrote quantityReceived down to ~currentBirdCount on every single batch
    // edit — including edits that only touched dateOfHatch or a typo fix —
    // permanently discarding every on-farm death recorded since intake from
    // the received/survival baseline. Symptom: survival rate (currentBirdCount
    // / quantityReceived) would jump back to ~100% after any edit.
    //
    // Fixed by (a) only acting when mortalityOnArrival actually changed, and
    // (b) applying that change as a DELTA on the existing quantityReceived —
    // so a DOA correction shifts the baseline by exactly the correction,
    // and nothing else touches it.
    if (input.mortalityOnArrival !== undefined) {
      const newMortalityOnArrival = Number(input.mortalityOnArrival);
      if (!Number.isFinite(newMortalityOnArrival) || newMortalityOnArrival < 0) {
        throw new BadRequestException('mortalityOnArrival must be zero or a positive number');
      }
      const oldMortalityOnArrival = batch.mortalityOnArrival ?? 0;
      if (newMortalityOnArrival !== oldMortalityOnArrival) {
        const delta = newMortalityOnArrival - oldMortalityOnArrival;
        const newQuantityReceived = batch.quantityReceived + delta;
        // Guard the invariant this correction must preserve:
        //   quantityReceived - mortalityOnArrival - farmDeaths = currentBirdCount
        // i.e. quantityReceived - mortalityOnArrival can never drop below
        // currentBirdCount, or on-farm deaths would go negative.
        if (newQuantityReceived - newMortalityOnArrival < batch.currentBirdCount) {
          throw new BadRequestException(
            `Mortality on arrival can't be corrected to ${newMortalityOnArrival}: that would put ` +
            `total received (${newQuantityReceived}) below birds currently accounted for on the farm ` +
            `(${batch.currentBirdCount} live + on-farm deaths already logged).`,
          );
        }
        data.mortalityOnArrival = newMortalityOnArrival;
        data.quantityReceived   = newQuantityReceived;
      }
      // currentBirdCount is intentionally NEVER touched here — on-farm
      // mortality/culling logs are the only thing allowed to move it.
    }

    // quantityReceived is only ever adjusted via the mortalityOnArrival delta
    // correction above, and only when that value actually changed.

    if (Object.keys(data).length === 0) {
      return this.getBatch(id);
    }

    try {
      return await this.prisma.batch.update({
        where: { id },
        data,
        include: {
          house: { select: { id: true, name: true, code: true } },
          supplier: { select: { id: true, name: true } },
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException('A batch with this code already exists');
      }
      throw err;
    }
  }

  // ── Daily entries ──────────────────────────────────────────────────────────

  async pendingEntries() {
    return this.prisma.flockDailyEntry.findMany({
      where: { status: EntryStatus.PENDING },
      include: {
        batch: { select: { id: true, batchCode: true, birdType: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async createEntry(input: any, userId: string) {
    if (!input?.batchId) throw new BadRequestException('batchId is required');
    const batch = await this.prisma.batch.findUnique({ where: { id: input.batchId } });
    if (!batch) throw new NotFoundException('Batch not found');

    const opening = Number(input.openingCount ?? batch.currentBirdCount);
    const mortality = Number(input.mortalityCount ?? 0);
    const culling = Number(input.cullingCount ?? 0);
    const closing = Number(input.closingCount ?? opening - mortality - culling);

    return this.prisma.flockDailyEntry.create({
      data: {
        batchId: batch.id,
        houseId: batch.houseId,
        entryDate: input.entryDate ? new Date(input.entryDate) : new Date(),
        shift: input.shift ?? 'AM',
        openingCount: opening,
        mortalityCount: mortality,
        mortalityCause: input.mortalityCause ?? null,
        cullingCount: culling,
        cullingReason: input.cullingReason ?? null,
        closingCount: closing,
        waterConsumptionL: input.waterConsumptionL ?? null,
        notes: input.notes ?? null,
        status: EntryStatus.PENDING,
        submittedById: userId,
      },
    });
  }

  async verifyEntry(id: string, body: any, userId: string) {
    const entry = await this.prisma.flockDailyEntry.findUnique({ where: { id } });
    if (!entry) throw new NotFoundException('Entry not found');

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.flockDailyEntry.update({
        where: { id },
        data: {
          status: EntryStatus.APPROVED,
          approvedById: userId,
          approvedAt: new Date(),
          returnReason: null,
        },
      });

      // Apply the verified entry to the batch's live bird count
      const delta = (entry.mortalityCount ?? 0) + (entry.cullingCount ?? 0);
      if (delta > 0) {
        await tx.batch.update({
          where: { id: entry.batchId },
          data: { currentBirdCount: { decrement: delta } },
        });

        // General (not-row-specific) mortality/culling logged here must also be
        // reflected on whichever production-house rows the batch currently
        // occupies. Without this, BatchCageAssignment.birdCount per row goes
        // stale the moment a batch spans more than one row: currentBirdCount
        // (and therefore the survival rate) drops correctly, but the cage-map
        // keeps showing the old per-row counts, so the row-level birds never
        // add up to the batch total and per-row survival looks unaffected by
        // deaths that were, in fact, recorded.
        //
        // We distribute `delta` across active row assignments proportionally
        // to their current occupancy (largest-remainder method, so the parts
        // sum to exactly `delta` with no fractional birds), then decrement
        // each row by its share.
        const rowAssignments = await tx.batchCageAssignment.findMany({
          where: { batchId: entry.batchId },
          select: { rowId: true, birdCount: true },
        });
        const rowTotal = rowAssignments.reduce((s, r) => s + r.birdCount, 0);

        if (rowAssignments.length > 0 && rowTotal > 0) {
          const shares = rowAssignments.map((r) => {
            const exact = (r.birdCount / rowTotal) * delta;
            const floor = Math.floor(exact);
            return { rowId: r.rowId, birdCount: r.birdCount, floor, remainder: exact - floor };
          });

          const allocated = shares.reduce((s, r) => s + r.floor, 0);
          let remaining = delta - allocated;

          // Hand out the leftover birds (from flooring) to the rows with the
          // largest fractional remainder first, so the total still equals delta.
          const byRemainderDesc = [...shares].sort((a, b) => b.remainder - a.remainder);
          for (let i = 0; i < byRemainderDesc.length && remaining > 0; i++) {
            byRemainderDesc[i].floor += 1;
            remaining--;
          }

          for (const share of shares) {
            const decrementBy = Math.min(share.floor, share.birdCount);
            if (decrementBy > 0) {
              await tx.batchCageAssignment.update({
                where: { rowId: share.rowId },
                data: { birdCount: { decrement: decrementBy } },
              });
            }
          }
        }
      }
      return updated;
    });
  }

  // ── Culling ────────────────────────────────────────────────────────────────

  async logCulling(input: any, userId: string) {
    if (!input?.batchId) throw new BadRequestException('batchId is required');
    const count = Number(input.cullingCount);
    if (!Number.isFinite(count) || count < 1) {
      throw new BadRequestException('cullingCount must be a positive number');
    }
    // FIX: frontend sends cullingReason; backend expected reason — accept both
    const reason = input.reason ?? input.cullingReason;
    if (!reason) throw new BadRequestException('reason is required');

    const batch = await this.prisma.batch.findUnique({ where: { id: input.batchId } });
    if (!batch) throw new NotFoundException('Batch not found');
    if (count > batch.currentBirdCount) {
      throw new BadRequestException('Culling count exceeds current bird count');
    }

    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.flockDailyEntry.create({
        data: {
          batchId: batch.id,
          houseId: batch.houseId,
          entryDate: new Date(),
          shift: 'AM',
          openingCount: batch.currentBirdCount,
          mortalityCount: 0,
          cullingCount: count,
          cullingReason: String(reason),
          closingCount: batch.currentBirdCount - count,
          status: EntryStatus.APPROVED,
          submittedById: userId,
          approvedById: userId,
          approvedAt: new Date(),
          notes: input.notes ?? null,
        },
      });
      const updated = await tx.batch.update({
        where: { id: batch.id },
        data: {
          currentBirdCount: { decrement: count },
          isActive: batch.currentBirdCount - count > 0,
          closedAt: batch.currentBirdCount - count > 0 ? null : new Date(),
        },
      });
      return { entry, batch: updated };
    });
  }

  // ── Data repair: quantityReceived corruption ──────────────────────────────
  //
  // Batches saved through the old (pre-fix) updateBatch() could have had
  // quantityReceived silently overwritten to ~currentBirdCount + mortalityOnArrival
  // on any edit, discarding on-farm mortality from the received/survival
  // baseline. That code path is fixed (see updateBatch() above), but this
  // repairs data that was already corrupted before the fix was deployed.
  //
  // The corruption only ever touches quantityReceived — currentBirdCount,
  // mortalityOnArrival, and every mortality log table are untouched by it —
  // so the correct original value can always be reconstructed:
  //
  //   quantityReceived = currentBirdCount + mortalityOnArrival
  //                     + SUM(mortalityCount + cullingCount) across every
  //                       mortality/culling record ever logged for the batch
  //                       (FlockDailyEntry[APPROVED], BrooderLevelMortalityLog,
  //                       BrooderGeneralMortalityLog)
  //
  // Exposed as two endpoints (see FlockController): a read-only preview and
  // an apply step that requires an explicit confirm flag. Mirrors
  // scripts/repair-batch-quantity-received.ts for teams that can't run a CLI
  // script directly against the database.
  async previewQuantityReceivedRepair(batchId?: string) {
    return this.computeQuantityReceivedRepair(batchId, false);
  }

  async applyQuantityReceivedRepair(batchId?: string) {
    return this.computeQuantityReceivedRepair(batchId, true);
  }

  private async computeQuantityReceivedRepair(batchId: string | undefined, apply: boolean) {
    const batches = await this.prisma.batch.findMany({
      where: batchId ? { id: batchId } : {},
      select: {
        id: true, batchCode: true,
        quantityReceived: true, currentBirdCount: true, mortalityOnArrival: true,
      },
      orderBy: { batchCode: 'asc' },
    });

    const results: Array<{
      batchId: string; batchCode: string;
      currentQuantityReceived: number; recomputedQuantityReceived: number;
      currentBirdCount: number; mortalityOnArrival: number; farmMortalityLogged: number;
      needsReview: boolean; applied: boolean;
    }> = [];

    for (const batch of batches) {
      const [entryAgg, levelAgg, generalAgg] = await Promise.all([
        this.prisma.flockDailyEntry.aggregate({
          where: { batchId: batch.id, status: EntryStatus.APPROVED },
          _sum: { mortalityCount: true, cullingCount: true },
        }),
        this.prisma.brooderLevelMortalityLog.aggregate({
          where: { batchId: batch.id },
          _sum: { mortalityCount: true, cullingCount: true },
        }),
        this.prisma.brooderGeneralMortalityLog.aggregate({
          where: { batchId: batch.id },
          _sum: { mortalityCount: true, cullingCount: true },
        }),
      ]);

      const totalFarmMortality =
        (entryAgg._sum.mortalityCount ?? 0) + (entryAgg._sum.cullingCount ?? 0) +
        (levelAgg._sum.mortalityCount ?? 0) + (levelAgg._sum.cullingCount ?? 0) +
        (generalAgg._sum.mortalityCount ?? 0) + (generalAgg._sum.cullingCount ?? 0);

      const moa = batch.mortalityOnArrival ?? 0;
      const correctQuantityReceived = batch.currentBirdCount + moa + totalFarmMortality;

      if (correctQuantityReceived === batch.quantityReceived) continue; // already correct

      const needsReview = correctQuantityReceived < batch.currentBirdCount + moa;

      const result = {
        batchId: batch.id,
        batchCode: batch.batchCode,
        currentQuantityReceived: batch.quantityReceived,
        recomputedQuantityReceived: correctQuantityReceived,
        currentBirdCount: batch.currentBirdCount,
        mortalityOnArrival: moa,
        farmMortalityLogged: totalFarmMortality,
        needsReview,
        applied: false,
      };

      if (!needsReview && apply) {
        await this.prisma.batch.update({
          where: { id: batch.id },
          data: { quantityReceived: correctQuantityReceived },
        });
        result.applied = true;
      }

      results.push(result);
    }

    return {
      mode: apply ? 'apply' : 'dry-run',
      batchesChecked: batches.length,
      mismatches: results.length,
      results,
    };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async resolveSupplier(supplierId?: string, supplierName?: string) {
    if (supplierId) {
      const found = await this.prisma.supplier.findUnique({ where: { id: supplierId } });
      if (!found) throw new BadRequestException('Supplier not found');
      return found;
    }
    const name = (supplierName ?? '').trim() || 'Unknown Supplier';
    const existing = await this.prisma.supplier.findFirst({ where: { name } });
    if (existing) return existing;
    return this.prisma.supplier.create({ data: { name } });
  }

  private async resolveHouse(houseId: string | undefined, birdType: BirdType) {
    if (houseId) {
      const found = await this.prisma.house.findUnique({ where: { id: houseId } });
      if (found) return found;
      // Treat the value as a code (frontend lets users type "house_001")
      const byCode = await this.prisma.house.findUnique({ where: { code: houseId } });
      if (byCode) return byCode;
    }
    const fallback = await this.prisma.house.findFirst({
      where: { birdType, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    if (fallback) return fallback;

    // Auto-provision a default house so first-time setups don't fail
    return this.prisma.house.create({
      data: {
        name: `Default ${birdType.replace(/_/g, ' ')} House`,
        code: `AUTO-${birdType}-${Date.now().toString(36)}`.toUpperCase(),
        capacity: 10000,
        birdType,
        description: 'Auto-created when registering the first batch',
      },
    });
  }

  // ── Brooder logs ──────────────────────────────────────────────────────────

  async listBrooderLogs(batchId: string, limit = 50, rowId?: string, levelId?: string) {
    if (!batchId) return [];
    return this.prisma.brooderLog.findMany({
      where: { batchId, ...(rowId ? { rowId } : {}), ...(levelId ? { levelId } : {}) },
      orderBy: [{ logDate: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      include: {
        loggedBy: { select: { id: true, fullName: true } },
        row:   { select: { id: true, label: true } },
        level: { select: { id: true, label: true } },
      },
    });
  }

  async createBrooderLog(input: any, userId: string) {
    if (!input?.batchId) throw new BadRequestException('batchId is required');

    const batch = await this.prisma.batch.findUnique({ where: { id: input.batchId } });
    if (!batch) throw new NotFoundException('Batch not found');

    const logDate      = input.logDate ? new Date(input.logDate) : new Date();
    const isSessionLog = !!(input.logSession); // MORNING | MIDDAY | EVENING

    // ── SESSION LOG (temperature / humidity / light — up to 3× per day) ──────
    //
    // Morning / Midday / Evening are independent of one another and of the
    // once-daily entry below — the farm now records all three sessions in
    // one sitting rather than returning to the app at different times of
    // day, so re-submitting the SAME session (e.g. correcting a typo, or
    // simply re-saving the whole form) updates the existing row instead of
    // being rejected as a duplicate. Each session is still saved as its own
    // independent write, so one session failing never blocks the other two,
    // or the once-daily entry, from being recorded.
    if (isSessionLog) {
      const existing = await this.prisma.brooderLog.findFirst({
        where: { batchId: batch.id, logDate, logSession: input.logSession as any },
      });

      const data = {
        batchId:           batch.id,
        logDate,
        logSession:        input.logSession as any,
        temperature:       input.temperature        != null ? Number(input.temperature)        : null,
        humidityPercent:   input.humidityPercent    != null ? Number(input.humidityPercent)    : null,
        lightIntensityLux: input.lightIntensityLux  != null ? Number(input.lightIntensityLux)  : null,
        lightingOk:        input.lightingOk ?? true,
        waterConsumptionL: null,
        vaccineGiven:      null,
        vaccineGivenDose:  null,
        vaccinesJson:      Prisma.JsonNull,
        supplement:        null,
        supplementDose:    null,
        supplementsJson:   Prisma.JsonNull,
        feedType:          null,
        feedConsumedKg:    null,
        mortalityCount:    0,
        notes:             input.notes ?? null,
        loggedById:        userId,
        rowId:             input.rowId   ?? null,
        levelId:           input.levelId ?? null,
      };

      if (existing) {
        return this.prisma.brooderLog.update({ where: { id: existing.id }, data });
      }
      return this.prisma.brooderLog.create({ data });
    }

    // ── ONCE-DAILY LOG (water / vaccines / supplements — max 1× per day) ─────
    //
    // Accepts:
    //   • input.vaccines    — array of { name, dose, route }  (preferred)
    //   • input.supplements — array of { name, dose }         (preferred)
    //   • input.vaccineGiven / input.vaccineGivenDose / input.vaccineRoute (legacy single)
    //   • input.supplement  / input.supplementDose            (legacy single)
    //
    // All are collapsed into vaccinesJson / supplementsJson for storage.
    // Legacy single fields are also populated for backward-compat read paths.
    //
    // Past-date (backdated) logs are allowed as long as no daily log already
    // exists for that batch+date. The uniqueness check only rejects true
    // duplicate submissions, not backdated entries.

    const existingDaily = await this.prisma.brooderLog.findFirst({
      where: { batchId: batch.id, logDate, logSession: null },
    });
    if (existingDaily) {
      throw new BadRequestException(
        `A daily entry has already been recorded for ${batch.batchCode} on ` +
        `${logDate.toISOString().slice(0, 10)}. ` +
        `To correct it, ask a manager to edit the existing record.`,
      );
    }

    // Normalise vaccines: merge array input + legacy single-vaccine input
    type VaccineEntry    = { name: string; dose: string; route?: string; storeItemId?: string | null; quantityUsed?: number | null; unit?: string | null };
    type SupplementEntry = { name: string; dose: string; storeItemId?: string | null; quantityUsed?: number | null; unit?: string | null };

    const vaccinesArr: VaccineEntry[] = [];
    if (Array.isArray(input.vaccines)) {
      for (const v of input.vaccines) {
        const name = String(v.name ?? '').trim();
        if (name) {
          vaccinesArr.push({
            name,
            dose: String(v.dose ?? '').trim(),
            route: v.route ?? 'DRINKING_WATER',
            storeItemId: v.storeItemId || null,
            quantityUsed: v.quantityUsed != null ? Number(v.quantityUsed) : null,
          });
        }
      }
    } else if (input.vaccineGiven && String(input.vaccineGiven).trim()) {
      // Legacy single-vaccine path
      vaccinesArr.push({
        name:  String(input.vaccineGiven).trim(),
        dose:  String(input.vaccineDose ?? input.vaccineGivenDose ?? '').trim(),
        route: input.vaccineRoute ?? 'DRINKING_WATER',
      });
    }

    const supplementsArr: SupplementEntry[] = [];
    if (Array.isArray(input.supplements)) {
      for (const s of input.supplements) {
        const name = String(s.name ?? '').trim();
        if (name) {
          supplementsArr.push({
            name,
            dose: String(s.dose ?? '').trim(),
            storeItemId: s.storeItemId || null,
            quantityUsed: s.quantityUsed != null ? Number(s.quantityUsed) : null,
          });
        }
      }
    } else if (input.supplement && String(input.supplement).trim()) {
      supplementsArr.push({
        name: String(input.supplement).trim(),
        dose: String(input.supplementDose ?? '').trim(),
      });
    }

    // Every vaccine/supplement tagged with a store item is looked up (in
    // parallel) — it does not have to have been issued yet. The item's
    // stock unit is snapshotted onto the entry here (server-side,
    // authoritative) so the residual subtraction is always unit-consistent.
    const storeItemIdsToCheck = Array.from(new Set([
      ...vaccinesArr.map(v => v.storeItemId),
      ...supplementsArr.map(s => s.storeItemId),
    ].filter((id): id is string => !!id)));
    const issuedItems = await Promise.all(
      storeItemIdsToCheck.map(id => this.getIssuedStoreItemOrThrow(id)),
    );
    const unitByStoreItemId = new Map(storeItemIdsToCheck.map((id, i) => [id, issuedItems[i].unit]));

    // Validate residual for every entry tagged with a storeItemId, in order,
    // tracking how much of each item this same request has already claimed
    // so two entries in one submission (e.g. two vaccines from the same
    // bottle) can't each pass the check independently and jointly overdraw.
    const reservedByItem = new Map<string, number>();
    for (const entry of [...vaccinesArr, ...supplementsArr]) {
      if (!entry.storeItemId || entry.quantityUsed == null) continue;
      const alreadyReserved = reservedByItem.get(entry.storeItemId) ?? 0;
      await this.checkResidualOrWarn(
        entry.storeItemId,
        entry.quantityUsed,
        alreadyReserved,
        unitByStoreItemId.get(entry.storeItemId) ?? null,
        'Brooder vaccine/supplement log',
      );
      reservedByItem.set(entry.storeItemId, alreadyReserved + entry.quantityUsed);
    }

    for (const v of vaccinesArr) {
      if (v.storeItemId) v.unit = unitByStoreItemId.get(v.storeItemId) ?? null;
    }
    for (const s of supplementsArr) {
      if (s.storeItemId) s.unit = unitByStoreItemId.get(s.storeItemId) ?? null;
    }


    // Auto-create VaccinationRecord for each vaccine so it appears on the
    // manager's Health/Vaccination History page without re-entry.
    if (vaccinesArr.length > 0) {
      await Promise.allSettled(
        vaccinesArr.map(v =>
          this.prisma.vaccinationRecord.create({
            data: {
              batchId:          batch.id,
              vaccineName:      v.name,
              administeredDate: logDate,
              route:            (v.route ?? 'DRINKING_WATER') as any,
              batchSize:        batch.currentBirdCount,
              dosageUnits:      v.dose || undefined,
              notes:            input.notes ?? undefined,
              recordedById:     userId,
            },
          })
        )
      );
      // allSettled — individual VaccinationRecord failures don't abort the log
    }

    // Legacy single-field values for backward-compat (first vaccine/supplement only)
    const firstVaccine    = vaccinesArr[0]    ?? null;
    const firstSupplement = supplementsArr[0] ?? null;

    return this.prisma.brooderLog.create({
      data: {
        batchId:           batch.id,
        logDate,
        logSession:        null,
        waterConsumptionL: input.waterConsumptionL != null ? Number(input.waterConsumptionL) : null,
        temperature:       null,
        humidityPercent:   null,
        lightIntensityLux: null,
        lightingOk:        true,
        feedType:          null,
        feedConsumedKg:    null,
        mortalityCount:    0,
        // Legacy single-field columns (first entry, for existing read paths)
        vaccineGiven:      firstVaccine?.name      ?? null,
        vaccineGivenDose:  firstVaccine?.dose      ?? null,
        supplement:        firstSupplement?.name   ?? null,
        supplementDose:    firstSupplement?.dose   ?? null,
        // Full arrays stored as JSON (source of truth for display)
        vaccinesJson:      vaccinesArr.length    > 0 ? vaccinesArr    : Prisma.JsonNull,
        supplementsJson:   supplementsArr.length > 0 ? supplementsArr : Prisma.JsonNull,
        notes:             input.notes ?? null,
        loggedById:        userId,
        rowId:             input.rowId   ?? null,
        levelId:           input.levelId ?? null,
      },
    });
  }

  async listBrooderTreatmentLogs(batchId: string, limit = 30) {
    return (this.prisma as any).brooderTreatmentLog.findMany({
      where:   { batchId },
      orderBy: { treatmentDate: 'desc' },
      take:    limit,
      include: {
        loggedBy: { select: { id: true, fullName: true } },
        row:      { select: { id: true, label: true } },
        level:    { select: { id: true, label: true } },
      },
    });
  }

  async createBrooderTreatmentLog(input: any, userId: string) {
    if (!input?.batchId) throw new BadRequestException('batchId is required');
    if (!input?.drugName) throw new BadRequestException('drugName is required');
    if (!input?.dose)     throw new BadRequestException('dose is required');
    const batch = await this.prisma.batch.findUnique({ where: { id: input.batchId } });
    if (!batch) throw new NotFoundException('Batch not found');
    const issuedItem = input.storeItemId ? await this.getIssuedStoreItemOrThrow(input.storeItemId) : null;
    if (input.storeItemId && input.quantityUsed != null) {
      await this.checkResidualOrWarn(
        input.storeItemId,
        Number(input.quantityUsed),
        0,
        issuedItem?.unit ?? null,
        'Brooder treatment log',
      );
    }
    return (this.prisma as any).brooderTreatmentLog.create({
      data: {
        batchId:          batch.id,
        rowId:            input.rowId       ?? null,
        levelId:          input.levelId     ?? null,
        treatmentDate:    input.treatmentDate ? new Date(input.treatmentDate) : new Date(),
        drugName:         String(input.drugName).trim(),
        storeItemId:      input.storeItemId || null,
        dose:             String(input.dose).trim(),
        doseUnit:         input.doseUnit ?? 'ml',
        quantityUsed:     input.quantityUsed != null ? Number(input.quantityUsed) : null,
        quantityUsedUnit: issuedItem?.unit ?? null,
        route:            input.route    ?? 'DRINKING_WATER',
        durationDays:     input.durationDays != null ? Number(input.durationDays) : null,
        notes:            input.notes ?? null,
        loggedById:       userId,
      },
    });
  }

  async listHouses(birdType?: string) {
    return this.prisma.house.findMany({
      where: { isActive: true, ...(birdType ? { birdType: birdType as BirdType } : {}) },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, code: true, birdType: true, capacity: true },
    });
  }

  async getBatchEntries(batchId: string, limit = 50) {
    return this.prisma.flockDailyEntry.findMany({
      where: { batchId },
      orderBy: { entryDate: 'desc' },
      take: limit,
      include: { batch: { select: { id: true, batchCode: true } } },
    });
  }

  async returnEntry(id: string, returnReason: string, userId: string) {
    const entry = await this.prisma.flockDailyEntry.findUnique({ where: { id } });
    if (!entry) throw new NotFoundException('Entry not found');
    return this.prisma.flockDailyEntry.update({
      where: { id },
      data: { status: EntryStatus.RETURNED, returnReason: returnReason ?? 'Returned for correction' },
    });
  }

  async logWeightSample(input: any, userId: string) {
    if (!input?.batchId) throw new BadRequestException('batchId is required');
    const batch = await this.prisma.batch.findUnique({ where: { id: input.batchId } });
    if (!batch) throw new NotFoundException('Batch not found');
    // Accept frontend field names (sampleSize/avgWeightKg) and map to schema field names
    const sampleCount  = Number(input.sampleCount  ?? input.sampleSize ?? 1);
    const avgWeightG   = input.averageWeightG
      ? Number(input.averageWeightG)
      : input.avgWeightKg ? Math.round(Number(input.avgWeightKg) * 1000) : 0;
    const totalWeightG = Number(input.totalWeightG ?? Math.round(avgWeightG * sampleCount));
    return this.prisma.birdWeightSample.create({
      data: {
        batchId:        batch.id,
        sampleDate:     input.sampleDate ? new Date(input.sampleDate) : new Date(),
        sampleCount,
        totalWeightG,
        averageWeightG: avgWeightG,
        ageWeeks:       Number(input.ageWeeks ?? 0),
        notes:          input.notes ?? null,
        recordedById:   userId,
      },
    });
  }

  async getWeightSamples(batchId: string, limit = 20) {
    return this.prisma.birdWeightSample.findMany({
      where: { batchId },
      orderBy: { sampleDate: 'desc' },
      take: limit,
    });
  }
}
