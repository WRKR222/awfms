-- ====================================================================
-- AWFMS Stores Role Improvements — Migration SQL
-- File: prisma/migrations/store_role_improvements/migration.sql
--
-- Fixes: GAP-04 (issuedToName), GAP-12 (FarmEmployee fields),
--        GAP-03 (ConstructionAttendance), GAP-11 (StoreItem subitem),
--        GAP-10 (PR free-text items)
--
-- Run via: psql $DATABASE_URL -f store_role_improvements.sql
-- Or paste into a new Prisma migration file and run: npx prisma migrate deploy
-- ====================================================================

-- ─── GAP-04: Add issued_to_name + balance_after to store_stock_outs ──
ALTER TABLE store_stock_outs
  ADD COLUMN IF NOT EXISTS issued_to_name TEXT,
  ADD COLUMN IF NOT EXISTS balance_after  DECIMAL(10,3);

-- ─── GAP-12: FarmEmployee — additional fields ─────────────────────────
ALTER TABLE farm_employees
  ADD COLUMN IF NOT EXISTS employee_number  TEXT,
  ADD COLUMN IF NOT EXISTS address          TEXT,
  ADD COLUMN IF NOT EXISTS work_phone       TEXT,
  ADD COLUMN IF NOT EXISTS mobile_phone     TEXT;

-- Optional: Create unique index on employee_number (add UNIQUE if desired)
-- CREATE UNIQUE INDEX IF NOT EXISTS idx_farm_employees_employee_number
--   ON farm_employees(employee_number) WHERE employee_number IS NOT NULL;

-- ─── GAP-03: Construction Employee Attendance records ─────────────────
CREATE TABLE IF NOT EXISTS construction_attendance (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  record_date          DATE         NOT NULL,
  serial_number        INTEGER,
  id_number            TEXT,
  full_name            TEXT         NOT NULL,
  phone_number         TEXT,
  designation          TEXT,
  time_in              TEXT,           -- stored as HH:MM string
  time_out             TEXT,           -- stored as HH:MM string
  construction_project TEXT,
  notes                TEXT,
  uploaded_by_id       TEXT         REFERENCES users(id),
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_construction_attendance_date
  ON construction_attendance(record_date);
CREATE INDEX IF NOT EXISTS idx_construction_attendance_project
  ON construction_attendance(construction_project);

-- ─── GAP-11: StoreItem parent–child hierarchy ─────────────────────────
ALTER TABLE store_items
  ADD COLUMN IF NOT EXISTS parent_item_id UUID REFERENCES store_items(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_store_items_parent
  ON store_items(parent_item_id) WHERE parent_item_id IS NOT NULL;

-- ─── GAP-10: PurchaseRequestItem — allow free-text item descriptions ──
-- Make storeItemId optional and add free-text fallback
ALTER TABLE purchase_request_items
  ADD COLUMN IF NOT EXISTS item_description TEXT;

-- To make store_item_id optional, remove NOT NULL constraint:
-- (Only run this if you want to allow PRs with items not in catalogue)
-- ALTER TABLE purchase_request_items ALTER COLUMN store_item_id DROP NOT NULL;
-- NOTE: The Prisma schema PurchaseRequestItem.storeItemId must also become String?
--       before running the above line.
