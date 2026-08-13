// scripts/repair-health-usage-dose-text.ts
//
// One-off data repair for BrooderLog.vaccinesJson / BrooderLog.supplementsJson
// / BrooderTreatmentLog entries whose `dose` field was written as a
// converted-quantity-plus-report-unit string (e.g. "0.012MLS") instead of
// the report's actual dosage text (e.g. "SOLVITA(12MLS/120LTS)"). See the
// comment on writeHealthUsageLog() in production-report-reconciliation.service.ts
// for the fix that stops this happening on *future* auto-fills — this
// script repairs entries that were already written before that fix went in.
//
// SYMPTOM
// -------
// The Brooder daily log timeline (BrooderPage.tsx) shows something like
//   Sol-vita · 0.012MLS
// instead of the report's actual dosage text, e.g.
//   Sol-vita · SOLVITA(12MLS/120LTS)   (0.012L used)
//
// HOW THE REPAIR WORKS
// ---------------------
// For every StoreProductionReport, walk its rawRows[].healthUsages — each
// entry there already carries the CORRECT pairing: `rawText` (the report's
// own dosage text) plus `quantity`/`unit` info needed to work out the
// correct store-unit quantity for that (batch, date, item). For every
// BrooderLog row on that same (batchId, logDate) whose vaccinesJson/
// supplementsJson contains an entry for the same storeItemId where `dose`
// does NOT match the report's rawText — i.e. it looks like a bare
// "<number><report-unit>" string rather than the descriptive dosage text —
// the entry's `dose` is corrected to the report's rawText, and
// `quantityUsed`/`unit` are backfilled from the StoreItem's current stock
// unit if they're missing. Same idea for BrooderTreatmentLog.dose/doseUnit.
//
// This never touches quantityUsed/stock numbers that were already applied
// (no re-deduction happens here) — it only rewrites the descriptive text
// fields so the daily log history displays correctly. Idempotent: rows
// already showing the correct rawText are left untouched.
//
// Run with:
//   npx ts-node scripts/repair-health-usage-dose-text.ts
// or:
//   npx tsx scripts/repair-health-usage-dose-text.ts
//
// Add --dry-run to only print what would change, without writing anything.

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

// A "bad" dose looks like a bare number + unit text and nothing else (e.g.
// "0.012MLS", "12ml", "0.5L") — the report's real dosage text is always
// more descriptive than this (a drug/item name, a slash-separated ratio,
// parentheses, etc.), so this pattern is a safe signal that the entry was
// built from a converted quantity rather than the report's raw text.
const BARE_QTY_UNIT_RE = /^\d+(?:\.\d+)?\s*[a-zA-Z%]+$/;

async function main() {
  console.log(DRY_RUN ? '--- DRY RUN: repair-health-usage-dose-text ---' : '--- Repairing health-usage dose text ---');

  const reports = await prisma.storeProductionReport.findMany({
    select: { id: true, batchId: true, fileName: true, rawRows: true },
  });

  let brooderLogFixCount = 0;
  let treatmentLogFixCount = 0;
  let reportsScanned = 0;

  for (const report of reports) {
    const rows = (report.rawRows as any[]) ?? [];
    if (!Array.isArray(rows) || rows.length === 0) continue;
    reportsScanned++;

    for (const row of rows) {
      const usages: any[] = Array.isArray(row?.healthUsages) ? row.healthUsages : [];
      if (!usages.length) continue;
      const logDate = row?.date ? new Date(row.date) : null;
      if (!logDate || Number.isNaN(logDate.getTime())) continue;

      for (const usage of usages) {
        if (!usage?.storeItemId || !usage?.rawText) continue;
        const storeItemId: string = usage.storeItemId;
        const rawText: string = usage.rawText;

        if (usage.kind === 'treatment') {
          const treatment = await prisma.brooderTreatmentLog.findFirst({
            where: { batchId: report.batchId, treatmentDate: logDate, storeItemId },
          });
          if (!treatment) continue;
          if (treatment.dose === rawText) continue; // already correct
          if (!BARE_QTY_UNIT_RE.test(String(treatment.dose ?? ''))) continue; // don't touch text we don't recognise as the bug

          console.log(`[BrooderTreatmentLog ${treatment.id}] batch=${report.batchId} date=${row.date} "${treatment.dose}" -> "${rawText}"`);
          if (!DRY_RUN) {
            await prisma.brooderTreatmentLog.update({
              where: { id: treatment.id },
              data: { dose: rawText },
            });
          }
          treatmentLogFixCount++;
          continue;
        }

        // vaccine / supplement — stored inside BrooderLog's once-daily JSON row.
        const key = usage.kind === 'vaccine' ? 'vaccinesJson' : 'supplementsJson';
        const brooderLog = await prisma.brooderLog.findFirst({
          where: { batchId: report.batchId, logDate, logSession: null },
        });
        if (!brooderLog) continue;
        const entries: any[] = Array.isArray((brooderLog as any)[key]) ? (brooderLog as any)[key] : [];
        if (!entries.length) continue;

        let changed = false;
        const fixedEntries = entries.map(e => {
          if (e?.storeItemId !== storeItemId) return e;
          if (e.dose === rawText) return e; // already correct
          if (!BARE_QTY_UNIT_RE.test(String(e.dose ?? ''))) return e; // not the pattern this script targets
          changed = true;
          console.log(`[BrooderLog ${brooderLog.id}.${key}] batch=${report.batchId} date=${row.date} "${e.dose}" -> "${rawText}"`);
          return { ...e, dose: rawText };
        });

        if (changed) {
          brooderLogFixCount++;
          if (!DRY_RUN) {
            await prisma.brooderLog.update({
              where: { id: brooderLog.id },
              data: { [key]: fixedEntries } as any,
            });
          }
        }
      }
    }
  }

  console.log(`\nReports scanned: ${reportsScanned}`);
  console.log(`BrooderLog entries fixed: ${brooderLogFixCount}`);
  console.log(`BrooderTreatmentLog rows fixed: ${treatmentLogFixCount}`);
  if (DRY_RUN) console.log('\nDry run only — nothing was written. Re-run without --dry-run to apply.');
}

main()
  .catch(e => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
