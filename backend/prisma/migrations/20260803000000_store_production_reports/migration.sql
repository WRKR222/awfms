-- ============================================================================
-- Migration: Store Production Report verification
--
-- Stores upload a day-by-day production report for a batch (feed, mortality,
-- opening/closing stock, items issued e.g. charcoal/drugs). Every field is
-- cross-checked against whatever the attendant already recorded:
--   • nothing recorded yet   -> applied immediately (autofill), no approval needed
--   • recorded and matches   -> no-op
--   • recorded and CONFLICTS -> held back and flagged for the Director
-- Only ONE current report is kept per batch — re-uploading replaces it.
-- Idempotent — safe to re-run on any environment.
-- ============================================================================

-- ── 1. New enums ─────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "StoreProductionReportStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ProductionReportDiscrepancyType" AS ENUM ('MORTALITY', 'FEED', 'STOCK_COUNT', 'ITEM_ISSUANCE', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2. NotificationType enum additions ───────────────────────────────────────

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PRODUCTION_REPORT_SUBMITTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PRODUCTION_REPORT_DISCREPANCY';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PRODUCTION_REPORT_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PRODUCTION_REPORT_REJECTED';

-- ── 3. store_production_reports ──────────────────────────────────────────────
-- One row per batch (unique batch_id) — re-uploading replaces this row rather
-- than creating a new one.

CREATE TABLE IF NOT EXISTS "store_production_reports" (
  "id"                   TEXT                          NOT NULL DEFAULT gen_random_uuid()::text,
  "batch_id"             TEXT                          NOT NULL UNIQUE REFERENCES "batches"("id"),
  "file_name"            TEXT                          NOT NULL,
  "column_mapping"       JSONB                         NOT NULL,
  "raw_rows"             JSONB                         NOT NULL,
  "status"               "StoreProductionReportStatus" NOT NULL DEFAULT 'PENDING',
  "discrepancy_count"    INTEGER                       NOT NULL DEFAULT 0,
  "autofill_count"       INTEGER                       NOT NULL DEFAULT 0,
  "matched_count"        INTEGER                       NOT NULL DEFAULT 0,
  "resubmission_count"   INTEGER                       NOT NULL DEFAULT 0,
  "uploaded_by_id"       TEXT                          NOT NULL REFERENCES "users"("id"),
  "uploaded_at"          TIMESTAMP                     NOT NULL DEFAULT now(),
  "reviewed_by_id"       TEXT                          REFERENCES "users"("id"),
  "reviewed_at"          TIMESTAMP,
  "rejection_reason"     TEXT,
  "applied_at"           TIMESTAMP,
  "created_at"           TIMESTAMP                     NOT NULL DEFAULT now(),
  "updated_at"           TIMESTAMP                     NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "store_production_reports_status_idx"
  ON "store_production_reports"("status");

COMMENT ON TABLE "store_production_reports" IS
  'Current store production report per batch (one row per batch_id, replaced on re-upload). Auto-applies to the system unless a field conflicts with existing attendant-recorded data, in which case it is held as a discrepancy pending Director review.';

-- ── 4. production_report_discrepancies ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS "production_report_discrepancies" (
  "id"                TEXT                              NOT NULL DEFAULT gen_random_uuid()::text,
  "report_id"         TEXT                              NOT NULL
      REFERENCES "store_production_reports"("id") ON DELETE CASCADE,
  "row_date"          DATE                              NOT NULL,
  "field"             TEXT                              NOT NULL,
  "discrepancy_type"  "ProductionReportDiscrepancyType" NOT NULL,
  "location_ref"      TEXT,
  "system_value"      TEXT,
  "report_value"      TEXT,
  "notes"             TEXT,
  "resolved"          BOOLEAN                           NOT NULL DEFAULT false,
  "resolution"        TEXT,
  "resolved_by_id"    TEXT                              REFERENCES "users"("id"),
  "resolved_at"       TIMESTAMP,
  "created_at"        TIMESTAMP                         NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "production_report_discrepancies_report_id_idx"
  ON "production_report_discrepancies"("report_id");
CREATE INDEX IF NOT EXISTS "production_report_discrepancies_row_date_idx"
  ON "production_report_discrepancies"("row_date");

COMMENT ON TABLE "production_report_discrepancies" IS
  'Flagged mismatches between the current store production report and system-recorded data. Recomputed (deleted + recreated) every time the report is reprocessed, so this only ever reflects the CURRENT report.';
