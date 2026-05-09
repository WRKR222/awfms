-- Migration: Drop store operations tables + Add next-of-kin to farm_employees
-- Path: backend/prisma/migrations/20260509120000_stores_role_cleanup/migration.sql

-- 1. DROP OPERATIONS TABLES (clean removal)
DROP TABLE IF EXISTS "store_worker_assignments" CASCADE;
DROP TABLE IF EXISTS "store_vet_visit_logs" CASCADE;
DROP TABLE IF EXISTS "store_equipment_logs" CASCADE;
DROP TABLE IF EXISTS "store_medication_logs" CASCADE;

-- 2. ADD NEXT-OF-KIN + CONTACT FIELDS TO farm_employees
ALTER TABLE "farm_employees" ADD COLUMN IF NOT EXISTS "email" TEXT;
ALTER TABLE "farm_employees" ADD COLUMN IF NOT EXISTS "assignment" TEXT;
ALTER TABLE "farm_employees" ADD COLUMN IF NOT EXISTS "next_of_kin_name" TEXT;
ALTER TABLE "farm_employees" ADD COLUMN IF NOT EXISTS "next_of_kin_phone" TEXT;
ALTER TABLE "farm_employees" ADD COLUMN IF NOT EXISTS "next_of_kin_relation" TEXT;
