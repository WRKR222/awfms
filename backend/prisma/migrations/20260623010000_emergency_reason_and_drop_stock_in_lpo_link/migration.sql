-- ============================================================================
-- Migration: emergency_reason on issuance_plans  +  drop store_stock_ins.lpo_id
-- ----------------------------------------------------------------------------
-- 1. Emergency issuance plans must carry a mandatory justification. The
--    column was missing entirely, so the value the frontend collected was
--    silently dropped by the whitelist ValidationPipe and never enforced.
-- 2. Store Stock In is no longer linked back to a LocalPurchaseOrder/
--    PurchaseRequest — that coupling has been removed from the workflow.
--    Drop the FK column and its index.
-- 3. New NotificationType so Store gets a Saturday reminder (bell + cron)
--    to draft the weekly issuance plan, in addition to the dashboard banner.
-- ============================================================================

-- ── 1. issuance_plans.emergency_reason ─────────────────────────────────────────

ALTER TABLE "issuance_plans" ADD COLUMN IF NOT EXISTS "emergency_reason" TEXT;

-- ── 2. New NotificationType — Saturday weekly-plan reminder for Store ────────

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'WEEKLY_PLAN_REMINDER';

-- ── 3. store_stock_ins.lpo_id ──────────────────────────────────────────────────

ALTER TABLE "store_stock_ins" DROP CONSTRAINT IF EXISTS "store_stock_ins_lpo_id_fkey";
ALTER TABLE "store_stock_ins" DROP COLUMN IF EXISTS "lpo_id";
