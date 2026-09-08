// src/modules/production/production.service.ts
//
// Lead Attendant submission flow per changes.pdf + Anza Whole Foods Summary:
//   • One bundled submission contains egg counts, session feed, environmental
//     readings and (optional) vaccines/supplements.
//   • Block 1 only — units A, B, C with two rows each (Block 2 is under
//     construction and rejected here as a guard).
//   • Per-row counters: broken / damaged / starterEggs. The old brokenUnsellable
//     / brokenSellable split is no longer captured at collection time — Sales
//     enters the actual sellable/unsellable classification at tally sign-off.
//   • starterEggs roll up to a session field consumed by the Accountant for
//     per-category pricing and by the Sales person's stock.
//   • Vaccines / supplements are forwarded to VaccinationRecord so they appear
//     in the Production Manager's Health page as a historical log.
//   • Once the Production Manager verifies, the entry is locked.
//
// CORRECTIONS APPLIED:
//   FIX-1: Approving AM session now notifies the attendant that AM is approved
//           and opens the PM session for data recording.
//   FIX-2: Once BOTH AM and PM sessions are approved, both are locked (no
//           further data can be recorded for that day).
//   FIX-3: "Return to Attendant" now notifies the attendant with the reason
//           and restores Block 1 units for editing.
//   FIX-4: Tally sign-off is only triggered after BOTH AM and PM sessions
//           are approved on the same day.

import {
  Injectable, NotFoundException, ConflictException,
  BadRequestException, ForbiddenException, Logger,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EntryStatus, VaccinationRoute } from '@prisma/client';
import { RequestUser } from '../../auth/types/request-user.type';
import { NotificationsService } from '../../common/notifications/notifications.service';
import type { CreateEggCollectionSessionDto } from './production.dto';
import { TallyVerificationService } from '../store/tally-verification.service';
import { assertEggCollectionSessionOpen, getEggCollectionSessionStatus } from '../../common/production/egg-collection-session-window.util';
import { StoreInventoryService } from '../store/store-inventory.service';
import { CageMapService } from './cage-map.service';

interface RowDataEntry {
  rowCode: string;
  totalBirds: number;
  totalEggs: number;
  starterEggs: number;
  broken: number;
  damaged: number;
  softShell: number;
  deformed: number;
  weightKg: number;
  attendantName: string;
}

function rollupRows(rows: RowDataEntry[]) {
  let totalEggs = 0, totalStarter = 0, totalBroken = 0, totalDamaged = 0;
  let totalSoftShell = 0, totalDeformed = 0, totalWeightKg = 0;
  for (const r of rows) {
    totalEggs      += r.totalEggs   ?? 0;
    totalStarter    += r.starterEggs ?? 0;
    totalBroken     += r.broken      ?? 0;
    totalDamaged    += r.damaged     ?? 0;
    totalSoftShell  += r.softShell   ?? 0;
    totalDeformed   += r.deformed    ?? 0;
    totalWeightKg   += Number(r.weightKg ?? 0);
  }
  // All-starter special case:
  // totalEggs === starterEggs + broken + damaged + softShell + deformed
  // → every non-broken egg is a starter; totalGoodEggs = 0 (starters tracked separately).
  // isAllStarter is returned so callers (HDP, notifications) can use it without
  // re-deriving the condition from the stored fields.
  const nonStandardTotal = totalStarter + totalBroken + totalDamaged + totalSoftShell + totalDeformed;
  const isAllStarter     = totalStarter > 0 && totalEggs > 0 && totalEggs === nonStandardTotal;
  const totalGoodEggs    = Math.max(0, totalEggs - nonStandardTotal);
  const totalFullTrays   = Math.floor(totalGoodEggs / 30);
  const totalLooseEggs   = totalGoodEggs % 30;
  return {
    totalEggs, totalStarter, totalBroken, totalDamaged,
    totalSoftShell, totalDeformed, totalWeightKg,
    totalGoodEggs, totalFullTrays, totalLooseEggs, isAllStarter,
  };
}

@Injectable()
export class ProductionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly tallyVerificationService: TallyVerificationService,
    private readonly storeInventory: StoreInventoryService,
    private readonly cageMapService: CageMapService,
  ) {}

  private readonly logger = new Logger(ProductionService.name);

  // A feed/vaccine/supplement/treatment can be logged against any active
  // store item in the right category — it no longer has to have been
  // issued (stock-out'd) first. Mirrors FlockService.getIssuedStoreItemOrThrow:
  // feed, and bulk-issued supplements/treatments especially, are routinely
  // handed to the attendant before Store logs the stock-out in the system
  // (or issued once in bulk and drawn down across many later days) — the
  // residual check below still ties the recorded amount back to Store's
  // issuance once it exists, flagging surplus rather than gating on it.
  private async getIssuedStoreItemOrThrow(storeItemId: string) {
    const item = await this.prisma.storeItem.findUnique({
      where: { id: storeItemId },
      select: { unit: true, name: true, category: true, isActive: true },
    });
    if (!item || !item.isActive) throw new BadRequestException('Store item not found.');
    return item;
  }

  // Soft stock check — no longer blocks the write; it warns (for Store/PM
  // follow-up) when the amount recorded runs past the item's residual
  // (issued − dispensed, all-time). Mirrors FlockService.checkResidualOrWarn.
  private async checkResidualOrWarn(
    storeItemId: string,
    quantityRequested: number,
    unit: string | null,
    context: string,
  ): Promise<void> {
    const residualInfo = await this.storeInventory.getResidualForItem(storeItemId);
    const residualBefore = residualInfo?.residual ?? 0;
    if (quantityRequested > residualBefore) {
      this.logger.warn(
        `[StockSurplus] ${context}: storeItemId=${storeItemId} requested=${quantityRequested}${unit ?? ''} ` +
        `exceeds residual=${Math.max(0, residualBefore).toFixed(3)}${unit ?? ''} — recorded anyway, ` +
        `flagged for Store/PM follow-up.`,
      );
    }
  }

  // Derives a FeedType enum value from the store item's SKU/name — mirrors
  // BrooderDailyLogModal's deriveFeedType on the frontend, kept here too
  // since FeedIntakeLog.feedType is a non-nullable enum column.
  private deriveFeedTypeFromItem(item: { sku?: string | null; name: string }): string {
    const haystack = `${item.sku ?? ''} ${item.name}`.toUpperCase();
    if (haystack.includes('KIENYEJI')) {
      if (haystack.includes('STARTER'))  return 'KIENYEJI_STARTER';
      if (haystack.includes('GROWER'))   return 'KIENYEJI_GROWER';
      if (haystack.includes('FINISHER')) return 'KIENYEJI_FINISHER';
    }
    if (haystack.includes('CHICK'))  return 'CHICK_MASH';
    if (haystack.includes('GROWER')) return 'GROWER_MASH';
    if (haystack.includes('LAYER'))  return 'LAYER_MASH';
    return 'LAYER_MASH'; // production-house default — birds here are always layers
  }

  getEggCollectionSessionStatus() {
    return getEggCollectionSessionStatus();
  }

  async createEggCollection(dto: CreateEggCollectionSessionDto, user: RequestUser) {
    if (user.role !== 'ATTENDANT') {
      throw new ForbiddenException('Only the Lead Attendant may submit egg collection sessions');
    }
    if (dto.block && dto.block !== 'BLOCK1') {
      throw new BadRequestException('Block 2 is under construction and cannot accept submissions yet');
    }

    const batch = await this.prisma.batch.findFirst({
      where: { id: dto.batchId, deletedAt: null, stage: { not: 'CLOSED' } },
    });
    if (!batch) throw new NotFoundException('Batch not found or closed');

    // Daily submission deadline: AM locks at 12:00pm, PM locks at 4:30pm
    // (farm-local time) — past that, the shift is closed until tomorrow's
    // AM window opens at midnight. Only applies to TODAY's sessionDate; a
    // backdated correction is exempt (see the util's own comment).
    assertEggCollectionSessionOpen(dto.shift, dto.sessionDate);

    // FIX-2: Block same-day recording if both sessions are already approved (day is locked)
    if (dto.shift === 'PM') {
      const amSession = await this.prisma.eggCollectionSession.findFirst({
        where: {
          batchId: dto.batchId,
          houseId: dto.houseId,
          sessionDate: new Date(dto.sessionDate),
          shift: 'AM',
          deletedAt: null,
        },
      });
      if (!amSession || amSession.status !== EntryStatus.APPROVED) {
        throw new ConflictException(
          'AM session must be approved by the Production Manager before PM data can be recorded.',
        );
      }
    }

    const existing = await this.prisma.eggCollectionSession.findFirst({
      where: {
        batchId: dto.batchId,
        houseId: dto.houseId,
        sessionDate: new Date(dto.sessionDate),
        shift: dto.shift,
        deletedAt: null,
      },
      include: { tally: true },
    });

    if (existing && existing.status !== EntryStatus.RETURNED) {
      throw new ConflictException(
        `A ${dto.shift} egg collection session already exists for this house on ${dto.sessionDate}`,
      );
    }
    if (existing?.tally?.isLocked) {
      throw new ConflictException('Tally for this session is locked. No further submissions accepted.');
    }

    // ── Validate feed store item(s) + residual BEFORE writing anything ─────
    // Primary line first (backward-compat), then any additional lines for a
    // same-day feed transition (e.g. Growers Mash -> Developer's Mash).
    // Two lines against the same item within one submission are reserved
    // against each other, same pattern as the vaccine reservation below.
    const feedItem = await this.getIssuedStoreItemOrThrow(dto.sessionFeed.feedStoreItemId);
    const feedLines = [
      { feedStoreItemId: dto.sessionFeed.feedStoreItemId, feedKg: dto.sessionFeed.feedKg, item: feedItem },
    ];
    const feedReserved = new Map<string, number>();
    feedReserved.set(dto.sessionFeed.feedStoreItemId, dto.sessionFeed.feedKg);
    for (const line of dto.sessionFeed.additionalLines ?? []) {
      const lineItem = await this.getIssuedStoreItemOrThrow(line.feedStoreItemId);
      const already = feedReserved.get(line.feedStoreItemId) ?? 0;
      await this.checkResidualOrWarn(line.feedStoreItemId, already + line.feedKg, lineItem.unit, 'Egg collection feed line');
      feedReserved.set(line.feedStoreItemId, already + line.feedKg);
      feedLines.push({ feedStoreItemId: line.feedStoreItemId, feedKg: line.feedKg, item: lineItem });
    }
    await this.checkResidualOrWarn(dto.sessionFeed.feedStoreItemId, dto.sessionFeed.feedKg, feedItem.unit, 'Egg collection feed');
    const totalFeedKg = feedLines.reduce((s, l) => s + l.feedKg, 0);
    const feedBreakdownJson = feedLines.map(l => ({
      storeItemId: l.feedStoreItemId,
      name: l.item.name,
      kg: l.feedKg,
    }));

    // ── Validate each vaccine/supplement store item + residual up front too,
    // reserving quantities against each other within this same request (two
    // vaccine entries drawing on the same bottle can't both pass residual
    // checks independently and then overdraw once both are written).
    const vaccinesGiven = dto.vaccinesGiven ?? [];
    const reserved = new Map<string, number>();
    for (const v of vaccinesGiven) {
      const item = await this.getIssuedStoreItemOrThrow(v.storeItemId);
      const qty = v.quantityUsed ?? 0;
      if (qty > 0) {
        const alreadyReserved = reserved.get(v.storeItemId) ?? 0;
        await this.checkResidualOrWarn(v.storeItemId, alreadyReserved + qty, item.unit, `Egg collection ${v.kind.toLowerCase()}`);
        reserved.set(v.storeItemId, alreadyReserved + qty);
      }
    }

    const totals = rollupRows(dto.rowData as RowDataEntry[]);
    const closingStock = dto.openingPop - dto.mortalities;
    // When all eggs are starters, use totalStarter for HDP so production isn't
    // reported as 0% hen-day. Standard sessions use totalGoodEggs as normal.
    const hdpEggs       = totals.isAllStarter ? totals.totalStarter : totals.totalGoodEggs;
    const henDayPercent = closingStock > 0
      ? Math.round((hdpEggs / closingStock) * 10000) / 100
      : null;

    const data = {
      batchId: dto.batchId,
      houseId: dto.houseId,
      sessionDate: new Date(dto.sessionDate),
      shift: dto.shift,
      collectedById: user.id,
      openingPop: dto.openingPop,
      mortalities: dto.mortalities,
      closingStock,
      rowData: dto.rowData as any,
      totalFullTrays: totals.totalFullTrays,
      totalLooseEggs: totals.totalLooseEggs,
      totalBrokenEggs: totals.totalBroken,
      totalDamaged: totals.totalDamaged,
      totalSoftShell: totals.totalSoftShell,
      totalDeformed: totals.totalDeformed,
      totalWeightKg: totals.totalWeightKg,
      totalGoodEggs: totals.totalGoodEggs,
      totalStarterEggs: totals.totalStarter ?? 0,
      // Conservative default — every broken egg counted as a loss until
      // Sales enters the actual sellable/unsellable split at tally sign-off.
      totalBrokenSellable: 0,
      totalBrokenUnsellable: totals.totalBroken,
      feedKg: totalFeedKg,
      feedTypeName: this.deriveFeedTypeFromItem(feedItem as any),
      feedStoreItemId: dto.sessionFeed.feedStoreItemId,
      feedBreakdownJson: feedBreakdownJson as any,
      waterLiters: dto.environment?.waterLiters ?? null,
      houseTempC: dto.environment?.houseTempC ?? null,
      dailyFeedKg: totalFeedKg,
      vaccineGiven: vaccinesGiven
        .map((v: any) => (v.kind === 'VACCINE' ? 'V: ' : v.kind === 'SUPPLEMENT' ? 'S: ' : 'T: ') + v.name + ' (' + v.dosage + ')')
        .join('; ') || null,
      henDayPercent,
      remarks: dto.remarks ?? null,
      status: EntryStatus.PENDING,
    };

    const session = existing?.status === EntryStatus.RETURNED
      ? await this.prisma.eggCollectionSession.update({
          where: { id: existing.id },
          data: { ...data, status: EntryStatus.PENDING, returnReason: null, verifiedById: null, verifiedAt: null, },
        })
      : await this.prisma.eggCollectionSession.create({ data });

    // Deduct feed from stock — feed is now a required, store-item-linked
    // field (validated above), so this always fires. One log per feed line,
    // so a same-day transition (e.g. Growers Mash -> Developer's Mash) draws
    // down each item's own residual correctly instead of blending them.
    for (const line of feedLines) {
      try {
        await this.prisma.feedIntakeLog.create({
          data: {
            batchId: dto.batchId,
            houseId: dto.houseId,
            feedType: this.deriveFeedTypeFromItem(line.item as any) as any,
            storeItemId: line.feedStoreItemId,
            entryDate: new Date(dto.sessionDate),
            quantityDispensedKg: line.feedKg,
            wastageKg: 0,
            recommendedMinKg: 0,
            recommendedMaxKg: 0,
            notes: 'Logged from ' + dto.shift + ' egg collection session',
            recordedById: user.id,
          },
        });
      } catch (_) { /* best-effort feed log — residual already validated above */ }
    }

    // Forward vaccines/supplements to VaccinationRecord (store-item-linked,
    // residual already validated above) so the Production Manager Health
    // page surfaces them as a historical log AND the store residual ledger
    // (getIssuableStoreItems) reflects what was actually dispensed.
    for (const v of vaccinesGiven) {
      await this.prisma.vaccinationRecord.create({
        data: {
          batchId: dto.batchId,
          vaccineName: `${v.kind === 'SUPPLEMENT' ? '[Supplement] ' : v.kind === 'TREATMENT' ? '[Treatment] ' : ''}${v.name}`,
          administeredDate: new Date(dto.sessionDate),
          route: VaccinationRoute.OTHER,
          batchSize: closingStock,
          dosageUnits: v.dosage,
          storeItemId: v.storeItemId,
          quantityUsed: v.quantityUsed ?? null,
          notes: `Logged via Lead Attendant ${dto.shift} session`,
          recordedById: user.id,
        },
      });
    }

    // Auto-log collection-time breakage expenses (soft shell, deformed,
    // damaged, broken). The broken/sellable split isn't known yet at
    // collection time — Sales enters it at tally sign-off — so broken is
    // conservatively costed here as a full loss, same as damaged/soft
    // shell/deformed. TallyVerificationService.sign() logs an adjusting
    // entry once the actual split is known.
    try {
      const collDate = new Date(dto.sessionDate);
      collDate.setHours(0, 0, 0, 0);
      const pricing = await this.prisma.dailyEggPrice.findUnique({ where: { priceDate: collDate } });
      const costPerEgg        = pricing?.pricePerEgg       ? Number(pricing.pricePerEgg)       : 0;
      // pricePerEggBroken isn't used here — the broken bucket is conservatively
      // costed as a full loss until Sales's split is known (see sign() adjustment).

      const softShellQty     = totals.totalSoftShell ?? 0;
      const deformedQty      = totals.totalDeformed  ?? 0;
      const damagedQty       = totals.totalDamaged   ?? 0;
      const brokenQty        = totals.totalBroken    ?? 0; // unsplit at collection time — full loss until Sales classifies

      // softShell + deformed + damaged: cost = costPerEgg × qty (not sold)
      const fullLossLoss    = (softShellQty + deformedQty + damagedQty) * costPerEgg;
      // broken: conservatively costed as full loss (unsellable) at collection
      // time — corrected by an adjusting entry once Sales splits it.
      const brokenLoss      = brokenQty * costPerEgg;
      const totalCollLoss   = fullLossLoss + brokenLoss;

      if (totalCollLoss > 0 && costPerEgg > 0) {
        let cat = await this.prisma.expenseCategory.findUnique({ where: { name: 'Egg Breakage' } });
        if (!cat) {
          cat = await this.prisma.expenseCategory.create({
            data: { name: 'Egg Breakage', description: 'Auto-logged egg breakage losses', createdById: user.id },
          });
        }
        const parts: string[] = [];
        if (softShellQty > 0) parts.push(`Soft shell: ${softShellQty}`);
        if (deformedQty  > 0) parts.push(`Deformed: ${deformedQty}`);
        if (damagedQty   > 0) parts.push(`Damaged: ${damagedQty}`);
        if (brokenQty    > 0) parts.push(`Broken (unclassified, provisional full loss): ${brokenQty}`);

        await this.prisma.expenseLog.create({
          data: {
            categoryId:   cat.id,
            description:  `${dto.shift} collection breakage — Batch ${batch.batchCode ?? dto.batchId}. ${parts.join(', ')}.`,
            amount:       totalCollLoss,
            expenseDate:  collDate,
            vendorName:   null,
            receiptRef:   `COLL-${session.id.slice(0, 8)}`,
            recordedById: user.id,
          },
        });
      }
    } catch (_) { /* best-effort collection expense logging */ }

    // Create EggTallyVerification placeholder for both AM and PM sessions.
    // Tally sign-off is only triggered once BOTH sessions are APPROVED (see verifySession).
    await this._fireVerificationNotifications(session, batch);
    await this.prisma.eggTallyVerification.upsert({
      where: { sessionId: session.id },
      update: {},
      create: { sessionId: session.id, verificationDate: session.sessionDate },
    });

    return session;
  }

  async getDailyAggregate(date?: string) {
    const targetDate = date ? new Date(date) : new Date();
    targetDate.setHours(0, 0, 0, 0);

    const aggregate = await this.prisma.dailyEggAggregate.findFirst({
      where: {
        aggregateDate: { lte: targetDate },
      },
      orderBy: { aggregateDate: 'desc' },
    });

    if (!aggregate) return null;

    // Fetch the pricing for that day so the frontend can show the formula breakdown
    const pricing = await this.prisma.dailyEggPrice.findUnique({
      where: { priceDate: aggregate.aggregateDate },
      select: {
        pricePerEgg:        true,
        pricePerEggStarter: true,
        pricePerEggBroken:  true,
      },
    });

    return {
      ...aggregate,
      pricing: pricing ?? null,
    };
  }

  private async _fireVerificationNotifications(session: any, batch: any) {
    const targets = await this.prisma.user.findMany({
      where: { role: { in: ['MANAGER', 'STORE', 'OWNER'] }, isActive: true },
      select: { id: true, role: true },
    });
    const houseRecord = await this.prisma.house.findUnique({
      where: { id: session.houseId }, select: { name: true },
    });
    const houseName = houseRecord?.name ?? 'House';

    for (const target of targets) {
      const allStarterSession = (session as any).totalStarterEggs > 0 && session.totalGoodEggs === 0;
      const eggSummary = allStarterSession
        ? `${(session as any).totalStarterEggs} starter eggs (all-starter session)`
        : `${session.totalGoodEggs} good eggs, ${session.totalFullTrays} full trays`;
      const message = target.role === 'STORE'
        ? `${session.shift} egg collection submitted for ${houseName} (${batch.batchCode}). Please log your egg intake — ${eggSummary}.`
        : `${session.shift} egg collection awaiting Manager verification — ${houseName} (${batch.batchCode}). ${eggSummary} · HDP: ${session.henDayPercent ?? '—'}%.`;
      await this.prisma.notification.create({
        data: {
          userId: target.id,
          type: 'EGG_TALLY_TRIGGERED' as any,
          title: `Egg Collection — ${houseName} ${session.shift}`,
          message,
          entityId: session.id,
          entityType: 'EggCollectionSession',
        },
      });
    }
  }

  async getEggCollections(houseId?: string, batchId?: string, sessionDate?: string) {
    return this.prisma.eggCollectionSession.findMany({
      where: {
        deletedAt: null,
        ...(houseId ? { houseId } : {}),
        ...(batchId ? { batchId } : {}),
        ...(sessionDate ? { sessionDate: new Date(sessionDate) } : {}),
      },
      include: {
        batch: { select: { batchCode: true } },
        storeIntakes: {
          select: { id: true, totalGoodEggs: true, totalFullTrays: true, hasDiscrepancy: true },
        },
        tally: {
          select: {
            isLocked: true, lockedAt: true,
            pmSignedAt: true, salesSignedAt: true, storeSignedAt: true,
          },
        },
      },
      orderBy: [{ sessionDate: 'desc' }, { shift: 'asc' }],
      take: 100,
    });
  }

  async getSessionById(id: string) {
    const session = await this.prisma.eggCollectionSession.findFirst({
      where: { id, deletedAt: null },
      include: {
        batch: { select: { batchCode: true, currentBirdCount: true } },
        storeIntakes: true,
        tally: true,
      },
    });
    if (!session) throw new NotFoundException('Session not found');
    return session;
  }

  async verifySession(
    id: string,
    action: 'approve' | 'return',
    returnReason: string | undefined,
    user: RequestUser,
  ) {
    if (user.role !== 'MANAGER' && user.role !== 'OWNER') {
      throw new ForbiddenException('Only the Production Manager may verify a session');
    }
    const session = await this.prisma.eggCollectionSession.findFirst({
      where: { id, deletedAt: null },
      include: { storeIntakes: true, tally: true, batch: true },
    });
    if (!session) throw new NotFoundException('Session not found');
    if (session.tally?.isLocked) {
      throw new BadRequestException('Tally is locked — verification already finalised');
    }
    if (session.status !== EntryStatus.PENDING) {
      throw new BadRequestException(`Session is already ${session.status.toLowerCase()}`);
    }

    const houseRecord = await this.prisma.house.findUnique({
      where: { id: session.houseId }, select: { name: true },
    });
    const houseName = houseRecord?.name ?? 'House';

    if (action === 'approve') {
      const storeIntake = session.storeIntakes[0];
      if (storeIntake && session.totalGoodEggs !== storeIntake.totalGoodEggs) {
        await this.prisma.storeEggIntake.update({
          where: { id: storeIntake.id },
          data: {
            hasDiscrepancy: true,
            discrepancyNote: `Attendant: ${session.totalGoodEggs} eggs. Store: ${storeIntake.totalGoodEggs} eggs. Difference: ${Math.abs(session.totalGoodEggs - storeIntake.totalGoodEggs)}.`,
          },
        });
      }

      const approved = await this.prisma.eggCollectionSession.update({
        where: { id },
        data: { status: EntryStatus.APPROVED },
      });

      // Sync the production cage map's per-row bird counts from what the
      // attendant reported (rowData[i].totalBirds), now that a PM has
      // verified it. Best-effort — a cage-map sync problem should never
      // block the verification itself from going through.
      try {
        await this.cageMapService.syncRowPopulations(session.batchId, session.rowData as any);
      } catch (err) {
        this.logger.warn(`Cage map row-population sync failed for session ${id}: ${err}`);
      }

      // FIX-1: Notify attendant that their session has been approved
      // FIX (account-restricted / needs-hard-refresh bug): this used to call
      // `this.prisma.notification.create(...)` directly, which only writes
      // the row — it bypasses NotificationsService's event-bus emit, so the
      // attendant's browser never received a live 'notification:new' push
      // over the websocket. Their EggCollectionPage/AttendantHome session
      // queries were then left to passive polling (up to their own staleTime)
      // to notice the approval/return, which could take minutes and made a
      // freshly-unlocked PM session look locked/"restricted" until a hard
      // refresh forced an immediate refetch. Routing through
      // `this.notifications` (already injected, previously unused here)
      // fixes that — see useAttendantRealtime on the frontend, which
      // invalidates the session query the moment this notification arrives.
      const attendant = await this.prisma.user.findUnique({
        where: { id: session.collectedById },
        select: { id: true },
      });
      if (attendant) {
        if (session.shift === 'AM') {
          // AM approved → tell attendant they can now submit PM session
          await this.notifications.notifyUser(
            attendant.id,
            'EGG_TALLY_TRIGGERED' as any,
            `AM Session Approved — ${houseName}`,
            `Your AM egg collection for ${houseName} (${(session as any).batch?.batchCode ?? ''}) has been approved. You may now submit the PM session.`,
            { entityId: session.id, entityType: 'EggCollectionSession' },
          );
        } else {
          // PM approved → notify attendant; day is now fully locked
          await this.notifications.notifyUser(
            attendant.id,
            'EGG_TALLY_TRIGGERED' as any,
            `PM Session Approved — ${houseName}`,
            `Your PM egg collection for ${houseName} (${(session as any).batch?.batchCode ?? ''}) has been approved. Both AM and PM sessions are now locked for today.`,
            { entityId: session.id, entityType: 'EggCollectionSession' },
          );
        }
      }

      // FIX-4: Only trigger tally sign-off when BOTH AM and PM sessions are approved
      if (session.shift === 'PM') {
        const amSession = await this.prisma.eggCollectionSession.findFirst({
          where: {
            batchId: session.batchId,
            houseId: session.houseId,
            sessionDate: session.sessionDate,
            shift: 'AM',
            status: EntryStatus.APPROVED,
            deletedAt: null,
          },
        });
   
        if (amSession) {
          // Both AM and PM are approved — create tally records for each session
          await this.tallyVerificationService.createTallyForSession(
            amSession.id,
            session.sessionDate,
          );
          await this.tallyVerificationService.createTallyForSession(
            session.id,
            session.sessionDate,
          );
   
          // Notify all three tally parties.
          // PERF: was sequentially `await`ing one notification.create() per
          // user in a for-loop — with several Manager/Sales/Store accounts
          // that serializes N round-trips onto the approve request, which is
          // exactly why a PM-shift approval (the branch that reaches here)
          // could feel noticeably slower than an AM approval. createMany
          // sends all rows in a single query, matching the pattern already
          // used by TallyVerificationService's own bulk-notify helpers.
          const tallyTargets = await this.prisma.user.findMany({
            where: { role: { in: ['MANAGER', 'SALES', 'STORE'] }, isActive: true },
            select: { id: true },
          });
          if (tallyTargets.length > 0) {
            await this.prisma.notification.createMany({
              data: tallyTargets.map(t => ({
                userId: t.id,
                type: 'EGG_TALLY_TRIGGERED' as any,
                title: `Next Morning Sign-off Ready — ${houseName}`,
                message: `Both AM and PM sessions for ${houseName} (${session.batch?.batchCode ?? ''}) are approved. The morning three-party sign-off is now available.`,
                entityId: session.id,
                entityType: 'EggCollectionSession',
              })),
            });
          }
        }
      }

      return approved;
    }

    if (!returnReason) throw new BadRequestException('Return reason is required');

    const returned = await this.prisma.eggCollectionSession.update({
      where: { id },
      data: { status: EntryStatus.RETURNED, returnReason },
    });

    // FIX-3: Notify attendant of the return with the reason so they know to recount
    // (routed through NotificationsService — see the FIX comment on the
    // approve branch above for why the raw prisma.notification.create call
    // this replaced caused the "restricted / needs hard refresh" bug.)
    const attendant = await this.prisma.user.findUnique({
      where: { id: session.collectedById },
      select: { id: true },
    });
    if (attendant) {
      await this.notifications.notifyUser(
        attendant.id,
        'EGG_TALLY_TRIGGERED' as any,
        `${session.shift} Session Returned — Recount Required`,
        `Your ${session.shift} egg collection for ${houseName} has been returned for a recount. Reason: ${returnReason}. Please review and resubmit.`,
        { entityId: session.id, entityType: 'EggCollectionSession' },
      );
    }

    return returned;
  }

  async getHenDayTrend(batchId: string, days = 14) {
    // FIX: this used to only read PM sessions and return their per-shift
    // henDayPercent / totalGoodEggs — i.e. just one shift's good eggs divided
    // by that shift's own closing stock. That silently drops every AM
    // session's eggs from the numerator, understating true daily HDP by
    // roughly half whenever both shifts are recorded, and it skipped any day
    // where only the AM session has been submitted so far.
    //
    // Now pulls BOTH shifts and combines AM+PM per calendar day before
    // computing HDP — same convention already used in
    // CageMapService.getBlockWithMap and AiService.aggregateDailyHdp. Fetch
    // 3x the row count to comfortably cover `days` calendar days even when
    // some days only have one shift recorded.
    const sessions = await this.prisma.eggCollectionSession.findMany({
      where: { batchId, status: EntryStatus.APPROVED, deletedAt: null },
      orderBy: { sessionDate: 'desc' },
      take: days * 3,
      select: { sessionDate: true, shift: true, totalGoodEggs: true, totalStarterEggs: true, closingStock: true },
    });

    const byDate = new Map<string, typeof sessions>();
    for (const s of sessions) {
      const key = s.sessionDate.toISOString().slice(0, 10);
      const bucket = byDate.get(key) ?? [];
      bucket.push(s);
      byDate.set(key, bucket);
    }

    const trend = Array.from(byDate.values()).map(daySessions => {
      // A session that is entirely Kienyeji "starter" eggs stores 0 in
      // totalGoodEggs by design — fall back to totalStarterEggs in that case.
      const totalGoodEggs = daySessions.reduce(
        (sum, s) => sum + (s.totalGoodEggs > 0 ? s.totalGoodEggs : s.totalStarterEggs),
        0,
      );
      const pm = daySessions.find(s => s.shift === 'PM');
      const am = daySessions.find(s => s.shift === 'AM');
      const closingStock = pm?.closingStock ?? am?.closingStock ?? 0;
      return {
        sessionDate: (pm ?? am)!.sessionDate,
        totalGoodEggs,
        henDayPercent: closingStock > 0 ? Math.round((totalGoodEggs / closingStock) * 10000) / 100 : 0,
      };
    });

    // Chronological order (oldest → newest), matching the convention used by
    // the dashboard's egg trend — natural for plotting on a line chart.
    return trend
      .sort((a, b) => a.sessionDate.getTime() - b.sessionDate.getTime())
      .slice(-days);
  }

  async getTodaySummary(houseId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const sessions = await this.prisma.eggCollectionSession.findMany({
      where: { houseId, sessionDate: today, deletedAt: null },
      include: { storeIntakes: true, tally: true },
      orderBy: { shift: 'asc' },
    });
    const am = sessions.find(s => s.shift === 'AM') ?? null;
    const pm = sessions.find(s => s.shift === 'PM') ?? null;
    const storeIntake = pm?.storeIntakes?.[0] ?? am?.storeIntakes?.[0] ?? null;
    return {
      am, pm, storeIntake,
      tally: pm?.tally ?? null,
      totalGoodEggs: (am?.totalGoodEggs ?? 0) + (pm?.totalGoodEggs ?? 0),
      totalStarterEggs: (am?.totalStarterEggs ?? 0) + (pm?.totalStarterEggs ?? 0),
      totalBrokenSellable: (am?.totalBrokenSellable ?? 0) + (pm?.totalBrokenSellable ?? 0),
      totalFullTrays: (am?.totalFullTrays ?? 0) + (pm?.totalFullTrays ?? 0),
    };
  }
}
