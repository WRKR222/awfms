import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../../common/notifications/notifications.service';
import { HealthEventType, VaccinationRoute, UserRole, NotificationType } from '@prisma/client';
import { WeightAlertService } from '../weight/weight-alert.service';
import { batchAgeWeeks } from '../../common/feed/feed-standard.util';
import dayjs from 'dayjs';

@Injectable()
export class HealthService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private weightAlerts: WeightAlertService,
  ) {}

  // ── Health Events ──────────────────────────────────────────────────────────

  async logHealthEvent(dto: {
    batchId: string;
    eventType: HealthEventType;
    eventDate: string;
    affectedCount: number;
    symptoms?: string;
    diagnosis?: string;
    treatment?: string;
    notes?: string;
    rowCode?: string; // optional: explicit row code for CULLING/BIRD_MORTALITY events
    // ── WEIGHING event fields ──────────────────────────────────────────
    // `affectedCount` doubles as "birds sampled" for WEIGHING (see frontend
    // label swap in ManagerCullingPage). individualWeightsG is the primary
    // input going forward — one entry per sampled bird, in grams — with
    // totalWeightG/sampleCount kept for backward compatibility with any
    // caller that only has the aggregate. sourceUploadId is set when the
    // PM autofilled this entry from a BirdWeightReportUpload.
    sampleCount?: number;
    totalWeightG?: number;
    individualWeightsG?: number[];
    sourceUploadId?: string;
  }, recordedById: string) {
    // Only pass fields that exist on HealthEvent model — avoids Prisma "Unknown arg" errors.
    // HealthEvent has: batchId, eventType, eventDate, affectedCount, symptoms, diagnosis,
    // treatment, outcome, isResolved, resolvedAt, recordedById. "notes" → "outcome".
    const event = await this.prisma.healthEvent.create({
      data: {
        batchId:       dto.batchId,
        eventType:     dto.eventType,
        eventDate:     new Date(dto.eventDate),
        affectedCount: dto.affectedCount,
        symptoms:      dto.symptoms ?? null,
        diagnosis:     dto.diagnosis ?? null,
        treatment:     dto.treatment ?? null,
        outcome:       dto.notes ?? null,
        recordedById,
      },
    });

    // ── WEIGHING: persist the actual weight sample and check it against
    //    the HyLine standard band. Previously this data was collected by
    //    the Farm Events form (sampleCount/totalWeightG) but silently
    //    dropped here — HealthEvent has no weight columns — so nothing
    //    was ever saved for a "Bird Weighing" event. Now it's written to
    //    BirdWeightSample (the same table the brooder cage-map weighing
    //    flow uses), including per-bird weights when the form/upload
    //    provided them, and run through WeightAlertService exactly like a
    //    production report's avgWeight column.
    if (dto.eventType === 'WEIGHING') {
      const individualWeightsG = (dto.individualWeightsG ?? []).filter(w => Number.isFinite(w) && w > 0);
      const sampleCount = individualWeightsG.length > 0 ? individualWeightsG.length : (dto.sampleCount ?? dto.affectedCount);
      const totalWeightG = individualWeightsG.length > 0
        ? Math.round(individualWeightsG.reduce((s, w) => s + w, 0))
        : Math.round(dto.totalWeightG ?? 0);

      if (sampleCount > 0 && totalWeightG > 0) {
        const batch = await this.prisma.batch.findUnique({
          where: { id: dto.batchId },
          select: { dateOfHatch: true },
        });
        const sampleDate = new Date(dto.eventDate);
        const ageWeeks = batch ? batchAgeWeeks(batch.dateOfHatch, sampleDate) : 1;
        const averageWeightG = Math.round((totalWeightG / sampleCount) * 100) / 100;

        const sample = await this.prisma.birdWeightSample.create({
          data: {
            batchId: dto.batchId,
            sampleDate,
            sampleCount,
            totalWeightG,
            averageWeightG,
            ageWeeks,
            individualWeightsG,
            sourceUploadId: dto.sourceUploadId ?? null,
            notes: dto.notes ?? null,
            recordedById,
          },
        });

        // Best-effort — a failure here must never block the Farm Event
        // itself from being saved (see WeightAlertService header note).
        await this.weightAlerts.evaluateWeightSample({
          batchId: dto.batchId,
          sampleDate,
          averageWeightG,
          sampleCount,
          source: 'FARM_EVENT',
          sourceId: sample.id,
        }).catch(() => { /* alert is best-effort; sample is already saved */ });
      }
    }

    // When a batch is sold or discarded, update its stage explicitly so the
    // BatchStage enum is correct (SOLD vs DISCARDED — not just CLOSED).
    if (dto.eventType === 'BATCH_SOLD') {
      await this.prisma.batch.update({
        where: { id: dto.batchId },
        data: { isActive: false, stage: 'SOLD' as any, soldAt: new Date() },
      });
      // Clear production-house cage-row assignments so cage map shows rows as vacant
      await this.prisma.batchCageAssignment.deleteMany({ where: { batchId: dto.batchId } });
      // FIX: also clear brooder level assignments so the brooder cage map vacates
      // correctly when a batch is sold while still in BROODING stage.
      // Previously only BatchLifecycleService.updateBatchStage() cleared this table,
      // but Farm Events bypass that path — leaving orphaned BrooderLevelAssignment
      // rows that kept the brooder map occupied and the feed requirement non-zero.
      await this.prisma.brooderCageAssignment.deleteMany({ where: { batchId: dto.batchId } });
      await this.prisma.brooderLevelAssignment.deleteMany({ where: { batchId: dto.batchId } });
      // ── Notify Director (OWNER) — batch sold ─────────────────────────────
      const batch = await this.prisma.batch.findUnique({ where: { id: dto.batchId }, select: { batchCode: true } });
      await this.notifications.notifyRole(
        UserRole.OWNER, NotificationType.SYSTEM,
        'Batch Sold',
        `Batch ${batch?.batchCode ?? dto.batchId} has been marked as SOLD by the Production Manager on ${dayjs(dto.eventDate).format('D MMM YYYY')}.${dto.notes ? ' Notes: ' + dto.notes : ''}`,
        { entityId: event.id, entityType: 'HealthEvent' },
      ).catch(() => { /* best-effort */ });
    } else if (dto.eventType === 'BATCH_DISCARDED') {
      await this.prisma.batch.update({
        where: { id: dto.batchId },
        data: { isActive: false, stage: 'DISCARDED' as any, discardedAt: new Date() },
      });
      // Clear production-house cage-row assignments so cage map shows rows as vacant
      await this.prisma.batchCageAssignment.deleteMany({ where: { batchId: dto.batchId } });
      // FIX: also clear brooder level assignments (same reason as BATCH_SOLD above)
      await this.prisma.brooderCageAssignment.deleteMany({ where: { batchId: dto.batchId } });
      await this.prisma.brooderLevelAssignment.deleteMany({ where: { batchId: dto.batchId } });
      // ── Notify Director (OWNER) — batch discarded ─────────────────────────
      const batch = await this.prisma.batch.findUnique({ where: { id: dto.batchId }, select: { batchCode: true } });
      await this.notifications.notifyRole(
        UserRole.OWNER, NotificationType.SYSTEM,
        'Batch Discarded',
        `Batch ${batch?.batchCode ?? dto.batchId} has been DISCARDED by the Production Manager on ${dayjs(dto.eventDate).format('D MMM YYYY')}.${dto.notes ? ' Notes: ' + dto.notes : ''}`,
        { entityId: event.id, entityType: 'HealthEvent' },
      ).catch(() => { /* best-effort */ });
    }

    // When birds are culled OR die (BIRD_MORTALITY), subtract affected count from
    // batch's currentBirdCount.
    // FIX: this previously only ran for 'CULLING' — BIRD_MORTALITY events were
    // recorded in the HealthEvent log but never reflected in currentBirdCount,
    // so the cage map and batch page kept showing the pre-mortality count.
    if ((dto.eventType === 'CULLING' || dto.eventType === 'BIRD_MORTALITY') && dto.affectedCount > 0) {
      // Decrement currentBirdCount on the batch — this is the authoritative
      // total live bird count read by the cage map stats bar.
      await this.prisma.batch.update({
        where: { id: dto.batchId },
        data: { currentBirdCount: { decrement: dto.affectedCount } },
      });

      // If a specific row was selected, subtract from that row's birdCount only.
      // If no row was selected, leave all per-row birdCounts untouched —
      // the cage map reads currentBirdCount directly so it will still update.
      // Identify which row to subtract from.
      // Prefer the explicit rowCode field sent by the frontend; fall back to
      // parsing "row <CODE>" from the notes string for backwards compatibility.
      const rowCode = (dto.rowCode as string | undefined)?.toUpperCase()
        ?? (dto.notes ?? '').match(/row\s+(\w+)/i)?.[1]?.toUpperCase();

      if (rowCode) {
        const assignments = await this.prisma.batchCageAssignment.findMany({
          where: { batchId: dto.batchId },
          include: { row: { select: { rowCode: true } } },
        });
        const match = assignments.find((a: any) => a.row?.rowCode === rowCode);
        if (match) {
          await this.prisma.batchCageAssignment.update({
            where: { id: match.id },
            data: { birdCount: Math.max(0, match.birdCount - dto.affectedCount) },
          });
        }
      }
    }

    return event;
  }

  async getHealthEvents(batchId: string) {
    return this.prisma.healthEvent.findMany({
      where: { batchId },
      orderBy: { eventDate: 'desc' },
      include: {
        vetReports: { select: { id: true, reportDate: true, summary: true, vetName: true } },
      },
    });
  }

  async getAllHealthEvents(limit = 50, batchId?: string) {
    return this.prisma.healthEvent.findMany({
      where: { ...(batchId ? { batchId } : {}) },
      orderBy: { eventDate: 'desc' },
      take: limit,
      include: {
        batch: { select: { batchCode: true } },
        vetReports: { select: { id: true, reportDate: true, summary: true, vetName: true } },
      },
    });
  }

  async deleteHealthEvent(id: string) {
    await this.prisma.healthEvent.delete({ where: { id } });
    return { success: true };
  }

  // ── Vaccinations ───────────────────────────────────────────────────────────

  async logVaccination(dto: {
    batchId: string;
    scheduleId?: string;
    vaccineName: string;
    administeredDate: string;
    route: VaccinationRoute;
    batchSize: number;
    dosageUnits?: string;
    vetName?: string;
    notes?: string;
  }, recordedById: string) {
    return this.prisma.vaccinationRecord.create({
      data: { ...dto, administeredDate: new Date(dto.administeredDate), recordedById },
    });
  }

  async getVaccinationSchedule(birdType?: string) {
    return this.prisma.vaccinationSchedule.findMany({
      where: { isActive: true, ...(birdType && { birdType: birdType as any }) },
      orderBy: { ageWeeks: 'asc' },
    });
  }

  // ── Visitor Log ────────────────────────────────────────────────────────────

  async logVisitor(dto: {
    visitorName: string;
    organisation?: string;
    purpose: string;
    checkInAt: string;
    houseId?: string;
    biosecurityChecks: Record<string, boolean>;
    advanceNoticeId?: string;
  }, recordedById: string) {
    const log = await this.prisma.visitorLog.create({
      data: {
        visitorName: dto.visitorName,
        organisation: dto.organisation,
        purpose: dto.purpose,
        checkInAt: new Date(dto.checkInAt),
        houseId: dto.houseId,
        biosecurityChecks: dto.biosecurityChecks,
        recordedById,
      },
    });

    // Link advance notice if provided
    if (dto.advanceNoticeId) {
      await this.prisma.visitorAdvanceNotice.update({
        where: { id: dto.advanceNoticeId },
        data: { status: 'COMPLETED', visitorLogId: log.id },
      });
    }

    return log;
  }

  async getVisitors(days = 30) {
    const safeDays = Number(days) > 0 ? Number(days) : 30;
    const from = dayjs().subtract(safeDays, 'day').toDate();
    return this.prisma.visitorLog.findMany({
      where: { checkInAt: { gte: from } },
      orderBy: { checkInAt: 'desc' },
    });
  }

  async checkOutVisitor(visitorLogId: string) {
    const log = await this.prisma.visitorLog.findUnique({ where: { id: visitorLogId } });
    if (!log) throw new NotFoundException('Visitor log not found');

    const updated = await this.prisma.visitorLog.update({
      where: { id: visitorLogId },
      data: { checkOutAt: new Date() },
    });

    // Notify Director when visitor departs (HL-03)
    await this.notifications.notifyRole(
      UserRole.OWNER,
      NotificationType.SYSTEM,
      'Visitor Departed',
      `${log.visitorName}${log.organisation ? ` (${log.organisation})` : ''} has checked out.`,
      { entityId: visitorLogId, entityType: 'visitor_log' },
    );

    return updated;
  }

  // ── Visitor Advance Notice (HL-04) ─────────────────────────────────────────

  async createAdvanceNotice(dto: {
    expectedDate: string;
    visitorName: string;
    organisation?: string;
    phone?: string;
    idNumber?: string;
    purpose: string;
    expectedCount?: number;
    houseIds?: string[];
    notes?: string;
  }, requestedById: string) {
    const expectedDate = new Date(dto.expectedDate);
    if (isNaN(expectedDate.getTime())) {
      throw new BadRequestException('Invalid expected date/time');
    }
    // Cannot schedule an advance visit in the past, relative to the moment
    // it's being logged. Date-only submissions (no time-of-day, e.g. the
    // Manager flow's plain date picker) are compared by calendar day so
    // "today" still validates; full date+time submissions (e.g. Store's
    // datetime picker) are compared by exact instant.
    const hasTimeComponent = /T\d/.test(dto.expectedDate);
    const isPast = hasTimeComponent
      ? expectedDate.getTime() < Date.now()
      : dayjs(expectedDate).isBefore(dayjs(), 'day');
    if (isPast) {
      throw new BadRequestException('Expected arrival date/time cannot be in the past');
    }

    const notice = await this.prisma.visitorAdvanceNotice.create({
      data: {
        expectedDate,
        visitorName: dto.visitorName,
        organisation: dto.organisation,
        phone: dto.phone,
        idNumber: dto.idNumber,
        purpose: dto.purpose,
        expectedCount: dto.expectedCount ?? 1,
        houseIds: dto.houseIds ?? [],
        notes: dto.notes,
        requestedById,
        status: 'PENDING',
      },
    });

    // Notify Director to approve
    await this.notifications.notifyRole(
      UserRole.OWNER,
      NotificationType.SYSTEM,
      'Visitor Notice Requires Approval',
      `${dto.visitorName}${dto.organisation ? ` (${dto.organisation})` : ''} is expected on ${dayjs(dto.expectedDate).format('D MMM YYYY, HH:mm')}. Please review and approve.`,
      { entityId: notice.id, entityType: 'visitor_advance_notice' },
    );

    return notice;
  }

  async getAdvanceNotices(days = 30) {
    const safeDays = Number(days) > 0 ? Number(days) : 30;
    const from = dayjs().subtract(safeDays, 'day').toDate();
    const until = dayjs().add(30, 'day').toDate();
    return this.prisma.visitorAdvanceNotice.findMany({
      where: { expectedDate: { gte: from, lte: until } },
      orderBy: { expectedDate: 'asc' },
    });
  }

  async updateAdvanceNoticeStatus(
    id: string,
    status: 'APPROVED' | 'REJECTED',
    directorNote: string | undefined,
    approvedById: string,
  ) {
    const notice = await this.prisma.visitorAdvanceNotice.update({
      where: { id },
      data: {
        status,
        directorNote,
        approvedById,
        approvedAt: new Date(),
      },
    });

    // Notify the Manager who requested it
    await this.prisma.notification.create({
      data: {
        userId: notice.requestedById,
        type: NotificationType.SYSTEM,
        title: `Visitor Notice ${status === 'APPROVED' ? 'Approved' : 'Rejected'}`,
        message: `Your request for ${notice.visitorName} on ${dayjs(notice.expectedDate).format('D MMM YYYY')} has been ${status.toLowerCase()}${directorNote ? `: ${directorNote}` : '.'}`,
        entityId: id,
        entityType: 'visitor_advance_notice',
      },
    });

    return notice;
  }

  // ── Biosecurity Checkpoint (Phase 5 — HL-02) ──────────────────────────────

  async submitBiosecurityLog(dto: {
    logDate: string;
    checkpointType: 'MAIN_GATE' | 'FARM_GATE';
    checks: Record<string, string>;
    itemNotes: Record<string, string>;
    overallNotes?: string;
    failCount: number;
  }, loggedById: string) {
    const log = await this.prisma.biosecurityLog.create({
      data: {
        logDate:        new Date(dto.logDate),
        checkpointType: dto.checkpointType,
        loggedById,
        checks:         dto.checks,
        itemNotes:      dto.itemNotes,
        overallNotes:   dto.overallNotes,
        failCount:      dto.failCount,
      },
    });

    if (dto.failCount > 0) {
      const dateStr = dayjs(dto.logDate).format('D MMM YYYY');
      await this.notifications.notifyRole(
        UserRole.OWNER, NotificationType.SYSTEM,
        'Biosecurity Issues Detected',
        `${dto.failCount} biosecurity issue(s) at ${dto.checkpointType.replace('_', ' ')} on ${dateStr}.`,
        { entityId: log.id, entityType: 'biosecurity_log' },
      );
    }

    return log;
  }

  async getBiosecurityLogs(days = 30, checkpointType?: string) {
    const safeDays = Number(days) > 0 ? Number(days) : 30;
    const from = dayjs().subtract(safeDays, 'day').toDate();
    return this.prisma.biosecurityLog.findMany({
      where: {
        logDate: { gte: from },
        ...(checkpointType && { checkpointType }),
      },
      orderBy: { logDate: 'desc' },
    });
  }

  async getVaccinationRecords(batchId?: string, limit = 50) {
    return this.prisma.vaccinationRecord.findMany({
      where: { ...(batchId ? { batchId } : {}) },
      orderBy: { administeredDate: 'desc' },
      take: limit,
      include: {
        schedule: { select: { vaccineName: true, ageWeeks: true } },
      },
    });
  }
}
