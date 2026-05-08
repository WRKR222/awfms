-- V4 Migration: BrooderLog, Batch location, Starter/Broken egg pricing
-- NOTE: SECURITY1/SECURITY2 already handled by previous migration

-- 1. Add location field to Batch table
ALTER TABLE "batches" ADD COLUMN IF NOT EXISTS "location" TEXT NOT NULL DEFAULT 'PRODUCTION_HOUSE';

-- 2. Add starter and broken egg price fields to DailyEggPrice
ALTER TABLE "daily_egg_prices" ADD COLUMN IF NOT EXISTS "price_per_egg_starter" DECIMAL(8,4);
ALTER TABLE "daily_egg_prices" ADD COLUMN IF NOT EXISTS "price_per_egg_broken" DECIMAL(8,4);

-- 3. Create BrooderLog table
CREATE TABLE IF NOT EXISTS "brooder_logs" (
  "id"                  TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "batch_id"            TEXT NOT NULL,
  "log_date"            DATE NOT NULL,
  "water_consumption_l" DOUBLE PRECISION,
  "temperature"         DOUBLE PRECISION,
  "lighting_ok"         BOOLEAN NOT NULL DEFAULT true,
  "mortality_count"     INTEGER NOT NULL DEFAULT 0,
  "vaccine_given"       TEXT,
  "supplement"          TEXT,
  "notes"               TEXT,
  "logged_by_id"        TEXT NOT NULL,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "brooder_logs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "brooder_logs_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "brooder_logs_logged_by_id_fkey" FOREIGN KEY ("logged_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "brooder_logs_batch_id_log_date_idx" ON "brooder_logs"("batch_id", "log_date");