-- ============================================================================
-- Migration: issuance_plans, issuance_plan_items, feed_consumption_plans,
--            data_upload_logs  +  FK columns on store_stock_outs
-- ----------------------------------------------------------------------------
-- These four tables exist in schema.prisma but were never committed as a
-- migration (they were pushed to a local dev DB via `prisma db push` and
-- the corresponding `prisma migrate dev` run was never committed).
-- This migration is fully idempotent — safe to re-run on any environment.
-- ============================================================================

-- ── 1. New enums ──────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "IssuancePlanType" AS ENUM ('WEEKLY', 'EMERGENCY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "IssuancePlanPhase" AS ENUM (
    'DRAFT', 'PENDING_ACCOUNTANT', 'PENDING_DIRECTOR', 'DECIDED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "IssuancePlanItemStatus" AS ENUM (
    'PENDING_ACCOUNTANT', 'PENDING_DIRECTOR', 'APPROVED', 'REJECTED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2. NotificationType enum additions (plan-related notifications) ───────────

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ISSUANCE_PLAN_SUBMITTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ISSUANCE_PLAN_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ISSUANCE_PLAN_REJECTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ISSUANCE_PLAN_DECIDED';

-- ── 3. issuance_plans ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "issuance_plans" (
  "id"              UUID                  PRIMARY KEY DEFAULT gen_random_uuid(),
  "plan_ref"        TEXT                  NOT NULL UNIQUE,
  "type"            "IssuancePlanType"    NOT NULL DEFAULT 'WEEKLY',
  "week_start_date" DATE                  NOT NULL,
  "week_end_date"   DATE                  NOT NULL,
  "phase"           "IssuancePlanPhase"   NOT NULL DEFAULT 'DRAFT',
  "notes"           TEXT,
  "created_by_id"   TEXT                  NOT NULL REFERENCES "users"("id"),
  "created_at"      TIMESTAMPTZ           NOT NULL DEFAULT now(),
  "updated_at"      TIMESTAMPTZ           NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "issuance_plans_phase_idx"
    ON "issuance_plans"("phase");
CREATE INDEX IF NOT EXISTS "issuance_plans_week_start_date_idx"
    ON "issuance_plans"("week_start_date");
CREATE INDEX IF NOT EXISTS "issuance_plans_type_phase_idx"
    ON "issuance_plans"("type", "phase");

-- ── 4. issuance_plan_items ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "issuance_plan_items" (
  "id"                       UUID                     PRIMARY KEY DEFAULT gen_random_uuid(),
  "plan_id"                  UUID                     NOT NULL
      REFERENCES "issuance_plans"("id") ON DELETE CASCADE,
  "store_item_id"            UUID                     NOT NULL REFERENCES "store_items"("id"),
  "quantity_planned"         NUMERIC(10,3)            NOT NULL,
  "unit_price_kes"           NUMERIC(10,2)            NOT NULL,
  "daily_breakdown"          JSONB,
  "quantity_issued"          NUMERIC(10,3)            NOT NULL DEFAULT 0,
  "source"                   TEXT                     NOT NULL DEFAULT 'MANUAL',
  "notes"                    TEXT,
  "status"                   "IssuancePlanItemStatus" NOT NULL DEFAULT 'PENDING_ACCOUNTANT',
  "accountant_approved_by_id" TEXT                    REFERENCES "users"("id"),
  "accountant_approved_at"   TIMESTAMPTZ,
  "director_approved_by_id"  TEXT                     REFERENCES "users"("id"),
  "director_approved_at"     TIMESTAMPTZ,
  "rejected_by_id"           TEXT                     REFERENCES "users"("id"),
  "rejected_at"              TIMESTAMPTZ,
  "rejection_reason"         TEXT,
  "created_at"               TIMESTAMPTZ              NOT NULL DEFAULT now(),
  "updated_at"               TIMESTAMPTZ              NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "issuance_plan_items_plan_id_idx"
    ON "issuance_plan_items"("plan_id");
CREATE INDEX IF NOT EXISTS "issuance_plan_items_store_item_id_idx"
    ON "issuance_plan_items"("store_item_id");
CREATE INDEX IF NOT EXISTS "issuance_plan_items_status_idx"
    ON "issuance_plan_items"("status");

-- ── 5. FK columns on store_stock_outs ─────────────────────────────────────────
-- These two columns + FK constraints link a stock-out back to the plan/item
-- that authorised it. They are optional (existing stock-outs have no plan).

ALTER TABLE "store_stock_outs"
    ADD COLUMN IF NOT EXISTS "issuance_plan_id"      UUID,
    ADD COLUMN IF NOT EXISTS "issuance_plan_item_id" UUID;

-- Add FKs only once (DROP + ADD so it is idempotent without IF NOT EXISTS on ADD CONSTRAINT)
ALTER TABLE "store_stock_outs"
    DROP CONSTRAINT IF EXISTS "store_stock_outs_issuance_plan_id_fkey";
ALTER TABLE "store_stock_outs"
    ADD CONSTRAINT "store_stock_outs_issuance_plan_id_fkey"
    FOREIGN KEY ("issuance_plan_id") REFERENCES "issuance_plans"("id");

ALTER TABLE "store_stock_outs"
    DROP CONSTRAINT IF EXISTS "store_stock_outs_issuance_plan_item_id_fkey";
ALTER TABLE "store_stock_outs"
    ADD CONSTRAINT "store_stock_outs_issuance_plan_item_id_fkey"
    FOREIGN KEY ("issuance_plan_item_id") REFERENCES "issuance_plan_items"("id");

-- ── 6. feed_consumption_plans ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "feed_consumption_plans" (
  "id"                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  "week_start_date"      DATE         NOT NULL,
  "stage"                "BatchStage" NOT NULL,
  "feed_type"            "FeedType"   NOT NULL,
  "grams_per_bird_per_day" NUMERIC(8,2) NOT NULL,
  "set_by_id"            TEXT         NOT NULL REFERENCES "users"("id"),
  "created_at"           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE ("week_start_date", "stage", "feed_type")
);

CREATE INDEX IF NOT EXISTS "feed_consumption_plans_week_start_date_idx"
    ON "feed_consumption_plans"("week_start_date");

-- ── 7. data_upload_logs ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "data_upload_logs" (
  "id"               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "upload_type"      TEXT        NOT NULL,
  "file_name"        TEXT        NOT NULL,
  "records_imported" INT         NOT NULL DEFAULT 0,
  "records_skipped"  INT         NOT NULL DEFAULT 0,
  "uploaded_by_id"   TEXT        NOT NULL REFERENCES "users"("id"),
  "uploaded_at"      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "data_upload_logs_upload_type_idx"
    ON "data_upload_logs"("upload_type");
CREATE INDEX IF NOT EXISTS "data_upload_logs_uploaded_at_idx"
    ON "data_upload_logs"("uploaded_at");
