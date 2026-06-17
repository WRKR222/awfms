import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../../common/notifications/notifications.service';
import { HealthEventType, VaccinationRoute, UserRole, NotificationType } from '@prisma/client';
import dayjs from 'dayjs';

@Injectable()
export class HealthService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
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

    // When a batch is sold or discarded, update its stage explicitly so the
    // BatchStage enum is correct (SOLD vs DISCARDED — not just CLOSED).
    if (dto.eventType === 'BATCH_SOLD') {
      await this.prisma.batch.update({
        where: { id: dto.batchId },
        data: { isActive: false, stage: 'SOLD' as any, soldAt: new Date() },
      });
      // Clear cage assignments so cage map shows rows as vacant
      await this.prisma.batchCageAssignment.deleteMany({ where: { batchId: dto.batchId } });
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
      // Clear cage assignments so cage map shows rows as vacant
      await this.prisma.batchCageAssignment.deleteMany({ where: { batchId: dto.batchId } });
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
    const from = dayjs().subtract(days, 'day').toDate();
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
    purpose: string;
    expectedCount?: number;
    houseIds?: string[];
  }, requestedById: string) {
    const notice = await this.prisma.visitorAdvanceNotice.create({
      data: {
        expectedDate: new Date(dto.expectedDate),
        visitorName: dto.visitorName,
        organisation: dto.organisation,
        purpose: dto.purpose,
        expectedCount: dto.expectedCount ?? 1,
        houseIds: dto.houseIds ?? [],
        requestedById,
        status: 'PENDING',
      },
    });

    // Notify Director to approve
    await this.notifications.notifyRole(
      UserRole.OWNER,
      NotificationType.SYSTEM,
      'Visitor Notice Requires Approval',
      `${dto.visitorName}${dto.organisation ? ` (${dto.organisation})` : ''} is expected on ${dayjs(dto.expectedDate).format('D MMM YYYY')}. Please review and approve.`,
      { entityId: notice.id, entityType: 'visitor_advance_notice' },
    );

    return notice;
  }

  async getAdvanceNotices(days = 30) {
    const from = dayjs().subtract(days, 'day').toDate();
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
    const from = dayjs().subtract(days, 'day').toDate();
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
