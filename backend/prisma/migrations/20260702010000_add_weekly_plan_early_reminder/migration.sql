-- Migration: 20260702010000_add_weekly_plan_early_reminder
--
-- Fixes a pre-existing bug: IssuancePlanService.sendEarlyWeeklyPlanReminder()
-- referenced NotificationType.WEEKLY_PLAN_EARLY_REMINDER, but that value was
-- never added to the enum (only WEEKLY_PLAN_REMINDER existed), which failed
-- TypeScript compilation (`nest build`) once the `as any` cast masking it
-- was removed.

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'WEEKLY_PLAN_EARLY_REMINDER';
