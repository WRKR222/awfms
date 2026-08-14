// scripts/backfill-feed-wastage.ts
//
// One-time catch-up for feed wastage tracking: runs FeedWastageService
// against a batch's EXISTING BrooderGeneralFeedLog history (both feed
// logged manually via the General Record sheet, and feed already
// auto-filled from a production report BEFORE the reconciliation service
// was wired up to check for over-issuance — see feed-wastage.service.ts /
// production-report-reconciliation.service.ts for that fix). Without this,
// any report you already uploaded and reconciled prior to that fix has its
// feed rows sitting in BrooderGeneralFeedLog same as always, but never got
// checked against the day's ration, so it's invisible in the Director's
// feed-wastage summary.
//
// This is safe to run repeatedly and safe to run for a whole batch even if
// PART of its history was already checked live (see
// FeedWastageService.backfillDayIfOverIssued — it's a no-op for any
// (batch, day) that already has a BrooderFeedWastageLog entry).
//
// USAGE
// -----
//   cd backend
//   npx tsx scripts/backfill-feed-wastage.ts --batch=BATCH-CODE-OR-ID
//   npx tsx scripts/backfill-feed-wastage.ts --batch=BATCH-CODE-OR-ID --dry-run
//   npx tsx scripts/backfill-feed-wastage.ts --all              # every batch that has any feed log
//   npx tsx scripts/backfill-feed-wastage.ts --batch=... --notify   # also page the Director for each day found
//
// --dry-run prints what WOULD be created without writing anything.
// --notify sends the normal "Feed Over-Issued" notification for each day
//   this backfill finds — off by default, since these are (usually)
//   already-past dates, and a live-looking alert for a stale date is more
//   confusing than helpful. Turn it on only if you want the Director
//   informed about this specific catch-up.
//
// LIMITATION (shared with the live check, not new here): the daily ration
// is computed from the batch's CURRENT `currentBirdCount`, not the bird
// count as it actually was on that historical date. For a batch that's had
// significant mortality/culls since, this will slightly understate the
// ration (and so slightly overstate excess) for older dates. This mirrors
// the live path's existing behaviour exactly — not a new inconsistency
// introduced by backfilling.

import { PrismaClient } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FeedWastageService } from '../src/common/feed/feed-wastage.service';
import { NotificationsService } from '../src/common/notifications/notifications.service';
import { batchAgeWeeks, brooderRequiredFeedKg } from '../src/common/feed/feed-standard.util';

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const NOTIFY  = args.includes('--notify');
const RUN_ALL = args.includes('--all');
const batchArg = args.find(a => a.startsWith('--batch='))?.split('=')[1];

// The script talks to Prisma directly for lookups, but reuses the exact
// same FeedWastageService the app runs in production for the actual
// check/create — so a manual dry-run reasoning-through of the numbers
// isn't needed here; the same code that runs live is what's running here.
// A real EventEmitter2 (rather than a stub) so --notify's dashboard-refresh
// event behaves identically to the live path — it just has no listeners
// attached outside of Nest's DI container, which is harmless here.
const feedWastage = new FeedWastageService(
  prisma as any,
  new NotificationsService(prisma as any, new EventEmitter2()) as any,
);

async function processBatch(batch: { id: string; batchCode: string; currentBirdCount: number; dateReceived: Date }) {
  const days = await prisma.brooderGeneralFeedLog.findMany({
    where: { batchId: batch.id },
    select: { entryDate: true },
    distinct: ['entryDate'],
    orderBy: { entryDate: 'asc' },
  });
  if (days.length === 0) {
    console.log(`  ${batch.batchCode}: no feed log entries — nothing to check.`);
    return { checked: 0, created: 0 };
  }

  let created = 0;
  for (const { entryDate } of days) {
    const ageWeeks = batchAgeWeeks(batch.dateReceived, entryDate);
    const dailyRationKg = brooderRequiredFeedKg(batch.currentBirdCount, ageWeeks, 1);

    if (DRY_RUN) {
      const dayStr = entryDate.toISOString().slice(0, 10);
      const total = await prisma.brooderGeneralFeedLog.aggregate({
        where: { batchId: batch.id, entryDate },
        _sum: { quantityDispensedKg: true },
      });
      const dispensed = total._sum.quantityDispensedKg ?? 0;
      const already = await prisma.brooderFeedWastageLog.findFirst({ where: { batchId: batch.id, entryDate } });
      const excess = dispensed - dailyRationKg;
      if (!already && excess > 0.05) {
        console.log(`  ${batch.batchCode} ${dayStr}: WOULD flag — ${dispensed.toFixed(2)}kg fed vs ${dailyRationKg.toFixed(2)}kg ration (+${excess.toFixed(2)}kg)`);
        created++;
      }
      continue;
    }

    const result = await feedWastage.backfillDayIfOverIssued({
      batch: { id: batch.id, batchCode: batch.batchCode },
      entryDate,
      dailyRationKg,
      loggedById: 'SYSTEM_BACKFILL',
      notify: NOTIFY,
    });
    if (result) {
      created++;
      const dayStr = entryDate.toISOString().slice(0, 10);
      console.log(`  ${batch.batchCode} ${dayStr}: flagged — ${result.dispensedKgTotal.toFixed(2)}kg fed vs ${result.requiredKgForDay.toFixed(2)}kg ration (+${result.excessKg.toFixed(2)}kg)`);
    }
  }
  return { checked: days.length, created };
}

async function main() {
  if (!batchArg && !RUN_ALL) {
    console.error('Usage: npx tsx scripts/backfill-feed-wastage.ts --batch=<batchCode-or-id> [--dry-run] [--notify]');
    console.error('   or: npx tsx scripts/backfill-feed-wastage.ts --all [--dry-run] [--notify]');
    process.exitCode = 1;
    return;
  }

  console.log(DRY_RUN ? '--- DRY RUN: backfill-feed-wastage ---' : '--- Backfilling feed wastage ---');
  if (NOTIFY) console.log('(notifications ON — the Director will be paged for each day found)');

  const batches = RUN_ALL
    ? await prisma.batch.findMany({
        where: { brooderGeneralFeedLogs: { some: {} } },
        select: { id: true, batchCode: true, currentBirdCount: true, dateReceived: true },
      })
    : await prisma.batch.findMany({
        where: { OR: [{ id: batchArg }, { batchCode: batchArg }] },
        select: { id: true, batchCode: true, currentBirdCount: true, dateReceived: true },
      });

  if (batches.length === 0) {
    console.error(`No batch found matching "${batchArg}".`);
    process.exitCode = 1;
    return;
  }

  let totalChecked = 0, totalCreated = 0;
  for (const batch of batches) {
    console.log(`\nBatch ${batch.batchCode}:`);
    const { checked, created } = await processBatch(batch);
    totalChecked += checked;
    totalCreated += created;
  }

  console.log(`\nDone. Days checked: ${totalChecked}. Wastage entries ${DRY_RUN ? 'that would be ' : ''}created: ${totalCreated}.`);
  if (DRY_RUN) console.log('Dry run only — nothing was written. Re-run without --dry-run to apply.');
}

main()
  .catch(e => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
