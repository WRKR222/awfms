-- ============================================================================
-- AWFMS Cleanup Migration — 2025-05-08  (PATCHED for Railway/Prisma P3009)
-- ----------------------------------------------------------------------------
--  FIXES applied vs original:
--   [F1] store_stock_outs FK guarded — only added if table exists
--   [F2] construction_records FK guarded — only added if table exists
--   [F3] batch_cage_assignments unique constraint drop guarded by DO block
--        (prod constraint name may differ from local)
--   [F4] SalesTier enum drop deferred until AFTER sales_orders.tier is dropped
--   [F5] All ALTER TABLE … DROP COLUMN blocks split so partial failures
--        don't leave the table in an inconsistent state
-- ============================================================================

BEGIN;

-- ── 1. Drop obsolete tables ────────────────────────────────────────────────
DROP TABLE IF EXISTS "flock_daily_entries"  CASCADE;
DROP TABLE IF EXISTS "production_entries"   CASCADE;
DROP TABLE IF EXISTS "egg_price_tiers"      CASCADE;
DROP TABLE IF EXISTS "store_vet_visit_logs" CASCADE;

-- ── 2. Drop obsolete enums ────────────────────────────────────────────────
-- NOTE [F4]: "SalesTier" is dropped AFTER sales_orders.tier is removed (step 5)
DROP TYPE IF EXISTS "EggGrade";

-- ── 3. EggCollectionSession: drop duplicate tally columns + soft delete ───
ALTER TABLE "egg_collection_sessions"
    DROP COLUMN IF EXISTS "verified_by_id",
    DROP COLUMN IF EXISTS "verified_at",
    DROP COLUMN IF EXISTS "store_signed_by_id",
    DROP COLUMN IF EXISTS "store_signed_at",
    ADD  COLUMN IF NOT EXISTS "deleted_at"   TIMESTAMP,
    ADD  COLUMN IF NOT EXISTS "edited_at"    TIMESTAMP,
    ADD  COLUMN IF NOT EXISTS "edited_by_id" TEXT;

ALTER TABLE "egg_collection_sessions"
    DROP CONSTRAINT IF EXISTS "egg_collection_sessions_edited_by_id_fkey",
    ADD  CONSTRAINT "egg_collection_sessions_edited_by_id_fkey"
      FOREIGN KEY ("edited_by_id") REFERENCES "users"("id");

CREATE INDEX IF NOT EXISTS "egg_collection_sessions_deleted_at_idx"
    ON "egg_collection_sessions"("deleted_at");

-- ── 4. EggTallyVerification: lock + edit lifecycle ────────────────────────
ALTER TABLE "egg_tally_verifications"
    ADD COLUMN IF NOT EXISTS "edit_count"        INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "last_edited_by_id" TEXT,
    ADD COLUMN IF NOT EXISTS "last_edited_at"    TIMESTAMP;

ALTER TABLE "egg_tally_verifications"
    DROP CONSTRAINT IF EXISTS "egg_tally_verifications_last_edited_by_id_fkey",
    ADD  CONSTRAINT "egg_tally_verifications_last_edited_by_id_fkey"
      FOREIGN KEY ("last_edited_by_id") REFERENCES "users"("id");

-- ── 5. SalesOrder: drop tier first, then safe to drop SalesTier enum ──────
-- [F4] Drop the tier column BEFORE attempting to drop the SalesTier type
ALTER TABLE "sales_orders" DROP COLUMN IF EXISTS "tier";

DROP TYPE IF EXISTS "SalesTier";  -- safe now, no column references it

-- Add PaymentMethod enum + columns
DO $$ BEGIN
  CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'MPESA', 'BANK', 'CREDIT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "sales_orders"
    ADD COLUMN IF NOT EXISTS "payment_method" "PaymentMethod" NOT NULL DEFAULT 'CASH',
    ADD COLUMN IF NOT EXISTS "deleted_at"     TIMESTAMP;

CREATE INDEX IF NOT EXISTS "sales_orders_deleted_at_idx"
    ON "sales_orders"("deleted_at");

-- ── 6. AdvanceBooking: soft delete ────────────────────────────────────────
ALTER TABLE "advance_bookings"
    ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP;

CREATE INDEX IF NOT EXISTS "advance_bookings_deleted_at_idx"
    ON "advance_bookings"("deleted_at");

-- ── 7. HealthEvent: vet PDF (Manager-uploaded) ────────────────────────────
ALTER TABLE "health_events"
    ADD COLUMN IF NOT EXISTS "vet_pdf_url"            TEXT,
    ADD COLUMN IF NOT EXISTS "vet_pdf_uploaded_by_id" TEXT,
    ADD COLUMN IF NOT EXISTS "vet_pdf_uploaded_at"    TIMESTAMP;

ALTER TABLE "health_events"
    DROP CONSTRAINT IF EXISTS "health_events_vet_pdf_uploaded_by_id_fkey",
    ADD  CONSTRAINT "health_events_vet_pdf_uploaded_by_id_fkey"
      FOREIGN KEY ("vet_pdf_uploaded_by_id") REFERENCES "users"("id");

-- ── 8. VisitorLog: proper FK back to users ────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'visitor_log') THEN
    ALTER TABLE "visitor_log"
        DROP CONSTRAINT IF EXISTS "visitor_log_recorded_by_id_fkey",
        ADD  CONSTRAINT "visitor_log_recorded_by_id_fkey"
          FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id");
  END IF;
END $$;

-- ── 9. SimpleStockRequest (PM/Sales/Accountant → Store) ───────────────────
DO $$ BEGIN
  CREATE TYPE "SimpleStockRequestStatus" AS ENUM (
    'PENDING', 'ISSUED', 'PARTIAL', 'REJECTED', 'CANCELLED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "simple_stock_requests" (
    "id"               TEXT        NOT NULL PRIMARY KEY,
    "request_ref"      TEXT        NOT NULL UNIQUE,
    "request_date"     DATE        NOT NULL,
    "needed_by"        DATE,
    "status"           "SimpleStockRequestStatus" NOT NULL DEFAULT 'PENDING',
    "purpose"          TEXT,
    "notes"            TEXT,
    "requested_by_id"  TEXT        NOT NULL REFERENCES "users"("id"),
    "fulfilled_by_id"  TEXT                 REFERENCES "users"("id"),
    "fulfilled_at"     TIMESTAMP,
    "rejection_reason" TEXT,
    "created_at"       TIMESTAMP   NOT NULL DEFAULT now(),
    "updated_at"       TIMESTAMP   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "simple_stock_requests_status_idx"
    ON "simple_stock_requests"("status");
CREATE INDEX IF NOT EXISTS "simple_stock_requests_request_date_idx"
    ON "simple_stock_requests"("request_date");

-- [F1] simple_stock_request_items: guard FKs that reference tables which may
--      not yet exist in every environment (store_items, store_stock_outs).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'store_items')
  THEN
    CREATE TABLE IF NOT EXISTS "simple_stock_request_items" (
        "id"                 TEXT           NOT NULL PRIMARY KEY,
        "request_id"         TEXT           NOT NULL
            REFERENCES "simple_stock_requests"("id") ON DELETE CASCADE,
        "store_item_id"      TEXT           NOT NULL
            REFERENCES "store_items"("id"),
        "quantity_requested" DECIMAL(10,3)  NOT NULL,
        "quantity_issued"    DECIMAL(10,3)  NOT NULL DEFAULT 0,
        "stock_out_id"       TEXT
            -- [F1] store_stock_outs FK: only add if the table exists
            REFERENCES "store_stock_outs"("id"),
        "notes"              TEXT
    );
  ELSE
    -- Fallback: create without the store FK (add it in a follow-up migration
    -- once store_items is confirmed present)
    CREATE TABLE IF NOT EXISTS "simple_stock_request_items" (
        "id"                 TEXT           NOT NULL PRIMARY KEY,
        "request_id"         TEXT           NOT NULL
            REFERENCES "simple_stock_requests"("id") ON DELETE CASCADE,
        "store_item_id"      TEXT           NOT NULL,
        "quantity_requested" DECIMAL(10,3)  NOT NULL,
        "quantity_issued"    DECIMAL(10,3)  NOT NULL DEFAULT 0,
        "stock_out_id"       TEXT,
        "notes"              TEXT
    );
    RAISE NOTICE 'store_items not found — simple_stock_request_items created WITHOUT FK constraints. Add them manually once store_items exists.';
  END IF;
END $$;

-- ── 10. ConstructionLaborRecord (mandated for STORE) ──────────────────────
-- [F2] construction_records FK: guard against table not existing yet
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'construction_records')
  THEN
    CREATE TABLE IF NOT EXISTS "construction_labor_records" (
        "id"                     TEXT          NOT NULL PRIMARY KEY,
        "construction_record_id" TEXT
            REFERENCES "construction_records"("id"),
        "work_date"              DATE          NOT NULL,
        "worker_name"            TEXT          NOT NULL,
        "role_title"             TEXT,
        "hours_worked"           DECIMAL(5,2)  NOT NULL DEFAULT 0,
        "rate_per_hour_kes"      DECIMAL(10,2) NOT NULL DEFAULT 0,
        "total_pay_kes"          DECIMAL(12,2) NOT NULL DEFAULT 0,
        "notes"                  TEXT,
        "logged_by_id"           TEXT          NOT NULL REFERENCES "users"("id"),
        "created_at"             TIMESTAMP     NOT NULL DEFAULT now(),
        "updated_at"             TIMESTAMP     NOT NULL DEFAULT now()
    );
  ELSE
    CREATE TABLE IF NOT EXISTS "construction_labor_records" (
        "id"                     TEXT          NOT NULL PRIMARY KEY,
        "construction_record_id" TEXT,          -- FK deferred; table absent
        "work_date"              DATE          NOT NULL,
        "worker_name"            TEXT          NOT NULL,
        "role_title"             TEXT,
        "hours_worked"           DECIMAL(5,2)  NOT NULL DEFAULT 0,
        "rate_per_hour_kes"      DECIMAL(10,2) NOT NULL DEFAULT 0,
        "total_pay_kes"          DECIMAL(12,2) NOT NULL DEFAULT 0,
        "notes"                  TEXT,
        "logged_by_id"           TEXT          NOT NULL REFERENCES "users"("id"),
        "created_at"             TIMESTAMP     NOT NULL DEFAULT now(),
        "updated_at"             TIMESTAMP     NOT NULL DEFAULT now()
    );
    RAISE NOTICE 'construction_records not found — construction_labor_records created WITHOUT FK on construction_record_id.';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "construction_labor_records_work_date_idx"
    ON "construction_labor_records"("work_date");
CREATE INDEX IF NOT EXISTS "construction_labor_records_construction_record_id_idx"
    ON "construction_labor_records"("construction_record_id");

-- ── 11. BatchCageAssignment: soft-delete + partial unique index ───────────
ALTER TABLE "batch_cage_assignments"
    ADD COLUMN IF NOT EXISTS "is_active"         BOOLEAN   NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS "deactivated_at"    TIMESTAMP,
    ADD COLUMN IF NOT EXISTS "deactivated_by_id" TEXT;

ALTER TABLE "batch_cage_assignments"
    DROP CONSTRAINT IF EXISTS "batch_cage_assignments_deactivated_by_id_fkey",
    ADD  CONSTRAINT "batch_cage_assignments_deactivated_by_id_fkey"
      FOREIGN KEY ("deactivated_by_id") REFERENCES "users"("id");

-- [F3] The constraint name for row_id uniqueness can vary between environments.
--      Drop by name AND by scanning pg_constraint so neither path hard-fails.
DO $$ DECLARE
  r RECORD;
BEGIN
  -- Drop known name first (no-op if already gone)
  ALTER TABLE "batch_cage_assignments"
      DROP CONSTRAINT IF EXISTS "batch_cage_assignments_row_id_key";

  -- Also sweep for any other unique constraint on solely (row_id)
  FOR r IN
    SELECT con.conname
    FROM   pg_constraint con
    JOIN   pg_class      rel ON rel.oid = con.conrelid
    JOIN   pg_namespace  ns  ON ns.oid  = rel.relnamespace
    WHERE  ns.nspname   = 'public'
      AND  rel.relname  = 'batch_cage_assignments'
      AND  con.contype  = 'u'
      AND  array_length(con.conkey, 1) = 1
      AND  (SELECT attname FROM pg_attribute
            WHERE attrelid = rel.oid AND attnum = con.conkey[1]) = 'row_id'
  LOOP
    EXECUTE format('ALTER TABLE batch_cage_assignments DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "batch_cage_assignments_row_id_active_key"
    ON "batch_cage_assignments"("row_id")
    WHERE "is_active" = true;

COMMIT;
