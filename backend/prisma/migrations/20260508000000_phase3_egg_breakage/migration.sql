-- Phase 3: Egg Breakage Adjustments
--
-- Adds the BreakageAdjustmentStatus and BreakageReason enums plus the
-- egg_breakage_adjustments table and supporting indexes.

CREATE TYPE "BreakageAdjustmentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TYPE "BreakageReason" AS ENUM (
  'TRANSIT_DAMAGE',
  'CUSTOMER_RETURN',
  'STORAGE_DAMAGE',
  'HANDLING',
  'OTHER'
);

CREATE TABLE "egg_breakage_adjustments" (
  "id"               TEXT                           NOT NULL,
  "adjustment_ref"   TEXT                           NOT NULL,
  "adjustment_date"  DATE                           NOT NULL,
  "sales_order_id"   TEXT,
  "customer_id"      TEXT,
  "grade"            "EggGrade"                     NOT NULL,
  "quantity_trays"   INTEGER                        NOT NULL DEFAULT 0,
  "quantity_eggs"    INTEGER                        NOT NULL DEFAULT 0,
  "unit_price_kes"   DECIMAL(10,2)                  NOT NULL,
  "total_value_kes"  DECIMAL(12,2)                  NOT NULL,
  "reason"           "BreakageReason"               NOT NULL,
  "notes"            TEXT,
  "status"           "BreakageAdjustmentStatus"     NOT NULL DEFAULT 'PENDING',
  "review_notes"     TEXT,
  "reported_by_id"   TEXT                           NOT NULL,
  "reviewed_by_id"   TEXT,
  "reviewed_at"      TIMESTAMP(3),
  "created_at"       TIMESTAMP(3)                   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3)                   NOT NULL,
  CONSTRAINT "egg_breakage_adjustments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "egg_breakage_adjustments_adjustment_ref_key"
  ON "egg_breakage_adjustments"("adjustment_ref");

CREATE INDEX "egg_breakage_adjustments_adjustment_date_idx"
  ON "egg_breakage_adjustments"("adjustment_date");

CREATE INDEX "egg_breakage_adjustments_status_idx"
  ON "egg_breakage_adjustments"("status");

CREATE INDEX "egg_breakage_adjustments_sales_order_id_idx"
  ON "egg_breakage_adjustments"("sales_order_id");

ALTER TABLE "egg_breakage_adjustments"
  ADD CONSTRAINT "egg_breakage_adjustments_sales_order_id_fkey"
  FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "egg_breakage_adjustments"
  ADD CONSTRAINT "egg_breakage_adjustments_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "egg_breakage_adjustments"
  ADD CONSTRAINT "egg_breakage_adjustments_reported_by_id_fkey"
  FOREIGN KEY ("reported_by_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "egg_breakage_adjustments"
  ADD CONSTRAINT "egg_breakage_adjustments_reviewed_by_id_fkey"
  FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
