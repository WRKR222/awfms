-- Migration: phase8_batch_lifecycle_fields
-- Adds SOLD/DISCARDED to BatchStage enum, lifecycle timestamps to batches,
-- issuedToName to store_stock_outs, finalStarterEggs to egg_tally_verifications.

-- 1. Extend BatchStage enum
ALTER TYPE "BatchStage" ADD VALUE IF NOT EXISTS 'SOLD';
ALTER TYPE "BatchStage" ADD VALUE IF NOT EXISTS 'DISCARDED';

-- 2. Add lifecycle timestamp columns to batches
ALTER TABLE "batches"
  ADD COLUMN IF NOT EXISTS "sold_at"       TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "discarded_at"  TIMESTAMP;

-- 3. Add issued_to_name to store_stock_outs (GAP-04)
ALTER TABLE "store_stock_outs"
  ADD COLUMN IF NOT EXISTS "issued_to_name" TEXT;

-- 4. Add final_starter_eggs to egg_tally_verifications
ALTER TABLE "egg_tally_verifications"
  ADD COLUMN IF NOT EXISTS "final_starter_eggs" INTEGER;
