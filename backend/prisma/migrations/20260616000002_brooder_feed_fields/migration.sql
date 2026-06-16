-- Migration: Add feed_type and feed_consumed_kg to brooder_logs
-- These fields exist in the frontend LogModal but were never persisted to the DB.

ALTER TABLE "brooder_logs"
  ADD COLUMN IF NOT EXISTS "feed_type"         TEXT,
  ADD COLUMN IF NOT EXISTS "feed_consumed_kg"  DOUBLE PRECISION;

-- Optional index for querying last feed entry per batch
CREATE INDEX IF NOT EXISTS "brooder_logs_batch_feed_idx"
  ON "brooder_logs"("batch_id", "log_date" DESC)
  WHERE "feed_type" IS NOT NULL;
