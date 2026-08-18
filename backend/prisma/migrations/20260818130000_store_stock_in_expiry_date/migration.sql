-- ============================================================================
-- Migration: StoreStockIn.expiryDate
-- ----------------------------------------------------------------------------
-- Declared in schema.prisma (expiry_date, DATE) but never migrated onto the
-- deployed database. Same drift class as the bird-weight-sample fixes above.
-- Idempotent (IF NOT EXISTS).
-- ============================================================================

ALTER TABLE "store_stock_ins"
  ADD COLUMN IF NOT EXISTS "expiry_date" DATE;
