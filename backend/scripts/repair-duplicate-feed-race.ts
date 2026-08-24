// scripts/repair-duplicate-feed-race.ts
//
// One-off data repair for BrooderGeneralFeedLog rows that were DOUBLE-BOOKED
// by the concurrency race in production-report-reconciliation.service.ts's
// Phase 2 loop (fixed in the same change that added this script — see the
// comment above the `rowsByDate` grouping in reconcile()).
//
// ROOT CAUSE (for context)
// ------------------------
// Every "report is authoritative" reconciler (feed, mortality, water, item
// usage) reads the CURRENT total already logged for (batchId, a row's
// date), diffs it against the report's figure for that date, and writes a
// single correction row for the delta. Before this fix, ALL of a report's
// rows ran with unrestricted concurrency (up to RECONCILE_CONCURRENCY at
// once) regardless of date. When a report had more than one row for the
// same calendar date, two same-date rows could both read the SAME "nothing
// logged yet" snapshot before either had committed its write, and both then
// created a full delta on top of that stale snapshot — silently booking
// that day's feed twice. Each row still correctly reported "autofilled" on
// its own; the bug was only visible in the resulting FeedWastageLog totals.
//
// WHAT THIS SCRIPT DOES
// ----------------------
// For a given batch (required — see --batch below), walks every
// StoreProductionReport's ProductionReportAppliedChange ledger looking for
// the exact signature of that race: two or more non-rolled-back CREATE
// entries for entityType='BrooderGeneralFeedLog', from the SAME report, for
// the SAME row date, targeting the SAME store item/feed type, where every
// one of them was written as a fresh "Auto-filled ..." entry rather than a
// "Correction: ..." entry (a real, intentional correction always has
// exactly one CREATE per report/date/item — a race is the only way to get
// two "Auto-filled" CREATEs for the identical (report, date, item)).
//
// Default mode is DIAGNOSTIC ONLY — it prints what it finds and changes
// nothing. Pass --apply to actually fix flagged groups: the earliest CREATE
// in each group is kept, the rest are deleted (their BrooderGeneralFeedLog
// row + any BrooderFeedWastageLog row that references it), and their ledger
// entries are marked rolled back — the same effect as running the app's own
// "Undo this report" for just those specific duplicate writes, leaving
// everything else that report applied untouched.
//
// This never touches a row that's been hand-edited since (same
// still-matches-what-we-created guard as ProductionReportRollbackService),
// and never touches anything a Director applied via approve()/
// applyDiscrepancy() — only what reconcile() itself auto-applied.
//
// USAGE
// -----
//   npx ts-node scripts/repair-duplicate-feed-race.ts --batch=<batchId>
//       Diagnostic report only. Always start here.
//
//   npx ts-node scripts/repair-duplicate-feed-race.ts --batch=<batchId> --apply
//       Applies the fix for high-confidence groups found above.
//
// Example for the batch reported in the Aug 21 feed-wastage spike:
//   npx ts-node scripts/repair-duplicate-feed-race.ts --batch=46bd03b8-3b69-432d-9369-440b2b2ef0a2

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const APPLY = process.argv.includes('--apply');
const batchArg = process.argv.find(a => a.startsWith('--batch='));
const BATCH_ID = batchArg ? batchArg.split('=')[1] : null;

interface ChangeRow {
  id: string;
  reportId: string;
  batchId: string;
  rowDate: Date | null;
  entityId: string | null;
  createdAt: Date;
  afterState: any;
}

function isAutoFilledNote(note: unknown): boolean {
  return typeof note === 'string' && note.startsWith('Auto-filled');
}

async function main() {
  if (!BATCH_ID) {
    console.error('Usage: npx ts-node scripts/repair-duplicate-feed-race.ts --batch=<batchId> [--apply]');
    process.exitCode = 1;
    return;
  }

  console.log(APPLY
    ? `--- Repairing duplicate feed-race entries for batch ${BATCH_ID} ---`
    : `--- DRY RUN (diagnostic only) — duplicate feed-race scan for batch ${BATCH_ID} ---`);

  const batch = await prisma.batch.findUnique({ where: { id: BATCH_ID }, select: { id: true, batchCode: true } });
  if (!batch) {
    console.error(`No batch found with id ${BATCH_ID}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Batch: ${batch.batchCode} (${batch.id})\n`);

  const changes = await prisma.productionReportAppliedChange.findMany({
    where: { batchId: BATCH_ID, entityType: 'BrooderGeneralFeedLog', action: 'CREATE', rolledBack: false },
    orderBy: [{ rowDate: 'asc' }, { createdAt: 'asc' }],
  }) as unknown as ChangeRow[];

  if (changes.length === 0) {
    console.log('No BrooderGeneralFeedLog CREATE entries found for this batch. Nothing to check.');
    return;
  }

  // Group by (reportId, rowDate) — the unit a single race can happen within.
  const groups = new Map<string, ChangeRow[]>();
  for (const c of changes) {
    const key = `${c.reportId}::${c.rowDate ? c.rowDate.toISOString().slice(0, 10) : 'unknown'}`;
    const arr = groups.get(key);
    if (arr) arr.push(c);
    else groups.set(key, [c]);
  }

  let groupsFlagged = 0;
  let rowsToDelete = 0;
  let rowsFixed = 0;
  let rowsSkipped = 0;

  for (const [key, group] of groups) {
    if (group.length < 2) continue; // a single CREATE for a report/date is normal

    const [reportId, dateStr] = key.split('::');

    // Sub-group further by (storeItemId, feedType) within this report/date —
    // legitimate multi-item feed (e.g. two distinct feed types genuinely
    // logged the same day) is fine; it's only a same-item repeat that's the
    // race signature.
    const byItem = new Map<string, ChangeRow[]>();
    for (const c of group) {
      const storeItemId = c.afterState?.storeItemId ?? 'unknown';
      const feedType = c.afterState?.feedType ?? 'unknown';
      const itemKey = `${storeItemId}::${feedType}`;
      const arr = byItem.get(itemKey);
      if (arr) arr.push(c);
      else byItem.set(itemKey, [c]);
    }

    for (const [itemKey, itemGroup] of byItem) {
      if (itemGroup.length < 2) continue;
      const allAutoFilled = itemGroup.every(c => isAutoFilledNote(c.afterState?.notes));
      if (!allAutoFilled) {
        // At least one entry is a real "Correction:" — not the race
        // signature; likely a legitimate multi-step correction over time.
        continue;
      }

      groupsFlagged++;
      const totalKg = itemGroup.reduce((s, c) => s + (Number(c.afterState?.quantityDispensedKg) || 0), 0);
      console.log(`\n[${dateStr}] report=${reportId} item=${itemKey}`);
      console.log(`  ${itemGroup.length} "Auto-filled" CREATE entries for the same (report, date, item) — race signature.`);
      itemGroup.forEach((c, i) => {
        console.log(`  ${i === 0 ? 'KEEP  ' : 'REMOVE'} entityId=${c.entityId} qty=${c.afterState?.quantityDispensedKg}kg createdAt=${c.createdAt.toISOString()}`);
      });
      console.log(`  Combined kg currently double-booked for this item/date: ${totalKg.toFixed(2)} kg (should be ~${itemGroup[0].afterState?.quantityDispensedKg}kg)`);

      const [, ...toRemove] = itemGroup; // keep the earliest, remove the rest
      rowsToDelete += toRemove.length;

      if (!APPLY) continue;

      for (const change of toRemove) {
        try {
          await prisma.$transaction(async (tx) => {
            const row = change.entityId
              ? await tx.brooderGeneralFeedLog.findUnique({ where: { id: change.entityId } })
              : null;
            if (row && change.entityId) {
              // Guard: only delete if it still looks like the row this
              // report created (nobody hand-edited it since).
              const expected = change.afterState ?? {};
              const stillMatches = Object.keys(expected)
                .filter(k => !['id', 'createdAt', 'updatedAt'].includes(k))
                .every(k => JSON.stringify((row as any)[k]) === JSON.stringify((expected as any)[k]));
              if (!stillMatches) {
                throw new Error('Row has been edited since the report created it — leaving for manual review.');
              }
              // Clean up any wastage log that points at this feed log row,
              // or it's left as a dangling, now-orphaned "excess feed"
              // entry that keeps inflating the Director's wastage view even
              // after the underlying feed row is gone.
              await tx.brooderFeedWastageLog.deleteMany({ where: { generalFeedLogId: change.entityId } });
              await tx.brooderGeneralFeedLog.delete({ where: { id: change.entityId } });
            }
            await tx.productionReportAppliedChange.update({
              where: { id: change.id },
              data: { rolledBack: true, rolledBackAt: new Date() },
            });
          });
          rowsFixed++;
        } catch (err: any) {
          console.warn(`  SKIPPED entityId=${change.entityId}: ${err.message}`);
          rowsSkipped++;
        }
      }
    }
  }

  console.log(`\n--- Summary ---`);
  console.log(`Duplicate groups flagged: ${groupsFlagged}`);
  console.log(`Duplicate rows found:     ${rowsToDelete}`);
  if (APPLY) {
    console.log(`Duplicate rows removed:   ${rowsFixed}`);
    console.log(`Duplicate rows skipped:   ${rowsSkipped} (edited since — left for manual review)`);
  } else {
    console.log(`\nDry run only — nothing was written.`);
    console.log(`Re-run with --apply to remove the flagged duplicates and their orphaned wastage entries.`);
  }
}

main()
  .catch(e => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
