-- Migration: 20260728000000_brooder_stock_count
--
-- Context:
--   The farm's paper daily record sheet carries an Opening Stock / Closing
--   Stock pair for every day, alongside mortality. Opening stock normally
--   just carries forward as the previous day's closing stock, but the farm
--   sometimes performs a physical bird count that finds FEWER birds than
--   expected — a shrinkage the mortality log alone doesn't explain. This
--   migration adds a dedicated table to capture that reconciliation and
--   flag the mismatch for Manager/Owner visibility, without blocking the
--   attendant's save.

CREATE TABLE IF NOT EXISTS "brooder_stock_counts" (
  "id"                     TEXT      NOT NULL DEFAULT gen_random_uuid()::text,
  "batch_id"               TEXT      NOT NULL REFERENCES "batches"("id"),
  "log_date"               DATE      NOT NULL,
  "opening_stock"          INTEGER   NOT NULL,
  "expected_opening_stock" INTEGER,
  "variance"               INTEGER   NOT NULL DEFAULT 0,
  "variance_reason"        TEXT,
  "mortality_count"        INTEGER   NOT NULL DEFAULT 0,
  "culling_count"          INTEGER   NOT NULL DEFAULT 0,
  "closing_stock"          INTEGER   NOT NULL,
  "notes"                  TEXT,
  "logged_by_id"           TEXT      NOT NULL REFERENCES "users"("id"),
  "created_at"             TIMESTAMP NOT NULL DEFAULT now(),
  "updated_at"             TIMESTAMP NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "brooder_stock_counts_batch_id_log_date_key" UNIQUE ("batch_id", "log_date")
);

CREATE INDEX IF NOT EXISTS "brooder_stock_counts_batch_id_log_date_idx"
  ON "brooder_stock_counts"("batch_id", "log_date");

COMMENT ON TABLE "brooder_stock_counts" IS
  'Whole-batch opening/closing stock reconciliation, one row per (batch, log_date). Flags variance when a physical bird count (opening_stock) does not match the previous day''s closing_stock.';

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'BROODER_STOCK_MISMATCH';
