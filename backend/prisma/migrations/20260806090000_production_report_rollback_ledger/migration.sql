-- ============================================================================
-- Migration: Production report applied-change ledger + rollback support
--
-- Fixes reported by Store/Director:
--   • Re-uploading / re-processing a production report created duplicate
--     daily records (e.g. a vaccine/supplement already logged got appended
--     again into the same day's JSON array) instead of correcting the
--     existing one.
--   • There was no reliable way to undo what a report upload had written —
--     "notes" text search is not safe enough for a real rollback.
--
-- This migration adds an append-only ledger (production_report_applied_
-- changes) that records every CREATE / UPDATE / JSON_APPEND the
-- reconciliation engine performs, in the same transaction as the mutation
-- itself, so a report's effects can always be traced and reversed.
-- Idempotent — safe to re-run on any environment.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "production_report_applied_changes" (
  "id"                TEXT      NOT NULL DEFAULT gen_random_uuid()::text,
  "report_id"         TEXT      NOT NULL REFERENCES "store_production_reports"("id") ON DELETE CASCADE,
  "batch_id"          TEXT      NOT NULL,
  "row_date"          DATE,
  "entity_type"       TEXT      NOT NULL,
  "entity_id"         TEXT,
  "action"            TEXT      NOT NULL,
  "before_state"      JSONB,
  "after_state"       JSONB,
  "rolled_back"        BOOLEAN   NOT NULL DEFAULT false,
  "rolled_back_at"     TIMESTAMP,
  "rolled_back_by_id"  TEXT,
  "created_at"        TIMESTAMP NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "production_report_applied_changes_report_id_idx"
  ON "production_report_applied_changes"("report_id");
CREATE INDEX IF NOT EXISTS "production_report_applied_changes_batch_id_idx"
  ON "production_report_applied_changes"("batch_id");
CREATE INDEX IF NOT EXISTS "production_report_applied_changes_report_id_rolled_back_idx"
  ON "production_report_applied_changes"("report_id", "rolled_back");

COMMENT ON TABLE "production_report_applied_changes" IS
  'Append-only ledger of every write a production-report upload made — CREATE rows are deleted on rollback, UPDATE rows are restored to before_state, JSON_APPEND entries are removed from the JSON array they were appended to. Written in the same transaction as the mutation it describes.';

ALTER TABLE "store_production_reports"
  ADD COLUMN IF NOT EXISTS "rolled_back_at" TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "rolled_back_by_id" TEXT;
