-- Migration: 20260617000000_add_new_standard_to_breakage
--
-- When a STANDARD egg breaks (into Consumable or Non-Consumable), the standard
-- egg count must decrease. Previously the table only tracked the "before"
-- standard count with no corresponding "new" count, so standard stock was
-- never actually deducted on a breakage adjustment. This adds the missing
-- column, mirroring the existing new_consumable / new_non_consumable pattern.

ALTER TABLE "egg_breakage_adjustments"
  ADD COLUMN IF NOT EXISTS "new_standard" INTEGER;

-- Back-fill existing rows: if source was STANDARD, eggs left the standard
-- pool roughly equal to the increase in broken counts. If no prior rows
-- exist this is a no-op. We default to quantity_standard_before (no change)
-- for safety, since we cannot retroactively know the exact figure.
UPDATE "egg_breakage_adjustments"
SET "new_standard" = COALESCE("new_standard", "quantity_standard_before");

ALTER TABLE "egg_breakage_adjustments"
  ALTER COLUMN "new_standard" SET NOT NULL;
