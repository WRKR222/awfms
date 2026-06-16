-- Migration: 20260616000001_reshape_egg_breakage_adjustments
--
-- The egg_breakage_adjustments table was originally created for a different
-- feature (per-grade, per-order breakage tracking). The Prisma schema and
-- sales service were later rewritten to use a simpler stock-level adjustment
-- model but no migration was run, leaving the DB and Prisma schema out of sync.
--
-- This migration drops the old columns and adds the new ones so the live DB
-- matches the Prisma schema model exactly.

-- 1. Drop old foreign-key constraints that reference columns we are removing
ALTER TABLE "egg_breakage_adjustments"
  DROP CONSTRAINT IF EXISTS "egg_breakage_adjustments_sales_order_id_fkey";

ALTER TABLE "egg_breakage_adjustments"
  DROP CONSTRAINT IF EXISTS "egg_breakage_adjustments_customer_id_fkey";

ALTER TABLE "egg_breakage_adjustments"
  DROP CONSTRAINT IF EXISTS "egg_breakage_adjustments_reviewed_by_id_fkey";

-- 2. Drop old indexes that reference columns we are removing
DROP INDEX IF EXISTS "egg_breakage_adjustments_status_idx";
DROP INDEX IF EXISTS "egg_breakage_adjustments_sales_order_id_idx";

-- 3. Drop old columns (not present in current Prisma schema)
ALTER TABLE "egg_breakage_adjustments"
  DROP COLUMN IF EXISTS "grade",
  DROP COLUMN IF EXISTS "sales_order_id",
  DROP COLUMN IF EXISTS "customer_id",
  DROP COLUMN IF EXISTS "quantity_trays",
  DROP COLUMN IF EXISTS "quantity_eggs",
  DROP COLUMN IF EXISTS "unit_price_kes",
  DROP COLUMN IF EXISTS "total_value_kes",
  DROP COLUMN IF EXISTS "reason",
  DROP COLUMN IF EXISTS "status",
  DROP COLUMN IF EXISTS "review_notes",
  DROP COLUMN IF EXISTS "reviewed_by_id",
  DROP COLUMN IF EXISTS "reviewed_at";

-- 4. Add new columns (present in current Prisma schema, missing from live DB)
ALTER TABLE "egg_breakage_adjustments"
  ADD COLUMN IF NOT EXISTS "adjustment_type"               TEXT,
  ADD COLUMN IF NOT EXISTS "quantity_standard_before"      INTEGER,
  ADD COLUMN IF NOT EXISTS "quantity_starter_before"       INTEGER,
  ADD COLUMN IF NOT EXISTS "quantity_non_consumable_before" INTEGER,
  ADD COLUMN IF NOT EXISTS "quantity_consumable_before"    INTEGER,
  ADD COLUMN IF NOT EXISTS "new_non_consumable"            INTEGER,
  ADD COLUMN IF NOT EXISTS "new_consumable"                INTEGER,
  ADD COLUMN IF NOT EXISTS "quantity_diff"                 INTEGER,
  ADD COLUMN IF NOT EXISTS "tally_session_id"              TEXT;

-- 5. Back-fill NULLs on rows that existed before (if any) so we can add NOT NULL
UPDATE "egg_breakage_adjustments"
SET
  "adjustment_type"                = COALESCE("adjustment_type", 'NON_CONSUMABLE'),
  "quantity_standard_before"       = COALESCE("quantity_standard_before", 0),
  "quantity_starter_before"        = COALESCE("quantity_starter_before", 0),
  "quantity_non_consumable_before" = COALESCE("quantity_non_consumable_before", 0),
  "quantity_consumable_before"     = COALESCE("quantity_consumable_before", 0),
  "new_non_consumable"             = COALESCE("new_non_consumable", 0),
  "new_consumable"                 = COALESCE("new_consumable", 0),
  "quantity_diff"                  = COALESCE("quantity_diff", 0);

-- 6. Apply NOT NULL constraints now that all rows have values
ALTER TABLE "egg_breakage_adjustments"
  ALTER COLUMN "adjustment_type"                SET NOT NULL,
  ALTER COLUMN "quantity_standard_before"       SET NOT NULL,
  ALTER COLUMN "quantity_starter_before"        SET NOT NULL,
  ALTER COLUMN "quantity_non_consumable_before" SET NOT NULL,
  ALTER COLUMN "quantity_consumable_before"     SET NOT NULL,
  ALTER COLUMN "new_non_consumable"             SET NOT NULL,
  ALTER COLUMN "new_consumable"                 SET NOT NULL,
  ALTER COLUMN "quantity_diff"                  SET NOT NULL;

-- 7. Add new index on adjustment_type (matches Prisma schema @@index)
CREATE INDEX IF NOT EXISTS "egg_breakage_adjustments_adjustment_type_idx"
  ON "egg_breakage_adjustments"("adjustment_type");
