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
   * submit. Only one requisition per week; reuses the existing DRAFT if
   * present rather than creating duplicates.
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

    let requisition = await this.prisma.pMItemRequisition.findFirst({
      where: { weekStartDate: monday, status: 'DRAFT' as any },
    });

    if (!requisition) {
      // Can't open a new draft once the week has already been submitted —
      // edit the submitted one via updateSubmitted-style flow is out of
      // scope; keep this simple and predictable.
      const alreadySubmitted = await this.prisma.pMItemRequisition.findFirst({
        where: { weekStartDate: monday, status: 'SUBMITTED' as any },
      });
      if (alreadySubmitted) {
        throw new BadRequestException(
          `A requisition for the week of ${dayjs(monday).format('D MMM YYYY')} has already been submitted (${alreadySubmitted.requisitionRef}).`,
        );
      }

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
        data: dto.items.map((item) => ({
          requisitionId: requisition!.id,
          storeItemId: item.storeItemId ?? null,
          customItemName: item.storeItemId ? null : item.customItemName!.trim(),
          customItemUnit: item.storeItemId ? null : (item.customItemUnit?.trim() || null),
          quantityNeeded: item.quantityNeeded,
          notes: item.notes,
        })),
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
