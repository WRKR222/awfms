-- ============================================================================
-- Migration: Feed lab tests (nutrient analysis entered by Store) — compared
-- with breed-guide nutrient targets by the breed-standards engine.
-- Idempotent.
-- ============================================================================
CREATE TABLE IF NOT EXISTS "feed_lab_tests" (
  "id"                TEXT NOT NULL,
  "store_item_id"     UUID NOT NULL,
  "feed_family"       TEXT,
  "stock_in_id"       TEXT,
  "lab_name"          TEXT,
  "sample_ref"        TEXT,
  "sample_date"       DATE NOT NULL,
  "result_date"       DATE,
  "effective_from"    DATE NOT NULL,
  "values"            JSONB NOT NULL,
  "reported_basis"    TEXT NOT NULL DEFAULT 'AS_FED',
  "report_file_name"  TEXT,
  "ai_interpretation" TEXT,
  "notes"             TEXT,
  "recorded_by_id"    TEXT NOT NULL,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3) NOT NULL,
  "deleted_at"        TIMESTAMP(3),
  CONSTRAINT "feed_lab_tests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "feed_lab_tests_store_item_id_effective_from_idx" ON "feed_lab_tests" ("store_item_id", "effective_from");
CREATE INDEX IF NOT EXISTS "feed_lab_tests_feed_family_effective_from_idx" ON "feed_lab_tests" ("feed_family", "effective_from");
DO $$ BEGIN
  ALTER TABLE "feed_lab_tests" ADD CONSTRAINT "feed_lab_tests_store_item_id_fkey"
    FOREIGN KEY ("store_item_id") REFERENCES "store_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
