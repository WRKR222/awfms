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
    notes?: string;  // FIX: added missing notes field
  }, recordedById: string) {
    // FIX C2: Re-enabled event types per PM Activity Diagram – Farm Event Recording
    // and system specification. DISEASE_OUTBREAK, INJURY, QUARANTINE_IMPOSED,
    // QUARANTINE_LIFTED are all valid PM farm events.
    const event = await this.prisma.healthEvent.create({
      data: { ...dto, eventDate: new Date(dto.eventDate), recordedById },
    });

    // When a batch is sold or discarded, update its stage explicitly so the
    // BatchStage enum is correct (SOLD vs DISCARDED — not just CLOSED).
    if (dto.eventType === 'BATCH_SOLD') {
      await this.prisma.batch.update({
        where: { id: dto.batchId },
        data: { isActive: false, stage: 'SOLD' as any, soldAt: new Date() },
      });
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
      // ── Notify Director (OWNER) — batch discarded ─────────────────────────
      const batch = await this.prisma.batch.findUnique({ where: { id: dto.batchId }, select: { batchCode: true } });
      await this.notifications.notifyRole(
        UserRole.OWNER, NotificationType.SYSTEM,
        'Batch Discarded',
        `Batch ${batch?.batchCode ?? dto.batchId} has been DISCARDED by the Production Manager on ${dayjs(dto.eventDate).format('D MMM YYYY')}.${dto.notes ? ' Notes: ' + dto.notes : ''}`,
        { entityId: event.id, entityType: 'HealthEvent' },
      ).catch(() => { /* best-effort */ });
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

  // ── Health Checklist (Phase 5 — HL-01) ────────────────────────────────────

  async submitChecklist(dto: {
    checkDate: string;
    shift: string;
    houseId?: string;
    checks: Record<string, string>;
    itemNotes: Record<string, string>;
    overallNotes?: string;
    failCount: number;
  }, submittedById: string) {
    const checklist = await this.prisma.healthChecklist.create({
      data: {
        checkDate:    new Date(dto.checkDate),
        shift:        dto.shift,
        houseId:      dto.houseId,
        submittedById,
        checks:       dto.checks,
        itemNotes:    dto.itemNotes,
        overallNotes: dto.overallNotes,
        failCount:    dto.failCount,
      },
    });

    // If failures found, notify Manager and Owner
    if (dto.failCount > 0) {
      const dateStr = dayjs(dto.checkDate).format('D MMM YYYY');
      const msg = `${dto.failCount} issue(s) flagged on the ${dto.shift} health checklist for ${dateStr}.`;

      await this.notifications.notifyRole(
        UserRole.MANAGER, NotificationType.SYSTEM,
        'Health Checklist Issues Flagged', msg,
        { entityId: checklist.id, entityType: 'health_checklist' },
      );
      await this.notifications.notifyRole(
        UserRole.OWNER, NotificationType.SYSTEM,
        'Health Checklist Issues Flagged', msg,
        { entityId: checklist.id, entityType: 'health_checklist' },
      );
    }

    return checklist;
  }

  async getChecklists(days = 14) {
    const from = dayjs().subtract(days, 'day').toDate();
    return this.prisma.healthChecklist.findMany({
      where: { checkDate: { gte: from } },
      orderBy: { checkDate: 'desc' },
    });
  }

  async getChecklistById(id: string) {
    return this.prisma.healthChecklist.findUnique({ where: { id } });
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
}
