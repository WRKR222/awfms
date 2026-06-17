import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BatchStage, BirdType, EntryStatus, Prisma } from '@prisma/client';

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
  constructor(private readonly prisma: PrismaService) {}

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

    // mortalityOnArrival correction — apply only the delta to currentBirdCount.
    if (input.mortalityOnArrival !== undefined) {
      const newMortalityOnArrival = Number(input.mortalityOnArrival);
      if (!Number.isFinite(newMortalityOnArrival) || newMortalityOnArrival < 0) {
        throw new BadRequestException('mortalityOnArrival must be zero or a positive number');
      }
      if (newMortalityOnArrival > batch.quantityReceived) {
        throw new BadRequestException('mortalityOnArrival cannot exceed Quantity Received');
      }
      const delta = newMortalityOnArrival - batch.mortalityOnArrival; // +ve = correcting upward
      const newCurrentBirdCount = batch.currentBirdCount - delta;
      if (newCurrentBirdCount < 0) {
        throw new BadRequestException(
          'This correction would make the current bird count negative. Check the recorded mortality before saving.',
        );
      }
      data.mortalityOnArrival = newMortalityOnArrival;
      data.currentBirdCount = newCurrentBirdCount;
    }

    // quantityReceived is deliberately ignored even if present in the payload —
    // "Number Received" is locked once a batch is created.

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

  async listBrooderLogs(batchId: string, limit = 50) {
    if (!batchId) return [];
    return this.prisma.brooderLog.findMany({
      where: { batchId },
      orderBy: { logDate: 'desc' },
      take: limit,
      include: {
        loggedBy: { select: { id: true, fullName: true } },
      },
    });
  }

  async createBrooderLog(input: any, userId: string) {
    if (!input?.batchId) throw new BadRequestException('batchId is required');

    const batch = await this.prisma.batch.findUnique({ where: { id: input.batchId } });
    if (!batch) throw new NotFoundException('Batch not found');

    const mortality = Number(input.mortalityCount ?? 0);
    if (mortality > 0) {
      await this.prisma.batch.update({
        where: { id: batch.id },
        data: { currentBirdCount: { decrement: mortality } },
      });
    }

    // If feed was consumed, also create a FeedIntakeLog to deduct from stock
    const feedKg = Number(input.feedConsumedKg ?? 0);
    if (feedKg > 0 && input.feedType) {
      try {
        await this.prisma.feedIntakeLog.create({
          data: {
            batchId: batch.id,
            houseId: batch.houseId,
            feedType: input.feedType,
            entryDate: input.logDate ? new Date(input.logDate) : new Date(),
            quantityDispensedKg: feedKg,
            wastageKg: 0,
            recommendedMinKg: 0,
            recommendedMaxKg: 0,
            notes: 'Logged from Brooder page',
            recordedById: userId,
          },
        });
      } catch (_) { /* feed intake log is best-effort */ }
    }

    return this.prisma.brooderLog.create({
      data: {
        batchId:           batch.id,
        logDate:           input.logDate ? new Date(input.logDate) : new Date(),
        feedType:          input.feedType ?? null,
        feedConsumedKg:    input.feedConsumedKg != null ? Number(input.feedConsumedKg) : null,
        waterConsumptionL: input.waterConsumptionL != null ? Number(input.waterConsumptionL) : null,
        temperature:       input.temperature != null ? Number(input.temperature) : null,
        lightingOk:        input.lightingOk ?? true,
        mortalityCount:    mortality,
        vaccineGiven:      input.vaccineGiven ?? null,
        supplement:        input.supplement ?? null,
        notes:             input.notes ?? null,
        loggedById:        userId,
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
