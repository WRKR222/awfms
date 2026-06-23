-- ============================================================
-- Migration: Split FEED_SUPPLEMENT → FEED + SUPPLEMENT
-- Strategy: CREATE new enum type → ALTER TABLE → rename/drop
--   This pattern works inside a Prisma-managed transaction and
--   is compatible with all PostgreSQL versions supported by this
--   project. It matches the pattern used in 20260402194553.
-- ============================================================

-- Step 1: Create the new enum with FEED and SUPPLEMENT added
CREATE TYPE "StoreItemCategory_new" AS ENUM (
  'MEDICATION',
  'EQUIPMENT',
  'FEED',
  'SUPPLEMENT',
  'FEED_SUPPLEMENT',
  'PACKAGING',
  'CLEANING',
  'SAFETY',
  'OTHER'
);

-- Step 2: Migrate store_items.category to the new type.
--   Existing FEED_SUPPLEMENT rows are mapped to FEED by default.
--   Store staff can reclassify individual supplement items via the
--   edit form in the Inventory > Items tab after the migration.
ALTER TABLE "store_items"
  ALTER COLUMN "category" TYPE "StoreItemCategory_new"
  USING (
    CASE "category"::text
      WHEN 'FEED_SUPPLEMENT' THEN 'FEED'::"StoreItemCategory_new"
      ELSE "category"::text::"StoreItemCategory_new"
    END
  );

-- Step 3: Swap the enum name
ALTER TYPE "StoreItemCategory" RENAME TO "StoreItemCategory_old";
ALTER TYPE "StoreItemCategory_new" RENAME TO "StoreItemCategory";

-- Step 4: Drop the obsolete type
DROP TYPE "StoreItemCategory_old";
