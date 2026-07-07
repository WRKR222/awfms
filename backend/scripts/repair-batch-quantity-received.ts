// scripts/repair-batch-quantity-received.ts
//
// One-off data repair for batches whose `quantityReceived` was silently
// overwritten by the old FlockService.updateBatch() bug (see
// flock.service.ts, the block above the mortalityOnArrival handling in
// updateBatch()). That bug ran, on EVERY batch save — including edits that
// only touched dateOfHatch, a typo fix, etc. — regardless of whether
// mortalityOnArrival had actually changed:
//
//     newQuantityReceived = currentBirdCount + mortalityOnArrival
//
// currentBirdCount decreases over the batch's life as on-farm mortality and
// culling are logged, so this permanently discarded every on-farm death
// recorded since intake from the received/survival baseline, every time the
// batch was edited. Symptom: "birds started with" drops to roughly today's
// live count, and survival rate snaps back to ~100%.
//
// The code fix (already applied — see flock.service.ts) stops this from
// happening on *future* saves. It does NOT repair batches that were already
// corrupted by a save made before the fix went in. This script finds and
// repairs those.
//
// HOW THE REPAIR WORKS
// ---------------------
// The corruption only ever touches Batch.quantityReceived. It never touches
// Batch.currentBirdCount, Batch.mortalityOnArrival, or any of the mortality
// log tables (all farm-mortality decrements to currentBirdCount happen
// through code paths untouched by this bug). That means the following
// invariant always holds for an uncorrupted batch, and can be used to
// recompute the correct original quantityReceived for a corrupted one:
//
//   quantityReceived
//     = currentBirdCount
//     + mortalityOnArrival
//     + SUM(mortalityCount + cullingCount) over every mortality/culling
//       record ever logged against the batch, across all three log sources:
//         - FlockDailyEntry      (status = APPROVED only — PENDING/RETURNED
//                                 entries were never applied to
//                                 currentBirdCount, so they must not be
//                                 counted here either)
//         - BrooderLevelMortalityLog
//         - BrooderGeneralMortalityLog
//
// This script recomputes that right-hand side for every batch, compares it
// to the stored quantityReceived, and reports (or, with --apply, fixes) any
// mismatch.
//
// USAGE
// -----
//   Dry run (default) — reports mismatches, changes nothing:
//     npx ts-node scripts/repair-batch-quantity-received.ts
//     npx tsx scripts/repair-batch-quantity-received.ts        (if ts-node isn't set up)
//
//   Apply the fix (after reviewing the dry-run report):
//     npx ts-node scripts/repair-batch-quantity-received.ts --apply
//
//   Limit to one batch while testing:
//     npx ts-node scripts/repair-batch-quantity-received.ts --batch=<batchId> --apply
//
// SAFETY
// ------
// - Always run without --apply first and review the report.
// - Take a database backup/snapshot before running with --apply.
// - The script only ever updates Batch.quantityReceived. It never touches
//   currentBirdCount, mortalityOnArrival, or any log table.
// - If recomputed value === stored value, the batch is skipped (untouched).
// - If recomputed value < mortalityOnArrival + currentBirdCount (shouldn't be
//   possible given the formula, but guarded anyway), the batch is flagged as
//   NEEDS MANUAL REVIEW and skipped rather than guessed at.

import { PrismaClient, EntryStatus } from '@prisma/client';

const prisma = new PrismaClient();

const APPLY = process.argv.includes('--apply');
const batchArg = process.argv.find((a) => a.startsWith('--batch='));
const ONLY_BATCH_ID = batchArg ? batchArg.split('=')[1] : null;

async function main() {
  console.log(`--- Repairing Batch.quantityReceived (${APPLY ? 'APPLY MODE' : 'DRY RUN'}) ---`);
  if (!APPLY) {
    console.log('    (no changes will be made — pass --apply to write fixes)\n');
  }

  const batches = await prisma.batch.findMany({
    where: ONLY_BATCH_ID ? { id: ONLY_BATCH_ID } : {},
    select: {
      id: true,
      batchCode: true,
      quantityReceived: true,
      currentBirdCount: true,
      mortalityOnArrival: true,
    },
    orderBy: { batchCode: 'asc' },
  });

  let checked = 0;
  let mismatched = 0;
  let fixed = 0;
  let needsReview = 0;

  for (const batch of batches) {
    checked++;

    const [entryAgg, levelAgg, generalAgg] = await Promise.all([
      prisma.flockDailyEntry.aggregate({
        where: { batchId: batch.id, status: EntryStatus.APPROVED },
        _sum: { mortalityCount: true, cullingCount: true },
      }),
      prisma.brooderLevelMortalityLog.aggregate({
        where: { batchId: batch.id },
        _sum: { mortalityCount: true, cullingCount: true },
      }),
      prisma.brooderGeneralMortalityLog.aggregate({
        where: { batchId: batch.id },
        _sum: { mortalityCount: true, cullingCount: true },
      }),
    ]);

    const totalFarmMortality =
      (entryAgg._sum.mortalityCount ?? 0) + (entryAgg._sum.cullingCount ?? 0) +
      (levelAgg._sum.mortalityCount ?? 0) + (levelAgg._sum.cullingCount ?? 0) +
      (generalAgg._sum.mortalityCount ?? 0) + (generalAgg._sum.cullingCount ?? 0);

    const correctQuantityReceived =
      batch.currentBirdCount + (batch.mortalityOnArrival ?? 0) + totalFarmMortality;

    if (correctQuantityReceived === batch.quantityReceived) {
      continue; // already correct — leave it alone
    }

    mismatched++;

    if (correctQuantityReceived < batch.currentBirdCount + (batch.mortalityOnArrival ?? 0)) {
      // Shouldn't be reachable given the formula above, but if the numbers
      // don't make sense, don't guess — flag for a human to look at.
      needsReview++;
      console.log(
        `  [NEEDS REVIEW] ${batch.batchCode} (${batch.id}): recomputed value looks invalid ` +
        `(${correctQuantityReceived}) — skipping.`,
      );
      continue;
    }

    console.log(
      `  ${batch.batchCode} (${batch.id}): quantityReceived ${batch.quantityReceived} -> ${correctQuantityReceived} ` +
      `[currentBirdCount=${batch.currentBirdCount}, mortalityOnArrival=${batch.mortalityOnArrival ?? 0}, ` +
      `farmMortalityLogged=${totalFarmMortality}]`,
    );

    if (APPLY) {
      await prisma.batch.update({
        where: { id: batch.id },
        data: { quantityReceived: correctQuantityReceived },
      });
      fixed++;
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Batches checked:    ${checked}`);
  console.log(`Mismatches found:   ${mismatched}`);
  console.log(`Needs manual review:${needsReview}`);
  console.log(`Fixed:              ${APPLY ? fixed : 0}${APPLY ? '' : ' (dry run — re-run with --apply to write these)'}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
