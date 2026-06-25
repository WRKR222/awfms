-- ============================================================================
-- Migration: Brooder Daily Log v2
-- ----------------------------------------------------------------------------
-- 1. Extends brooder_logs with session (MORNING/MIDDAY/EVENING), humidity,
--    light intensity, vaccine dose, supplement dose fields.
--    Removes feed & mortality from brooder_logs (both now tracked elsewhere:
--    feed → brooder_level_feed_logs, mortality → brooder_level_mortality_logs).
-- 2. Adds brooder_treatment_logs for drug administration with dose + row/level.
-- 3. All DDL is idempotent (IF NOT EXISTS / DO $$ BEGIN ... END $$).
-- ============================================================================

-- 1. Log-session enum
DO $$ BEGIN
  CREATE TYPE "BrooderLogSession" AS ENUM ('MORNING', 'MIDDAY', 'EVENING');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- 2. Extend brooder_logs
ALTER TABLE "brooder_logs"
  ADD COLUMN IF NOT EXISTS "log_session"        "BrooderLogSession",
  ADD COLUMN IF NOT EXISTS "humidity_percent"   DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "light_intensity_lux" INTEGER,
  ADD COLUMN IF NOT EXISTS "vaccine_dose"       TEXT,
  ADD COLUMN IF NOT EXISTS "supplement_dose"    TEXT;

-- 3. New table: brooder_treatment_logs
CREATE TABLE IF NOT EXISTS "brooder_treatment_logs" (
  "id"              TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "batch_id"        TEXT        NOT NULL REFERENCES "batches"("id"),
  "row_id"          TEXT        REFERENCES "brooder_rows"("id"),
  "level_id"        TEXT        REFERENCES "brooder_levels"("id"),
  "treatment_date"  DATE        NOT NULL,
  "drug_name"       TEXT        NOT NULL,
  "dose"            TEXT        NOT NULL,
  "dose_unit"       TEXT        NOT NULL DEFAULT 'ml',
  "route"           TEXT        NOT NULL DEFAULT 'DRINKING_WATER',
  "duration_days"   INTEGER,
  "notes"           TEXT,
  "logged_by_id"    TEXT        NOT NULL REFERENCES "users"("id"),
  "created_at"      TIMESTAMP   NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "brooder_treatment_logs_batch_id_idx"
  ON "brooder_treatment_logs"("batch_id");
CREATE INDEX IF NOT EXISTS "brooder_treatment_logs_treatment_date_idx"
  ON "brooder_treatment_logs"("treatment_date");
