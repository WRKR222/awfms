// src/common/feed/feed-wastage.service.ts
//
// Director-facing feed over-issuance detection + cost, for
// BrooderGeneralFeedLog rows. Originally lived as a private method on
// BrooderService (recordFeedWastageIfOverIssued), only reachable from the
// manual "General population sheet" feed-entry endpoint
// (BrooderService.createGeneralFeedLog). Production reports auto-fill feed
// straight into BrooderGeneralFeedLog too (see
// ProductionReportReconciliationService.reconcileFeed /
// reconcileFeedSplit), writing via Prisma directly rather than going through
// BrooderService — so a batch that was over-fed entirely via an
// auto-reconciled report never got a BrooderFeedWastageLog entry, and never
// showed up in the Director's feed-wastage summary. Moving this here as a
// standalone, @Global-provided service (same pattern as PrismaService /
// NotificationsService) lets both call sites share the exact same
// calculation and notification, with no risk of the two drifting apart —
// see BrooderService and ProductionReportReconciliationService for the two
// call sites.
import { Injectable, Logger } from '@nestjs/common';
import dayjs from 'dayjs';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

export interface RecordFeedWastageParams {
  batch: { id: string; batchCode: string };
  entryDate: Date;
  dailyRationKg: number;
  generalFeedLogId: string;
  feedType: string;
  storeItemId: string | null;
  thisEntryKg: number;
  loggedById: string;
}

@Injectable()
export class FeedWastageService {
  private readonly logger = new Logger(FeedWastageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── Feed wastage: over-issuance detection + cost (whole-brooder path) ────
  //
  // Called right after a BrooderGeneralFeedLog row is saved — whether that
  // row came from a manual General Record entry OR from a production report
  // being auto-reconciled. Recomputes the batch's TOTAL feed for that
  // calendar date (every general-log entry for the day, including the one
  // that just triggered this call) and compares it against the HyLine daily
  // ration.
  //
  // excessKg is deliberately the INCREMENTAL amount this specific entry
  // added past the ration, not the day's running total:
  //   - if the day was already under ration before this entry, and this
  //     entry alone pushes it over, excessKg = (new total − ration).
  //   - if the day was ALREADY over ration before this entry (e.g. an
  //     evening top-up, or a report correction applied on top of an
  //     already-full day), the entire new entry counts as excess.
  // That keeps a per-event notification meaningful ("this entry added Xkg
  // over") while still letting excessKg sum correctly to the day's true
  // total when rolled up for the daily/weekly/monthly Director summary.
  //
  // Cost is priced off the CURRENT StoreItem.unitCostKes for whichever
  // store item this triggering entry was logged against — the log rows
  // don't carry a per-entry price snapshot, so this is the best available
  // figure at write time. If the entry wasn't linked to a store item, only
  // the excess kg is recorded — no cost figure is fabricated.
  //
  // Best-effort by design — callers should wrap this in try/catch and log a
  // warning on failure rather than let it fail the feed log write itself
  // (see both call sites).
  async recordIfOverIssued(params: RecordFeedWastageParams) {
    const {
      batch, entryDate, dailyRationKg, generalFeedLogId,
      feedType, storeItemId, thisEntryKg, loggedById,
    } = params;

    // No valid ration to compare against (e.g. batch has 0 live birds) —
    // nothing meaningful to flag.
    if (!dailyRationKg || dailyRationKg <= 0) return;

    const dayStr        = dayjs(entryDate).format('YYYY-MM-DD');
    const entryDateStart = new Date(`${dayStr}T00:00:00.000Z`);
    const entryDateEnd   = new Date(`${dayStr}T23:59:59.999Z`);

    const dayTotal = await this.prisma.brooderGeneralFeedLog.aggregate({
      where: { batchId: batch.id, entryDate: { gte: entryDateStart, lte: entryDateEnd } },
      _sum:  { quantityDispensedKg: true },
    });
    const dispensedKgTotal = Math.round((dayTotal._sum.quantityDispensedKg ?? 0) * 100) / 100;

    const dispensedBeforeThisEntry = Math.max(0, dispensedKgTotal - thisEntryKg);
    const excessBefore = Math.max(0, dispensedBeforeThisEntry - dailyRationKg);
    const excessAfter  = Math.max(0, dispensedKgTotal - dailyRationKg);
    const excessKg     = Math.round((excessAfter - excessBefore) * 100) / 100;

    // Rounding-noise tolerance — mirrors the 0.05kg tolerance the
    // under-issuance (missed-feed) check uses, applied here symmetrically.
    if (excessKg <= 0.05) return;

    let unitCostKes: number | null = null;
    let storeItemName: string | null = null;
    if (storeItemId) {
      const item = await this.prisma.storeItem.findUnique({
        where:  { id: storeItemId },
        select: { name: true, unitCostKes: true },
      });
      if (item) {
        storeItemName = item.name;
        unitCostKes   = Number(item.unitCostKes);
      }
    }
    const excessCostKes = unitCostKes != null
      ? Math.round(excessKg * unitCostKes * 100) / 100
      : null;

    await this.prisma.brooderFeedWastageLog.create({
      data: {
        batchId:          batch.id,
        batchCode:        batch.batchCode,
        generalFeedLogId,
        feedType,
        storeItemId,
        storeItemName,
        entryDate:        entryDateStart,
        requiredKgForDay: dailyRationKg,
        dispensedKgTotal,
        excessKg,
        unitCostKes,
        excessCostKes,
        loggedById,
      },
    });

    const costLine = excessCostKes != null
      ? ` Cost of the excess: KES ${excessCostKes.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ` +
        `(${storeItemName} @ KES ${unitCostKes!.toFixed(2)}/kg).`
      : ' This feed entry was not linked to a store item, so no cost could be calculated.';

    // Director-only — unlike the other Brooder alerts (mortality, weight
    // anomaly, stock mismatch) this one deliberately does NOT go through
    // alertRoles(), which also notifies MANAGER. Feed cost/wastage tracking
    // is Director-facing only.
    await this.notifications.notifyRole(
      UserRole.OWNER,
      'BROODER_FEED_WASTAGE' as any,
      `Feed Over-Issued — ${batch.batchCode}`,
      `Batch ${batch.batchCode} has been given ${dispensedKgTotal.toFixed(2)}kg of feed so far today ` +
      `against a required ${dailyRationKg.toFixed(2)}kg — ${excessKg.toFixed(2)}kg more than estimated.` +
      costLine,
      { entityId: batch.id, entityType: 'Brooder' },
    );
  }
}
