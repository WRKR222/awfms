-- Migration: Split FEED_SUPPLEMENT into FEED and SUPPLEMENT
-- Adds two new enum values to StoreItemCategory and migrates existing records.

-- Step 1: Add FEED and SUPPLEMENT to the existing enum
ALTER TYPE "StoreItemCategory" ADD VALUE IF NOT EXISTS 'FEED';
ALTER TYPE "StoreItemCategory" ADD VALUE IF NOT EXISTS 'SUPPLEMENT';

-- Step 2: Migrate all existing FEED_SUPPLEMENT rows to FEED by default.
-- Store staff can re-classify supplement items individually via the edit form.
UPDATE "store_items"
SET "category" = 'FEED'
WHERE "category" = 'FEED_SUPPLEMENT';
