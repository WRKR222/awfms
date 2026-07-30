-- ============================================================================
-- Migration: let PM requisition lines request an item that isn't in the
--            Store catalog. Adds custom_item_name / custom_item_unit,
--            relaxes store_item_id to nullable, and enforces that exactly
--            one of (store_item_id, custom_item_name) is set.
-- Idempotent — safe to re-run on any environment.
-- ============================================================================

-- ── 1. New columns ───────────────────────────────────────────────────────────

ALTER TABLE "pm_item_requisition_items"
  ADD COLUMN IF NOT EXISTS "custom_item_name" TEXT,
  ADD COLUMN IF NOT EXISTS "custom_item_unit" TEXT;

-- ── 2. Relax store_item_id to nullable ─────────────────────────────────────────

ALTER TABLE "pm_item_requisition_items"
  ALTER COLUMN "store_item_id" DROP NOT NULL;

-- ── 3. Guard: exactly one of store_item_id / custom_item_name must be set ──────

DO $$ BEGIN
  ALTER TABLE "pm_item_requisition_items"
    ADD CONSTRAINT "pm_item_requisition_items_item_ref_check"
    CHECK (
      ("store_item_id" IS NOT NULL AND "custom_item_name" IS NULL)
      OR
      ("store_item_id" IS NULL AND "custom_item_name" IS NOT NULL)
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
