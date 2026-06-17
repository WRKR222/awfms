// scripts/reset-egg-sales-data.ts
//
// One-off RESET of all egg collection, store egg intake, sales/orders,
// invoicing, AR, delivery, advance-booking, and cumulative-egg-production
// data — for clearing out test/seed data before go-live.
//
// What this DELETES (in FK-safe order, children before parents):
//   1. ArEntry                — AR ledger entries (tied to invoices)
//   2. InvoicePayment         — payments recorded against invoices
//   3. Invoice                — sales invoices
//   4. DeliveryLog            — egg/tray delivery logs
//   5. AdvanceBooking         — pre-orders against future egg stock
//   6. SalesOrderItem         — line items on sales orders
//   7. SalesOrder             — sales orders
//   8. EggTallyVerification   — PM/Sales/Store tally sign-offs
//   9. StoreEggIntake         — store egg intake records
//  10. EggBreakageAdjustment  — egg breakage adjustment records
//  11. EggCollectionSession   — daily egg collection sessions ("egg collection")
//  12. DailyEggAggregate      — cumulative/daily egg production rollups
//
// What this PRESERVES (intentionally, since these aren't transactional data):
//   - Batch, House, FlockDailyEntry, BrooderLog, HealthEvent, FeedIntakeLog, etc.
//     (flock/feed/health history is untouched — only egg + sales/finance data)
//   - Customer master records
//   - DailyEggPrice / EggPriceTier / EggPriceSchedule (pricing configuration)
//   - StoreItem / StoreStockIn / StoreStockOut (general store/consumables —
//     unrelated to egg sales stock)
//   - Users, AiReport, AuditLog
//
// SAFETY: this is a DRY RUN by default — it only prints row counts and does
// NOT delete anything unless you pass --confirm. Take a database backup
// before running with --confirm; this action is irreversible.
//
// Run with:
//   npx ts-node scripts/reset-egg-sales-data.ts            # dry run (counts only)
//   npx ts-node scripts/reset-egg-sales-data.ts --confirm   # actually deletes
// or, if ts-node isn't set up:
//   npx tsx scripts/reset-egg-sales-data.ts [--confirm]

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const CONFIRM = process.argv.includes('--confirm');

async function main() {
  console.log(CONFIRM ? '*** LIVE RUN — rows WILL be deleted ***' : '--- DRY RUN (pass --confirm to actually delete) ---');
  console.log('');

  const counts = {
    arEntry: await prisma.arEntry.count(),
    invoicePayment: await prisma.invoicePayment.count(),
    invoice: await prisma.invoice.count(),
    deliveryLog: await prisma.deliveryLog.count(),
    advanceBooking: await prisma.advanceBooking.count(),
    salesOrderItem: await prisma.salesOrderItem.count(),
    salesOrder: await prisma.salesOrder.count(),
    eggTallyVerification: await prisma.eggTallyVerification.count(),
    storeEggIntake: await prisma.storeEggIntake.count(),
    eggBreakageAdjustment: await prisma.eggBreakageAdjustment.count(),
    eggCollectionSession: await prisma.eggCollectionSession.count(),
    dailyEggAggregate: await prisma.dailyEggAggregate.count(),
  };

  console.log('Rows found:');
  for (const [table, count] of Object.entries(counts)) {
    console.log(`  ${table.padEnd(24)} ${count}`);
  }
  console.log('');

  if (!CONFIRM) {
    console.log('Dry run complete — nothing was deleted. Re-run with --confirm to apply.');
    return;
  }

  // ── Delete in FK-safe order (children before parents) ─────────────────────
  console.log('Deleting...');

  const r1 = await prisma.arEntry.deleteMany({});
  console.log(`  ArEntry: deleted ${r1.count}`);

  const r2 = await prisma.invoicePayment.deleteMany({});
  console.log(`  InvoicePayment: deleted ${r2.count}`);

  const r3 = await prisma.invoice.deleteMany({});
  console.log(`  Invoice: deleted ${r3.count}`);

  const r4 = await prisma.deliveryLog.deleteMany({});
  console.log(`  DeliveryLog: deleted ${r4.count}`);

  const r5 = await prisma.advanceBooking.deleteMany({});
  console.log(`  AdvanceBooking: deleted ${r5.count}`);

  const r6 = await prisma.salesOrderItem.deleteMany({});
  console.log(`  SalesOrderItem: deleted ${r6.count}`);

  const r7 = await prisma.salesOrder.deleteMany({});
  console.log(`  SalesOrder: deleted ${r7.count}`);

  const r8 = await prisma.eggTallyVerification.deleteMany({});
  console.log(`  EggTallyVerification: deleted ${r8.count}`);

  const r9 = await prisma.storeEggIntake.deleteMany({});
  console.log(`  StoreEggIntake: deleted ${r9.count}`);

  const r10 = await prisma.eggBreakageAdjustment.deleteMany({});
  console.log(`  EggBreakageAdjustment: deleted ${r10.count}`);

  const r11 = await prisma.eggCollectionSession.deleteMany({});
  console.log(`  EggCollectionSession: deleted ${r11.count}`);

  const r12 = await prisma.dailyEggAggregate.deleteMany({});
  console.log(`  DailyEggAggregate: deleted ${r12.count}`);

  console.log('');
  console.log('Done. Egg collection, sales/orders, invoicing and cumulative egg production data has been cleared.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
