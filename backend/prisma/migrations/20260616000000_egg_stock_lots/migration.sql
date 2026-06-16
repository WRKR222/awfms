-- Migration: 20260616000000_egg_stock_lots
-- Adds a lightweight signal record so the frontend knows to re-fetch stock
-- when an invoice is paid. The actual stock calculation happens in the service.
-- Also adds sourceType column to EggBreakageAdjustment for traceability.

-- Track the source type of breakage (STANDARD egg broke vs CONSUMABLE broken egg destroyed)
ALTER TABLE "egg_breakage_adjustments"
  ADD COLUMN IF NOT EXISTS "source_type" TEXT NOT NULL DEFAULT 'STANDARD';

-- Index to speed up the FIFO lot query in getSalesStock
CREATE INDEX IF NOT EXISTS "idx_daily_egg_aggregates_date_asc"
  ON "daily_egg_aggregates" ("aggregate_date" ASC);
