// src/modules/store/issuance-plan.service.ts
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../../common/notifications/notifications.service';
import { NotificationType, UserRole, BatchStage, Prisma } from '@prisma/client';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import utc from 'dayjs/plugin/utc';
import PDFDocument from 'pdfkit';
import { Response } from 'express';

dayjs.extend(isoWeek);
dayjs.extend(utc);

const DAY_KEYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
type DayKey = (typeof DAY_KEYS)[number];

function sundayOf(monday: Date): Date {
  return dayjs.utc(monday).add(6, 'day').endOf('day').toDate();
}

// ─── Feed type labels / SKUs for the PM feed plan auto-injection ──────────────
const FEED_LABELS: Record<string, string> = {
  CHICK_MASH: 'Chick & Duckling Mash',
  GROWER_MASH: "Grower's Mash",
  LAYER_MASH: 'Layer Mash',
  KIENYEJI_STARTER: 'Kienyeji Starter',
  KIENYEJI_GROWER: 'Kienyeji Grower',
  KIENYEJI_FINISHER: 'Kienyeji Finisher',
};

const FEED_SKU: Record<string, string> = {
  CHICK_MASH: 'FEED-CHICK-MASH',
  GROWER_MASH: 'FEED-GROWER-MASH',
  LAYER_MASH: 'FEED-LAYER-MASH',
  KIENYEJI_STARTER: 'FEED-KIENYEJI-STARTER',
  KIENYEJI_GROWER: 'FEED-KIENYEJI-GROWER',
  KIENYEJI_FINISHER: 'FEED-KIENYEJI-FINISHER',
};

// Item-include shape reused across list/get so the frontend always gets the
// same per-item approval fields regardless of which endpoint it called.
const ITEM_INCLUDE = {
  storeItem: { select: { id: true, name: true, sku: true, unit: true, currentStock: true } },
  // accountantApprovedBy kept for backward compat on older records; null for all new plans
  accountantApprovedBy: { select: { id: true, fullName: true } },
  directorApprovedBy: { select: { id: true, fullName: true } },
  rejectedBy: { select: { id: true, fullName: true } },
} as const;

@Injectable()
export class IssuancePlanService {
  private readonly logger = new Logger(IssuancePlanService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────────
  // PLAN-LEVEL PHASE — recomputed from item statuses, not stored as a free choice
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Plan phase (Director-only flow):
   * - DRAFT: plan hasn't been submitted yet
   * - PENDING_DIRECTOR: submitted and awaiting Director action on ≥1 item
   * - DECIDED: every item has a final outcome (APPROVED or REJECTED)
   *
   * PENDING_ACCOUNTANT is kept in the DB enum for compat but is never written
   * for new plans. Legacy records migrated by 20260629 migration.
   */
  private computePhase(items: { status: string }[], wasSubmitted: boolean): 'DRAFT' | 'PENDING_DIRECTOR' | 'DECIDED' {
    if (!wasSubmitted) return 'DRAFT';
    if (items.length === 0) return 'DRAFT';
    // Any item that isn't yet APPROVED or REJECTED means we're still pending Director
    if (items.some((i) => !['APPROVED', 'REJECTED'].includes(i.status))) return 'PENDING_DIRECTOR';
    return 'DECIDED';
  }

  private async syncPhase(planId: string) {
    const plan = await this.prisma.issuancePlan.findUnique({
      where: { id: planId },
      include: { items: { select: { status: true } } },
    });
    if (!plan) return;
    const wasSubmitted = plan.phase !== 'DRAFT';
    const phase = this.computePhase(plan.items, wasSubmitted);
    await this.prisma.issuancePlan.update({ where: { id: planId }, data: { phase: phase as any } });
    return phase;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // CREATE
  // Store can create a DRAFT on any day of the week.
  // Weekly plans can now also be SUBMITTED any day of the week.
  // ─────────────────────────────────────────────────────────────────────────────

  async createPlan(
    dto: {
      type: 'WEEKLY' | 'EMERGENCY';
      weekStartDate: string;
      notes?: string;
      emergencyReason?: string;
      items: {
        storeItemId: string;
        quantityPlanned?: number;
        unitPriceKes: number;
        dailyBreakdown?: Record<string, number>;
        notes?: string;
      }[];
    },
    userId: string,
  ) {
    const monday = dayjs.utc(dto.weekStartDate).startOf('day').toDate();
    const sunday = sundayOf(monday);

    if (dayjs.utc(monday).isoWeekday() !== 1) {
      throw new BadRequestException('weekStartDate must be a Monday');
    }

    // No day-of-week gate on CREATE — Store can draft at any time.
    // No day-of-week gate on SUBMIT either — Store can submit whenever the draft is ready.

    const enrichedItems = dto.items.map((item) => {
      let qtyPlanned = Number(item.quantityPlanned ?? 0);
      if (item.dailyBreakdown && dto.type === 'WEEKLY') {
        qtyPlanned = Object.values(item.dailyBreakdown).reduce((s: number, v: unknown) => s + Number(v ?? 0), 0);
      }
      if (!isFinite(qtyPlanned) || qtyPlanned < 0) qtyPlanned = 0;
      return { ...item, quantityPlanned: qtyPlanned };
    });

    const count = await this.prisma.issuancePlan.count();
    const prefix = dto.type === 'EMERGENCY' ? 'EIP' : 'IP';
    const planRef = `${prefix}-${dayjs().format('YYYY')}-${String(count + 1).padStart(4, '0')}`;

    const plan = await this.prisma.issuancePlan.create({
      data: {
        planRef,
        type: dto.type as any,
        weekStartDate: monday,
        weekEndDate: sunday,
        phase: 'DRAFT',
        notes: dto.notes,
        emergencyReason: dto.type === 'EMERGENCY' ? dto.emergencyReason : null,
        createdById: userId,
      },
    });

    if (enrichedItems.length > 0) {
      await this.prisma.issuancePlanItem.createMany({
        data: enrichedItems.map((item) => ({
          planId: plan.id,
          storeItemId: item.storeItemId,
          quantityPlanned: item.quantityPlanned,
          unitPriceKes: item.unitPriceKes,
          dailyBreakdown: item.dailyBreakdown ?? Prisma.JsonNull,
          notes: item.notes,
          source: 'MANUAL',
          // Director-only flow: skip PENDING_ACCOUNTANT, go straight to PENDING_DIRECTOR
          status: 'PENDING_DIRECTOR',
        })),
      });
    }

    // If this is a new WEEKLY draft, pick up any feed consumption plans the PM
    // already submitted for this week.
    if (dto.type === 'WEEKLY') {
      const existingFeedPlans = await this.prisma.feedConsumptionPlan.findMany({
        where: { weekStartDate: monday },
      });
      for (const fp of existingFeedPlans) {
        await this.injectFeedLineIntoPlan(monday, fp.stage, fp.feedType, Number(fp.gramsPerBirdPerDay));
      }
    }

    return this.getPlan(plan.id);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // UPDATE (edit line items)
  // Store can edit DRAFT plans any day. Director can edit items in their queue.
  // ─────────────────────────────────────────────────────────────────────────────

  async updatePlan(
    id: string,
    dto: {
      notes?: string;
      emergencyReason?: string;
      items?: {
        id?: string;
        storeItemId: string;
        quantityPlanned?: number;
        unitPriceKes: number;
        dailyBreakdown?: Record<string, number>;
        notes?: string;
        source?: string;
      }[];
    },
    userRole: string,
  ) {
    const plan = await this.prisma.issuancePlan.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!plan) throw new NotFoundException('Issuance plan not found');

    // Store: edits while DRAFT (pre-submit) — items must be PENDING_DIRECTOR
    //   (that's the initial status now for all new items)
    // Director: can edit PENDING_DIRECTOR, APPROVED, or REJECTED items
    const editableItemStatuses: Record<string, string[]> = {
      STORE: ['PENDING_DIRECTOR'],
      OWNER: ['PENDING_DIRECTOR', 'APPROVED', 'REJECTED'],
    };
    const allowedStatuses = editableItemStatuses[userRole] ?? [];

    await this.prisma.$transaction(async (tx) => {
      if (dto.items) {
        const existing = plan.items;
        const existingIds = new Set(existing.map((e) => e.id));
        const submittedIds = new Set(dto.items.filter((i: any) => i.id).map((i: any) => i.id));

        for (const item of dto.items as any[]) {
          if (item.id && existingIds.has(item.id)) {
            const prior = existing.find((e) => e.id === item.id)!;
            if (!allowedStatuses.includes(prior.status)) {
              throw new ForbiddenException(
                `As ${userRole === 'STORE' ? 'Store' : 'Director'}, ` +
                  `you cannot edit "${prior.id}" while it is ${prior.status.replace('_', ' ').toLowerCase()}.`,
              );
            }
          } else if (userRole !== 'STORE') {
            throw new ForbiddenException('Only Store can add new line items to an issuance plan.');
          }
        }

        const idsToDelete = [...existingIds].filter((eid) => !submittedIds.has(eid));
        if (idsToDelete.length > 0) {
          const withIssuance = existing.filter(
            (e) => idsToDelete.includes(e.id) && Number(e.quantityIssued) > 0,
          );
          if (withIssuance.length > 0) {
            throw new BadRequestException(
              `Cannot remove a line item that already has stock issued against it (${withIssuance
                .map((w) => w.id)
                .join(', ')}). Set its planned quantity to match what's been issued instead.`,
            );
          }
          const notAllowed = existing.filter(
            (e) => idsToDelete.includes(e.id) && !allowedStatuses.includes(e.status),
          );
          if (notAllowed.length > 0) {
            throw new ForbiddenException('You cannot remove a line item that is not at your stage of approval.');
          }
          await tx.issuancePlanItem.deleteMany({ where: { id: { in: idsToDelete } } });
        }

        for (const item of dto.items as any[]) {
          let qtyPlanned = Number(item.quantityPlanned ?? 0);
          if (item.dailyBreakdown && plan.type === 'WEEKLY') {
            qtyPlanned = Object.values(item.dailyBreakdown as Record<string, number>).reduce(
              (s: number, v: number) => s + Number(v ?? 0),
              0,
            );
          }
          if (!isFinite(qtyPlanned) || qtyPlanned < 0) qtyPlanned = 0;

          if (item.id && existingIds.has(item.id)) {
            const prior = existing.find((e) => e.id === item.id)!;
            // Editing a Director-decided item (APPROVED/REJECTED) re-opens it
            // to PENDING_DIRECTOR — only the Director signature is needed again.
            const willReopenItem = ['APPROVED', 'REJECTED'].includes(prior.status);
            await tx.issuancePlanItem.update({
              where: { id: item.id },
              data: {
                storeItemId: item.storeItemId,
                quantityPlanned: qtyPlanned,
                unitPriceKes: item.unitPriceKes,
                dailyBreakdown: item.dailyBreakdown ?? Prisma.JsonNull,
                notes: item.notes,
                source: item.source ?? prior.source,
                ...(willReopenItem
                  ? {
                      status: 'PENDING_DIRECTOR',
                      accountantApprovedById: null,
                      accountantApprovedAt: null,
                      directorApprovedById: null,
                      directorApprovedAt: null,
                      rejectedById: null,
                      rejectedAt: null,
                      rejectionReason: null,
                    }
                  : {}),
              },
            });
          } else {
            await tx.issuancePlanItem.create({
              data: {
                planId: id,
                storeItemId: item.storeItemId,
                quantityPlanned: qtyPlanned,
                unitPriceKes: item.unitPriceKes,
                dailyBreakdown: item.dailyBreakdown ?? Prisma.JsonNull,
                notes: item.notes,
                source: item.source ?? 'MANUAL',
                status: 'PENDING_DIRECTOR',
              },
            });
          }
        }
      }

      if (dto.notes !== undefined) {
        await tx.issuancePlan.update({ where: { id }, data: { notes: dto.notes } });
      }
      if (dto.emergencyReason !== undefined && plan.type === 'EMERGENCY') {
        await tx.issuancePlan.update({ where: { id }, data: { emergencyReason: dto.emergencyReason } });
      }
    });

    await this.syncPhase(id);
    return this.getPlan(id);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SUBMIT (Store: DRAFT → every item PENDING_DIRECTOR, phase → PENDING_DIRECTOR)
  // Weekly plans can be submitted any day of the week. Director notified immediately.
  // ─────────────────────────────────────────────────────────────────────────────

  async submitPlan(id: string, userId: string) {
    const plan = await this.prisma.issuancePlan.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!plan) throw new NotFoundException('Issuance plan not found');
    if (plan.phase !== 'DRAFT') {
      throw new BadRequestException('Only DRAFT plans can be submitted');
    }
    if (plan.items.length === 0) {
      throw new BadRequestException('Cannot submit an issuance plan with no items');
    }

    if (plan.type === 'EMERGENCY' && !plan.emergencyReason?.trim()) {
      throw new BadRequestException(
        'A reason is required before an emergency issuance plan can be submitted.',
      );
    }

    // Ensure all items are PENDING_DIRECTOR (in case any were pre-loaded as drafts)
    await this.prisma.issuancePlanItem.updateMany({
      where: { planId: id, status: { notIn: ['APPROVED', 'REJECTED'] } },
      data: { status: 'PENDING_DIRECTOR' },
    });

    await this.prisma.issuancePlan.update({
      where: { id },
      data: { phase: 'PENDING_DIRECTOR' },
    });

    // Notify Director only — Accountant receives a read-only copy once approved
    await this.notifications.notifyRole(
      UserRole.OWNER,
      NotificationType.ISSUANCE_PLAN_SUBMITTED as any,
      'New Issuance Plan Awaiting Your Approval',
      `${plan.type === 'EMERGENCY' ? 'Emergency issuance plan' : 'Weekly issuance plan'} ${plan.planRef} (${plan.items.length} item${plan.items.length > 1 ? 's' : ''}) has been submitted and requires your approval.`,
      { entityId: id, entityType: 'IssuancePlan' },
    );

    return this.getPlan(id);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PER-ITEM APPROVE / REJECT — Director only
  // Director can approve/reject on any day of the week for any plan type.
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Approve a single line item.
   * Director moves it PENDING_DIRECTOR → APPROVED.
   * Sibling items on the same plan are completely unaffected.
   */
  async approveItem(planId: string, itemId: string, userId: string, userRole: string) {
    if (userRole !== 'OWNER') {
      throw new ForbiddenException('Only the Director can approve issuance plan items');
    }

    const item = await this.prisma.issuancePlanItem.findUnique({
      where: { id: itemId },
      include: { plan: true, storeItem: true },
    });
    if (!item || item.planId !== planId) throw new NotFoundException('Issuance plan item not found');

    if (item.status !== 'PENDING_DIRECTOR') {
      throw new BadRequestException('This item is not awaiting Director approval');
    }

    await this.prisma.issuancePlanItem.update({
      where: { id: itemId },
      data: {
        status: 'APPROVED',
        directorApprovedById: userId,
        directorApprovedAt: new Date(),
      },
    });
    await this.syncPhase(planId);

    // Notify Store that this item is now authorised for stock issuance
    await this.notifications.notifyRole(
      UserRole.STORE,
      NotificationType.ISSUANCE_PLAN_APPROVED as any,
      'Issuance Plan Item Approved — Stock Can Now Be Issued',
      `"${item.storeItem.name}" on plan ${item.plan.planRef} has been approved by the Director. You may now issue stock against this line.`,
      { entityId: planId, entityType: 'IssuancePlan' },
    );

    // Accountant visibility: notify them of what the Director approved so they
    // can reconcile spend — they don't approve, they only observe the outcome.
    await this.notifications.notifyRole(
      UserRole.ACCOUNTANT,
      NotificationType.ISSUANCE_PLAN_APPROVED as any,
      `Director Approved Issuance — ${item.plan.planRef}`,
      `Director approved "${item.storeItem.name}" on plan ${item.plan.planRef}. Stock issuance for this item is now active.`,
      { entityId: planId, entityType: 'IssuancePlan' },
    );

    return this.getPlan(planId);
  }

  /** Reject a single line item. Director only. Siblings unaffected. */
  async rejectItem(
    planId: string,
    itemId: string,
    userId: string,
    userRole: string,
    rejectionReason: string,
  ) {
    if (userRole !== 'OWNER') {
      throw new ForbiddenException('Only the Director can reject issuance plan items');
    }

    const item = await this.prisma.issuancePlanItem.findUnique({
      where: { id: itemId },
      include: { plan: true, storeItem: true },
    });
    if (!item || item.planId !== planId) throw new NotFoundException('Issuance plan item not found');

    if (item.status !== 'PENDING_DIRECTOR') {
      throw new BadRequestException('This item cannot be rejected in its current status');
    }

    await this.prisma.issuancePlanItem.update({
      where: { id: itemId },
      data: {
        status: 'REJECTED',
        rejectedById: userId,
        rejectedAt: new Date(),
        rejectionReason,
      },
    });
    await this.syncPhase(planId);

    // Notify Store (plan creator) of the rejection
    await this.notifications.notifyUser(
      item.plan.createdById,
      NotificationType.ISSUANCE_PLAN_REJECTED as any,
      `Issuance Plan Item Rejected — ${item.plan.planRef}`,
      `Director rejected "${item.storeItem.name}" on plan ${item.plan.planRef}: ${rejectionReason}`,
      { entityId: planId, entityType: 'IssuancePlan' },
    );

    // Let Accountant know about the rejection for their records
    await this.notifications.notifyRole(
      UserRole.ACCOUNTANT,
      NotificationType.ISSUANCE_PLAN_REJECTED as any,
      `Issuance Plan Item Rejected — ${item.plan.planRef}`,
      `Director rejected "${item.storeItem.name}" on plan ${item.plan.planRef}: ${rejectionReason}`,
      { entityId: planId, entityType: 'IssuancePlan' },
    );

    return this.getPlan(planId);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // LIST + GET
  // ─────────────────────────────────────────────────────────────────────────────

  async listPlans(filters: { type?: string; phase?: string; weekStartDate?: string }) {
    return this.prisma.issuancePlan.findMany({
      where: {
        ...(filters.type ? { type: filters.type as any } : {}),
        ...(filters.phase ? { phase: filters.phase as any } : {}),
        ...(filters.weekStartDate ? { weekStartDate: dayjs(filters.weekStartDate).toDate() } : {}),
      },
      include: {
        createdBy: { select: { id: true, fullName: true, role: true } },
        items: { include: ITEM_INCLUDE },
      },
      orderBy: [{ weekStartDate: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async getPlan(id: string) {
    const plan = await this.prisma.issuancePlan.findUnique({
      where: { id },
      include: {
        createdBy: { select: { id: true, fullName: true, role: true } },
        items: { include: ITEM_INCLUDE },
      },
    });
    if (!plan) throw new NotFoundException('Issuance plan not found');
    return plan;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // STOCK-OUT GATE — checks the ITEM's status, not the plan's
  // ─────────────────────────────────────────────────────────────────────────────

  async validateStockOut(
    storeItemId: string,
    quantityOut: number,
    issuedDate: Date,
  ): Promise<{ planId: string; planItemId: string }> {
    const today = dayjs(issuedDate).startOf('day');
    const weekMonday = today.isoWeekday(1).startOf('day').toDate();
    const weekSunday = dayjs(weekMonday).add(6, 'day').endOf('day').toDate();
    const dayKey = DAY_KEYS[today.isoWeekday() - 1];

    const weeklyItem = await this.prisma.issuancePlanItem.findFirst({
      where: {
        storeItemId,
        status: 'APPROVED',
        plan: {
          type: 'WEEKLY',
          weekStartDate: { lte: weekSunday },
          weekEndDate: { gte: weekMonday },
        },
      },
    });

    if (weeklyItem) {
      const breakdown = weeklyItem.dailyBreakdown as Record<string, number> | null;
      const dailyAllowed = breakdown ? (breakdown[dayKey] ?? 0) : 0;

      const issuedToday = await this.prisma.storeStockOut.aggregate({
        _sum: { quantityOut: true },
        where: {
          issuancePlanItemId: weeklyItem.id,
          issuedDate: { gte: today.toDate(), lt: today.add(1, 'day').toDate() },
        },
      });
      const alreadyToday = Number(issuedToday._sum.quantityOut ?? 0);
      const remainingToday = dailyAllowed - alreadyToday;

      if (quantityOut <= remainingToday) {
        return { planId: weeklyItem.planId, planItemId: weeklyItem.id };
      }

      const emergencyAuth = await this.findEmergencyAuth(storeItemId, quantityOut, issuedDate);
      if (emergencyAuth) return emergencyAuth;

      throw new BadRequestException(
        `Quantity exceeds today's approved issuance plan. ` +
          `Approved for ${dayKey}: ${dailyAllowed.toFixed(3)}, already issued: ${alreadyToday.toFixed(3)}, ` +
          `remaining: ${Math.max(0, remainingToday).toFixed(3)}.`,
      );
    }

    const emergencyAuth = await this.findEmergencyAuth(storeItemId, quantityOut, issuedDate);
    if (emergencyAuth) return emergencyAuth;

    throw new BadRequestException(
      `This item is not on an approved issuance plan and cannot be issued. ` +
        `Add it to the weekly issuance plan or raise an emergency issuance plan first.`,
    );
  }

  private async findEmergencyAuth(
    storeItemId: string,
    quantityOut: number,
    issuedDate: Date,
  ): Promise<{ planId: string; planItemId: string } | null> {
    const today = dayjs(issuedDate).startOf('day');
    const emergencyItems = await this.prisma.issuancePlanItem.findMany({
      where: {
        storeItemId,
        status: 'APPROVED',
        plan: {
          type: 'EMERGENCY',
          weekStartDate: { lte: today.endOf('day').toDate() },
          weekEndDate: { gte: today.toDate() },
        },
      },
    });

    for (const eItem of emergencyItems) {
      const remaining = Number(eItem.quantityPlanned) - Number(eItem.quantityIssued);
      if (remaining >= quantityOut) {
        return { planId: eItem.planId, planItemId: eItem.id };
      }
    }
    return null;
  }

  async incrementIssuedQuantity(planItemId: string, quantity: number) {
    await this.prisma.issuancePlanItem.update({
      where: { id: planItemId },
      data: { quantityIssued: { increment: quantity } },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PM FEED CONSUMPTION PLAN
  // ─────────────────────────────────────────────────────────────────────────────

  async setFeedConsumptionPlan(dto: {
    weekStartDate: string;
    stage: string;
    feedType: string;
    gramsPerBirdPerDay: number;
    userId: string;
  }) {
    const monday = dayjs(dto.weekStartDate).startOf('day').toDate();

    const record = await this.prisma.feedConsumptionPlan.upsert({
      where: {
        weekStartDate_stage_feedType: {
          weekStartDate: monday,
          stage: dto.stage as BatchStage,
          feedType: dto.feedType as any,
        },
      },
      create: {
        weekStartDate: monday,
        stage: dto.stage as BatchStage,
        feedType: dto.feedType as any,
        gramsPerBirdPerDay: dto.gramsPerBirdPerDay,
        setById: dto.userId,
      },
      update: {
        gramsPerBirdPerDay: dto.gramsPerBirdPerDay,
        setById: dto.userId,
      },
    });

    const injection = await this.injectFeedLineIntoPlan(
      monday,
      dto.stage,
      dto.feedType,
      dto.gramsPerBirdPerDay,
    );

    return { ...record, planStatus: injection };
  }

  async getFeedConsumptionPlan(weekStartDate: string) {
    const monday = dayjs(weekStartDate).startOf('day').toDate();
    return this.prisma.feedConsumptionPlan.findMany({
      where: { weekStartDate: monday },
      include: { setBy: { select: { id: true, fullName: true } } },
    });
  }

  private async injectFeedLineIntoPlan(
    monday: Date,
    stage: string,
    feedType: string,
    gramsPerBirdPerDay: number,
  ): Promise<
    | { status: 'NO_BIRDS' }
    | { status: 'NO_STORE_ITEM' }
    | { status: 'NO_DRAFT_PLAN' }
    | { status: 'ATTACHED'; dailyKg: number; weeklyKg: number; planRef: string }
  > {
    const batches = await this.prisma.batch.findMany({
      where: { stage: stage as BatchStage, isActive: true, deletedAt: null },
      select: { currentBirdCount: true },
    });
    const totalBirds = batches.reduce((s, b) => s + b.currentBirdCount, 0);
    if (totalBirds === 0) return { status: 'NO_BIRDS' };

    const dailyKg = (gramsPerBirdPerDay * totalBirds) / 1000;
    const dailyBreakdown: Record<string, number> = {};
    DAY_KEYS.forEach((k) => (dailyBreakdown[k] = dailyKg));
    const weeklyKg = dailyKg * 7;

    const sku = FEED_SKU[feedType];
    const feedLabel = FEED_LABELS[feedType] ?? feedType;
    const storeItem =
      (sku && (await this.prisma.storeItem.findFirst({ where: { sku, isActive: true } }))) ??
      (await this.prisma.storeItem.findFirst({
        where: { name: { contains: feedLabel, mode: 'insensitive' }, isActive: true },
      }));
    if (!storeItem) return { status: 'NO_STORE_ITEM' };

    const draftPlan = await this.prisma.issuancePlan.findFirst({
      where: { type: 'WEEKLY', phase: 'DRAFT', weekStartDate: monday },
    });
    if (!draftPlan) return { status: 'NO_DRAFT_PLAN' };

    const existing = await this.prisma.issuancePlanItem.findFirst({
      where: { planId: draftPlan.id, storeItemId: storeItem.id, source: 'PM_FEED_PLAN' },
    });

    if (existing) {
      await this.prisma.issuancePlanItem.update({
        where: { id: existing.id },
        data: {
          quantityPlanned: weeklyKg,
          unitPriceKes: Number(storeItem.unitCostKes),
          dailyBreakdown,
        },
      });
    } else {
      await this.prisma.issuancePlanItem.create({
        data: {
          planId: draftPlan.id,
          storeItemId: storeItem.id,
          quantityPlanned: weeklyKg,
          unitPriceKes: Number(storeItem.unitCostKes),
          dailyBreakdown,
          source: 'PM_FEED_PLAN',
          status: 'PENDING_DIRECTOR',
          notes: `Auto: ${stage} birds (${totalBirds}) × ${gramsPerBirdPerDay}g/bird/day`,
        },
      });
    }

    return { status: 'ATTACHED', dailyKg, weeklyKg, planRef: draftPlan.planRef };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // DAILY FEED ALERT (called by cron) — only for items that are APPROVED
  // ─────────────────────────────────────────────────────────────────────────────

  async sendDailyFeedAlert() {
    const today = dayjs().startOf('day');
    const dayKey = DAY_KEYS[today.isoWeekday() - 1];

    const items = await this.prisma.issuancePlanItem.findMany({
      where: {
        source: 'PM_FEED_PLAN',
        status: 'APPROVED',
        plan: {
          type: 'WEEKLY',
          weekStartDate: { lte: today.toDate() },
          weekEndDate: { gte: today.toDate() },
        },
      },
      include: { storeItem: true, plan: true },
    });

    for (const item of items) {
      const breakdown = item.dailyBreakdown as Record<string, number> | null;
      const dailyKg = breakdown?.[dayKey] ?? 0;
      if (dailyKg <= 0) continue;

      await this.notifications.notifyRole(
        UserRole.STORE,
        NotificationType.FEED_ISSUANCE_DAILY_ALERT as any,
        `Issue ${dailyKg.toFixed(1)} kg of ${item.storeItem.name} Today`,
        `Daily feed issuance alert (plan ${item.plan.planRef}): Issue ${dailyKg.toFixed(1)} kg of ${item.storeItem.name} today per the approved issuance plan.`,
        { entityId: item.planId, entityType: 'IssuancePlan' },
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // THURSDAY EARLY REMINDER — 2 days before Saturday submission deadline
  // Fires on Thursday if no weekly plan exists for the upcoming week yet.
  // ─────────────────────────────────────────────────────────────────────────────

  async sendEarlyWeeklyPlanReminder() {
    const today = dayjs();
    // Thursday: next Monday is 4 days away
    const daysUntilMon = (8 - today.day()) % 7 || 7;
    const mondayDateStr = today.add(daysUntilMon, 'day').format('YYYY-MM-DD');
    const monday = dayjs.utc(mondayDateStr).startOf('day').toDate();

    const existing = await this.prisma.issuancePlan.findFirst({
      where: { type: 'WEEKLY', weekStartDate: monday },
    });
    if (existing) return; // draft or submitted plan already exists — no nudge needed

    await this.notifications.notifyRole(
      UserRole.STORE,
      NotificationType.WEEKLY_PLAN_EARLY_REMINDER,
      'Heads Up — Issuance Plan Due Saturday',
      `The weekly issuance plan for ${dayjs(monday).format('D MMM')} – ${dayjs(monday).add(6, 'day').format('D MMM YYYY')} is due this Saturday. ` +
        `You can start drafting it now and submit on Saturday for Director approval.`,
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SATURDAY WEEKLY-PLAN REMINDER — nudges Store to submit next week's plan.
  // Skips the nudge if a plan for the upcoming week already exists.
  // ─────────────────────────────────────────────────────────────────────────────

  async sendWeeklyPlanReminder() {
    const today = dayjs();
    const daysUntilMon = (8 - today.day()) % 7 || 7;
    const mondayDateStr = today.add(daysUntilMon, 'day').format('YYYY-MM-DD');
    const monday = dayjs.utc(mondayDateStr).startOf('day').toDate();

    const existing = await this.prisma.issuancePlan.findFirst({
      where: { type: 'WEEKLY', weekStartDate: monday },
    });
    if (existing) return;

    await this.notifications.notifyRole(
      UserRole.STORE,
      NotificationType.WEEKLY_PLAN_REMINDER,
      "It's Saturday — Submit the Weekly Issuance Plan",
      `Draft and submit the weekly issuance plan for the coming week (${dayjs(monday).format('D MMM')} – ${dayjs(monday).add(6, 'day').format('D MMM YYYY')}) before end of day for Director approval.`,
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PENDING REMINDER (called by daily cron) — Director only, per item
  // ─────────────────────────────────────────────────────────────────────────────

  async sendPendingReminders() {
    const today = dayjs().startOf('day');

    const pendingItems = await this.prisma.issuancePlanItem.findMany({
      where: {
        status: 'PENDING_DIRECTOR',
        plan: { weekStartDate: { lte: today.add(7, 'day').toDate() } },
      },
      include: { plan: true, storeItem: true },
    });

    // Group by plan so we send one notification per plan rather than one per item
    const groups = new Map<string, { plan: any; items: any[] }>();
    for (const item of pendingItems) {
      const key = item.planId;
      if (!groups.has(key)) groups.set(key, { plan: item.plan, items: [] });
      groups.get(key)!.items.push(item);
    }

    for (const { plan, items } of groups.values()) {
      const itemNames = items.map((i) => i.storeItem?.name).filter(Boolean);
      await this.notifications.notifyRole(
        UserRole.OWNER,
        NotificationType.ISSUANCE_PLAN_PENDING_REMINDER as any,
        `Reminder: ${items.length} Item${items.length > 1 ? 's' : ''} Awaiting Your Approval — ${plan.planRef}`,
        `Plan ${plan.planRef} (week of ${dayjs(plan.weekStartDate).format('D MMM YYYY')}) has ${items.length} item${items.length > 1 ? 's' : ''} still awaiting your approval${itemNames.length ? `: ${itemNames.join(', ')}` : ''}.`,
        { entityId: plan.id, entityType: 'IssuancePlan' },
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PDF GENERATION — only APPROVED items listed
  // ─────────────────────────────────────────────────────────────────────────────

  async streamPdf(id: string, res: Response) {
    const plan = await this.getPlan(id);
    const approvedItems = plan.items.filter((i: any) => i.status === 'APPROVED');
    const isEmergency = plan.type === 'EMERGENCY';

    if (approvedItems.length === 0) {
      throw new BadRequestException(
        'This plan has no approved items yet — a PDF can only include items that have been fully approved.',
      );
    }

    const doc = new PDFDocument({ margin: 50, size: 'A4', bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${isEmergency ? 'EmergencyIssuancePlan' : 'IssuancePlan'}-${plan.planRef}.pdf"`,
    );
    doc.pipe(res);

    const brand = '#2d7a4f';
    const light = '#f5f5f5';
    const pageBottom = doc.page.height - doc.page.margins.bottom;
    const colWidths = isEmergency
      ? [200, 70, 90, 90, 125]
      : [150, 50, 50, 50, 50, 50, 50, 55, 70];
    const headers = isEmergency
      ? ['Item', 'Qty', 'Unit Price (KES)', 'Line Total (KES)', 'Approved By']
      : ['Item', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN', 'Approved By'];
    const tableWidth = colWidths.reduce((a, b) => a + b, 0);

    // Draws the table header row at the current doc.y and returns the y just below it.
    const drawTableHeader = () => {
      const top = doc.y;
      doc.rect(50, top, tableWidth, 16).fill(brand);
      let hx = 50;
      headers.forEach((h, i) => {
        doc
          .fillColor('#fff')
          .fontSize(7.5)
          .text(h, hx + 3, top + 4, { width: colWidths[i] - 4, align: i === 0 ? 'left' : 'center' });
        hx += colWidths[i];
      });
      return top + 17;
    };

    // Ensures there's room for one more row; if not, starts a new page and redraws the header.
    const ensureRowSpace = (rowY: number, rowHeight: number) => {
      if (rowY + rowHeight > pageBottom) {
        doc.addPage();
        doc.y = 50;
        return drawTableHeader();
      }
      return rowY;
    };

    doc
      .fontSize(18)
      .fillColor(brand)
      .text(isEmergency ? 'AWFMS — Emergency Issuance Plan' : 'AWFMS — Issuance Plan', { align: 'left' })
      .moveDown(0.2);

    doc.fontSize(10).fillColor('#333').text(`Plan Ref: ${plan.planRef}`);

    if (isEmergency) {
      doc.text(`Date Raised: ${dayjs(plan.createdAt ?? plan.weekStartDate).format('D MMM YYYY')}`);
      doc.text(`Approved items: ${approvedItems.length} of ${plan.items.length}`);
      if (plan.emergencyReason) {
        doc.moveDown(0.3).fontSize(9).fillColor('#a33').text(`Reason for emergency: ${plan.emergencyReason}`);
      }
    } else {
      doc
        .text(`Week: ${dayjs(plan.weekStartDate).format('D MMM YYYY')} – ${dayjs(plan.weekEndDate).format('D MMM YYYY')}`)
        .text(`Type: ${plan.type}`)
        .text(`Approved items: ${approvedItems.length} of ${plan.items.length}`);
    }
    doc.moveDown(0.5);

    if (plan.notes) {
      doc.fontSize(9).fillColor('#333').text(`Notes: ${plan.notes}`).moveDown(0.3);
    }

    doc.moveDown(0.5);
    doc.fontSize(11).fillColor(brand).text('Approved Items', { underline: true }).moveDown(0.4);

    let rowY = drawTableHeader();
    const rowHeight = 15;

    approvedItems.forEach((item: any, idx: number) => {
      rowY = ensureRowSpace(rowY, rowHeight);
      const bg = idx % 2 === 0 ? '#fff' : light;
      doc.rect(50, rowY, tableWidth, 14).fill(bg);

      let cx = 50;
      doc
        .fillColor('#222')
        .fontSize(7)
        .text(`${item.storeItem.name} (${item.storeItem.unit})`, cx + 3, rowY + 3, { width: colWidths[0] - 4 });
      cx += colWidths[0];

      if (isEmergency) {
        const qty = Number(item.quantityPlanned ?? 0);
        const unitPrice = Number(item.unitPriceKes ?? 0);
        doc.text(qty.toFixed(2), cx + 3, rowY + 3, { width: colWidths[1] - 4, align: 'center' });
        cx += colWidths[1];
        doc.text(unitPrice.toFixed(2), cx + 3, rowY + 3, { width: colWidths[2] - 4, align: 'center' });
        cx += colWidths[2];
        doc.text((qty * unitPrice).toFixed(2), cx + 3, rowY + 3, { width: colWidths[3] - 4, align: 'center' });
        cx += colWidths[3];
        doc.text(item.directorApprovedBy?.fullName ?? '—', cx + 3, rowY + 3, { width: colWidths[4] - 4, align: 'center' });
      } else {
        const breakdown = item.dailyBreakdown as Record<string, number> | null;
        DAY_KEYS.forEach((k, i) => {
          const val = breakdown ? (breakdown[k] ?? 0).toFixed(2) : '—';
          doc.text(val, cx + 3, rowY + 3, { width: colWidths[i + 1] - 4, align: 'center' });
          cx += colWidths[i + 1];
        });
        doc.text(item.directorApprovedBy?.fullName ?? '—', cx + 3, rowY + 3, { width: colWidths[8] - 4, align: 'center' });
      }
      rowY += rowHeight;

      if (isEmergency && item.notes) {
        rowY = ensureRowSpace(rowY, rowHeight);
        doc
          .fillColor('#666')
          .fontSize(6.5)
          .text(`Note: ${item.notes}`, 53, rowY + 1, { width: tableWidth - 6 });
        rowY += rowHeight;
      }
    });

    doc.y = rowY;

    // Weekly plans surface pending/rejected items for context; emergency plans
    // are approved item-by-item at issue time, so this section is skipped there.
    if (!isEmergency) {
      const otherItems = plan.items.filter((i: any) => i.status !== 'APPROVED');
      if (otherItems.length > 0) {
        doc.moveDown(1.5);
        doc.fontSize(10).fillColor('#888').text('Not Approved / Pending (excluded above)', { underline: true }).moveDown(0.3);
        otherItems.forEach((item: any) => {
          const label =
            item.status === 'REJECTED'
              ? `Rejected — ${item.rejectionReason ?? 'no reason given'}`
              : 'Awaiting Director';
          doc.fontSize(8).fillColor('#999').text(`• ${item.storeItem.name}: ${label}`);
        });
      }
    }

    const totalKes = approvedItems.reduce(
      (s: number, i: any) => s + Number(i.quantityPlanned) * Number(i.unitPriceKes),
      0,
    );
    doc.moveDown(1);
    doc
      .fontSize(10)
      .fillColor(brand)
      .text(`Total Approved Value: KES ${totalKes.toLocaleString('en-KE', { minimumFractionDigits: 2 })}`, { align: 'right' });

    doc
      .moveDown(2)
      .fontSize(8)
      .fillColor('#888')
      .text(
        isEmergency
          ? 'This document is computer-generated. It reflects only this emergency plan; it does not include any weekly issuance plan items.'
          : 'This document is computer-generated. Only Director-approved items are listed as authorised.',
        { align: 'center' },
      );

    doc.end();
  }
}
