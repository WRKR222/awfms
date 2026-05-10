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
        _count: { select: { flockEntries: true } },
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
        _count: { select: { flockEntries: true } },
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

    const supplier = await this.resolveSupplier(input.supplierId, input.supplierName);
    const house = await this.resolveHouse(input.houseId, input.birdType as BirdType);

    const stage = (input.stage as BatchStage) ?? BatchStage.BROODING;
    const location: string =
      input.location ?? (stage === BatchStage.PRODUCTION ? 'PRODUCTION_HOUSE' : 'BROODER');

    const vaccinationOnArrival = Boolean(
      input.vaccinationOnArrival ?? input.vaccinatedOnArrival ?? false,
    );

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

    return this.prisma.brooderLog.create({
      data: {
        batchId: batch.id,
        logDate: input.logDate ? new Date(input.logDate) : new Date(),
        waterConsumptionL: input.waterConsumptionL != null ? Number(input.waterConsumptionL) : null,
        temperature: input.temperature != null ? Number(input.temperature) : null,
        lightingOk: input.lightingOk ?? true,
        mortalityCount: mortality,
        vaccineGiven: input.vaccineGiven ?? null,
        supplement: input.supplement ?? null,
        notes: input.notes ?? null,
        loggedById: userId,
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
    return this.prisma.birdWeightSample.create({
      data: {
        batchId: batch.id,
        sampleDate: input.sampleDate ? new Date(input.sampleDate) : new Date(),
        sampleSize: Number(input.sampleSize ?? 1),
        avgWeightKg: Number(input.avgWeightKg ?? 0),
        minWeightKg: input.minWeightKg != null ? Number(input.minWeightKg) : null,
        maxWeightKg: input.maxWeightKg != null ? Number(input.maxWeightKg) : null,
        notes: input.notes ?? null,
        recordedById: userId,
      },
    });
  }

  async getWeightSamples(batchId: string, limit = 20) {
    return this.prisma.birdWeightSample.findMany({
      where: { batchId },
      orderBy: { sampleDate: 'desc' },
      take: limit,
      include: { recordedBy: { select: { id: true, fullName: true } } },
    });
  }
}
