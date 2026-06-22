-- ============================================================================
-- Migration: add missing NotificationType enum values
-- ----------------------------------------------------------------------------
-- These three values exist in schema.prisma but were never added to the DB
-- enum. Each one causes a 500 the moment a code path that uses it is hit:
--
--   ISSUANCE_PLAN_ACCOUNTANT_APPROVED  — fired on every accountant item approval
--   ISSUANCE_PLAN_PENDING_REMINDER     — fired by the issuance-plan cron job
--   FEED_ISSUANCE_DAILY_ALERT          — fired by the daily feed-issuance cron
-- ============================================================================

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ISSUANCE_PLAN_ACCOUNTANT_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ISSUANCE_PLAN_PENDING_REMINDER';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'FEED_ISSUANCE_DAILY_ALERT';
