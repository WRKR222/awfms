-- ============================================================================
-- Migration: fix store_production_reports drift
--
-- The original 20260803000000_store_production_reports migration created the
-- table and enum without two columns/one enum value that schema.prisma and
-- the application code already expect:
--   • store_production_reports.store_verified_by_id / store_verified_at
--     (Store's own confirmation, set inside submit() and selected via the
--     storeVerifiedBy relation on every GET :batchId) — missing column causes
--     a Postgres "column does not exist" error, surfacing as a 500 on both
--     the submit endpoint and the plain GET.
--   • ProductionReportDiscrepancyType.CAGE_REASSIGNMENT — referenced by
--     production-report-reconciliation.service.ts but never added to the
--     Postgres enum, so any report with a per-cage headcount row fails the
--     same way.
-- Idempotent — safe to re-run on any environment.
-- ============================================================================

ALTER TYPE "ProductionReportDiscrepancyType" ADD VALUE IF NOT EXISTS 'CAGE_REASSIGNMENT';

ALTER TABLE "store_production_reports"
  ADD COLUMN IF NOT EXISTS "store_verified_by_id" TEXT REFERENCES "users"("id"),
  ADD COLUMN IF NOT EXISTS "store_verified_at" TIMESTAMP;
