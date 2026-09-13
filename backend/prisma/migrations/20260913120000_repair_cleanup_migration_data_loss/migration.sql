-- Migration: repair_cleanup_migration_data_loss
--
-- 20260509000001_cleanup was authored long ago (its own header says
-- "2025-05-08") to drop things that were obsolete AT THAT TIME. It never
-- successfully completed against any real database until today, because it
-- always failed earlier in the same transaction on a separate bug (a bare
-- DROP TYPE "EggGrade" with a live dependency — fixed by
-- 20260913000000_egg_collection_missed_notification's sibling commit adding
-- CASCADE to that statement). Because it never ran, its OTHER drop
-- statements sat dormant — but several of the things it drops were
-- reintroduced by later migrations / the current schema and are actively
-- used by current code:
--   - flock_daily_entries   (mortality/culling entry workflow)
--   - production_entries
--   - egg_price_tiers
--   - egg_collection_sessions.verified_by_id / verified_at /
--     store_signed_by_id / store_signed_at
--   - sales_orders.tier (+ the SalesTier enum type)
--
-- Fixing the CASCADE bug let this dormant migration finally run for the
-- first time today, which dropped all of the above for real, taking their
-- data with it (this table/column-level data cannot be recovered — Railway
-- Hobby plan has no backup/restore available). This migration re-creates
-- the structures current code and schema.prisma require, as EMPTY
-- structures, so the application stops erroring. It does not and cannot
-- restore the lost historical values.
--
-- Also included (harmless, additive, unrelated to the incident but
-- confirmed missing and required by current code found while diagnosing
-- this): sales_orders.delivered_at, sales_order_items.quantity_eggs,
-- and the daily_budgets table.

-- ── SalesTier enum + sales_orders/sales_order_items columns ────────────────
DO $$ BEGIN
  CREATE TYPE "SalesTier" AS ENUM ('TIER_1', 'TIER_2');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "sales_orders"
    ADD COLUMN IF NOT EXISTS "tier" "SalesTier" NOT NULL DEFAULT 'TIER_1',
    ADD COLUMN IF NOT EXISTS "delivered_at" TIMESTAMP(3);

ALTER TABLE "sales_order_items"
    ADD COLUMN IF NOT EXISTS "quantity_eggs" INTEGER;

-- ── egg_collection_sessions: re-add dropped verification columns ──────────
ALTER TABLE "egg_collection_sessions"
    ADD COLUMN IF NOT EXISTS "verified_by_id"     TEXT,
    ADD COLUMN IF NOT EXISTS "verified_at"        TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "store_signed_by_id" TEXT,
    ADD COLUMN IF NOT EXISTS "store_signed_at"    TIMESTAMP(3);

-- ── Recreate flock_daily_entries (data unrecoverable — table only) ────────
CREATE TABLE IF NOT EXISTS "flock_daily_entries" (
    "id"                  TEXT        NOT NULL,
    "batch_id"            TEXT        NOT NULL,
    "house_id"            TEXT        NOT NULL,
    "entry_date"          DATE        NOT NULL,
    "shift"               TEXT        NOT NULL DEFAULT 'AM',
    "opening_count"       INTEGER     NOT NULL,
    "mortality_count"     INTEGER     NOT NULL DEFAULT 0,
    "mortality_cause"     "MortalityCause",
    "culling_count"       INTEGER     NOT NULL DEFAULT 0,
    "culling_reason"      TEXT,
    "closing_count"       INTEGER     NOT NULL,
    "water_consumption_l" DECIMAL(8,2),
    "temperature_celsius" DECIMAL(4,1),
    "humidity_percent"    DECIMAL(4,1),
    "notes"               TEXT,
    "status"              "EntryStatus" NOT NULL DEFAULT 'PENDING',
    "submitted_by_id"     TEXT        NOT NULL,
    "approved_by_id"      TEXT,
    "approved_at"         TIMESTAMP(3),
    "return_reason"       TEXT,
    "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flock_daily_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "flock_daily_entries_batch_id_entry_date_idx"
    ON "flock_daily_entries"("batch_id", "entry_date");
CREATE INDEX IF NOT EXISTS "flock_daily_entries_status_idx"
    ON "flock_daily_entries"("status");
CREATE INDEX IF NOT EXISTS "flock_daily_entries_submitted_by_id_idx"
    ON "flock_daily_entries"("submitted_by_id");
CREATE UNIQUE INDEX IF NOT EXISTS "flock_daily_entries_batch_id_entry_date_shift_key"
    ON "flock_daily_entries"("batch_id", "entry_date", "shift");

DO $$ BEGIN
  ALTER TABLE "flock_daily_entries" ADD CONSTRAINT "flock_daily_entries_batch_id_fkey"
      FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "flock_daily_entries" ADD CONSTRAINT "flock_daily_entries_submitted_by_id_fkey"
      FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "flock_daily_entries" ADD CONSTRAINT "flock_daily_entries_approved_by_id_fkey"
      FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Recreate production_entries (data unrecoverable — table only) ─────────
CREATE TABLE IF NOT EXISTS "production_entries" (
    "id"               TEXT        NOT NULL,
    "batch_id"         TEXT        NOT NULL,
    "house_id"         TEXT        NOT NULL,
    "entry_date"       DATE        NOT NULL,
    "shift"            TEXT        NOT NULL DEFAULT 'AM',
    "eggs_small"       INTEGER     NOT NULL DEFAULT 0,
    "eggs_medium"      INTEGER     NOT NULL DEFAULT 0,
    "eggs_large"       INTEGER     NOT NULL DEFAULT 0,
    "eggs_extra_large" INTEGER     NOT NULL DEFAULT 0,
    "eggs_reject"      INTEGER     NOT NULL DEFAULT 0,
    "total_eggs"       INTEGER     NOT NULL,
    "hen_day_percent"  DECIMAL(5,2),
    "status"           "EntryStatus" NOT NULL DEFAULT 'PENDING',
    "notes"            TEXT,
    "submitted_by_id"  TEXT        NOT NULL,
    "approved_by_id"   TEXT,
    "approved_at"      TIMESTAMP(3),
    "return_reason"    TEXT,
    "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "production_entries_batch_id_entry_date_idx"
    ON "production_entries"("batch_id", "entry_date");
CREATE INDEX IF NOT EXISTS "production_entries_status_idx"
    ON "production_entries"("status");
CREATE UNIQUE INDEX IF NOT EXISTS "production_entries_batch_id_entry_date_shift_key"
    ON "production_entries"("batch_id", "entry_date", "shift");

DO $$ BEGIN
  ALTER TABLE "production_entries" ADD CONSTRAINT "production_entries_batch_id_fkey"
      FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "production_entries" ADD CONSTRAINT "production_entries_submitted_by_id_fkey"
      FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Recreate egg_price_tiers (data unrecoverable — table only) ────────────
CREATE TABLE IF NOT EXISTS "egg_price_tiers" (
    "id"             TEXT        NOT NULL,
    "tier"           "SalesTier" NOT NULL,
    "min_trays"      INTEGER     NOT NULL,
    "max_trays"      INTEGER,
    "price_per_tray" DECIMAL(10,2) NOT NULL,
    "is_active"      BOOLEAN     NOT NULL DEFAULT true,
    "effective_from" DATE        NOT NULL,
    "effective_to"   DATE,
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "egg_price_tiers_pkey" PRIMARY KEY ("id")
);

-- ── New table required by current schema (BudgetCategory), unrelated to
-- the incident but confirmed missing while diagnosing it — brand new,
-- no data ever existed, zero-risk to create.
DO $$ BEGIN
  CREATE TYPE "BudgetCategory" AS ENUM ('FEED', 'CHARCOAL', 'VACCINE', 'SUPPLEMENT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "daily_budgets" (
    "id"          TEXT        NOT NULL,
    "budget_date" DATE        NOT NULL,
    "category"    "BudgetCategory" NOT NULL,
    "amount_kes"  DECIMAL(12,2) NOT NULL,
    "notes"       TEXT,
    "set_by_id"   TEXT        NOT NULL,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_budgets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "daily_budgets_budget_date_idx"
    ON "daily_budgets"("budget_date");
CREATE UNIQUE INDEX IF NOT EXISTS "daily_budgets_budget_date_category_key"
    ON "daily_budgets"("budget_date", "category");
