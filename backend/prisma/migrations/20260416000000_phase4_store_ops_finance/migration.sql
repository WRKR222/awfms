-- ============================================================
-- AWFMS Phase 4 Migration
-- Store Operations + Finance (Invoices, AR, Expenses, Config)
-- ============================================================

-- ─── STORE OPERATIONS ────────────────────────────────────────

CREATE TABLE "store_medication_logs" (
    "id"              TEXT NOT NULL,
    "batch_id"        TEXT NOT NULL,
    "house_id"        TEXT NOT NULL,
    "log_date"        DATE NOT NULL,
    "medication_name" TEXT NOT NULL,
    "dosage"          TEXT,
    "quantity_units"  TEXT,
    "cost_kes"        DECIMAL(12,2) NOT NULL DEFAULT 0,
    "notes"           TEXT,
    "logged_by_id"    TEXT NOT NULL,
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "store_medication_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "store_medication_logs_batch_id_log_date_idx" ON "store_medication_logs"("batch_id", "log_date");
CREATE INDEX "store_medication_logs_log_date_idx" ON "store_medication_logs"("log_date");

CREATE TABLE "store_equipment_logs" (
    "id"             TEXT NOT NULL,
    "log_date"       DATE NOT NULL,
    "equipment_name" TEXT NOT NULL,
    "event_type"     TEXT NOT NULL,
    "description"    TEXT,
    "cost_kes"       DECIMAL(12,2) NOT NULL DEFAULT 0,
    "vendor_name"    TEXT,
    "notes"          TEXT,
    "logged_by_id"   TEXT NOT NULL,
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "store_equipment_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "store_equipment_logs_log_date_idx" ON "store_equipment_logs"("log_date");

CREATE TABLE "store_vet_visit_logs" (
    "id"           TEXT NOT NULL,
    "visit_date"   DATE NOT NULL,
    "vet_name"     TEXT NOT NULL,
    "purpose"      TEXT NOT NULL,
    "batches_seen" TEXT[],
    "findings"     TEXT,
    "cost_kes"     DECIMAL(12,2) NOT NULL DEFAULT 0,
    "notes"        TEXT,
    "logged_by_id" TEXT NOT NULL,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "store_vet_visit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "store_vet_visit_logs_visit_date_idx" ON "store_vet_visit_logs"("visit_date");

CREATE TABLE "store_worker_assignments" (
    "id"              TEXT NOT NULL,
    "week_start_date" DATE NOT NULL,
    "worker_name"     TEXT NOT NULL,
    "house_id"        TEXT NOT NULL,
    "role_title"      TEXT,
    "salary_kes"      DECIMAL(12,2) NOT NULL DEFAULT 0,
    "notes"           TEXT,
    "logged_by_id"    TEXT NOT NULL,
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "store_worker_assignments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "store_worker_assignments_week_start_date_idx" ON "store_worker_assignments"("week_start_date");
CREATE INDEX "store_worker_assignments_house_id_idx" ON "store_worker_assignments"("house_id");

-- ─── EXPENSE CATEGORIES ──────────────────────────────────────

CREATE TABLE "expense_categories" (
    "id"            TEXT NOT NULL,
    "name"          TEXT NOT NULL,
    "description"   TEXT,
    "is_active"     BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" TEXT NOT NULL,
    "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "expense_categories_name_key" UNIQUE ("name")
);

-- ─── EGG PRICE SCHEDULES (multi-tier pricing) ────────────────

CREATE TABLE "egg_price_schedules" (
    "id"                   TEXT NOT NULL,
    "effective_date"       DATE NOT NULL,
    "retail_per_tray"      DECIMAL(10,2) NOT NULL,
    "wholesale_per_tray"   DECIMAL(10,2) NOT NULL,
    "broken_sellable_each" DECIMAL(8,4) NOT NULL,
    "notes"                TEXT,
    "set_by_id"            TEXT NOT NULL,
    "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "egg_price_schedules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "egg_price_schedules_effective_date_idx" ON "egg_price_schedules"("effective_date" DESC);

-- ─── EGG TALLY VERIFICATIONS (3-party next-day sign-off) ─────

CREATE TABLE "egg_tally_verifications" (
    "id"                   TEXT NOT NULL,
    "session_id"           TEXT NOT NULL,
    "verification_date"    DATE NOT NULL,
    "pm_signed_by_id"      TEXT,
    "pm_signed_at"         TIMESTAMP(3),
    "pm_row_data"          JSONB,
    "sales_signed_by_id"   TEXT,
    "sales_signed_at"      TIMESTAMP(3),
    "sales_row_data"       JSONB,
    "store_signed_by_id"   TEXT,
    "store_signed_at"      TIMESTAMP(3),
    "store_row_data"       JSONB,
    "is_locked"            BOOLEAN NOT NULL DEFAULT false,
    "locked_at"            TIMESTAMP(3),
    "final_good_eggs"      INTEGER,
    "final_full_trays"     INTEGER,
    "final_loose_eggs"     INTEGER,
    "expected_revenue_kes" DECIMAL(12,2),
    "revenue_set_by_id"    TEXT,
    "revenue_set_at"       TIMESTAMP(3),
    "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "egg_tally_verifications_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "egg_tally_verifications_session_id_key" UNIQUE ("session_id")
);

CREATE INDEX "egg_tally_verifications_session_id_idx" ON "egg_tally_verifications"("session_id");
CREATE INDEX "egg_tally_verifications_verification_date_idx" ON "egg_tally_verifications"("verification_date");

-- ─── EGG COUNTER OFFSET (system config seed) ─────────────────

INSERT INTO "system_config" ("id", "key", "value", "updated_at")
VALUES (gen_random_uuid(), 'egg_counter_offset', '0', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

-- ─── FOREIGN KEYS ─────────────────────────────────────────────

ALTER TABLE "store_medication_logs"
    ADD CONSTRAINT "store_medication_logs_batch_id_fkey"
    FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "store_medication_logs"
    ADD CONSTRAINT "store_medication_logs_logged_by_id_fkey"
    FOREIGN KEY ("logged_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "store_equipment_logs"
    ADD CONSTRAINT "store_equipment_logs_logged_by_id_fkey"
    FOREIGN KEY ("logged_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "store_vet_visit_logs"
    ADD CONSTRAINT "store_vet_visit_logs_logged_by_id_fkey"
    FOREIGN KEY ("logged_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "store_worker_assignments"
    ADD CONSTRAINT "store_worker_assignments_house_id_fkey"
    FOREIGN KEY ("house_id") REFERENCES "houses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "store_worker_assignments"
    ADD CONSTRAINT "store_worker_assignments_logged_by_id_fkey"
    FOREIGN KEY ("logged_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "expense_categories"
    ADD CONSTRAINT "expense_categories_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "egg_price_schedules"
    ADD CONSTRAINT "egg_price_schedules_set_by_id_fkey"
    FOREIGN KEY ("set_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── ALTER egg_collection_sessions: broken egg split ──────────

ALTER TABLE "egg_collection_sessions"
    ADD COLUMN IF NOT EXISTS "total_broken_empty"    INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "total_broken_sellable" INTEGER NOT NULL DEFAULT 0;

UPDATE "egg_collection_sessions"
SET "total_broken_empty"    = "total_broken_eggs",
    "total_broken_sellable" = 0
WHERE "total_broken_empty" = 0;
