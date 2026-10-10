// src/common/finance/auto-expense.service.ts
//
// Expenses the Accountant never has to key in by hand:
//   • Every Store issue (StoreStockOut) — cost = quantity × unit cost at issue.
//   • Egg losses, costed at the STANDARD BULK egg price for that day
//     (DailyEggPrice.pricePerEggBulk, falling back to pricePerEgg when no
//     bulk price is set):
//       damaged / broken-unsellable → bulk price per egg (never sold)
//       broken-sellable             → bulk price − broken-sellable price
//     Recorded from the attendant's collection (damaged), the PM's broken
//     split at the three-party tally, and Sales' breakage adjustments.
//
// Each auto expense is keyed by (sourceType, sourceId), so re-submitting the
// same record (a returned session, a tally edit) updates its expense in
// place instead of logging it twice.
import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Db = Prisma.TransactionClient | PrismaService;

export const AUTO_EXPENSE_SOURCES = {
  STORE_ISSUE: 'STORE_STOCK_OUT',
  COLLECTION_DAMAGED: 'EGG_COLLECTION_DAMAGED',
  TALLY_BROKEN_SPLIT: 'TALLY_BROKEN_SPLIT',
  SALES_BREAKAGE: 'EGG_BREAKAGE_ADJUSTMENT',
} as const;

export const EGG_BREAKAGE_CATEGORY = 'Egg Breakage';

const STORE_CATEGORY_LABELS: Record<string, string> = {
  FEED: 'Feed',
  FEED_SUPPLEMENT: 'Feed',
  VACCINE: 'Vaccines',
  SUPPLEMENT: 'Supplements',
  MEDICATION: 'Medication & Treatment',
  TREATMENT: 'Medication & Treatment',
  EQUIPMENT: 'Equipment',
  PACKAGING: 'Packaging',
  CLEANING: 'Cleaning',
  SAFETY: 'Safety',
  OTHER: 'Other Supplies',
};

export interface EggCostBasis {
  /** Standard egg bulk price — the cost of one lost egg. */
  bulkPrice: number;
  /** Price a broken-sellable egg is sold at. */
  brokenPrice: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

@Injectable()
export class AutoExpenseService {
  private readonly logger = new Logger(AutoExpenseService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async ensureCategory(db: Db, name: string, userId: string, description: string) {
    const existing = await db.expenseCategory.findUnique({ where: { name } });
    if (existing) return existing;
    return db.expenseCategory.upsert({
      where: { name },
      update: {},
      create: { name, description, createdById: userId },
    });
  }

  /** Create or update the single expense row for a source record. */
  async upsertForSource(db: Db, args: {
    sourceType: string;
    sourceId: string;
    categoryName: string;
    categoryDescription?: string;
    amount: number;
    description: string;
    expenseDate: Date;
    userId: string;
    batchId?: string | null;
    receiptRef?: string | null;
  }) {
    const amount = round2(Math.max(0, args.amount));
    const existing = await db.expenseLog.findUnique({
      where: { sourceType_sourceId: { sourceType: args.sourceType, sourceId: args.sourceId } },
    });
    if (!existing && amount <= 0) return null;

    const cat = await this.ensureCategory(
      db, args.categoryName, args.userId,
      args.categoryDescription ?? 'Auto-logged expenses',
    );
    const data = {
      categoryId: cat.id,
      description: args.description,
      amount,
      expenseDate: args.expenseDate,
      batchId: args.batchId ?? null,
      receiptRef: args.receiptRef ?? null,
    };
    if (existing) {
      return db.expenseLog.update({ where: { id: existing.id }, data });
    }
    return db.expenseLog.create({
      data: {
        ...data,
        vendorName: null,
        recordedById: args.userId,
        sourceType: args.sourceType,
        sourceId: args.sourceId,
      },
    });
  }

  /** Day's egg cost basis — latest price set on or before `date`. */
  async eggCostBasis(db: Db, date: Date): Promise<EggCostBasis> {
    const day = new Date(date);
    day.setUTCHours(0, 0, 0, 0);
    const pricing =
      (await db.dailyEggPrice.findUnique({ where: { priceDate: day } })) ??
      (await db.dailyEggPrice.findFirst({
        where: { priceDate: { lte: day } },
        orderBy: { priceDate: 'desc' },
      }));
    if (!pricing) return { bulkPrice: 0, brokenPrice: 0 };
    const bulk = pricing.pricePerEggBulk != null ? Number(pricing.pricePerEggBulk) : Number(pricing.pricePerEgg);
    return {
      bulkPrice: bulk,
      brokenPrice: pricing.pricePerEggBroken != null ? Number(pricing.pricePerEggBroken) : 0,
    };
  }

  /** Loss on lost eggs: unsellable at full bulk price, sellable at the shortfall. */
  static eggLoss(basis: EggCostBasis, unsellable: number, sellable: number) {
    const sellableLossEach = Math.max(0, basis.bulkPrice - basis.brokenPrice);
    return round2(unsellable * basis.bulkPrice + sellable * sellableLossEach);
  }

  // ── Store issues ────────────────────────────────────────────────────────

  async logStockOut(db: Db, stockOutId: string) {
    const so = await db.storeStockOut.findUnique({
      where: { id: stockOutId },
      include: { storeItem: { select: { name: true, unit: true, category: true, customCategoryLabel: true } } },
    });
    if (!so) return null;
    const item = so.storeItem;
    const label = item.category === 'OTHER' && item.customCategoryLabel
      ? item.customCategoryLabel
      : (STORE_CATEGORY_LABELS[item.category] ?? 'Other Supplies');
    const destination = so.issuedToName ?? (so.issuedToType === 'BROODER' ? 'Brooder'
      : so.issuedToType === 'PRODUCTION_HOUSE' ? 'Production House' : null);
    return this.upsertForSource(db, {
      sourceType: AUTO_EXPENSE_SOURCES.STORE_ISSUE,
      sourceId: so.id,
      categoryName: `Store Issue — ${label}`,
      categoryDescription: 'Auto-logged from items issued out of Store',
      amount: Number(so.totalCostKes),
      description:
        `Store issued ${Number(so.quantityOut)} ${item.unit} ${item.name}` +
        ` @ KES ${Number(so.unitCostKes).toFixed(2)}` +
        (destination ? ` → ${destination}` : '') +
        (so.purpose ? ` (${so.purpose})` : ''),
      expenseDate: so.issuedDate,
      batchId: so.issuedToBatchId,
      receiptRef: `SO-${so.id.slice(0, 8)}`,
      userId: so.issuedById,
    });
  }

  /** Best-effort wrapper — an expense problem must never block a stock issue. */
  async logStockOutSafe(db: Db, stockOutId: string) {
    try {
      await this.logStockOut(db, stockOutId);
    } catch (err) {
      this.logger.warn(`Auto expense for stock-out ${stockOutId} failed: ${(err as Error).message}`);
    }
  }

  // ── Egg losses ──────────────────────────────────────────────────────────

  /** Attendant-recorded damaged eggs for a collection session. */
  async logCollectionDamaged(db: Db, session: {
    id: string; sessionDate: Date; shift: string; block?: string | null;
    batchId: string; totalDamaged: number;
  }, batchCode: string, userId: string) {
    const basis = await this.eggCostBasis(db, session.sessionDate);
    const qty = session.totalDamaged ?? 0;
    return this.upsertForSource(db, {
      sourceType: AUTO_EXPENSE_SOURCES.COLLECTION_DAMAGED,
      sourceId: session.id,
      categoryName: EGG_BREAKAGE_CATEGORY,
      categoryDescription: 'Auto-logged egg breakage losses',
      amount: AutoExpenseService.eggLoss(basis, qty, 0),
      description:
        `${session.shift} collection damaged eggs — ${blockLabel(session.block)}, Batch ${batchCode}: ` +
        `${qty} × KES ${basis.bulkPrice.toFixed(2)} (standard bulk price).`,
      expenseDate: session.sessionDate,
      batchId: session.batchId,
      receiptRef: `COLL-${session.id.slice(0, 8)}`,
      userId,
    });
  }

  /** PM's broken sellable / unsellable split at the three-party tally. */
  async logTallyBrokenSplit(db: Db, session: {
    id: string; sessionDate: Date; shift: string; block?: string | null; batchId: string;
  }, split: { sellable: number; unsellable: number }, userId: string, alreadyExpensed = 0) {
    const basis = await this.eggCostBasis(db, session.sessionDate);
    const loss = AutoExpenseService.eggLoss(basis, split.unsellable, split.sellable);
    const sellableEach = Math.max(0, basis.bulkPrice - basis.brokenPrice);
    return this.upsertForSource(db, {
      sourceType: AUTO_EXPENSE_SOURCES.TALLY_BROKEN_SPLIT,
      sourceId: session.id,
      categoryName: EGG_BREAKAGE_CATEGORY,
      categoryDescription: 'Auto-logged egg breakage losses',
      amount: loss - alreadyExpensed,
      description:
        `Tally broken-egg split — ${session.shift} ${blockLabel(session.block)}: ` +
        `${split.unsellable} unsellable × KES ${basis.bulkPrice.toFixed(2)}, ` +
        `${split.sellable} sellable × KES ${sellableEach.toFixed(2)} (bulk − broken price)` +
        (alreadyExpensed > 0 ? `, less KES ${alreadyExpensed.toFixed(2)} logged provisionally at collection.` : '.'),
      expenseDate: session.sessionDate,
      batchId: session.batchId,
      receiptRef: `TALLY-${session.id.slice(0, 8)}`,
      userId,
    });
  }

  /** Sales' egg breakage adjustment. */
  async logSalesBreakage(db: Db, adj: {
    id: string; adjustmentRef: string; adjustmentDate: Date;
  }, unsellable: number, sellable: number, userId: string, sellableDestroyed = 0) {
    // `sellableDestroyed` = broken-sellable eggs (already expensed at the
    // bulk − broken shortfall) that became unsellable: they lose only the
    // broken price they could still have fetched.
    const basis = await this.eggCostBasis(db, adj.adjustmentDate);
    const sellableEach = Math.max(0, basis.bulkPrice - basis.brokenPrice);
    const fromStandard = Math.max(0, unsellable - sellableDestroyed);
    const parts: string[] = [];
    if (fromStandard > 0) parts.push(`${fromStandard} unsellable × KES ${basis.bulkPrice.toFixed(2)}`);
    if (sellableDestroyed > 0) parts.push(`${sellableDestroyed} broken-sellable destroyed × KES ${basis.brokenPrice.toFixed(2)}`);
    if (sellable > 0) parts.push(`${sellable} sellable × KES ${sellableEach.toFixed(2)} (bulk − broken price)`);
    const amount = round2(
      AutoExpenseService.eggLoss(basis, fromStandard, sellable) + Math.min(sellableDestroyed, unsellable) * basis.brokenPrice,
    );
    await this.upsertForSource(db, {
      sourceType: AUTO_EXPENSE_SOURCES.SALES_BREAKAGE,
      sourceId: adj.id,
      categoryName: EGG_BREAKAGE_CATEGORY,
      categoryDescription: 'Auto-logged egg breakage losses',
      amount,
      description: `Egg breakage — Ref: ${adj.adjustmentRef}. ${parts.join(', ')}.`,
      expenseDate: adj.adjustmentDate,
      receiptRef: adj.adjustmentRef,
      userId,
    });
    return { amount, basis };
  }
}

function blockLabel(block?: string | null) {
  return block === 'BLOCK2' ? 'Block 2' : 'Block 1';
}

@Global()
@Module({
  providers: [AutoExpenseService],
  exports: [AutoExpenseService],
})
export class AutoExpenseModule {}
