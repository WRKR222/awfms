-- Phase 2 Migration: Store Inventory, Purchase Requests, LPO, Farm Employees, Construction Records
-- Run this in Railway's query editor (or via prisma migrate deploy)

-- ─── 1. ADD ENUM VALUES ────────────────────────────────────────────────────

-- HealthEventType: add CULLING, BIRD_SOLD, WEIGHING
ALTER TYPE "HealthEventType" ADD VALUE IF NOT EXISTS 'CULLING';
ALTER TYPE "HealthEventType" ADD VALUE IF NOT EXISTS 'BIRD_SOLD';
ALTER TYPE "HealthEventType" ADD VALUE IF NOT EXISTS 'WEIGHING';

-- NotificationType: add PURCHASE_REQUEST, LPO_SUBMITTED, LPO_APPROVED
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PURCHASE_REQUEST';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'LPO_SUBMITTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'LPO_APPROVED';

-- ─── 2. NEW ENUMS ───────────────────────────────────────────────────────────

CREATE TYPE "StoreItemCategory" AS ENUM (
  'MEDICATION', 'EQUIPMENT', 'FEED_SUPPLEMENT', 'PACKAGING',
  'CLEANING', 'SAFETY', 'OTHER'
);

CREATE TYPE "StoreItemUnit" AS ENUM (
  'KG', 'G', 'L', 'ML', 'PIECE', 'BOX', 'BAG', 'BOTTLE', 'SACHET', 'TRAY'
);

CREATE TYPE "PurchaseRequestStatus" AS ENUM (
  'DRAFT', 'SUBMITTED', 'REVIEWED', 'LPO_RAISED', 'REJECTED'
);

CREATE TYPE "LPOStatus" AS ENUM (
  'DRAFT', 'SUBMITTED', 'APPROVED', 'PARTIALLY_RECEIVED', 'FULLY_RECEIVED', 'CANCELLED'
);

CREATE TYPE "EmployeeStatus" AS ENUM (
  'ACTIVE', 'ON_LEAVE', 'TERMINATED'
);

CREATE TYPE "ConstructionType" AS ENUM (
  'NEW_STRUCTURE', 'RENOVATION', 'REPAIR', 'MAINTENANCE', 'EXPANSION'
);

-- ─── 3. STORE ITEMS (master catalogue) ─────────────────────────────────────

CREATE TABLE "store_items" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "name"          TEXT NOT NULL,
  "sku"           TEXT NOT NULL UNIQUE,
  "category"      "StoreItemCategory" NOT NULL,
  "unit"          "StoreItemUnit" NOT NULL,
  "description"   TEXT,
  "reorder_level" NUMERIC(10,3) NOT NULL DEFAULT 0,
  "current_stock" NUMERIC(10,3) NOT NULL DEFAULT 0,
  "unit_cost_kes" NUMERIC(10,2) NOT NULL DEFAULT 0,
  "supplier_id"   UUID,
  "is_active"     BOOLEAN NOT NULL DEFAULT true,
  "created_by_id" UUID NOT NULL,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "store_items_category_idx"   ON "store_items"("category");
CREATE INDEX "store_items_is_active_idx"  ON "store_items"("is_active");

-- ─── 4. STORE STOCK IN ──────────────────────────────────────────────────────

CREATE TABLE "store_stock_ins" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "store_item_id"  UUID NOT NULL REFERENCES "store_items"("id"),
  "received_date"  DATE NOT NULL,
  "quantity_in"    NUMERIC(10,3) NOT NULL,
  "unit_cost_kes"  NUMERIC(10,2) NOT NULL,
  "total_cost_kes" NUMERIC(12,2) NOT NULL,
  "supplier_name"  TEXT,
  "invoice_ref"    TEXT,
  "lpo_id"         UUID,
  "notes"          TEXT,
  "received_by_id" UUID NOT NULL REFERENCES "users"("id"),
  "created_at"     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "store_stock_ins_item_date_idx" ON "store_stock_ins"("store_item_id", "received_date");
CREATE INDEX "store_stock_ins_date_idx"      ON "store_stock_ins"("received_date");

-- ─── 5. STORE STOCK OUT ─────────────────────────────────────────────────────

CREATE TABLE "store_stock_outs" (
  "id"                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "store_item_id"       UUID NOT NULL REFERENCES "store_items"("id"),
  "issued_date"         DATE NOT NULL,
  "quantity_out"        NUMERIC(10,3) NOT NULL,
  "unit_cost_kes"       NUMERIC(10,2) NOT NULL,
  "total_cost_kes"      NUMERIC(12,2) NOT NULL,
  "issued_to_house_id"  UUID,
  "issued_to_batch_id"  UUID,
  "purpose"             TEXT,
  "notes"               TEXT,
  "issued_by_id"        UUID NOT NULL REFERENCES "users"("id"),
  "created_at"          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "store_stock_outs_item_date_idx" ON "store_stock_outs"("store_item_id", "issued_date");
CREATE INDEX "store_stock_outs_date_idx"      ON "store_stock_outs"("issued_date");

-- ─── 6. PURCHASE REQUESTS ───────────────────────────────────────────────────

CREATE TABLE "purchase_requests" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "request_ref"    TEXT NOT NULL UNIQUE,
  "request_date"   DATE NOT NULL,
  "status"         "PurchaseRequestStatus" NOT NULL DEFAULT 'DRAFT',
  "urgency"        TEXT NOT NULL DEFAULT 'NORMAL',
  "notes"          TEXT,
  "review_notes"   TEXT,
  "created_by_id"  UUID NOT NULL REFERENCES "users"("id"),
  "reviewed_by_id" UUID REFERENCES "users"("id"),
  "reviewed_at"    TIMESTAMPTZ,
  "created_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "purchase_requests_status_idx" ON "purchase_requests"("status");
CREATE INDEX "purchase_requests_date_idx"   ON "purchase_requests"("request_date");

CREATE TABLE "purchase_request_items" (
  "id"                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "purchase_request_id"  UUID NOT NULL REFERENCES "purchase_requests"("id") ON DELETE CASCADE,
  "store_item_id"        UUID NOT NULL REFERENCES "store_items"("id"),
  "quantity_requested"   NUMERIC(10,3) NOT NULL,
  "estimated_unit_cost"  NUMERIC(10,2) NOT NULL DEFAULT 0,
  "reason"               TEXT
);

-- ─── 7. LOCAL PURCHASE ORDERS ───────────────────────────────────────────────

CREATE TABLE "local_purchase_orders" (
  "id"                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "lpo_number"          TEXT NOT NULL UNIQUE,
  "purchase_request_id" UUID UNIQUE REFERENCES "purchase_requests"("id"),
  "supplier_id"         UUID REFERENCES "suppliers"("id"),
  "supplier_name"       TEXT NOT NULL,
  "lpo_date"            DATE NOT NULL,
  "expected_delivery"   DATE,
  "status"              "LPOStatus" NOT NULL DEFAULT 'DRAFT',
  "subtotal_kes"        NUMERIC(12,2) NOT NULL,
  "vat_kes"             NUMERIC(12,2) NOT NULL DEFAULT 0,
  "total_kes"           NUMERIC(12,2) NOT NULL,
  "notes"               TEXT,
  "approved_by_id"      UUID REFERENCES "users"("id"),
  "approved_at"         TIMESTAMPTZ,
  "created_by_id"       UUID NOT NULL REFERENCES "users"("id"),
  "created_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "lpo_status_idx" ON "local_purchase_orders"("status");
CREATE INDEX "lpo_date_idx"   ON "local_purchase_orders"("lpo_date");

CREATE TABLE "lpo_items" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "lpo_id"       UUID NOT NULL REFERENCES "local_purchase_orders"("id") ON DELETE CASCADE,
  "store_item_id" UUID NOT NULL REFERENCES "store_items"("id"),
  "description"  TEXT,
  "quantity"     NUMERIC(10,3) NOT NULL,
  "unit_price"   NUMERIC(10,2) NOT NULL,
  "subtotal"     NUMERIC(12,2) NOT NULL
);

-- Add lpo_id FK to store_stock_ins now that LPO table exists
ALTER TABLE "store_stock_ins"
  ADD CONSTRAINT "store_stock_ins_lpo_id_fkey"
  FOREIGN KEY ("lpo_id") REFERENCES "local_purchase_orders"("id");

-- ─── 8. FARM EMPLOYEES ──────────────────────────────────────────────────────

CREATE TABLE "farm_employees" (
  "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "full_name"        TEXT NOT NULL,
  "national_id"      TEXT UNIQUE,
  "phone"            TEXT,
  "role"             TEXT NOT NULL,
  "house_ids"        TEXT[] NOT NULL DEFAULT '{}',
  "salary_kes"       NUMERIC(10,2) NOT NULL DEFAULT 0,
  "pay_period"       TEXT NOT NULL DEFAULT 'MONTHLY',
  "hire_date"        DATE NOT NULL,
  "terminated_date"  DATE,
  "status"           "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
  "notes"            TEXT,
  "created_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "farm_employees_status_idx" ON "farm_employees"("status");

-- ─── 9. CONSTRUCTION RECORDS ────────────────────────────────────────────────

CREATE TABLE "construction_records" (
  "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "title"             TEXT NOT NULL,
  "construction_type" "ConstructionType" NOT NULL,
  "location"          TEXT NOT NULL,
  "start_date"        DATE NOT NULL,
  "end_date"          DATE,
  "contractor_name"   TEXT,
  "contractor_phone"  TEXT,
  "budget_kes"        NUMERIC(12,2) NOT NULL DEFAULT 0,
  "actual_cost_kes"   NUMERIC(12,2) NOT NULL DEFAULT 0,
  "status"            TEXT NOT NULL DEFAULT 'IN_PROGRESS',
  "description"       TEXT,
  "notes"             TEXT,
  "created_at"        TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "construction_records_status_idx"     ON "construction_records"("status");
CREATE INDEX "construction_records_start_date_idx" ON "construction_records"("start_date");
