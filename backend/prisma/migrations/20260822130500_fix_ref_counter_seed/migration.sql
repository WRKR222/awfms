-- Corrects the seed value written by
-- 20260822125500_ref_counters_atomic_plan_ref.
--
-- That migration seeded ref_counters.value from
-- `COUNT(*) FROM issuance_plans`. That's wrong whenever any plan has ever
-- been deleted (IssuancePlanService.deletePlan lets Store delete DRAFT
-- plans) — COUNT(*) drops when a row is deleted, but the sequence number
-- embedded in that row's plan_ref (e.g. "IP-2026-0020") was already
-- issued and never reused. Seeding from the row count instead of the
-- highest number actually issued let the atomic counter hand out
-- "0016" while "0016"..."0020" still existed on other rows, so
-- issuancePlan.create() kept hitting the plan_ref unique constraint —
-- the same symptom as the original race, but now from a bad starting
-- value rather than a race.
--
-- Fix: reseed from the actual max sequence number found in existing
-- plan_ref values, not the row count. The sequence is the 3rd '-'
-- delimited segment of `${prefix}-${year}-${NNNN}` — extracted via
-- SPLIT_PART rather than a fixed RIGHT(...,4) so this keeps working once
-- the sequence grows past 4 digits (plan #10000+), not just today.
-- GREATEST(...) makes this a no-op if the counter is already correct or
-- ahead.

UPDATE "ref_counters"
SET "value" = GREATEST(
    "value",
    COALESCE((SELECT MAX(CAST(SPLIT_PART("plan_ref", '-', 3) AS INTEGER)) FROM "issuance_plans"), 0)
)
WHERE "key" = 'issuance_plan';

-- Defensive: if the counter row is somehow missing (e.g. the previous
-- migration's INSERT was skipped by its ON CONFLICT DO NOTHING for an
-- unrelated reason), create it now from the same max-sequence logic.
INSERT INTO "ref_counters" ("key", "value")
SELECT 'issuance_plan', COALESCE((SELECT MAX(CAST(SPLIT_PART("plan_ref", '-', 3) AS INTEGER)) FROM "issuance_plans"), 0)
WHERE NOT EXISTS (SELECT 1 FROM "ref_counters" WHERE "key" = 'issuance_plan');
