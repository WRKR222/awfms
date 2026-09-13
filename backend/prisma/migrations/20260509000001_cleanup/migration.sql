-- ============================================================================
-- AWFMS Cleanup Migration — 2025-05-08  (v2 — UUID-compatible)
-- ----------------------------------------------------------------------------
-- FIXES vs v1:
--   [U1] simple_stock_request_items: store_item_id + stock_out_id → UUID
--        (phase2 creates store_items/store_stock_outs with UUID PKs)
--   [U2] construction_labor_records: construction_record_id → UUID
--        (phase2 creates construction_records with UUID PK)
--   [U3] simple_stock_requests.id stays TEXT (Prisma cuid — intentional)
--        construction_labor_records.id stays TEXT (Prisma cuid — intentional)
--        Only the FK *reference* columns are UUID to match the target tables
--   [F1-F5] All prior production guards retained
-- ============================================================================

BEGIN;

-- ── 1. Drop obsolete tables ────────────────────────────────────────────────
DROP TABLE IF EXISTS "flock_daily_entries"  CASCADE;
DROP TABLE IF EXISTS "production_entries"   CASCADE;
DROP TABLE IF EXISTS "egg_price_tiers"      CASCADE;
DROP TABLE IF EXISTS "store_vet_visit_logs" CASCADE;

-- ── 2. Drop EggGrade enum ─────────────────────────────────────────────────
-- CASCADE: egg_breakage_adjustments.grade (added by 20260508000000) still
-- depends on this type at the point this migration runs — plain DROP TYPE
-- aborts the whole transaction (current transaction is aborted, commands
-- ignored...) on any database replaying migration history from scratch.
-- The dependent column is dropped for good by 20260616000001 anyway, so
-- cascading here just does that removal a bit earlier; every other
-- statement in this file is already IF EXISTS/IF NOT EXISTS-guarded.
DROP TYPE IF EXISTS "EggGrade" CASCADE;

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

-- ── 4. EggTallyVerification: edit lifecycle ───────────────────────────────
ALTER TABLE "egg_tally_verifications"
    ADD COLUMN IF NOT EXISTS "edit_count"        INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "last_edited_by_id" TEXT,
    ADD COLUMN IF NOT EXISTS "last_edited_at"    TIMESTAMP;

ALTER TABLE "egg_tally_verifications"
    DROP CONSTRAINT IF EXISTS "egg_tally_verifications_last_edited_by_id_fkey",
    ADD  CONSTRAINT "egg_tally_verifications_last_edited_by_id_fkey"
      FOREIGN KEY ("last_edited_by_id") REFERENCES "users"("id");

-- ── 5. SalesOrder: drop tier column FIRST, then drop SalesTier enum ───────
ALTER TABLE "sales_orders" DROP COLUMN IF EXISTS "tier";

DROP TYPE IF EXISTS "SalesTier";

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

-- ── 7. HealthEvent: vet PDF ───────────────────────────────────────────────
ALTER TABLE "health_events"
    ADD COLUMN IF NOT EXISTS "vet_pdf_url"            TEXT,
    ADD COLUMN IF NOT EXISTS "vet_pdf_uploaded_by_id" TEXT,
    ADD COLUMN IF NOT EXISTS "vet_pdf_uploaded_at"    TIMESTAMP;

ALTER TABLE "health_events"
    DROP CONSTRAINT IF EXISTS "health_events_vet_pdf_uploaded_by_id_fkey",
    ADD  CONSTRAINT "health_events_vet_pdf_uploaded_by_id_fkey"
      FOREIGN KEY ("vet_pdf_uploaded_by_id") REFERENCES "users"("id");

-- ── 8. VisitorLog: FK back to users ──────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'visitor_log') THEN
    ALTER TABLE "visitor_log"
        DROP CONSTRAINT IF EXISTS "visitor_log_recorded_by_id_fkey",
        ADD  CONSTRAINT "visitor_log_recorded_by_id_fkey"
          FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id");
  END IF;
END $$;

-- ── 9. SimpleStockRequest ─────────────────────────────────────────────────
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

-- [U1] store_item_id + stock_out_id are UUID to match phase2 PKs
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'store_items') THEN

    CREATE TABLE IF NOT EXISTS "simple_stock_request_items" (
        "id"                 TEXT           NOT NULL PRIMARY KEY,
        "request_id"         TEXT           NOT NULL
            REFERENCES "simple_stock_requests"("id") ON DELETE CASCADE,
        "store_item_id"      UUID           NOT NULL  -- [U1] UUID FK
            REFERENCES "store_items"("id"),
        "quantity_requested" DECIMAL(10,3)  NOT NULL,
        "quantity_issued"    DECIMAL(10,3)  NOT NULL DEFAULT 0,
        "stock_out_id"       UUID                     -- [U1] UUID FK
            REFERENCES "store_stock_outs"("id"),
        "notes"              TEXT
    );

  ELSE
    -- store_items not yet created; table created without FKs (rare edge case)
    CREATE TABLE IF NOT EXISTS "simple_stock_request_items" (
        "id"                 TEXT           NOT NULL PRIMARY KEY,
        "request_id"         TEXT           NOT NULL
            REFERENCES "simple_stock_requests"("id") ON DELETE CASCADE,
        "store_item_id"      UUID           NOT NULL,  -- FK deferred
        "quantity_requested" DECIMAL(10,3)  NOT NULL,
        "quantity_issued"    DECIMAL(10,3)  NOT NULL DEFAULT 0,
        "stock_out_id"       UUID,                     -- FK deferred
        "notes"              TEXT
    );
    RAISE NOTICE 'store_items not found — simple_stock_request_items created WITHOUT FK constraints.';
  END IF;
END $$;

-- ── 10. ConstructionLaborRecord ───────────────────────────────────────────
-- [U2] construction_record_id is UUID to match phase2 construction_records PK
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'construction_records') THEN

    CREATE TABLE IF NOT EXISTS "construction_labor_records" (
        "id"                     TEXT          NOT NULL PRIMARY KEY,
        "construction_record_id" UUID                    -- [U2] UUID FK
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
        "construction_record_id" UUID,                   -- FK deferred
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
    RAISE NOTICE 'construction_records not found — construction_labor_records FK skipped.';
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

-- Drop unique constraint by name AND by introspection (prod name may differ)
DO $$ DECLARE r RECORD; BEGIN
  ALTER TABLE "batch_cage_assignments"
      DROP CONSTRAINT IF EXISTS "batch_cage_assignments_row_id_key";

  FOR r IN
    SELECT con.conname
    FROM   pg_constraint con
    JOIN   pg_class      rel ON rel.oid = con.conrelid
    JOIN   pg_namespace  ns  ON ns.oid  = rel.relnamespace
    WHERE  ns.nspname  = 'public'
      AND  rel.relname = 'batch_cage_assignments'
      AND  con.contype = 'u'
      AND  array_length(con.conkey, 1) = 1
      AND  (SELECT attname FROM pg_attribute
            WHERE attrelid = rel.oid
              AND attnum = con.conkey[1]) = 'row_id'
  LOOP
    EXECUTE format(
      'ALTER TABLE batch_cage_assignments DROP CONSTRAINT IF EXISTS %I',
      r.conname
    );
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "batch_cage_assignments_row_id_active_key"
    ON "batch_cage_assignments"("row_id")
    WHERE "is_active" = true;

COMMIT;
