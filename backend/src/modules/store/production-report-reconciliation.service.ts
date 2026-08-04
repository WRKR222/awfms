// src/modules/store/production-report-reconciliation.service.ts
// The core "verification layer" logic: for every parsed report row, compare
// each field against whatever the system already has recorded for that
// batch + date, and decide what happens to it:
//
//   • nothing recorded yet     -> APPLY immediately (autofill)
//   • recorded and it matches  -> no-op
//   • recorded and it conflicts -> hold back, record a discrepancy
//
// Autofills and item deductions are committed to the real tables as soon as
// they're computed — no Director involvement needed for the parts that
// don't conflict with anything. Only conflicting fields wait for a decision.
//
// Feed is always reconciled against a real FEED-category StoreItem, never
// against a guessed label — the report's feed-type text is matched to
// what's actually present in stores. If that feed hasn't been issued yet
// but there's an already-APPROVED Issuance Plan line that covers it, the
// stock-out is auto-issued (through the same gate/audit path as a manual
// Store issuance) and Store is notified; if no plan covers it, the feed log
// is still filled in but the stock side is flagged for Store's attention.
//
// NOTE on scope: this MVP reconciles at the whole-batch ("general log")
// level — BrooderGeneralMortalityLog / BrooderGeneralFeedLog / BrooderStockCount
// — which matches the farm's current daily-record sheet (one row per day for
// the whole batch). If/when a report breaks feed or mortality down per row/
// level/cage, the parsed row still carries that as `locationRef` for display,
// but reconciliation itself stays at the batch level until level/cage text on
// the sheet can be reliably matched to actual BrooderLevel/BrooderCage rows.
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { FeedType, ProductionReportDiscrepancyType, UserRole, NotificationType, StoreItem } from '@prisma/client';
import { NotificationsService } from '../../common/notifications/notifications.service';
import { StoreInventoryService } from './store-inventory.service';
import { RequestUser } from '../../auth/types/request-user.type';
import { ParsedReportRow } from './production-report.dto';

export interface ReconcileOutcome {
  rows: ParsedReportRow[];
  discrepancies: {
    rowDate: string;
    field: string;
    discrepancyType: ProductionReportDiscrepancyType;
    locationRef: string | null;
    systemValue: string | null;
    reportValue: string | null;
    notes?: string;
  }[];
  autofillCount: number;
  matchedCount: number;
}

function normaliseText(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Best-effort mapping onto the FeedType enum, which is a required column on
 *  BrooderGeneralFeedLog but currently has no separate "crumb" stage. Prefers
 *  the name of the matched StoreItem (the actual feed present in stores) over
 *  the report's own free-text label, per the rule that feed must always be
 *  reconciled against what stores actually carries. */
function mapFeedType(storeItemName: string | undefined, reportText: string | undefined): FeedType {
  const t = (storeItemName ?? reportText ?? '').toLowerCase();
  if (t.includes('grower')) return FeedType.GROWER_MASH;
  if (t.includes('layer')) return FeedType.LAYER_MASH;
  if (t.includes('kienyeji') && t.includes('grow')) return FeedType.KIENYEJI_GROWER;
  if (t.includes('kienyeji') && t.includes('finish')) return FeedType.KIENYEJI_FINISHER;
  if (t.includes('kienyeji')) return FeedType.KIENYEJI_STARTER;
  // chick mash / chick crumb / chick start all land here — FeedType has no
  // separate "crumb" stage yet.
  return FeedType.CHICK_MASH;
}

/** Match the report's free-text feed type (e.g. "Chick Mash", "chickcrumbs")
 *  against the FEED-category items actually held in stores — feed is never
 *  reconciled against a guessed enum alone, always against a real StoreItem
 *  when one can be identified. */
function matchFeedItem(reportText: string | undefined, feedItems: StoreItem[]): StoreItem | null {
  if (!reportText) return null;
  const norm = normaliseText(reportText);
  if (!norm) return null;
  let best: StoreItem | null = null;
  let bestScore = 0;
  for (const item of feedItems) {
    const itemNorm = normaliseText(item.name);
    if (itemNorm === norm) return item; // exact match wins outright
    if (norm.includes(itemNorm) || itemNorm.includes(norm)) {
      const score = Math.min(itemNorm.length, norm.length);
      if (score > bestScore) { bestScore = score; best = item; }
    }
  }
  return best;
}

@Injectable()
export class ProductionReportReconciliationService {
  private readonly logger = new Logger(ProductionReportReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storeInventory: StoreInventoryService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Run the full cross-check + autofill pass over every parsed row for a
   *  batch. Mutates the real brooder/store tables for anything that can be
   *  safely auto-applied; returns the annotated rows + open discrepancies. */
  async reconcile(batchId: string, rows: ParsedReportRow[], uploaderId: string, fileName: string): Promise<ReconcileOutcome> {
    const discrepancies: ReconcileOutcome['discrepancies'] = [];
    let autofillCount = 0;
    let matchedCount = 0;
    const noteSuffix = `(from store production report "${fileName}")`;

    // Preload store items referenced by any row so we can label + deduct them.
    const itemIds = new Set<string>();
    for (const r of rows) for (const it of r.itemsIssued) itemIds.add(it.storeItemId);
    const storeItems = itemIds.size
      ? await this.prisma.storeItem.findMany({ where: { id: { in: [...itemIds] } } })
      : [];
    const storeItemMap = new Map(storeItems.map(si => [si.id, si]));

    // Feed must always be reconciled against what's actually present in
    // stores, never against a guessed label alone — preload every active
    // FEED-category item once so each row's feed-type text can be matched.
    const feedItems = await this.prisma.storeItem.findMany({ where: { category: 'FEED', isActive: true } });
    const batch = await this.prisma.batch.findUnique({ where: { id: batchId }, select: { batchCode: true } });

    for (const row of rows) {
      const logDate = new Date(row.date);

      // ── Mortality ────────────────────────────────────────────────────────
      if (row.mortality !== undefined) {
        const existing = await this.prisma.brooderGeneralMortalityLog.findMany({
          where: { batchId, logDate },
        });
        if (existing.length === 0) {
          if (row.mortality > 0) {
            await this.prisma.brooderGeneralMortalityLog.create({
              data: {
                batchId, logDate, mortalityCount: row.mortality, cullingCount: row.culling ?? 0,
                notes: `Auto-filled ${noteSuffix}`, loggedById: uploaderId,
              },
            });
            row.resolution.mortality = 'AUTOFILLED';
            autofillCount++;
          } else {
            row.resolution.mortality = 'MATCHED'; // zero mortality, nothing to record
            matchedCount++;
          }
        } else {
          const systemTotal = existing.reduce((s, e) => s + e.mortalityCount, 0);
          if (systemTotal === row.mortality) {
            row.resolution.mortality = 'MATCHED';
            matchedCount++;
          } else {
            row.resolution.mortality = 'DISCREPANCY';
            discrepancies.push({
              rowDate: row.date, field: 'mortality', discrepancyType: ProductionReportDiscrepancyType.MORTALITY,
              locationRef: row.locationRef, systemValue: String(systemTotal), reportValue: String(row.mortality),
            });
          }
        }
      }

      // ── Feed ─────────────────────────────────────────────────────────────
      // Feed is always resolved against a real StoreItem when the report's
      // feed-type text can be matched to one — this is what lets the exact
      // item be deducted from stores rather than just logging a kg figure.
      if (row.feedKg !== undefined) {
        const matchedFeedItem = matchFeedItem(row.feedType, feedItems);
        const existing = await this.prisma.brooderGeneralFeedLog.findMany({
          where: { batchId, entryDate: logDate },
        });

        if (existing.length === 0) {
          if (row.feedKg > 0) {
            let stockNote = '';

            if (matchedFeedItem) {
              const existingOuts = await this.prisma.storeStockOut.findMany({
                where: { storeItemId: matchedFeedItem.id, issuedToBatchId: batchId, issuedDate: logDate },
              });

              if (existingOuts.length === 0) {
                // Not yet issued by Store — try to auto-issue it under an
                // already-approved Issuance Plan line, exactly as if Store
                // had recorded the stock-out themselves.
                try {
                  await this.storeInventory.recordStockOut(
                    {
                      storeItemId: matchedFeedItem.id,
                      issuedDate: row.date,
                      quantityOut: row.feedKg,
                      issuedToBatchId: batchId,
                      purpose: 'Auto-issued from store production report',
                      notes: `Auto-issued ${noteSuffix} — matched feed type "${row.feedType}"`,
                    },
                    { id: uploaderId } as unknown as RequestUser, // recordStockOut only reads user.id
                  );
                  stockNote = `Auto-issued ${matchedFeedItem.name} per the approved issuance plan.`;
                  await this.notifications.notifyRole(
                    UserRole.STORE, NotificationType.PRODUCTION_REPORT_SUBMITTED,
                    `Feed auto-issued — ${batch?.batchCode ?? batchId}`,
                    `${row.feedKg} kg of ${matchedFeedItem.name} was auto-issued for ${row.date} per the approved issuance plan, ` +
                      `to match the store production report — no action needed unless this looks wrong.`,
                  ).catch(() => {});
                } catch (err) {
                  // No approved plan covers it (or insufficient stock) — the
                  // feed log itself is still filled in below, but the stock
                  // side needs Store's attention.
                  const reason = err instanceof BadRequestException ? err.message : 'Could not auto-issue';
                  stockNote = `Could not auto-issue ${matchedFeedItem.name} (${reason}) — needs Store to issue it manually.`;
                  discrepancies.push({
                    rowDate: row.date, field: `item:${matchedFeedItem.name}`, discrepancyType: ProductionReportDiscrepancyType.ITEM_ISSUANCE,
                    locationRef: row.locationRef, systemValue: '0 (not yet issued)', reportValue: `${row.feedKg} ${matchedFeedItem.unit}`,
                    notes: reason,
                  });
                  await this.notifications.notifyRole(
                    UserRole.STORE, NotificationType.PRODUCTION_REPORT_DISCREPANCY,
                    `Feed used but not issued — ${batch?.batchCode ?? batchId}`,
                    `The production report shows ${row.feedKg} kg of ${matchedFeedItem.name} used on ${row.date}, but it hasn't been ` +
                      `issued and there's no approved issuance plan to cover it automatically. Please issue it or arrange emergency authorisation.`,
                  ).catch(() => {});
                }
              } else {
                const systemQty = existingOuts.reduce((s, o) => s + Number(o.quantityOut), 0);
                if (Math.abs(systemQty - row.feedKg) >= 0.01) {
                  discrepancies.push({
                    rowDate: row.date, field: `item:${matchedFeedItem.name}`, discrepancyType: ProductionReportDiscrepancyType.ITEM_ISSUANCE,
                    locationRef: row.locationRef, systemValue: `${systemQty} ${matchedFeedItem.unit}`, reportValue: `${row.feedKg} ${matchedFeedItem.unit}`,
                  });
                }
              }
            } else {
              stockNote = `Report's feed type "${row.feedType ?? '(blank)'}" didn't match any FEED item in stores — stock wasn't touched.`;
              discrepancies.push({
                rowDate: row.date, field: 'feedType', discrepancyType: ProductionReportDiscrepancyType.FEED,
                locationRef: row.locationRef, systemValue: null, reportValue: row.feedType ?? null,
                notes: 'Could not match this feed type to any store item — add/rename the store item or fix the sheet.',
              });
            }

            await this.prisma.brooderGeneralFeedLog.create({
              data: {
                batchId, entryDate: logDate,
                feedType: mapFeedType(matchedFeedItem?.name, row.feedType),
                storeItemId: matchedFeedItem?.id, unit: matchedFeedItem?.unit,
                quantityDispensedKg: row.feedKg,
                notes: [`Auto-filled ${noteSuffix}`, row.feedType ? `sheet feed type: "${row.feedType}"` : null, stockNote || null].filter(Boolean).join(' — '),
                loggedById: uploaderId,
              },
            });
            row.resolution.feedKg = 'AUTOFILLED';
            autofillCount++;
          } else {
            row.resolution.feedKg = 'MATCHED';
            matchedCount++;
          }
        } else {
          const systemTotal = existing.reduce((s, e) => s + e.quantityDispensedKg, 0);
          if (Math.abs(systemTotal - row.feedKg) < 0.01) {
            row.resolution.feedKg = 'MATCHED';
            matchedCount++;
          } else {
            row.resolution.feedKg = 'DISCREPANCY';
            discrepancies.push({
              rowDate: row.date, field: 'feedKg', discrepancyType: ProductionReportDiscrepancyType.FEED,
              locationRef: row.locationRef, systemValue: `${systemTotal} kg`, reportValue: `${row.feedKg} kg`,
            });
          }
        }
      }

      // ── Opening/closing stock ────────────────────────────────────────────
      if (row.openingStock !== undefined && row.closingStock !== undefined) {
        const existing = await this.prisma.brooderStockCount.findUnique({
          where: { batchId_logDate: { batchId, logDate } },
        });
        if (!existing) {
          await this.prisma.brooderStockCount.create({
            data: {
              batchId, logDate,
              openingStock: row.openingStock, closingStock: row.closingStock,
              mortalityCount: row.mortality ?? 0, cullingCount: row.culling ?? 0,
              notes: `Auto-filled ${noteSuffix}`, loggedById: uploaderId,
            },
          });
          row.resolution.stockCount = 'AUTOFILLED';
          autofillCount++;
        } else if (existing.openingStock === row.openingStock && existing.closingStock === row.closingStock) {
          row.resolution.stockCount = 'MATCHED';
          matchedCount++;
        } else {
          row.resolution.stockCount = 'DISCREPANCY';
          discrepancies.push({
            rowDate: row.date, field: 'stockCount', discrepancyType: ProductionReportDiscrepancyType.STOCK_COUNT,
            locationRef: row.locationRef,
            systemValue: `O:${existing.openingStock} / C:${existing.closingStock}`,
            reportValue: `O:${row.openingStock} / C:${row.closingStock}`,
          });
        }
      }

      // ── Items issued (e.g. charcoal bags used) ──────────────────────────
      for (const usage of row.itemsIssued) {
        const item = storeItemMap.get(usage.storeItemId);
        if (!item) continue;
        usage.storeItemName = item.name;

        const existingOuts = await this.prisma.storeStockOut.findMany({
          where: { storeItemId: item.id, issuedToBatchId: batchId, issuedDate: logDate },
        });
        const systemQty = existingOuts.reduce((s, o) => s + Number(o.quantityOut), 0);

        if (existingOuts.length === 0) {
          if (Number(item.currentStock) >= usage.quantity) {
            await this.prisma.$transaction([
              this.prisma.storeStockOut.create({
                data: {
                  storeItemId: item.id, issuedDate: logDate, quantityOut: usage.quantity,
                  unitCostKes: item.unitCostKes, totalCostKes: usage.quantity * Number(item.unitCostKes),
                  issuedToBatchId: batchId, issuedToName: 'Brooder (via production report)',
                  purpose: 'Auto-recorded usage from store production report',
                  notes: `Auto-filled ${noteSuffix} — "${usage.rawText}"`,
                  issuedById: uploaderId,
                },
              }),
              this.prisma.storeItem.update({
                where: { id: item.id },
                data: { currentStock: { decrement: usage.quantity } },
              }),
            ]);
            usage.resolution = 'AUTOFILLED';
            autofillCount++;
          } else {
            usage.resolution = 'DISCREPANCY';
            discrepancies.push({
              rowDate: row.date, field: `item:${item.name}`, discrepancyType: ProductionReportDiscrepancyType.ITEM_ISSUANCE,
              locationRef: row.locationRef, systemValue: `0 (only ${item.currentStock} ${item.unit} in stock)`,
              reportValue: `${usage.quantity} ${usage.unit ?? item.unit}`,
              notes: 'Insufficient store stock to auto-apply — needs manual reconciliation',
            });
          }
        } else if (Math.abs(systemQty - usage.quantity) < 0.001) {
          usage.resolution = 'MATCHED';
          matchedCount++;
        } else {
          usage.resolution = 'DISCREPANCY';
          discrepancies.push({
            rowDate: row.date, field: `item:${item.name}`, discrepancyType: ProductionReportDiscrepancyType.ITEM_ISSUANCE,
            locationRef: row.locationRef, systemValue: `${systemQty} ${item.unit}`, reportValue: `${usage.quantity} ${usage.unit ?? item.unit}`,
          });
        }
      }
    }

    return { rows, discrepancies, autofillCount, matchedCount };
  }

  /** Director trusts the report's value for one discrepancy and applies an
   *  ADJUSTING entry on top of the existing record (never mutates/deletes the
   *  attendant's original entry — keeps the audit trail intact). Only
   *  positive deltas (system under-recorded vs. the report) are auto-applied;
   *  a negative delta (system recorded MORE than the report) is flagged back
   *  for manual correction rather than guessed at. */
  async applyDiscrepancy(
    discrepancy: { rowDate: Date; field: string; discrepancyType: ProductionReportDiscrepancyType; locationRef: string | null; systemValue: string | null; reportValue: string | null },
    batchId: string,
    userId: string,
  ): Promise<{ applied: boolean; note: string }> {
    const logDate = discrepancy.rowDate;

    if (discrepancy.discrepancyType === ProductionReportDiscrepancyType.MORTALITY) {
      const system = Number(discrepancy.systemValue ?? 0);
      const report = Number(discrepancy.reportValue ?? 0);
      const delta = report - system;
      if (delta <= 0) return { applied: false, note: 'System already recorded more than the report — needs manual correction, not auto-applied.' };
      await this.prisma.brooderGeneralMortalityLog.create({
        data: {
          batchId, logDate, mortalityCount: delta,
          notes: 'Director-approved correction from store production report',
          loggedById: userId,
        },
      });
      return { applied: true, note: `Added ${delta} to mortality for ${logDate.toISOString().slice(0, 10)}.` };
    }

    if (discrepancy.discrepancyType === ProductionReportDiscrepancyType.FEED) {
      if (discrepancy.field === 'feedType') {
        return { applied: false, note: 'Report feed type still needs to be matched to a store item manually — no store item to apply.' };
      }
      const system = parseFloat(discrepancy.systemValue ?? '0');
      const report = parseFloat(discrepancy.reportValue ?? '0');
      const delta = report - system;
      if (delta <= 0) return { applied: false, note: 'System already recorded more feed than the report — needs manual correction, not auto-applied.' };
      await this.prisma.brooderGeneralFeedLog.create({
        data: {
          batchId, entryDate: logDate, feedType: FeedType.CHICK_MASH, quantityDispensedKg: delta,
          notes: 'Director-approved correction from store production report',
          loggedById: userId,
        },
      });
      return { applied: true, note: `Added ${delta} kg to feed for ${logDate.toISOString().slice(0, 10)}.` };
    }

    if (discrepancy.discrepancyType === ProductionReportDiscrepancyType.STOCK_COUNT) {
      const m = /O:(-?\d+)\s*\/\s*C:(-?\d+)/.exec(discrepancy.reportValue ?? '');
      if (!m) return { applied: false, note: 'Could not parse report stock values.' };
      await this.prisma.brooderStockCount.update({
        where: { batchId_logDate: { batchId, logDate } },
        data: {
          openingStock: parseInt(m[1], 10), closingStock: parseInt(m[2], 10),
          varianceReason: 'Corrected to match Director-approved store production report',
        },
      });
      return { applied: true, note: 'Opening/closing stock corrected to match the report.' };
    }

    if (discrepancy.discrepancyType === ProductionReportDiscrepancyType.ITEM_ISSUANCE) {
      const itemName = discrepancy.field.replace(/^item:/, '');
      const item = await this.prisma.storeItem.findFirst({ where: { name: itemName } });
      if (!item) return { applied: false, note: `Store item "${itemName}" not found.` };
      const systemQty = parseFloat(discrepancy.systemValue ?? '0');
      const reportQty = parseFloat(discrepancy.reportValue ?? '0');
      const delta = reportQty - systemQty;
      if (delta > 0) {
        if (Number(item.currentStock) < delta) {
          return { applied: false, note: `Insufficient stock (${item.currentStock} ${item.unit}) to apply the extra ${delta} ${item.unit} — needs manual reconciliation.` };
        }
        await this.prisma.$transaction([
          this.prisma.storeStockOut.create({
            data: {
              storeItemId: item.id, issuedDate: logDate, quantityOut: delta,
              unitCostKes: item.unitCostKes, totalCostKes: delta * Number(item.unitCostKes),
              issuedToBatchId: batchId, issuedToName: 'Brooder (via production report)',
              purpose: 'Director-approved correction from store production report',
              issuedById: userId,
            },
          }),
          this.prisma.storeItem.update({ where: { id: item.id }, data: { currentStock: { decrement: delta } } }),
        ]);
        return { applied: true, note: `Deducted an additional ${delta} ${item.unit} of ${item.name}.` };
      } else if (delta < 0) {
        // Report says less was used than the system deducted — credit the difference back.
        await this.prisma.storeItem.update({ where: { id: item.id }, data: { currentStock: { increment: -delta } } });
        return { applied: true, note: `Credited back ${-delta} ${item.unit} of ${item.name} (report showed less usage than recorded).` };
      }
      return { applied: false, note: 'No difference to apply.' };
    }

    return { applied: false, note: 'Unrecognised discrepancy type — needs manual review.' };
  }
}
