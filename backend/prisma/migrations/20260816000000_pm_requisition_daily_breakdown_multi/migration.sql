-- ============================================================================
-- Migration: PM item requisition — day-specific quantities + notification
--            type for cascade-delete of an already-submitted line.
--
-- No schema change was needed to allow multiple requisition submissions per
-- week — that was purely an application-level guard in PMRequisitionService,
-- removed there. This migration only adds the new column and enum value.
-- Idempotent — safe to re-run on any environment.
-- ============================================================================

-- ── 1. Day-specific breakdown on each requisition line ─────────────────────

ALTER TABLE "pm_item_requisition_items"
  ADD COLUMN IF NOT EXISTS "daily_breakdown" JSONB;

-- ── 2. New notification type for cascade-delete of a submitted line ────────

DO $$ BEGIN
  ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PM_REQUISITION_ITEM_REMOVED';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
