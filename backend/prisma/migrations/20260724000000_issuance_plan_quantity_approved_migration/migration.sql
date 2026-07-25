-- Adds the Director's actually-approved quantity, separate from the
-- originally requested quantity (quantity_planned) and the running total
-- actually issued (quantity_issued). Nullable: existing rows and any item
-- not yet approved simply have no value here.
ALTER TABLE "issuance_plan_items"
  ADD COLUMN "quantity_approved" DECIMAL(10,3);

-- Backfill: for line items that are already APPROVED, assume (as a
-- best-effort default) that what was approved equals what was requested,
-- since there's no historical record of a different value. This only
-- affects rows written before this migration.
UPDATE "issuance_plan_items"
SET "quantity_approved" = "quantity_planned"
WHERE "status" = 'APPROVED' AND "quantity_approved" IS NULL;
