-- Migration: egg_collection_missed_notification
--
-- Adds the NotificationType value for EggCollectionMissedCron
-- (backend/src/modules/production/egg-collection-missed.cron.ts), which
-- fires shortly after each of the AM (noon) / PM (4:30pm) egg collection
-- cutoffs (see egg-collection-session-window.util.ts) closes for the day
-- and tells the Director about any active production-stage batch that
-- still has no session for that shift.
--
-- ALTER TYPE ... ADD VALUE cannot run in the same transaction as a statement
-- that uses the new value — left as its own top-level statement, same as
-- every other enum-value addition in this migrations folder.

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'EGG_COLLECTION_SESSION_MISSED';
