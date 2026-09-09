-- Migration: brooder_log_missed_notification
--
-- Adds the NotificationType value for BrooderMissedLogCron
-- (backend/src/modules/brooder/brooder-missed-log.cron.ts), which fires
-- shortly after each of the 3 attendant daily-log popups (Morning/11am/3pm —
-- see BROODER_SESSION_WINDOWS) closes for the day and tells the Director
-- about any active brooder batch that still has no log for that popup.
--
-- ALTER TYPE ... ADD VALUE cannot run in the same transaction as a statement
-- that uses the new value — left as its own top-level statement, same as
-- every other enum-value addition in this migrations folder.

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'BROODER_LOG_MISSED';
