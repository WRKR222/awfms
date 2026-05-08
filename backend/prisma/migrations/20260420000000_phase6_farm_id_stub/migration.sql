-- Phase 6 PW-04: Multi-location preparatory schema stub
-- Adds farm_id VARCHAR column with default 'anza-001' to core operational tables.
-- All existing rows automatically get 'anza-001' via the DEFAULT.
-- No data migration required. No foreign key to a farms table yet —
-- that constraint is added in the full multi-location phase.
-- This migration is additive-only and non-breaking.

ALTER TABLE "batches"
  ADD COLUMN IF NOT EXISTS "farm_id" VARCHAR(50) NOT NULL DEFAULT 'anza-001';

ALTER TABLE "customers"
  ADD COLUMN IF NOT EXISTS "farm_id" VARCHAR(50) NOT NULL DEFAULT 'anza-001';

ALTER TABLE "sales_orders"
  ADD COLUMN IF NOT EXISTS "farm_id" VARCHAR(50) NOT NULL DEFAULT 'anza-001';

ALTER TABLE "expense_logs"
  ADD COLUMN IF NOT EXISTS "farm_id" VARCHAR(50) NOT NULL DEFAULT 'anza-001';

-- Index farm_id on the most-queried tables for future multi-tenant queries
CREATE INDEX IF NOT EXISTS "batches_farm_id_idx"      ON "batches"      ("farm_id");
CREATE INDEX IF NOT EXISTS "customers_farm_id_idx"    ON "customers"    ("farm_id");
CREATE INDEX IF NOT EXISTS "sales_orders_farm_id_idx" ON "sales_orders" ("farm_id");
CREATE INDEX IF NOT EXISTS "expense_logs_farm_id_idx" ON "expense_logs" ("farm_id");
