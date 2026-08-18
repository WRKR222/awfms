// scripts/backfill-issuance-plan-phase.ts
//
// One-time correction for plans stuck showing "Awaiting Director" even
// though every item on them already has a final status.
//
// Root cause (fixed in IssuancePlanService.submitPlan, but this only
// prevents the bug for FUTURE submissions — plans submitted before that
// fix are already sitting in the database with the wrong phase and won't
// self-correct): submitPlan() used to hardcode `phase: 'PENDING_DIRECTOR'`
// on every submission, rather than recomputing it from the items' actual
// statuses. If a plan had an item already APPROVED before submission (e.g.
// via the separate premature-approval bug also fixed alongside this one —
// an item auto-injected from a PM requisition into a still-DRAFT plan
// could be approved by the Director before Store ever submitted it), that
// plan's phase got force-set to PENDING_DIRECTOR on submit and stayed
// there forever, even with nothing actually left pending.
//
// This script re-runs the same phase computation (computePhase) against
// every non-DRAFT plan's current item statuses and corrects the stored
// phase where it's wrong. Safe to run repeatedly — it's a pure
// recalculation, not an accumulating action, and does nothing to any plan
// whose stored phase already matches what its items say.
//
// USAGE
// -----
//   cd backend
//   npx tsx scripts/backfill-issuance-plan-phase.ts                 # every non-DRAFT plan
//   npx tsx scripts/backfill-issuance-plan-phase.ts --dry-run       # preview only, writes nothing
//   npx tsx scripts/backfill-issuance-plan-phase.ts --plan=<id-or-planRef>  # just one plan
//
// Never touches DRAFT plans — a DRAFT plan's phase is definitionally DRAFT
// regardless of item statuses (see computePhase's `!wasSubmitted` branch),
// so there's nothing for this script to correct there.

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const planArg = args.find(a => a.startsWith('--plan='))?.split('=')[1];

// Mirrors IssuancePlanService.computePhase exactly — kept in sync manually
// since this is a standalone script or importing the whole NestJS service
// (with its Prisma/Notifications DI) just for this one pure function.
function computePhase(items: { status: string }[]): 'PENDING_DIRECTOR' | 'DECIDED' {
  if (items.length === 0) return 'PENDING_DIRECTOR';
  if (items.some((i) => !['APPROVED', 'REJECTED'].includes(i.status))) return 'PENDING_DIRECTOR';
  return 'DECIDED';
}

async function main() {
  console.log(DRY_RUN ? '--- DRY RUN: backfill-issuance-plan-phase ---' : '--- Backfilling issuance plan phases ---');

  const plans = await prisma.issuancePlan.findMany({
    where: {
      phase: { not: 'DRAFT' },
      ...(planArg ? { OR: [{ id: planArg }, { planRef: planArg }] } : {}),
    },
    include: { items: { select: { status: true } } },
  });

  if (planArg && plans.length === 0) {
    console.error(`No non-DRAFT plan found matching "${planArg}".`);
    process.exitCode = 1;
    return;
  }

  let checked = 0;
  let corrected = 0;

  for (const plan of plans) {
    checked++;
    const correctPhase = computePhase(plan.items);
    if (correctPhase === plan.phase) continue;

    corrected++;
    console.log(
      `  ${plan.planRef}: stored phase "${plan.phase}" -> should be "${correctPhase}" ` +
      `(${plan.items.length} item(s): ${plan.items.map(i => i.status).join(', ')})`,
    );

    if (!DRY_RUN) {
      await prisma.issuancePlan.update({
        where: { id: plan.id },
        data: { phase: correctPhase as any },
      });
    }
  }

  console.log(`\nDone. Plans checked: ${checked}. Corrected: ${corrected}.`);
  if (DRY_RUN && corrected > 0) console.log('Dry run only — nothing was written. Re-run without --dry-run to apply.');
}

main()
  .catch(e => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
