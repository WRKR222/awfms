-- ============================================================================
-- Migration: Auto-record temperature/humidity/lux from production reports
--
-- Fixes: the report parser already had scaffolding to read up to 3 same-day
-- environmental readings (morning/midday/evening), but (a) it only handled
-- sheets with a SEPARATE column per reading — not the far more common case
-- here, a single cell like "32,31,30" holding all of a day's readings
-- comma-separated — and (b) nothing in the reconciliation engine ever wrote
-- ANY of it into brooder_logs. Both are fixed in the accompanying code
-- change; this migration just adds the new discrepancy type that lets a
-- genuine mismatch (report disagrees with an already-logged reading) be
-- surfaced to a Director instead of silently overwritten.
-- Idempotent — safe to re-run on any environment.
-- ============================================================================

ALTER TYPE "ProductionReportDiscrepancyType" ADD VALUE IF NOT EXISTS 'ENVIRONMENTAL';
