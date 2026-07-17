-- ============================================================================
-- Migration: PM weekly item requisition (PM -> Store, folded into the
--            Issuance Plan). Adds pm_item_requisitions,
--            pm_item_requisition_items, the PMRequisitionStatus enum, and
--            three new NotificationType values.
-- Idempotent — safe to re-run on any environment.
-- ============================================================================

-- ── 1. New enum ──────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "PMRequisitionStatus" AS ENUM ('DRAFT', 'SUBMITTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2. NotificationType enum additions ─────────────────────────────────────────

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PM_REQUISITION_SUBMITTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PM_REQUISITION_EARLY_REMINDER';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PM_REQUISITION_DUE_REMINDER';

-- ── 3. pm_item_requisitions ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "pm_item_requisitions" (
  "id"              UUID                  PRIMARY KEY DEFAULT gen_random_uuid(),
  "requisition_ref" TEXT                  NOT NULL UNIQUE,
  "week_start_date" DATE                  NOT NULL,
  "week_end_date"   DATE                  NOT NULL,
  "status"          "PMRequisitionStatus" NOT NULL DEFAULT 'DRAFT',
  "notes"           TEXT,
  "submitted_at"    TIMESTAMPTZ,
  "created_by_id"   TEXT                  NOT NULL REFERENCES "users"("id"),
  "created_at"      TIMESTAMPTZ           NOT NULL DEFAULT now(),
  "updated_at"      TIMESTAMPTZ           NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "pm_item_requisitions_status_idx"
    ON "pm_item_requisitions"("status");
CREATE INDEX IF NOT EXISTS "pm_item_requisitions_week_start_date_idx"
    ON "pm_item_requisitions"("week_start_date");

-- ── 4. pm_item_requisition_items ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "pm_item_requisition_items" (
  "id"                     UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  "requisition_id"         UUID          NOT NULL
      REFERENCES "pm_item_requisitions"("id") ON DELETE CASCADE,
  "store_item_id"          UUID          NOT NULL REFERENCES "store_items"("id"),
  "quantity_needed"        NUMERIC(10,3) NOT NULL,
  "notes"                  TEXT,
  -- Set once this line has been folded into an IssuancePlan (WEEKLY, or an
  -- auto-created EMERGENCY draft if that week's weekly plan was already
  -- submitted). NULL = still needs a home.
  "issuance_plan_item_id"  UUID          UNIQUE REFERENCES "issuance_plan_items"("id")
);

CREATE INDEX IF NOT EXISTS "pm_item_requisition_items_requisition_id_idx"
    ON "pm_item_requisition_items"("requisition_id");
CREATE INDEX IF NOT EXISTS "pm_item_requisition_items_store_item_id_idx"
    ON "pm_item_requisition_items"("store_item_id");
