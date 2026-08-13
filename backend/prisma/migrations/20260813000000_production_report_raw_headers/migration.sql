-- ============================================================================
-- Migration: production report raw column order
--
-- StoreProductionReport.raw_rows is jsonb. Postgres jsonb explicitly does
-- NOT preserve object key order (see https://www.postgresql.org/docs/current/datatype-json.html
-- — "jsonb does not preserve ... the order of object keys"). The frontend's
-- ProductionReportTable was deriving the table's column order from
-- Object.keys(row.raw) on rows pulled back out of raw_rows, so a report's
-- columns could render in a different order than the uploaded sheet once
-- it had round-tripped through the database (Store's fresh pre-save preview
-- was unaffected since it never touched jsonb).
--
-- raw_headers is a native Postgres text array, which DOES preserve
-- insertion order, and now carries the exact original column order
-- alongside raw_rows so the table can render deterministically regardless
-- of how jsonb chose to store the row objects.
--
-- Existing reports get an empty array (backfilling the true order isn't
-- possible after the fact, since it was never persisted) — ReportTable
-- falls back to the old Object.keys()-based derivation for any report with
-- an empty raw_headers, so older reports keep rendering rather than
-- breaking, they just aren't guaranteed to match original column order.
-- Idempotent — safe to re-run on any environment.
-- ============================================================================

ALTER TABLE "store_production_reports"
  ADD COLUMN IF NOT EXISTS "raw_headers" TEXT[] NOT NULL DEFAULT '{}';
