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

    // ...and any PM item requisition already submitted for this week but not
    // yet folded into a plan — applies whether Store is creating a WEEKLY or
    // an EMERGENCY plan, since injectRequisitionItemsIntoPlan resolves the
    // correct home for the requisition's lines independently of which plan
    // Store happens to be creating right now (PM's Thursday deadline is
    // ahead of Store's own Saturday one, so this is the expected order for
    // the common case, but a requisition can also be waiting on an
    // already-submitted weekly plan to get an emergency draft created).
    const outstandingRequisition = await this.prisma.pMItemRequisition.findFirst({
      where: { weekStartDate: monday, status: 'SUBMITTED' as any },
    });
    if (outstandingRequisition) {
      await this.injectRequisitionItemsIntoPlan(monday, outstandingRequisition.id);
    }

    return this.getPlan(plan.id);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PM ITEM REQUISITION → ISSUANCE PLAN INJECTION
  //
  // Each requisition line is folded into exactly one plan for its target
  // week, decided at injection time:
  //   • that week's WEEKLY plan is still a DRAFT (or doesn't exist yet)
  //       → attach to the WEEKLY draft (creating an empty one if needed).
  //   • that week's WEEKLY plan has already been submitted (phase != DRAFT)
  //       → too late to add lines to it; attach to that week's EMERGENCY
  //         draft instead (creating one if needed).
  //
  // A PMItemRequisitionItem.issuancePlanItemId is the authoritative record
  // of "has this line already been attached" — once set, injection never
  // touches that line again (a submitted requisition's lines are immutable).
  // ─────────────────────────────────────────────────────────────────────────────

  async injectRequisitionItemsIntoPlan(
    monday: Date,
    requisitionId: string,
  ): Promise<
    | { status: 'NOT_FOUND' }
    | { status: 'ALREADY_ATTACHED' }
    | { status: 'ATTACHED'; planId: string; planRef: string; planType: string; itemCount: number }
  > {
    const requisition = await this.prisma.pMItemRequisition.findUnique({
      where: { id: requisitionId },
      include: { items: { include: { storeItem: true } } },
    });
    if (!requisition) return { status: 'NOT_FOUND' };

    // Custom (non-catalog) lines have no storeItemId, so they can never
    // become an IssuancePlanItem (that model requires a real StoreItem FK).
    // They stay unattached forever — Store sources them outside this flow —
    // so only catalog lines are eligible for injection here.
    const pendingLines = requisition.items.filter((line) => !line.issuancePlanItemId && !!line.storeItemId);
    if (pendingLines.length === 0) return { status: 'ALREADY_ATTACHED' };

    const targetPlan = await this.resolveTargetPlanForWeek(monday, requisition.createdById, requisition.requisitionRef);

    for (const line of pendingLines) {
      // Guaranteed non-null by the pendingLines filter above (custom lines are excluded).
      const storeItemId = line.storeItemId!;
      const unitPrice = Number(line.storeItem!.unitCostKes);
      const notes = `PM requisition ${requisition.requisitionRef}${line.notes ? ` — ${line.notes}` : ''}`;

      // Day-specific amounts only make sense on a WEEKLY plan (EMERGENCY
      // items have no daily shape) — carry the PM's per-day figures straight
      // through so Store sees the same MON..SUN split the PM entered against
      // the weekly plan, rather than a single lump total.
      const breakdown = (line.dailyBreakdown as Record<string, number> | null) ?? null;
      const dailyBreakdown = targetPlan.type === 'WEEKLY' && breakdown ? breakdown : undefined;
      const qty = dailyBreakdown
        ? Object.values(dailyBreakdown).reduce((s: number, v: unknown) => s + Number(v ?? 0), 0)
        : Number(line.quantityNeeded);

      const planItem = await this.prisma.issuancePlanItem.create({
        data: {
          planId: targetPlan.id,
          storeItemId,
          quantityPlanned: qty,
          unitPriceKes: unitPrice,
          dailyBreakdown: dailyBreakdown ?? Prisma.JsonNull,
          source: 'PM_REQUISITION',
          status: 'PENDING_DIRECTOR',
          notes,
        },
      });

      await this.prisma.pMItemRequisitionItem.update({
        where: { id: line.id },
        data: { issuancePlanItemId: planItem.id },
      });
    }

    return {
      status: 'ATTACHED',
      planId: targetPlan.id,
      planRef: targetPlan.planRef,
      planType: targetPlan.type,
      itemCount: pendingLines.length,
    };
  }

  /** Decides — and if necessary creates — the plan a PM requisition's lines for `monday` should land in. */
  private async resolveTargetPlanForWeek(monday: Date, createdById: string, requisitionRef: string) {
    const weeklyPlan = await this.prisma.issuancePlan.findFirst({
      where: { type: 'WEEKLY', weekStartDate: monday },
      orderBy: { createdAt: 'desc' },
    });

    if (!weeklyPlan) {
      return this.createAutoDraftPlan('WEEKLY', monday, createdById, `Draft auto-created from PM requisition ${requisitionRef}.`);
    }
    if (weeklyPlan.phase === 'DRAFT') {
      return weeklyPlan;
    }

    // The week's weekly plan has already moved past DRAFT — too late to add
    // lines to it. Route to (or start) an EMERGENCY draft for the same week.
    const emergencyPlan = await this.prisma.issuancePlan.findFirst({
      where: { type: 'EMERGENCY', phase: 'DRAFT', weekStartDate: monday },
      orderBy: { createdAt: 'desc' },
    });
    if (emergencyPlan) return emergencyPlan;

    return this.createAutoDraftPlan(
      'EMERGENCY',
      monday,
      createdById,
      `Draft auto-created from PM requisition ${requisitionRef} — the weekly issuance plan for this week ` +
        `(${weeklyPlan.planRef}) was already submitted, so this was raised as an emergency plan instead.`,
      `PM requisition ${requisitionRef} — items needed after the week's weekly issuance plan (${weeklyPlan.planRef}) had already been submitted.`,
    );
  }

  private async createAutoDraftPlan(
    type: 'WEEKLY' | 'EMERGENCY',
    monday: Date,
    createdById: string,
    notes: string,
    emergencyReason?: string,
  ) {
    const count = await this.prisma.issuancePlan.count();
    const prefix = type === 'EMERGENCY' ? 'EIP' : 'IP';
    return this.prisma.issuancePlan.create({
      data: {
        planRef: `${prefix}-${dayjs().format('YYYY')}-${String(count + 1).padStart(4, '0')}`,
        type: type as any,
        weekStartDate: monday,
        weekEndDate: sundayOf(monday),
        phase: 'DRAFT',
        notes,
        emergencyReason: type === 'EMERGENCY' ? (emergencyReason ?? null) : null,
        createdById,
      },
    });
  }

  /**
   * Guard-check ONLY — throws if this IssuancePlanItem already has stock
   * issued against it, without deleting anything. Split out from
   * removeInjectedItem() so a caller that also owns a row with a FK into
   * this item (PMItemRequisitionItem.issuancePlanItemId) can check the
   * guard, delete ITS OWN row first (clearing the FK reference), and only
   * then call removeInjectedItem() — see PMRequisitionService.deleteItem
   * for why that ordering matters: deleting the IssuancePlanItem first
   * fails with a FK violation
   * (pm_item_requisition_items_issuance_plan_item_id_fkey) while a
   * requisition item row still points at it.
   */
  async assertItemRemovable(issuancePlanItemId: string) {
    const item = await this.prisma.issuancePlanItem.findUnique({ where: { id: issuancePlanItemId } });
    if (!item) return null; // already gone — nothing to cascade
    if (Number(item.quantityIssued) > 0) {
      throw new BadRequestException(
        'This item already has stock issued against it on the issuance plan, so the requisition line behind it cannot be deleted.',
      );
    }
    return item;
  }

  /**
   * Cascade delete for a PM requisition line: removes the IssuancePlanItem
   * that was auto-folded into a plan draft from that line, so the deletion
   * is reflected wherever the plan is visible (Store, Director, and anyone
   * else with plan-view access) — not just on the requisition itself.
   * Refused once stock has actually been issued against the line, same as
   * the manual removal path in updatePlan.
   *
   * IMPORTANT — caller contract: if the row calling this also holds a FK
   * into this IssuancePlanItem (e.g. PMItemRequisitionItem.issuancePlanItemId),
   * that FK-holding row must already be deleted (or nulled out) BEFORE this
   * runs, via assertItemRemovable() for the guard check first. Deleting the
   * IssuancePlanItem while another row still references it violates the FK
   * constraint. See PMRequisitionService.deleteItem for the correct order.
   */
  async removeInjectedItem(issuancePlanItemId: string) {
    const item = await this.assertItemRemovable(issuancePlanItemId);
    if (!item) return; // already gone — nothing to cascade
    await this.prisma.issuancePlanItem.delete({ where: { id: issuancePlanItemId } });
    await this.syncPhase(item.planId);
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
  async approveItem(
    planId: string,
    itemId: string,
    userId: string,
    userRole: string,
    quantityApproved?: number,
  ) {
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

    const qtyPlanned = Number(item.quantityPlanned);
    // Default: approved as requested. Director can override with a lower (or
    // equal) figure — e.g. feed requested at 1200kg but only 1000kg approved.
    const approvedQty = quantityApproved != null ? Number(quantityApproved) : qtyPlanned;

    if (!isFinite(approvedQty) || approvedQty <= 0) {
      throw new BadRequestException('Approved quantity must be greater than 0');
    }
    if (approvedQty > qtyPlanned) {
      throw new BadRequestException(
        `Approved quantity (${approvedQty.toFixed(3)}) cannot exceed the requested quantity (${qtyPlanned.toFixed(3)}).`,
      );
    }

    // For WEEKLY items, the stock-out gate checks each day against
    // dailyBreakdown, not against quantityPlanned directly — so if the
    // approved total is less than what was requested, rescale each day's
    // allowance proportionally to keep the gate consistent with the approval.
    let newBreakdown: Record<string, number> | undefined;
    const breakdown = item.dailyBreakdown as Record<string, number> | null;
    if (breakdown && approvedQty !== qtyPlanned && qtyPlanned > 0) {
      const factor = approvedQty / qtyPlanned;
      newBreakdown = {};
      for (const [day, kg] of Object.entries(breakdown)) {
        newBreakdown[day] = Math.round(Number(kg ?? 0) * factor * 1000) / 1000;
      }
    }

    await this.prisma.issuancePlanItem.update({
      where: { id: itemId },
      data: {
        status: 'APPROVED',
        directorApprovedById: userId,
        directorApprovedAt: new Date(),
        quantityApproved: approvedQty,
        ...(newBreakdown ? { dailyBreakdown: newBreakdown } : {}),
      },
    });
    await this.syncPhase(planId);

    const qtyNote = approvedQty !== qtyPlanned
      ? ` Approved for ${approvedQty.toFixed(2)} ${item.storeItem.unit ?? ''} (requested ${qtyPlanned.toFixed(2)}).`
      : '';

    // Notify Store that this item is now authorised for stock issuance
    await this.notifications.notifyRole(
      UserRole.STORE,
      NotificationType.ISSUANCE_PLAN_APPROVED as any,
      'Issuance Plan Item Approved — Stock Can Now Be Issued',
      `"${item.storeItem.name}" on plan ${item.plan.planRef} has been approved by the Director.${qtyNote} You may now issue stock against this line.`,
      { entityId: planId, entityType: 'IssuancePlan' },
    );

    // Accountant visibility: notify them of what the Director approved so they
    // can reconcile spend — they don't approve, they only observe the outcome.
    await this.notifications.notifyRole(
      UserRole.ACCOUNTANT,
      NotificationType.ISSUANCE_PLAN_APPROVED as any,
      `Director Approved Issuance — ${item.plan.planRef}`,
      `Director approved "${item.storeItem.name}" on plan ${item.plan.planRef}.${qtyNote} Stock issuance for this item is now active.`,
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
  ): Promise<{ planId: string; planItemId: string; quantity: number }[]> {
    const today = dayjs(issuedDate).startOf('day');
    const weekMonday = today.isoWeekday(1).startOf('day').toDate();
    const weekSunday = dayjs(weekMonday).add(6, 'day').endOf('day').toDate();
    const dayKey = DAY_KEYS[today.isoWeekday() - 1];

    // NOTE: it's valid for a store item to appear on more than one APPROVED
    // weekly plan covering the same week (e.g. a base plan plus a top-up
    // plan adding extra kg for specific days). All of them must be counted
    // together — findMany + FIFO allocation, not findFirst, or a combined
    // issuance that's within the *total* approved allowance gets wrongly
    // rejected because it looked only at whichever single plan came back
    // first.
    const weeklyItems = await this.prisma.issuancePlanItem.findMany({
      where: {
        storeItemId,
        status: 'APPROVED',
        plan: {
          type: 'WEEKLY',
          weekStartDate: { lte: weekSunday },
          weekEndDate: { gte: weekMonday },
        },
      },
      include: { plan: { select: { createdAt: true } } },
      orderBy: { plan: { createdAt: 'asc' } }, // FIFO: consume older plans' allowance first
    });

    if (weeklyItems.length > 0) {
      const allocations: { planId: string; planItemId: string; quantity: number }[] = [];
      let stillNeeded = quantityOut;
      let totalDailyAllowed = 0;
      let totalAlreadyToday = 0;

      for (const weeklyItem of weeklyItems) {
        const breakdown = weeklyItem.dailyBreakdown as Record<string, number> | null;
        const dailyAllowed = breakdown ? (breakdown[dayKey] ?? 0) : 0;
        totalDailyAllowed += dailyAllowed;

        const issuedToday = await this.prisma.storeStockOut.aggregate({
          _sum: { quantityOut: true },
          where: {
            issuancePlanItemId: weeklyItem.id,
            issuedDate: { gte: today.toDate(), lt: today.add(1, 'day').toDate() },
          },
        });
        const alreadyToday = Number(issuedToday._sum.quantityOut ?? 0);
        totalAlreadyToday += alreadyToday;

        const remainingForItem = dailyAllowed - alreadyToday;
        if (remainingForItem <= 0 || stillNeeded <= 0) continue;

        const takeFromThisItem = Math.min(remainingForItem, stillNeeded);
        allocations.push({ planId: weeklyItem.planId, planItemId: weeklyItem.id, quantity: takeFromThisItem });
        stillNeeded -= takeFromThisItem;
      }

      if (stillNeeded <= 1e-9) {
        return allocations;
      }

      const emergencyAuth = await this.findEmergencyAuth(storeItemId, quantityOut, issuedDate);
      if (emergencyAuth) return [{ ...emergencyAuth, quantity: quantityOut }];

      const remainingToday = totalDailyAllowed - totalAlreadyToday;
      const planNote = weeklyItems.length > 1 ? ` (combined across ${weeklyItems.length} approved weekly plans)` : '';
      throw new BadRequestException(
        `Quantity exceeds today's approved issuance plan${planNote}. ` +
          `Approved for ${dayKey}: ${totalDailyAllowed.toFixed(3)}, already issued: ${totalAlreadyToday.toFixed(3)}, ` +
          `remaining: ${Math.max(0, remainingToday).toFixed(3)}.`,
      );
    }

    const emergencyAuth = await this.findEmergencyAuth(storeItemId, quantityOut, issuedDate);
    if (emergencyAuth) return [{ ...emergencyAuth, quantity: quantityOut }];

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
      const cap = eItem.quantityApproved != null ? Number(eItem.quantityApproved) : Number(eItem.quantityPlanned);
      const remaining = cap - Number(eItem.quantityIssued);
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

    // Human-readable breakdown of exactly how `dailyKg` (and therefore each
    // day's figure on the schedule) was derived, so anyone viewing the
    // Issuance Plan can see the calculation, not just the resulting number.
    const stageLabel = stage === 'BROODING' ? 'Brooder' : 'Production House';
    const calcNote =
      `Auto-calculated: ${totalBirds.toLocaleString()} ${stageLabel} birds × ${gramsPerBirdPerDay}g/bird/day ` +
      `÷ 1000 = ${dailyKg.toFixed(2)} kg/day  ·  ${dailyKg.toFixed(2)} kg/day × 7 days = ${weeklyKg.toFixed(2)} kg/week`;

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
          notes: calcNote,
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
          notes: calcNote,
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
    // Table width is derived from the actual page/margins rather than hardcoded,
    // so columns always sum to the printable area and never run past the edge.
    const tableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    // Fractions of tableWidth — always sum to 1, so widths scale to fit whatever
    // the printable area turns out to be instead of a fixed pixel total.
    const colFractions = isEmergency
      ? [0.24, 0.09, 0.09, 0.1, 0.15, 0.15, 0.18]
      : [0.24, 0.072, 0.072, 0.072, 0.072, 0.072, 0.072, 0.072, 0.222];
    const colWidths = colFractions.map((f) => f * tableWidth);
    const headers = isEmergency
      ? ['Item', 'Qty App.', 'Qty Issued', 'Unit Price', 'Approved Value', 'Issued Value', 'Approved By']
      : ['Item', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN', 'Approved By'];

    // Draws the table header row at the current doc.y and returns the y just below it.
    const headerRowHeight = isEmergency ? 20 : 16;
    const drawTableHeader = () => {
      const top = doc.y;
      doc.rect(50, top, tableWidth, headerRowHeight).fill(brand);
      let hx = 50;
      headers.forEach((h, i) => {
        doc
          .fillColor('#fff')
          .fontSize(isEmergency ? 6.5 : 7.5)
          .text(h, hx + 3, top + (isEmergency ? 6 : 4), { width: colWidths[i] - 4, align: i === 0 ? 'left' : 'center' });
        hx += colWidths[i];
      });
      return top + headerRowHeight + 1;
    };

    // Ensures there's room for one more row; if not, starts a new page and redraws the header.
    const ensureRowSpace = (rowY: number, rowHeight: number) => {
      if (rowY + rowHeight > pageBottom) {
        doc.addPage();
        (doc as any).y = 50;
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

      // Approved qty is the Director-approved cap (falls back to what was requested
      // for older items with no approvedQty recorded); issued qty is what's actually
      // gone out against this line so far — the two can legitimately differ.
      const qtyApproved = Number(item.quantityApproved ?? item.quantityPlanned ?? 0);
      const qtyIssued = Number(item.quantityIssued ?? 0);
      const unitPrice = Number(item.unitPriceKes ?? 0);
      const approvedValue = qtyApproved * unitPrice;
      const issuedValue = qtyIssued * unitPrice;

      if (isEmergency) {
        doc.fontSize(6.5);
        doc.text(qtyApproved.toFixed(2), cx + 3, rowY + 3, { width: colWidths[1] - 4, align: 'center' });
        cx += colWidths[1];
        doc.text(qtyIssued.toFixed(2), cx + 3, rowY + 3, { width: colWidths[2] - 4, align: 'center' });
        cx += colWidths[2];
        doc.text(unitPrice.toFixed(2), cx + 3, rowY + 3, { width: colWidths[3] - 4, align: 'center' });
        cx += colWidths[3];
        doc.text(approvedValue.toFixed(2), cx + 3, rowY + 3, { width: colWidths[4] - 4, align: 'center' });
        cx += colWidths[4];
        doc.text(issuedValue.toFixed(2), cx + 3, rowY + 3, { width: colWidths[5] - 4, align: 'center' });
        cx += colWidths[5];
        doc.fontSize(7);
        doc.text(item.directorApprovedBy?.fullName ?? '—', cx + 3, rowY + 3, { width: colWidths[6] - 4, align: 'center' });
      } else {
        const breakdown = item.dailyBreakdown as Record<string, number> | null;
        DAY_KEYS.forEach((k, i) => {
          const val = breakdown ? (breakdown[k] ?? 0).toFixed(1) : '—';
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

      // Weekly rows only show the daily allocation in the table itself (7 day
      // columns already fill the row); approved/issued value goes on a compact
      // sub-row underneath so it never has to share column space with the days.
      if (!isEmergency) {
        rowY = ensureRowSpace(rowY, rowHeight);
        doc
          .fillColor('#666')
          .fontSize(6.5)
          .text(
            `Approved: ${qtyApproved.toFixed(2)} ${item.storeItem.unit} · KES ${approvedValue.toLocaleString('en-KE', { minimumFractionDigits: 2 })}   |   Issued: ${qtyIssued.toFixed(2)} ${item.storeItem.unit} · KES ${issuedValue.toLocaleString('en-KE', { minimumFractionDigits: 2 })}`,
            53,
            rowY + 1,
            { width: tableWidth - 6 },
          );
        rowY += rowHeight;
      }
    });

    (doc as any).y = rowY;

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

    // Approved value uses the Director-approved quantity (falling back to what was
    // requested only for older items with no approvedQty recorded) — this matches
    // the per-item cap the stock-out gate actually enforces, not the raw request.
    const totalApprovedKes = approvedItems.reduce(
      (s: number, i: any) => s + Number(i.quantityApproved ?? i.quantityPlanned) * Number(i.unitPriceKes),
      0,
    );
    const totalIssuedKes = approvedItems.reduce(
      (s: number, i: any) => s + Number(i.quantityIssued ?? 0) * Number(i.unitPriceKes),
      0,
    );
    doc.moveDown(1);
    doc
      .fontSize(10)
      .fillColor(brand)
      .text(`Total Approved Value: KES ${totalApprovedKes.toLocaleString('en-KE', { minimumFractionDigits: 2 })}`, { align: 'right' })
      .text(`Total Issued Value: KES ${totalIssuedKes.toLocaleString('en-KE', { minimumFractionDigits: 2 })}`, { align: 'right' });

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
