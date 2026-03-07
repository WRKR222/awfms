import {
  Injectable, NotFoundException, BadRequestException, ForbiddenException, Logger,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../../common/notifications/notifications.service';
import { CreateBatchDto } from './dto/create-batch.dto';
import { CreateDailyEntryDto } from './dto/create-daily-entry.dto';
import { VerifyEntryDto } from './dto/verify-entry.dto';
import { BatchStage, EntryStatus, NotificationType, UserRole } from '@prisma/client';
import dayjs from 'dayjs';

@Injectable()
export class FlockService {
  private readonly logger = new Logger(FlockService.name);

  // Stage thresholds (weeks)
  private readonly BROODING_MAX_WEEKS = 6;
  private readonly GROWER_MAX_WEEKS = 18;

  // Mortality anomaly threshold
  private readonly MORTALITY_ANOMALY_THRESHOLD = 0.15; // 15%

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  // ─── BATCH MANAGEMENT ─────────────────────────────────────────────────────

  async createBatch(dto: CreateBatchDto, createdById: string) {
    // Validate supplier and house exist
    const [supplier, house] = await Promise.all([
      this.prisma.supplier.findFirst({ where: { id: dto.supplierId, isActive: true } }),
      this.prisma.house.findFirst({ where: { id: dto.houseId, isActive: true } }),
    ]);

    if (!supplier) throw new NotFoundException('Supplier not found');
    if (!house) throw new NotFoundException('House not found');

    // Validate batch code is unique
    const existing = await this.prisma.batch.findUnique({ where: { batchCode: dto.batchCode } });
    if (existing) throw new BadRequestException(`Batch code '${dto.batchCode}' already exists`);

    const ageWeeks = dayjs().diff(dayjs(dto.dateOfHatch), 'week');
    const initialStage = this.calculateStage(ageWeeks);
    const initialCount = dto.quantityReceived - (dto.mortalityOnArrival ?? 0);

    const batch = await this.prisma.batch.create({
      data: {
        batchCode: dto.batchCode,
        supplierId: dto.supplierId,
        houseId: dto.houseId,
        birdType: dto.birdType,
        strain: dto.strain,
        quantityReceived: dto.quantityReceived,
        currentBirdCount: initialCount,
        dateOfHatch: new Date(dto.dateOfHatch),
        dateReceived: new Date(dto.dateReceived),
        stage: initialStage,
        vaccinationOnArrival: dto.vaccinationOnArrival ?? false,
        mortalityOnArrival: dto.mortalityOnArrival ?? 0,
        transportConditions: dto.transportConditions,
        notes: dto.notes,
        createdById,
      },
      include: { supplier: true, house: true },
    });

    this.logger.log(`Batch created: ${batch.batchCode} (${batch.birdType}) in ${house.name}`);
    return batch;
  }

  async getBatches(filters: { isActive?: boolean; houseId?: string; stage?: BatchStage }) {
    return this.prisma.batch.findMany({
      where: {
        ...filters,
        deletedAt: null,
      },
      include: {
        supplier: { select: { name: true } },
        house: { select: { name: true, code: true } },
        _count: { select: { flockEntries: true } },
      },
      orderBy: { dateReceived: 'desc' },
    });
  }

  async getBatchById(id: string) {
    const batch = await this.prisma.batch.findFirst({
      where: { id, deletedAt: null },
      include: {
        supplier: true,
        house: true,
        flockEntries: {
          orderBy: { entryDate: 'desc' },
          take: 14, // last 14 entries
          include: {
            submittedBy: { select: { fullName: true } },
            approvedBy: { select: { fullName: true } },
          },
        },
        weightSamples: { orderBy: { sampleDate: 'desc' }, take: 8 },
        vaccinationRecords: { orderBy: { administeredDate: 'desc' }, take: 10 },
      },
    });

    if (!batch) throw new NotFoundException('Batch not found');

    // Enrich with computed fields
    const ageWeeks = dayjs().diff(dayjs(batch.dateOfHatch), 'week');
    const agedays = dayjs().diff(dayjs(batch.dateOfHatch), 'day');
    const currentStage = this.calculateStage(ageWeeks);

    // Auto-update stage if changed
    if (currentStage !== batch.stage) {
      await this.prisma.batch.update({
        where: { id },
        data: { stage: currentStage },
      });
    }

    return { ...batch, ageDays: agedays, ageWeeks, currentStage };
  }

  // ─── DAILY ENTRIES ─────────────────────────────────────────────────────────

  async createDailyEntry(dto: CreateDailyEntryDto, submittedById: string, userRole: UserRole) {
    const batch = await this.prisma.batch.findFirst({
      where: { id: dto.batchId, isActive: true, deletedAt: null },
    });
    if (!batch) throw new NotFoundException('Active batch not found');

    // ATTENDANT can only submit for their assigned houses
    if (userRole === UserRole.ATTENDANT) {
      const attendant = await this.prisma.user.findUnique({
        where: { id: submittedById },
        select: { houseIds: true },
      });
      if (!attendant?.houseIds.includes(dto.houseId)) {
        throw new ForbiddenException('You can only submit entries for your assigned houses');
      }
    }

    // Validate biological impossibility
    const closingCount = dto.openingCount - dto.mortalityCount - (dto.cullingCount ?? 0);
    if (closingCount < 0) {
      throw new BadRequestException(
        `Closing count would be ${closingCount} — mortality + culling exceeds opening count`,
      );
    }

    // Check for duplicate (same batch, date, shift)
    const duplicate = await this.prisma.flockDailyEntry.findUnique({
      where: {
        batchId_entryDate_shift: {
          batchId: dto.batchId,
          entryDate: new Date(dto.entryDate),
          shift: dto.shift,
        },
      },
    });
    if (duplicate) {
      throw new BadRequestException(
        `Entry already exists for batch ${dto.batchId} on ${dto.entryDate} ${dto.shift} shift`,
      );
    }

    const entry = await this.prisma.flockDailyEntry.create({
      data: {
        batchId: dto.batchId,
        houseId: dto.houseId,
        entryDate: new Date(dto.entryDate),
        shift: dto.shift,
        openingCount: dto.openingCount,
        mortalityCount: dto.mortalityCount,
        mortalityCause: dto.mortalityCause,
        cullingCount: dto.cullingCount ?? 0,
        cullingReason: dto.cullingReason,
        closingCount,
        waterConsumptionL: dto.waterConsumptionL,
        temperatureCelsius: dto.temperatureCelsius,
        humidityPercent: dto.humidityPercent,
        notes: dto.notes,
        submittedById,
        status: EntryStatus.PENDING,
      },
      include: { submittedBy: { select: { fullName: true } } },
    });

    // Notify supervisors of pending entry
    await this.notifications.notifyRole(
      UserRole.SUPERVISOR,
      NotificationType.VERIFICATION_PENDING,
      'Entry Awaiting Verification',
      `${entry.submittedBy.fullName} submitted a flock entry for ${dto.entryDate} ${dto.shift} shift`,
      { entityId: entry.id, entityType: 'FlockDailyEntry' },
    );

    // Check mortality anomaly (warn supervisor if > 15% above 7-day average)
    if (dto.mortalityCount > 0) {
      await this.checkMortalityAnomaly(dto.batchId, dto.mortalityCount, batch.currentBirdCount);
    }

    return entry;
  }

  async verifyEntry(
    entryId: string,
    dto: VerifyEntryDto,
    approvedById: string,
    approverRole: UserRole,
  ) {
    if (![UserRole.SUPERVISOR, UserRole.MANAGER, UserRole.OWNER].includes(approverRole)) {
      throw new ForbiddenException('Only Supervisors, Managers, or Owners can verify entries');
    }

    if (dto.status === EntryStatus.RETURNED && !dto.returnReason) {
      throw new BadRequestException('Return reason is required when returning an entry');
    }

    const entry = await this.prisma.flockDailyEntry.findUnique({
      where: { id: entryId },
      include: { submittedBy: true },
    });

    if (!entry) throw new NotFoundException('Entry not found');
    if (entry.status !== EntryStatus.PENDING) {
      throw new BadRequestException(`Entry is already ${entry.status}`);
    }

    const updated = await this.prisma.flockDailyEntry.update({
      where: { id: entryId },
      data: {
        status: dto.status,
        approvedById,
        approvedAt: new Date(),
        returnReason: dto.returnReason,
      },
    });

    // If approved, update batch bird count
    if (dto.status === EntryStatus.APPROVED) {
      await this.prisma.batch.update({
        where: { id: entry.batchId },
        data: { currentBirdCount: entry.closingCount },
      });
    }

    // Notify the attendant who submitted
    if (dto.status === EntryStatus.RETURNED) {
      await this.notifications.notifyUser(
        entry.submittedById,
        NotificationType.ENTRY_RETURNED,
        'Entry Returned for Correction',
        `Your entry for ${entry.entryDate.toDateString()} ${entry.shift} was returned: ${dto.returnReason}`,
        { entityId: entryId, entityType: 'FlockDailyEntry' },
      );
    }

    return updated;
  }

  async getPendingEntries(userRole: UserRole, userId: string) {
    const where =
      userRole === UserRole.ATTENDANT
        ? { submittedById: userId, status: EntryStatus.PENDING }
        : { status: EntryStatus.PENDING };

    return this.prisma.flockDailyEntry.findMany({
      where,
      include: {
        batch: { select: { batchCode: true, birdType: true } },
        submittedBy: { select: { fullName: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getEntriesForBatch(batchId: string, days = 14) {
    const from = dayjs().subtract(days, 'day').toDate();
    return this.prisma.flockDailyEntry.findMany({
      where: { batchId, entryDate: { gte: from } },
      include: {
        submittedBy: { select: { fullName: true } },
        approvedBy: { select: { fullName: true } },
      },
      orderBy: [{ entryDate: 'desc' }, { shift: 'asc' }],
    });
  }

  // ─── WEIGHT SAMPLES ────────────────────────────────────────────────────────

  async logWeightSample(
    batchId: string,
    sampleDate: string,
    sampleCount: number,
    totalWeightG: number,
    notes: string | undefined,
    recordedById: string,
  ) {
    if (totalWeightG <= 0 || sampleCount <= 0) {
      throw new BadRequestException('Sample count and weight must be positive');
    }
    const averageWeightG = totalWeightG / sampleCount;
    const batch = await this.prisma.batch.findUnique({ where: { id: batchId } });
    if (!batch) throw new NotFoundException('Batch not found');

    const ageWeeks = dayjs().diff(dayjs(batch.dateOfHatch), 'week');

    return this.prisma.birdWeightSample.create({
      data: {
        batchId,
        sampleDate: new Date(sampleDate),
        sampleCount,
        totalWeightG,
        averageWeightG,
        ageWeeks,
        notes,
        recordedById,
      },
    });
  }

  // ─── PRIVATE HELPERS ───────────────────────────────────────────────────────

  private calculateStage(ageWeeks: number): BatchStage {
    if (ageWeeks <= this.BROODING_MAX_WEEKS) return BatchStage.BROODING;
    if (ageWeeks <= this.GROWER_MAX_WEEKS) return BatchStage.GROWER;
    return BatchStage.PRODUCTION;
  }

  private async checkMortalityAnomaly(
    batchId: string,
    todayMortality: number,
    currentBirdCount: number,
  ): Promise<void> {
    // Get last 7 approved entries for this batch
    const recent = await this.prisma.flockDailyEntry.findMany({
      where: { batchId, status: EntryStatus.APPROVED },
      orderBy: { entryDate: 'desc' },
      take: 7,
      select: { mortalityCount: true },
    });

    if (recent.length < 3) return; // not enough history

    const avg = recent.reduce((sum, e) => sum + e.mortalityCount, 0) / recent.length;
    const threshold = avg * (1 + this.MORTALITY_ANOMALY_THRESHOLD);

    if (todayMortality > threshold && todayMortality > 0) {
      this.logger.warn(
        `Mortality anomaly: batch ${batchId} — today: ${todayMortality}, 7-day avg: ${avg.toFixed(1)}`,
      );
      await this.notifications.notifyRole(
        UserRole.MANAGER,
        NotificationType.MORTALITY_ANOMALY,
        'Mortality Anomaly Detected',
        `Batch mortality (${todayMortality} birds) is significantly above the 7-day average (${avg.toFixed(1)}). Please investigate.`,
      );
    }
  }
}
