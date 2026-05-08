-- ============================================================================
-- Phase 2 Migration: Store Inventory, Purchase Requests, LPO,
--                    Farm Employees, Construction Records
-- PATCHED for Railway/Prisma idempotency (P3015 recovery)
-- ----------------------------------------------------------------------------
-- Changes vs original:
--   [P1] All CREATE TYPE wrapped in DO/EXCEPTION to survive reruns
--   [P2] All CREATE TABLE uses IF NOT EXISTS
--   [P3] suppliers FK guarded — only added if suppliers table exists
--   [P4] store_stock_ins lpo_id FK uses ADD CONSTRAINT IF NOT EXISTS pattern
-- ============================================================================

BEGIN;

-- ── 1. Enum value additions (ADD VALUE IF NOT EXISTS is already safe) ──────
ALTER TYPE "HealthEventType"   ADD VALUE IF NOT EXISTS 'CULLING';
ALTER TYPE "HealthEventType"   ADD VALUE IF NOT EXISTS 'BIRD_SOLD';
ALTER TYPE "HealthEventType"   ADD VALUE IF NOT EXISTS 'WEIGHING';

ALTER TYPE "NotificationType"  ADD VALUE IF NOT EXISTS 'PURCHASE_REQUEST';
ALTER TYPE "NotificationType"  ADD VALUE IF NOT EXISTS 'LPO_SUBMITTED';
ALTER TYPE "NotificationType"  ADD VALUE IF NOT EXISTS 'LPO_APPROVED';

-- ── 2. New enums — [P1] all idempotent ────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "StoreItemCategory" AS ENUM (
    'MEDICATION', 'EQUIPMENT', 'FEED_SUPPLEMENT', 'PACKAGING',
    'CLEANING', 'SAFETY', 'OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "StoreItemUnit" AS ENUM (
    'KG', 'G', 'L', 'ML', 'PIECE', 'BOX', 'BAG', 'BOTTLE', 'SACHET', 'TRAY'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PurchaseRequestStatus" AS ENUM (
    'DRAFT', 'SUBMITTED', 'REVIEWED', 'LPO_RAISED', 'REJECTED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "LPOStatus" AS ENUM (
    'DRAFT', 'SUBMITTED', 'APPROVED', 'PARTIALLY_RECEIVED',
    'FULLY_RECEIVED', 'CANCELLED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "EmployeeStatus" AS ENUM (
    'ACTIVE', 'ON_LEAVE', 'TERMINATED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ConstructionType" AS ENUM (
    'NEW_STRUCTURE', 'RENOVATION', 'REPAIR', 'MAINTENANCE', 'EXPANSION'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 3. store_items ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "store_items" (
  "id"            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  "name"          TEXT          NOT NULL,
  "sku"           TEXT          NOT NULL UNIQUE,
  "category"      "StoreItemCategory" NOT NULL,
  "unit"          "StoreItemUnit"     NOT NULL,
  "description"   TEXT,
  "reorder_level" NUMERIC(10,3) NOT NULL DEFAULT 0,
  "current_stock" NUMERIC(10,3) NOT NULL DEFAULT 0,
  "unit_cost_kes" NUMERIC(10,2) NOT NULL DEFAULT 0,
  "supplier_id"   UUID,
  "is_active"     BOOLEAN       NOT NULL DEFAULT true,
  "created_by_id" UUID          NOT NULL REFERENCES "users"("id"),
  "created_at"    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  "updated_at"    TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "store_items_category_idx"  ON "store_items"("category");
CREATE INDEX IF NOT EXISTS "store_items_is_active_idx" ON "store_items"("is_active");

-- ── 4. store_stock_ins ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "store_stock_ins" (
  "id"             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  "store_item_id"  UUID          NOT NULL REFERENCES "store_items"("id"),
  "received_date"  DATE          NOT NULL,
  "quantity_in"    NUMERIC(10,3) NOT NULL,
  "unit_cost_kes"  NUMERIC(10,2) NOT NULL,
  "total_cost_kes" NUMERIC(12,2) NOT NULL,
  "supplier_name"  TEXT,
  "invoice_ref"    TEXT,
  "lpo_id"         UUID,                    -- FK added after LPO table below
  "notes"          TEXT,
  "received_by_id" UUID          NOT NULL REFERENCES "users"("id"),
  "created_at"     TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "store_stock_ins_item_date_idx"
    ON "store_stock_ins"("store_item_id", "received_date");
CREATE INDEX IF NOT EXISTS "store_stock_ins_date_idx"
    ON "store_stock_ins"("received_date");

-- ── 5. store_stock_outs ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "store_stock_outs" (
  "id"                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  "store_item_id"       UUID          NOT NULL REFERENCES "store_items"("id"),
  "issued_date"         DATE          NOT NULL,
  "quantity_out"        NUMERIC(10,3) NOT NULL,
  "unit_cost_kes"       NUMERIC(10,2) NOT NULL,
  "total_cost_kes"      NUMERIC(12,2) NOT NULL,
  "issued_to_house_id"  UUID,
  "issued_to_batch_id"  UUID,
  "purpose"             TEXT,
  "notes"               TEXT,
  "issued_by_id"        UUID          NOT NULL REFERENCES "users"("id"),
  "created_at"          TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "store_stock_outs_item_date_idx"
    ON "store_stock_outs"("store_item_id", "issued_date");
CREATE INDEX IF NOT EXISTS "store_stock_outs_date_idx"
    ON "store_stock_outs"("issued_date");

-- ── 6. purchase_requests + items ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "purchase_requests" (
  "id"             UUID                   PRIMARY KEY DEFAULT gen_random_uuid(),
  "request_ref"    TEXT                   NOT NULL UNIQUE,
  "request_date"   DATE                   NOT NULL,
  "status"         "PurchaseRequestStatus" NOT NULL DEFAULT 'DRAFT',
  "urgency"        TEXT                   NOT NULL DEFAULT 'NORMAL',
  "notes"          TEXT,
  "review_notes"   TEXT,
  "created_by_id"  UUID                   NOT NULL REFERENCES "users"("id"),
  "reviewed_by_id" UUID                   REFERENCES "users"("id"),
  "reviewed_at"    TIMESTAMPTZ,
  "created_at"     TIMESTAMPTZ            NOT NULL DEFAULT now(),
  "updated_at"     TIMESTAMPTZ            NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "purchase_requests_status_idx"
    ON "purchase_requests"("status");
CREATE INDEX IF NOT EXISTS "purchase_requests_date_idx"
    ON "purchase_requests"("request_date");

CREATE TABLE IF NOT EXISTS "purchase_request_items" (
  "id"                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  "purchase_request_id" UUID          NOT NULL
      REFERENCES "purchase_requests"("id") ON DELETE CASCADE,
  "store_item_id"       UUID          NOT NULL REFERENCES "store_items"("id"),
  "quantity_requested"  NUMERIC(10,3) NOT NULL,
  "estimated_unit_cost" NUMERIC(10,2) NOT NULL DEFAULT 0,
  "reason"              TEXT
);

-- ── 7. local_purchase_orders + lpo_items ──────────────────────────────────
-- [P3] supplier_id FK only wired if suppliers table exists
CREATE TABLE IF NOT EXISTS "local_purchase_orders" (
  "id"                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "lpo_number"          TEXT        NOT NULL UNIQUE,
  "purchase_request_id" UUID        UNIQUE REFERENCES "purchase_requests"("id"),
  "supplier_id"         UUID,       -- FK added conditionally below
  "supplier_name"       TEXT        NOT NULL,
  "lpo_date"            DATE        NOT NULL,
  "expected_delivery"   DATE,
  "status"              "LPOStatus" NOT NULL DEFAULT 'DRAFT',
  "subtotal_kes"        NUMERIC(12,2) NOT NULL,
  "vat_kes"             NUMERIC(12,2) NOT NULL DEFAULT 0,
  "total_kes"           NUMERIC(12,2) NOT NULL,
  "notes"               TEXT,
  "approved_by_id"      UUID        REFERENCES "users"("id"),
  "approved_at"         TIMESTAMPTZ,
  "created_by_id"       UUID        NOT NULL REFERENCES "users"("id"),
  "created_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "lpo_status_idx" ON "local_purchase_orders"("status");
CREATE INDEX IF NOT EXISTS "lpo_date_idx"   ON "local_purchase_orders"("lpo_date");

-- [P3] Add supplier FK only if suppliers table exists
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'suppliers') THEN
    ALTER TABLE "local_purchase_orders"
        DROP CONSTRAINT IF EXISTS "local_purchase_orders_supplier_id_fkey",
        ADD  CONSTRAINT "local_purchase_orders_supplier_id_fkey"
          FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id");
  ELSE
    RAISE NOTICE 'suppliers table not found — local_purchase_orders.supplier_id FK skipped.';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "lpo_items" (
  "id"            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  "lpo_id"        UUID          NOT NULL
      REFERENCES "local_purchase_orders"("id") ON DELETE CASCADE,
  "store_item_id" UUID          NOT NULL REFERENCES "store_items"("id"),
  "description"   TEXT,
  "quantity"      NUMERIC(10,3) NOT NULL,
  "unit_price"    NUMERIC(10,2) NOT NULL,
  "subtotal"      NUMERIC(12,2) NOT NULL
);

-- [P4] Now wire lpo_id FK on store_stock_ins — safe because LPO table now exists
ALTER TABLE "store_stock_ins"
    DROP CONSTRAINT IF EXISTS "store_stock_ins_lpo_id_fkey",
    ADD  CONSTRAINT "store_stock_ins_lpo_id_fkey"
      FOREIGN KEY ("lpo_id") REFERENCES "local_purchase_orders"("id");

-- ── 8. farm_employees ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "farm_employees" (
  "id"              UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  "full_name"       TEXT           NOT NULL,
  "national_id"     TEXT           UNIQUE,
  "phone"           TEXT,
  "role"            TEXT           NOT NULL,
  "house_ids"       TEXT[]         NOT NULL DEFAULT '{}',
  "salary_kes"      NUMERIC(10,2)  NOT NULL DEFAULT 0,
  "pay_period"      TEXT           NOT NULL DEFAULT 'MONTHLY',
  "hire_date"       DATE           NOT NULL,
  "terminated_date" DATE,
  "status"          "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
  "notes"           TEXT,
  "created_at"      TIMESTAMPTZ    NOT NULL DEFAULT now(),
  "updated_at"      TIMESTAMPTZ    NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "farm_employees_status_idx" ON "farm_employees"("status");

-- ── 9. construction_records ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "construction_records" (
  "id"                UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  "title"             TEXT              NOT NULL,
  "construction_type" "ConstructionType" NOT NULL,
  "location"          TEXT              NOT NULL,
  "start_date"        DATE              NOT NULL,
  "end_date"          DATE,
  "contractor_name"   TEXT,
  "contractor_phone"  TEXT,
  "budget_kes"        NUMERIC(12,2)     NOT NULL DEFAULT 0,
  "actual_cost_kes"   NUMERIC(12,2)     NOT NULL DEFAULT 0,
  "status"            TEXT              NOT NULL DEFAULT 'IN_PROGRESS',
  "description"       TEXT,
  "notes"             TEXT,
  "created_at"        TIMESTAMPTZ       NOT NULL DEFAULT now(),
  "updated_at"        TIMESTAMPTZ       NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "construction_records_status_idx"
    ON "construction_records"("status");
CREATE INDEX IF NOT EXISTS "construction_records_start_date_idx"
    ON "construction_records"("start_date");

COMMIT;
