-- ============================================================================
-- Migration: Brooder Log Session Uniqueness
-- ----------------------------------------------------------------------------
-- Enforces the two-tier logging contract at the database level:
--
--   TIER 1 — SESSION LOG (temperature / humidity / light_intensity)
--     • log_session IS NOT NULL (MORNING | MIDDAY | EVENING)
--     • Unique per (batch_id, log_date, log_session)
--     • Up to 3 records per batch per day
--
--   TIER 2 — ONCE-DAILY LOG (water / vaccine / supplement)
--     • log_session IS NULL
--     • Unique per (batch_id, log_date)
--     • Exactly 1 record per batch per day
--
-- Both indexes are PARTIAL so they don't interfere with each other and
-- are idempotent (CREATE UNIQUE INDEX IF NOT EXISTS).
-- ============================================================================

-- Index 1: one session log per (batch, date, session)
CREATE UNIQUE INDEX IF NOT EXISTS "brooder_logs_batch_date_session_uidx"
  ON "brooder_logs" ("batch_id", "log_date", "log_session")
  WHERE "log_session" IS NOT NULL;

-- Index 2: one once-daily log per (batch, date)
CREATE UNIQUE INDEX IF NOT EXISTS "brooder_logs_batch_date_daily_uidx"
  ON "brooder_logs" ("batch_id", "log_date")
  WHERE "log_session" IS NULL;
