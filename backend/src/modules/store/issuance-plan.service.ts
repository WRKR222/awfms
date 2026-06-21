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
import { NotificationType, UserRole, BatchStage } from '@prisma/client';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import PDFDocument from 'pdfkit';
import { Response } from 'express';

dayjs.extend(isoWeek);

const DAY_KEYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
type DayKey = (typeof DAY_KEYS)[number];

function isSaturday(): boolean {
  return dayjs().day() === 6;
}

function sundayOf(monday: Date): Date {
  return dayjs(monday).add(6, 'day').endOf('day').toDate();
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
   * Plan phase is a derived summary of where its items collectively are:
   * - DRAFT: plan hasn't been submitted yet
   * - PENDING_ACCOUNTANT: at least one item is still awaiting the accountant
   * - PENDING_DIRECTOR: every item has passed the accountant; at least one is
   *   still awaiting the director
   * - DECIDED: every item has a final outcome (APPROVED or REJECTED) from the director
   * This keeps the plan's `phase` column useful for filtering/badges without
   * pretending the whole plan is a single yes/no decision.
   */
  private computePhase(items: { status: string }[], wasSubmitted: boolean): 'DRAFT' | 'PENDING_ACCOUNTANT' | 'PENDING_DIRECTOR' | 'DECIDED' {
    if (!wasSubmitted) return 'DRAFT';
    if (items.length === 0) return 'DRAFT';
    if (items.some((i) => i.status === 'PENDING_ACCOUNTANT')) return 'PENDING_ACCOUNTANT';
    if (items.some((i) => i.status === 'PENDING_DIRECTOR')) return 'PENDING_DIRECTOR';
    return 'DECIDED'; // every item is APPROVED or REJECTED
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
  // ─────────────────────────────────────────────────────────────────────────────

  async createPlan(
    dto: {
      type: 'WEEKLY' | 'EMERGENCY';
      weekStartDate: string;
      notes?: string;
      items: {
        storeItemId: string;
        quantityPlanned: number;
        unitPriceKes: number;
        dailyBreakdown?: Record<string, number>;
        notes?: string;
      }[];
    },
    userId: string,
  ) {
    const monday = dayjs(dto.weekStartDate).startOf('day').toDate();
    const sunday = sundayOf(monday);

    if (dayjs(monday).isoWeekday() !== 1) {
      throw new BadRequestException('weekStartDate must be a Monday');
    }

    const enrichedItems = dto.items.map((item) => {
      let qtyPlanned = item.quantityPlanned;
      if (item.dailyBreakdown && dto.type === 'WEEKLY') {
        qtyPlanned = Object.values(item.dailyBreakdown).reduce((s: number, v: number) => s + v, 0);
      }
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
        createdById: userId,
        items: {
          create: enrichedItems.map((item) => ({
            storeItemId: item.storeItemId,
            quantityPlanned: item.quantityPlanned,
            unitPriceKes: item.unitPriceKes,
            dailyBreakdown: item.dailyBreakdown ?? null,
            notes: item.notes,
            source: 'MANUAL',
            status: 'PENDING_ACCOUNTANT',
          })),
        },
      },
    });

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
  // ─────────────────────────────────────────────────────────────────────────────

  async updatePlan(
    id: string,
    dto: {
      notes?: string;
      items?: {
        id?: string;
        storeItemId: string;
        quantityPlanned: number;
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

    // Store can only edit items that are still PENDING_ACCOUNTANT (i.e. haven't
    // been touched yet). Accountant can only edit items still PENDING_ACCOUNTANT
    // (their own queue). Director can edit items PENDING_DIRECTOR, or re-open an
    // item that's already APPROVED/REJECTED by editing it back to PENDING_ACCOUNTANT.
    // Since approval is now per item, "editable within the chain" means: you can
    // only touch a line that currently sits at your stage.
    const editableItemStatuses: Record<string, string[]> = {
      STORE: ['PENDING_ACCOUNTANT'],
      ACCOUNTANT: ['PENDING_ACCOUNTANT'],
      OWNER: ['PENDING_DIRECTOR', 'APPROVED', 'REJECTED'],
    };
    const allowedStatuses = editableItemStatuses[userRole] ?? [];

    await this.prisma.$transaction(async (tx) => {
      if (dto.items) {
        const existing = plan.items;
        const existingIds = new Set(existing.map((e) => e.id));
        const submittedIds = new Set(dto.items.filter((i: any) => i.id).map((i: any) => i.id));

        // Only block edits to existing items the caller's role isn't allowed to touch.
        for (const item of dto.items as any[]) {
          if (item.id && existingIds.has(item.id)) {
            const prior = existing.find((e) => e.id === item.id)!;
            if (!allowedStatuses.includes(prior.status)) {
              throw new ForbiddenException(
                `As ${userRole === 'STORE' ? 'Store' : userRole === 'ACCOUNTANT' ? 'Accountant' : 'Director'}, ` +
                  `you cannot edit "${prior.id}" while it is ${prior.status.replace('_', ' ').toLowerCase()}.`,
              );
            }
          } else if (userRole !== 'STORE') {
            // Only Store may add brand-new line items to a plan.
            throw new ForbiddenException('Only Store can add new line items to an issuance plan.');
          }
        }

        // Delete only items the editor explicitly removed (present before, absent now)
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
          let qtyPlanned = item.quantityPlanned;
          if (item.dailyBreakdown && plan.type === 'WEEKLY') {
            qtyPlanned = Object.values(item.dailyBreakdown).reduce((s: number, v: number) => s + v, 0);
          }

          if (item.id && existingIds.has(item.id)) {
            const prior = existing.find((e) => e.id === item.id)!;
            // Editing a Director-decided item (APPROVED/REJECTED) re-opens it
            // to PENDING_ACCOUNTANT — both signatures are needed again for
            // that specific item only; siblings are untouched.
            const willReopenItem = ['APPROVED', 'REJECTED'].includes(prior.status);
            await tx.issuancePlanItem.update({
              where: { id: item.id },
              data: {
                storeItemId: item.storeItemId,
                quantityPlanned: qtyPlanned,
                unitPriceKes: item.unitPriceKes,
                dailyBreakdown: item.dailyBreakdown ?? null,
                notes: item.notes,
                source: item.source ?? prior.source,
                ...(willReopenItem
                  ? {
                      status: 'PENDING_ACCOUNTANT',
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
                dailyBreakdown: item.dailyBreakdown ?? null,
                notes: item.notes,
                source: item.source ?? 'MANUAL',
                status: 'PENDING_ACCOUNTANT',
              },
            });
          }
        }
      }

      if (dto.notes !== undefined) {
        await tx.issuancePlan.update({ where: { id }, data: { notes: dto.notes } });
      }
    });

    await this.syncPhase(id);
    return this.getPlan(id);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SUBMIT (Store: DRAFT → every item PENDING_ACCOUNTANT, phase → PENDING_ACCOUNTANT)
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

    if (plan.type === 'WEEKLY' && !isSaturday()) {
      throw new BadRequestException(
        'Weekly issuance plans can only be submitted on Saturdays for the following week',
      );
    }

    await this.prisma.issuancePlan.update({
      where: { id },
      data: { phase: 'PENDING_ACCOUNTANT' },
    });

    await this.notifications.notifyRole(
      UserRole.ACCOUNTANT,
      NotificationType.ISSUANCE_PLAN_SUBMITTED as any,
      'New Issuance Plan Awaiting Review',
      `${plan.type === 'EMERGENCY' ? 'Emergency issuance plan' : 'Weekly issuance plan'} ${plan.planRef} (${plan.items.length} item${plan.items.length > 1 ? 's' : ''}) has been submitted for your approval.`,
      { entityId: id, entityType: 'IssuancePlan' },
    );

    return this.getPlan(id);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PER-ITEM APPROVE / REJECT
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Approve a single line item. Accountant moves it PENDING_ACCOUNTANT →
   * PENDING_DIRECTOR. Director moves it PENDING_DIRECTOR → APPROVED. Sibling
   * items on the same plan are completely unaffected — this is the core of
   * "director can approve some items and reject others".
   */
  async approveItem(planId: string, itemId: string, userId: string, userRole: string) {
    const item = await this.prisma.issuancePlanItem.findUnique({
      where: { id: itemId },
      include: { plan: true, storeItem: true },
    });
    if (!item || item.planId !== planId) throw new NotFoundException('Issuance plan item not found');

    if (userRole === 'ACCOUNTANT') {
      if (item.status !== 'PENDING_ACCOUNTANT') {
        throw new BadRequestException('This item is not awaiting accountant approval');
      }
      await this.prisma.issuancePlanItem.update({
        where: { id: itemId },
        data: {
          status: 'PENDING_DIRECTOR',
          accountantApprovedById: userId,
          accountantApprovedAt: new Date(),
        },
      });
      await this.syncPhase(planId);

      await this.notifications.notifyRole(
        UserRole.OWNER,
        NotificationType.ISSUANCE_PLAN_ACCOUNTANT_APPROVED as any,
        'Issuance Plan Item Awaiting Your Approval',
        `Accountant approved "${item.storeItem.name}" on plan ${item.plan.planRef}. It now awaits your final approval.`,
        { entityId: planId, entityType: 'IssuancePlan' },
      );
      await this.notifications.notifyRole(
        UserRole.STORE,
        NotificationType.ISSUANCE_PLAN_ACCOUNTANT_APPROVED as any,
        'Issuance Plan Item — Accountant Approved',
        `"${item.storeItem.name}" on plan ${item.plan.planRef} has been approved by the Accountant and is now with the Director.`,
        { entityId: planId, entityType: 'IssuancePlan' },
      );

      return this.getPlan(planId);
    }

    if (userRole === 'OWNER') {
      if (item.status !== 'PENDING_DIRECTOR') {
        throw new BadRequestException('This item is not awaiting director approval');
      }
      if (item.plan.type === 'WEEKLY' && !isSaturday()) {
        throw new BadRequestException(
          'Weekly issuance plan items can only be approved by the Director on Saturdays',
        );
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

      await this.notifications.notifyRole(
        UserRole.STORE,
        NotificationType.ISSUANCE_PLAN_APPROVED as any,
        'Issuance Plan Item Approved — Stock Can Now Be Issued',
        `"${item.storeItem.name}" on plan ${item.plan.planRef} has been fully approved. You may now issue stock against this line.`,
        { entityId: planId, entityType: 'IssuancePlan' },
      );
      await this.notifications.notifyRole(
        UserRole.ACCOUNTANT,
        NotificationType.ISSUANCE_PLAN_APPROVED as any,
        `Issuance Plan Item Approved — ${item.plan.planRef}`,
        `Director approved "${item.storeItem.name}" on plan ${item.plan.planRef}. Stock issuance for this item is now unlocked.`,
        { entityId: planId, entityType: 'IssuancePlan' },
      );

      return this.getPlan(planId);
    }

    throw new ForbiddenException('Only Accountant or Director can approve issuance plan items');
  }

  /** Reject a single line item. Siblings are unaffected. */
  async rejectItem(
    planId: string,
    itemId: string,
    userId: string,
    userRole: string,
    rejectionReason: string,
  ) {
    const item = await this.prisma.issuancePlanItem.findUnique({
      where: { id: itemId },
      include: { plan: true, storeItem: true },
    });
    if (!item || item.planId !== planId) throw new NotFoundException('Issuance plan item not found');

    const rejectableStatuses =
      userRole === 'ACCOUNTANT'
        ? ['PENDING_ACCOUNTANT']
        : userRole === 'OWNER'
          ? ['PENDING_DIRECTOR']
          : [];
    if (!rejectableStatuses.includes(item.status)) {
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

    await this.notifications.notifyUser(
      item.plan.createdById,
      NotificationType.ISSUANCE_PLAN_REJECTED as any,
      `Issuance Plan Item Rejected — ${item.plan.planRef}`,
      `${userRole === 'ACCOUNTANT' ? 'Accountant' : 'Director'} rejected "${item.storeItem.name}" on plan ${item.plan.planRef}: ${rejectionReason}`,
      { entityId: planId, entityType: 'IssuancePlan' },
    );
    // Also let the Accountant know if the Director rejected something they'd
    // already passed, so they have visibility into the final outcome.
    if (userRole === 'OWNER') {
      await this.notifications.notifyRole(
        UserRole.ACCOUNTANT,
        NotificationType.ISSUANCE_PLAN_REJECTED as any,
        `Issuance Plan Item Rejected — ${item.plan.planRef}`,
        `Director rejected "${item.storeItem.name}" on plan ${item.plan.planRef} (you had approved it): ${rejectionReason}`,
        { entityId: planId, entityType: 'IssuancePlan' },
      );
    }

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

  /**
   * Returns the IssuancePlanItem that authorises the requested stock-out, or
   * throws BadRequestException if the item isn't APPROVED / limit exceeded.
   * Only items with status = APPROVED can ever authorise a stock-out — a
   * REJECTED or still-pending item on the same plan blocks nothing else and
   * grants nothing either.
   */
  async validateStockOut(
    storeItemId: string,
    quantityOut: number,
    issuedDate: Date,
  ): Promise<{ planId: string; planItemId: string }> {
    const today = dayjs(issuedDate).startOf('day');
    const weekMonday = today.isoWeekday(1).startOf('day').toDate();
    const weekSunday = dayjs(weekMonday).add(6, 'day').endOf('day').toDate();
    const dayKey = DAY_KEYS[today.isoWeekday() - 1];

    // 1. Look for an APPROVED weekly item covering this store item, this week
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

  /** Increment quantityIssued on a plan item after a stock-out is recorded */
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

  /**
   * Compute live bird count for a given stage (BROODING | PRODUCTION), then
   * upsert a PM_FEED_PLAN line item into any DRAFT plan for this week. Never
   * throws — a feed plan is always saved even if it can't be attached yet.
   */
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
          status: 'PENDING_ACCOUNTANT',
          notes: `Auto: ${stage} birds (${totalBirds}) × ${gramsPerBirdPerDay}g/bird/day`,
        },
      });
    }

    return { status: 'ATTACHED', dailyKg, weeklyKg, planRef: draftPlan.planRef };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // DAILY FEED ALERT (called by cron) — only for items that are actually APPROVED
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
  // PENDING REMINDER (called by daily cron) — per item, not per plan
  // ─────────────────────────────────────────────────────────────────────────────

  async sendPendingReminders() {
    const today = dayjs().startOf('day');

    const pendingItems = await this.prisma.issuancePlanItem.findMany({
      where: {
        status: { in: ['PENDING_ACCOUNTANT', 'PENDING_DIRECTOR'] as any[] },
        plan: { weekStartDate: { lte: today.add(7, 'day').toDate() } },
      },
      include: { plan: true, storeItem: true },
    });

    // Group by plan + awaiting role so each reminder mentions affected items rather
    // than spamming one notification per line item.
    const groups = new Map<string, { plan: any; role: UserRole; items: any[] }>();
    for (const item of pendingItems) {
      const role = item.status === 'PENDING_ACCOUNTANT' ? UserRole.ACCOUNTANT : UserRole.OWNER;
      const key = `${item.planId}:${role}`;
      if (!groups.has(key)) groups.set(key, { plan: item.plan, role, items: [] });
      groups.get(key)!.items.push(item);
    }

    for (const { plan, role, items } of groups.values()) {
      const awaitingRole = role === UserRole.ACCOUNTANT ? 'Accountant' : 'Director';
      const itemNames = items.map((i) => i.storeItem?.name).filter(Boolean);
      await this.notifications.notifyRole(
        role,
        NotificationType.ISSUANCE_PLAN_PENDING_REMINDER as any,
        `Reminder: ${items.length} Item${items.length > 1 ? 's' : ''} Awaiting Your Approval — ${plan.planRef}`,
        `Plan ${plan.planRef} (week of ${dayjs(plan.weekStartDate).format('D MMM YYYY')}) has ${items.length} item${items.length > 1 ? 's' : ''} still awaiting ${awaitingRole} approval${itemNames.length ? `: ${itemNames.join(', ')}` : ''}. Stock cannot be issued for these until approved.`,
        { entityId: plan.id, entityType: 'IssuancePlan' },
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PDF GENERATION — only APPROVED items are listed; others show their outcome
  // ─────────────────────────────────────────────────────────────────────────────

  async streamPdf(id: string, res: Response) {
    const plan = await this.getPlan(id);
    const approvedItems = plan.items.filter((i: any) => i.status === 'APPROVED');

    if (approvedItems.length === 0) {
      throw new BadRequestException(
        'This plan has no approved items yet — a PDF can only include items that have been fully approved.',
      );
    }

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="IssuancePlan-${plan.planRef}.pdf"`);
    doc.pipe(res);

    const brand = '#2d7a4f';
    const light = '#f5f5f5';

    doc.fontSize(18).fillColor(brand).text('AWFMS — Issuance Plan', { align: 'left' }).moveDown(0.2);

    doc
      .fontSize(10)
      .fillColor('#333')
      .text(`Plan Ref: ${plan.planRef}`)
      .text(`Week: ${dayjs(plan.weekStartDate).format('D MMM YYYY')} – ${dayjs(plan.weekEndDate).format('D MMM YYYY')}`)
      .text(`Type: ${plan.type}`)
      .text(`Approved items: ${approvedItems.length} of ${plan.items.length}`)
      .moveDown(0.5);

    if (plan.notes) {
      doc.fontSize(9).text(`Notes: ${plan.notes}`).moveDown(0.3);
    }

    doc.moveDown(0.5);
    doc.fontSize(11).fillColor(brand).text('Approved Items', { underline: true }).moveDown(0.4);

    const colWidths = [150, 50, 50, 50, 50, 50, 50, 55, 70];
    const headers = ['Item', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN', 'Approved By'];
    const tableTop = doc.y;

    doc.rect(50, tableTop, 575, 16).fill(brand);
    let x = 50;
    headers.forEach((h, i) => {
      doc.fillColor('#fff').fontSize(7.5).text(h, x + 3, tableTop + 4, { width: colWidths[i] - 4, align: i === 0 ? 'left' : 'center' });
      x += colWidths[i];
    });

    let rowY = tableTop + 17;
    approvedItems.forEach((item: any, idx: number) => {
      const breakdown = item.dailyBreakdown as Record<string, number> | null;
      const bg = idx % 2 === 0 ? '#fff' : light;
      doc.rect(50, rowY, 575, 14).fill(bg);

      let cx = 50;
      doc
        .fillColor('#222')
        .fontSize(7)
        .text(`${item.storeItem.name} (${item.storeItem.unit})`, cx + 3, rowY + 3, { width: colWidths[0] - 4 });
      cx += colWidths[0];

      DAY_KEYS.forEach((k, i) => {
        const val = breakdown ? (breakdown[k] ?? 0).toFixed(2) : '—';
        doc.text(val, cx + 3, rowY + 3, { width: colWidths[i + 1] - 4, align: 'center' });
        cx += colWidths[i + 1];
      });

      doc.text(item.directorApprovedBy?.fullName ?? '—', cx + 3, rowY + 3, { width: colWidths[8] - 4, align: 'center' });
      rowY += 15;
    });

    // List rejected/pending items separately so the Accountant/Director can see
    // at a glance what wasn't approved, without it looking like part of the
    // authorised issuance table.
    const otherItems = plan.items.filter((i: any) => i.status !== 'APPROVED');
    if (otherItems.length > 0) {
      doc.moveDown(1.5);
      doc.fontSize(10).fillColor('#888').text('Not Approved / Pending (excluded above)', { underline: true }).moveDown(0.3);
      otherItems.forEach((item: any) => {
        const label =
          item.status === 'REJECTED'
            ? `Rejected — ${item.rejectionReason ?? 'no reason given'}`
            : item.status === 'PENDING_DIRECTOR'
              ? 'Awaiting Director'
              : 'Awaiting Accountant';
        doc.fontSize(8).fillColor('#999').text(`• ${item.storeItem.name}: ${label}`);
      });
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
      .text('This document is computer-generated. Only items approved by both the Accountant and Director are listed as authorised.', { align: 'center' });

    doc.end();
  }
}
