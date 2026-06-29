-- ============================================================================
-- Migration: Issuance Plan — Director-only approval + Thursday early reminder
-- ----------------------------------------------------------------------------
-- Changes:
--   1. Add WEEKLY_PLAN_EARLY_REMINDER to NotificationType enum (Thursday nudge)
--   2. Migrate any existing PENDING_ACCOUNTANT items → PENDING_DIRECTOR so the
--      current in-flight plan is not lost; the Accountant step is removed from
--      the workflow going forward.
--   3. Sync plan phase: any plan whose items are now all PENDING_DIRECTOR gets
--      its phase updated from PENDING_ACCOUNTANT → PENDING_DIRECTOR.
-- ============================================================================

-- 1. New notification type for the Thursday early reminder
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'WEEKLY_PLAN_EARLY_REMINDER';

-- 2. Migrate existing in-flight items that are still waiting for the Accountant
--    → move them straight to PENDING_DIRECTOR (Accountant step no longer exists).
--    Items that are already PENDING_DIRECTOR, APPROVED, or REJECTED are untouched.
UPDATE "issuance_plan_items"
SET    "status" = 'PENDING_DIRECTOR'
WHERE  "status" = 'PENDING_ACCOUNTANT';

-- 3. Sync the plan-level phase for any plans that are still sitting at
--    PENDING_ACCOUNTANT — they should now read PENDING_DIRECTOR.
UPDATE "issuance_plans"
SET    "phase" = 'PENDING_DIRECTOR'
WHERE  "phase" = 'PENDING_ACCOUNTANT';
