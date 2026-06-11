// scripts/backfill-daily-egg-aggregates.ts
//
// One-off backfill for existing DailyEggAggregate rows (and a sanity check on
// EggTallyVerification.finalGoodEggs / finalStarterEggs) created before the
// totalStdEggs / totalBrokenUnsellable calculation fix.
//
// Fixes applied:
//   1. totalStdEggs was previously computed as
//        totalGoodEggs - totalStarterEggs - totalBrokenSellable
//      which double-subtracted starter and broken-sellable eggs (these are
//      already excluded from totalGoodEggs). Correct value is simply the sum
//      of session.totalGoodEggs across the AM+PM sessions for that day.
//   2. totalBrokenUnsellable was hardcoded to 0 on write. Recomputed here as
//      the sum of session.totalBrokenUnsellable across AM+PM.
//   3. expectedRevenueKes is recalculated from the corrected totals using
//      that day's DailyEggPrice (if present); left untouched if no price row
//      exists for that date.
//   4. EggTallyVerification.finalGoodEggs / finalStarterEggs are re-synced
//      from their session's totalGoodEggs / totalStarterEggs for any locked
//      tallies (these were usually already correct, but are re-verified here).
//
// Run with:
//   npx ts-node scripts/backfill-daily-egg-aggregates.ts
// or, if ts-node isn't set up:
//   npx tsx scripts/backfill-daily-egg-aggregates.ts

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- Backfilling EggTallyVerification.finalGoodEggs / finalStarterEggs ---');

  const lockedTallies = await prisma.eggTallyVerification.findMany({
    where: { isLocked: true },
    include: { session: true },
  });

  let tallyFixCount = 0;
  for (const tally of lockedTallies) {
    if (!tally.session) continue;
    const correctGood    = tally.session.totalGoodEggs ?? 0;
    const correctStarter = (tally.session as any).totalStarterEggs ?? 0;

    if (tally.finalGoodEggs !== correctGood || tally.finalStarterEggs !== correctStarter) {
      await prisma.eggTallyVerification.update({
        where: { id: tally.id },
        data: {
          finalGoodEggs: correctGood,
          finalStarterEggs: correctStarter,
        },
      });
      tallyFixCount++;
      console.log(
        `  Tally ${tally.id} (session ${tally.sessionId}): ` +
        `finalGoodEggs ${tally.finalGoodEggs} -> ${correctGood}, ` +
        `finalStarterEggs ${tally.finalStarterEggs} -> ${correctStarter}`,
      );
    }
  }
  console.log(`Fixed ${tallyFixCount} tally row(s).\n`);

  console.log('--- Backfilling DailyEggAggregate rows ---');

  const aggregates = await prisma.dailyEggAggregate.findMany();
  let aggFixCount = 0;

  for (const agg of aggregates) {
    const sessions = await prisma.eggCollectionSession.findMany({
      where: {
        batchId: agg.batchId,
        houseId: agg.houseId,
        sessionDate: agg.aggregateDate,
        shift: { in: ['AM', 'PM'] },
        status: 'APPROVED',
        deletedAt: null,
      },
    });

    if (sessions.length === 0) {
      console.log(`  Aggregate ${agg.id}: no matching sessions found, skipping.`);
      continue;
    }

    const correctStdEggs = sessions.reduce((s, sess) => s + (sess.totalGoodEggs ?? 0), 0);
    const correctStarterEggs = sessions.reduce(
      (s, sess) => s + ((sess as any).totalStarterEggs ?? 0), 0,
    );
    const correctBrokenSell = sessions.reduce(
      (s, sess) => s + ((sess as any).totalBrokenSellable ?? 0), 0,
    );
    const correctBrokenUnsell = sessions.reduce(
      (s, sess) => s + ((sess as any).totalBrokenUnsellable ?? 0), 0,
    );

    const dailyPrice = await prisma.dailyEggPrice.findUnique({
      where: { priceDate: agg.aggregateDate },
    });

    let correctRevenue: number | null = agg.expectedRevenueKes != null
      ? Number(agg.expectedRevenueKes)
      : null;

    if (dailyPrice) {
      correctRevenue =
        (correctStdEggs     * Number(dailyPrice.pricePerEgg)) +
        (correctStarterEggs * Number((dailyPrice as any).pricePerEggStarter ?? 0)) +
        (correctBrokenSell  * Number((dailyPrice as any).pricePerEggBroken  ?? 0));
    }

    const needsUpdate =
      agg.totalStdEggs !== correctStdEggs ||
      agg.totalStarterEggs !== correctStarterEggs ||
      agg.totalBrokenSellable !== correctBrokenSell ||
      agg.totalBrokenUnsellable !== correctBrokenUnsell ||
      (correctRevenue != null && Number(agg.expectedRevenueKes ?? 0) !== correctRevenue);

    if (needsUpdate) {
      await prisma.dailyEggAggregate.update({
        where: { id: agg.id },
        data: {
          totalStdEggs: correctStdEggs,
          totalStarterEggs: correctStarterEggs,
          totalBrokenSellable: correctBrokenSell,
          totalBrokenUnsellable: correctBrokenUnsell,
          ...(correctRevenue != null ? { expectedRevenueKes: correctRevenue } : {}),
        },
      });

      // Keep the matching tally rows' expectedRevenueKes in sync too.
      if (correctRevenue != null) {
        const sessionIds = sessions.map(s => s.id);
        await prisma.eggTallyVerification.updateMany({
          where: { sessionId: { in: sessionIds } },
          data: { expectedRevenueKes: correctRevenue },
        });
      }

      aggFixCount++;
      console.log(
        `  Aggregate ${agg.id} (${agg.aggregateDate.toISOString().slice(0, 10)}, batch ${agg.batchId}, house ${agg.houseId}): ` +
        `totalStdEggs ${agg.totalStdEggs} -> ${correctStdEggs}, ` +
        `totalBrokenSellable ${agg.totalBrokenSellable} -> ${correctBrokenSell}, ` +
        `totalBrokenUnsellable ${agg.totalBrokenUnsellable} -> ${correctBrokenUnsell}` +
        (correctRevenue != null ? `, expectedRevenueKes -> ${correctRevenue}` : ''),
      );
    }
  }

  console.log(`Fixed ${aggFixCount} aggregate row(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
