// src/modules/store/pm-requisition.service.ts
//
// PM's weekly "shopping list" of items needed for the coming week — a
// requisition form that gets folded into that week's Issuance Plan so it
// travels through the same Store → Director approval chain as everything
// else, instead of being a separate parallel procurement path.
//
// Deadline: PM should submit by Thursday, two clear days ahead of Store's
// own Saturday issuance-plan deadline, so Store has time to reconcile the
// PM's requested quantities against shelf stock before submitting to the
// Director. See PMRequisitionCron for the reminder cadence.

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../../common/notifications/notifications.service';
import { NotificationType, UserRole } from '@prisma/client';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import utc from 'dayjs/plugin/utc';
import { IssuancePlanService } from './issuance-plan.service';

dayjs.extend(isoWeek);
dayjs.extend(utc);

function sundayOf(monday: Date): Date {
  return dayjs.utc(monday).add(6, 'day').endOf('day').toDate();
}

/** This week's Monday and next week's Monday — the only two valid targets for a requisition. */
function allowedWeekStarts(): { thisWeek: Date; nextWeek: Date } {
  const today = dayjs.utc();
  const thisWeek = today.startOf('isoWeek').toDate(); // isoWeek starts on Monday
  const nextWeek = dayjs.utc(thisWeek).add(7, 'day').toDate();
  return { thisWeek, nextWeek };
}

const INCLUDE = {
  createdBy: { select: { id: true, fullName: true, role: true } },
  // storeItem is null for custom (non-catalog) lines — see customItemName/customItemUnit on the item itself.
  items: { include: { storeItem: { select: { id: true, name: true, sku: true, unit: true, category: true, unitCostKes: true } } } },
} as const;

@Injectable()
export class PMRequisitionService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private issuancePlans: IssuancePlanService,
  ) {}

  /**
   * Create-or-update the DRAFT requisition for a given week in one call —
   * PM can keep coming back to add/remove/adjust items right up until they
   * submit. Reuses the existing DRAFT for the week if present.
   *
   * A week is NOT limited to one submission: once a requisition has been
   * SUBMITTED, calling this again simply opens a brand new DRAFT for the
   * same week (a fresh requisitionRef) rather than blocking — the PM can
   * key in and send as many separate item lists as the week needs, e.g. a
   * routine Thursday list followed by a later top-up when something extra
   * comes up. Each submission is folded into the issuance plan independently.
   */
  async saveDraft(
    dto: {
      weekStartDate: string;
      notes?: string;
      items: {
        id?: string;
        storeItemId?: string;
        customItemName?: string;
        customItemUnit?: string;
        quantityNeeded: number;
        dailyBreakdown?: Record<string, number>;
        notes?: string;
      }[];
    },
    userId: string,
  ) {
    for (const item of dto.items) {
      const hasStoreItem = !!item.storeItemId;
      const hasCustomItem = !!item.customItemName?.trim();
      if (hasStoreItem === hasCustomItem) {
        throw new BadRequestException(
          'Each item must be either a store catalog item or a custom item name — not both, not neither.',
        );
      }
    }

    const monday = dayjs.utc(dto.weekStartDate).startOf('day').toDate();
    if (dayjs.utc(monday).isoWeekday() !== 1) {
      throw new BadRequestException('weekStartDate must be a Monday');
    }
    const { thisWeek, nextWeek } = allowedWeekStarts();
    if (monday.getTime() !== thisWeek.getTime() && monday.getTime() !== nextWeek.getTime()) {
      throw new BadRequestException('A requisition can only be raised for the current week or the coming week');
    }
    const sunday = sundayOf(monday);

    // Reuse THIS user's own in-progress draft for the week if one exists.
    // Scoped to createdById so one PM's still-being-assembled draft never
    // gets silently reused/overwritten by another PM raising a separate list
    // for the same week.
    let requisition = await this.prisma.pMItemRequisition.findFirst({
      where: { weekStartDate: monday, status: 'DRAFT' as any, createdById: userId },
    });

    if (!requisition) {
      // No cap on how many requisitions a week can have — a prior SUBMITTED
      // list (or several) for this week is fine; this just opens the next one.
      const count = await this.prisma.pMItemRequisition.count();
      requisition = await this.prisma.pMItemRequisition.create({
        data: {
          requisitionRef: `PMR-${dayjs().format('YYYY')}-${String(count + 1).padStart(4, '0')}`,
          weekStartDate: monday,
          weekEndDate: sunday,
          status: 'DRAFT' as any,
          notes: dto.notes,
          createdById: userId,
        },
      });
    } else if (dto.notes !== undefined) {
      await this.prisma.pMItemRequisition.update({ where: { id: requisition.id }, data: { notes: dto.notes } });
    }

    // Replace the item set wholesale — simplest, safest semantics for a
    // draft that's still being assembled (mirrors the Issuance Plan's own
    // "submit items array, reconcile against existing" pattern but without
    // needing per-item approval-state guards, since nothing here is approved yet).
    await this.prisma.pMItemRequisitionItem.deleteMany({ where: { requisitionId: requisition.id } });
    if (dto.items.length > 0) {
      await this.prisma.pMItemRequisitionItem.createMany({
        data: dto.items.map((item) => {
          // When a daily breakdown is given, it — not the raw quantityNeeded
          // the client sent — is the source of truth for the weekly total,
          // exactly like IssuancePlanItem.quantityPlanned derives from its
          // own dailyBreakdown.
          const breakdown = item.dailyBreakdown;
          const qty = breakdown
            ? Object.values(breakdown).reduce((s: number, v: unknown) => s + Number(v ?? 0), 0)
            : Number(item.quantityNeeded);
          return {
            requisitionId: requisition!.id,
            storeItemId: item.storeItemId ?? null,
            customItemName: item.storeItemId ? null : item.customItemName!.trim(),
            customItemUnit: item.storeItemId ? null : (item.customItemUnit?.trim() || null),
            quantityNeeded: isFinite(qty) && qty > 0 ? qty : Number(item.quantityNeeded),
            dailyBreakdown: breakdown ?? undefined,
            notes: item.notes,
          };
        }),
      });
    }

    return this.getById(requisition.id);
  }

  async submit(id: string, userId: string) {
    const requisition = await this.prisma.pMItemRequisition.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!requisition) throw new NotFoundException('Requisition not found');
    if (requisition.createdById !== userId) {
      throw new ForbiddenException('You can only submit your own requisition');
    }
    if (requisition.status !== ('DRAFT' as any)) {
      throw new BadRequestException('Only a DRAFT requisition can be submitted');
    }
    if (requisition.items.length === 0) {
      throw new BadRequestException('Add at least one item before submitting');
    }

    await this.prisma.pMItemRequisition.update({
      where: { id },
      data: { status: 'SUBMITTED' as any, submittedAt: new Date() },
    });

    const injection = await this.issuancePlans.injectRequisitionItemsIntoPlan(
      requisition.weekStartDate,
      requisition.id,
    );

    const routedNote =
      injection.status === 'ATTACHED'
        ? injection.planType === 'EMERGENCY'
          ? `The weekly plan for this week was already submitted, so it was added to emergency plan ${injection.planRef} instead — review before it goes to the Director.`
          : `Added to draft issuance plan ${injection.planRef} — review before Saturday's submission.`
        : '';

    // Custom (non-catalog) lines never get an IssuancePlanItem — Store has
    // to look at the requisition directly and decide how to source them.
    const customCount = requisition.items.filter((i: { storeItemId: string | null }) => !i.storeItemId).length;
    const customNote =
      customCount > 0
        ? ` ${customCount} item${customCount > 1 ? 's' : ''} on the list ${customCount > 1 ? 'are' : 'is'} not in the Store catalog — review the requisition directly to source ${customCount > 1 ? 'them' : 'it'}.`
        : '';

    await this.notifications.notifyRole(
      UserRole.STORE,
      NotificationType.PM_REQUISITION_SUBMITTED as any,
      'PM Weekly Item List Received',
      `The Production Manager submitted ${requisition.items.length} item${requisition.items.length > 1 ? 's' : ''} needed for the week of ` +
        `${dayjs(requisition.weekStartDate).format('D MMM')} – ${dayjs(requisition.weekEndDate).format('D MMM YYYY')} (${requisition.requisitionRef}). ${routedNote}${customNote}`,
      { entityId: id, entityType: 'PMItemRequisition' },
    );

    return this.getById(id);
  }

  /** DRAFT only — PM can withdraw a requisition they haven't sent yet. */
  async deleteDraft(id: string, userId: string) {
    const requisition = await this.prisma.pMItemRequisition.findUnique({ where: { id } });
    if (!requisition) throw new NotFoundException('Requisition not found');
    if (requisition.createdById !== userId) {
      throw new ForbiddenException('You can only delete your own requisition');
    }
    if (requisition.status !== ('DRAFT' as any)) {
      throw new BadRequestException('Only a DRAFT requisition can be deleted — it has already been sent to Store');
    }
    await this.prisma.pMItemRequisition.delete({ where: { id } });
    return { deleted: true };
  }

  /**
   * Delete a single line — from a DRAFT (simple removal) or from an
   * already-SUBMITTED requisition. For a submitted, catalog-backed line that
   * was already folded into an Issuance Plan draft, this cascades: the
   * linked IssuancePlanItem is removed too, so Store, the Director, and
   * anyone else looking at that plan see the line disappear along with it.
   * Refused if stock has already been issued against that plan line — the
   * requisition line can't un-happen at that point.
   */
  async deleteItem(requisitionId: string, itemId: string, userId: string) {
    const requisition = await this.prisma.pMItemRequisition.findUnique({
      where: { id: requisitionId },
      include: { items: true },
    });
    if (!requisition) throw new NotFoundException('Requisition not found');
    if (requisition.createdById !== userId) {
      throw new ForbiddenException('You can only delete items from your own requisition');
    }
    const item = requisition.items.find((i) => i.id === itemId);
    if (!item) throw new NotFoundException('Requisition item not found');

    // Cascade to the injected IssuancePlanItem first — this is where the
    // "already issued" guard lives, so a failure here leaves both records
    // untouched rather than deleting the requisition line but not its plan line.
    if (item.issuancePlanItemId) {
      await this.issuancePlans.removeInjectedItem(item.issuancePlanItemId);
    }

    await this.prisma.pMItemRequisitionItem.delete({ where: { id: itemId } });

    if (requisition.status === ('SUBMITTED' as any)) {
      const lineLabel = item.storeItemId ? 'A catalog item line' : `The custom line "${item.customItemName ?? 'an item'}"`;
      await this.notifications.notifyRole(
        UserRole.STORE,
        NotificationType.PM_REQUISITION_ITEM_REMOVED as any,
        'PM Removed an Item from a Requisition',
        `${lineLabel} was removed from requisition ${requisition.requisitionRef} ` +
          `(week of ${dayjs(requisition.weekStartDate).format('D MMM YYYY')})` +
          `${item.issuancePlanItemId ? ' — it has also been pulled off the issuance plan draft it was folded into.' : '.'}`,
        { entityId: requisitionId, entityType: 'PMItemRequisition' },
      );
    }

    return this.getById(requisitionId);
  }

  async list(filters: { weekStartDate?: string; status?: string }) {
    return this.prisma.pMItemRequisition.findMany({
      where: {
        ...(filters.weekStartDate ? { weekStartDate: dayjs.utc(filters.weekStartDate).startOf('day').toDate() } : {}),
        ...(filters.status ? { status: filters.status as any } : {}),
      },
      include: INCLUDE,
      orderBy: [{ weekStartDate: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async getById(id: string) {
    const requisition = await this.prisma.pMItemRequisition.findUnique({ where: { id }, include: INCLUDE });
    if (!requisition) throw new NotFoundException('Requisition not found');
    return requisition;
  }
}
