-- ============================================================================
-- Migration: fix weight-alert enum drift (NotificationType / ProductionReportDiscrepancyType)
--
-- Same drift class as 20260805000000_production_report_store_verified and
-- 20260818110000_weight_alert_enums_and_tables: schema.prisma and the
-- generated Prisma client already declare/query these enum values, but no
-- migration ever added them to the actual Postgres enums.
--
--   • NotificationType.WEIGHT_BELOW_STANDARD / WEIGHT_ABOVE_STANDARD
--     — referenced by WeightAlertService.evaluateWeightSample() every time
--     a bird-weight sample falls outside the HyLine band. Missing value
--     causes `22P02 invalid input value for enum "NotificationType"` on
--     notifications.createMany(), which currently fires on effectively
--     every production report / Farm Events weighing entry.
--
--   • ProductionReportDiscrepancyType.WEIGHT
--     — referenced by ProductionReportReconciliationService when a report
--     row's avgWeight is outside the HyLine band. Missing value causes the
--     same 22P02 error on productionReportDiscrepancy.createMany(), which
--     aborts ProductionReportService.submit() entirely (the whole
--     transaction rolls back — Store can no longer submit any production
--     report that includes a weight sample).
--
-- ALTER TYPE ... ADD VALUE cannot run inside the same transaction as a
-- statement that uses the new value, so each is left as its own top-level
-- statement (Prisma runs each migration.sql statement-by-statement in a
-- single migration transaction, but no other statement here depends on the
-- new values, so this is safe). Idempotent — safe to re-run on any
-- environment.
-- ============================================================================

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'WEIGHT_BELOW_STANDARD';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'WEIGHT_ABOVE_STANDARD';

ALTER TYPE "ProductionReportDiscrepancyType" ADD VALUE IF NOT EXISTS 'WEIGHT';
