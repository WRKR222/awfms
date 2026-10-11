-- ============================================================================
-- Migration: Breed standards (performance-guide benchmarking) + notification
-- de-duplication. Idempotent (IF NOT EXISTS / ON CONFLICT) like the others.
-- ============================================================================

-- ── 1. Notification types + anti-spam key ──────────────────────────────────
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'STANDARD_DEVIATION';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'BREED_GUIDE_ACTIVATED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'FARM_STANDARD_PROPOSED';

ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "dedupe_key" TEXT;
CREATE INDEX IF NOT EXISTS "notifications_user_id_dedupe_key_idx" ON "notifications" ("user_id", "dedupe_key");

-- ── 2. Breeds, guides, points ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "breeds" (
  "id"         TEXT        NOT NULL,
  "code"       TEXT        NOT NULL,
  "name"       TEXT        NOT NULL,
  "bird_type"  "BirdType"  NOT NULL,
  "aliases"    TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],
  "notes"      TEXT,
  "is_active"  BOOLEAN     NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "breeds_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "breeds_code_key" ON "breeds" ("code");

CREATE TABLE IF NOT EXISTS "breed_guides" (
  "id"                TEXT NOT NULL,
  "breed_id"          TEXT NOT NULL,
  "title"             TEXT NOT NULL,
  "version_label"     TEXT NOT NULL,
  "version_year"      INTEGER NOT NULL,
  "publisher"         TEXT,
  "housing_system"    TEXT,
  "variety"           TEXT,
  "source_file_name"  TEXT,
  "status"            TEXT NOT NULL DEFAULT 'DRAFT',
  "source_kind"       TEXT NOT NULL DEFAULT 'TEMPLATE',
  "ai_interpretation" TEXT,
  "notes"             TEXT,
  "uploaded_by_id"    TEXT,
  "activated_by_id"   TEXT,
  "activated_at"      TIMESTAMP(3),
  "superseded_by_id"  TEXT,
  "superseded_at"     TIMESTAMP(3),
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "breed_guides_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "breed_guides_breed_id_version_label_variety_key" ON "breed_guides" ("breed_id", "version_label", "variety");
CREATE INDEX IF NOT EXISTS "breed_guides_breed_id_status_idx" ON "breed_guides" ("breed_id", "status");
DO $$ BEGIN
  ALTER TABLE "breed_guides" ADD CONSTRAINT "breed_guides_breed_id_fkey"
    FOREIGN KEY ("breed_id") REFERENCES "breeds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "breed_standard_points" (
  "id"           TEXT NOT NULL,
  "guide_id"     TEXT NOT NULL,
  "metric"       TEXT NOT NULL,
  "variant"      TEXT,
  "age_unit"     TEXT NOT NULL DEFAULT 'WEEK',
  "age_from"     INTEGER NOT NULL,
  "age_to"       INTEGER NOT NULL,
  "min_value"    DECIMAL(12,3),
  "target_value" DECIMAL(12,3),
  "max_value"    DECIMAL(12,3),
  "unit"         TEXT,
  "label"        TEXT,
  "phase"        TEXT,
  "text_value"   TEXT,
  "seq"          INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "breed_standard_points_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "breed_standard_points" ADD COLUMN IF NOT EXISTS "seq" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS "breed_standard_points_guide_id_metric_age_from_idx" ON "breed_standard_points" ("guide_id", "metric", "age_from");
DO $$ BEGIN
  ALTER TABLE "breed_standard_points" ADD CONSTRAINT "breed_standard_points_guide_id_fkey"
    FOREIGN KEY ("guide_id") REFERENCES "breed_guides"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 3. Farm standards (farm-proven / deliberate overrides) ─────────────────
CREATE TABLE IF NOT EXISTS "farm_standards" (
  "id"             TEXT NOT NULL,
  "breed_id"       TEXT NOT NULL,
  "metric"         TEXT NOT NULL,
  "variant"        TEXT,
  "age_unit"       TEXT NOT NULL DEFAULT 'WEEK',
  "points"         JSONB NOT NULL,
  "reason"         TEXT NOT NULL,
  "evidence"       JSONB,
  "status"         TEXT NOT NULL DEFAULT 'PROPOSED',
  "proposed_by_id" TEXT,
  "approved_by_id" TEXT,
  "approved_at"    TIMESTAMP(3),
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "farm_standards_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "farm_standards_breed_id_metric_status_idx" ON "farm_standards" ("breed_id", "metric", "status");
DO $$ BEGIN
  ALTER TABLE "farm_standards" ADD CONSTRAINT "farm_standards_breed_id_fkey"
    FOREIGN KEY ("breed_id") REFERENCES "breeds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 4. Batch: breed, recording plan, housing, lighting, nutrition ─────────
ALTER TABLE "batches" ADD COLUMN IF NOT EXISTS "breed_id" TEXT;
ALTER TABLE "batches" ADD COLUMN IF NOT EXISTS "breed_variety" TEXT;
ALTER TABLE "batches" ADD COLUMN IF NOT EXISTS "untracked_metrics" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "batches" ADD COLUMN IF NOT EXISTS "recording_plan_set_at" TIMESTAMP(3);
ALTER TABLE "batches" ADD COLUMN IF NOT EXISTS "housing_type" TEXT;
ALTER TABLE "batches" ADD COLUMN IF NOT EXISTS "housing_description" TEXT;
ALTER TABLE "batches" ADD COLUMN IF NOT EXISTS "declared_light_hours" DECIMAL(4,1);
ALTER TABLE "batches" ADD COLUMN IF NOT EXISTS "nutrition_program" TEXT NOT NULL DEFAULT 'BOTH';
CREATE INDEX IF NOT EXISTS "batches_breed_id_idx" ON "batches" ("breed_id");
DO $$ BEGIN
  ALTER TABLE "batches" ADD CONSTRAINT "batches_breed_id_fkey"
    FOREIGN KEY ("breed_id") REFERENCES "breeds"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 5. Per-batch benchmark history + declared practices ───────────────────
CREATE TABLE IF NOT EXISTS "batch_standard_metrics" (
  "id"               TEXT NOT NULL,
  "batch_id"         TEXT NOT NULL,
  "metric"           TEXT NOT NULL,
  "age_unit"         TEXT NOT NULL DEFAULT 'WEEK',
  "age_index"        INTEGER NOT NULL,
  "period_start"     DATE NOT NULL,
  "period_end"       DATE NOT NULL,
  "actual_value"     DECIMAL(12,3),
  "actual_text"      TEXT,
  "min_value"        DECIMAL(12,3),
  "target_value"     DECIMAL(12,3),
  "max_value"        DECIMAL(12,3),
  "basis"            TEXT NOT NULL,
  "guide_id"         TEXT,
  "farm_standard_id" TEXT,
  "status"           TEXT NOT NULL,
  "guide_status"     TEXT,
  "sample_size"      INTEGER,
  "notified_at"      TIMESTAMP(3),
  "computed_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "batch_standard_metrics_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "batch_standard_metrics_batch_id_metric_age_unit_age_index_key" ON "batch_standard_metrics" ("batch_id", "metric", "age_unit", "age_index");
CREATE INDEX IF NOT EXISTS "batch_standard_metrics_metric_age_index_idx" ON "batch_standard_metrics" ("metric", "age_index");
CREATE INDEX IF NOT EXISTS "batch_standard_metrics_batch_id_status_idx" ON "batch_standard_metrics" ("batch_id", "status");
DO $$ BEGIN
  ALTER TABLE "batch_standard_metrics" ADD CONSTRAINT "batch_standard_metrics_batch_id_fkey"
    FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "batch_practice_notes" (
  "id"                   TEXT NOT NULL,
  "batch_id"             TEXT NOT NULL,
  "metric"               TEXT NOT NULL,
  "practice"             TEXT NOT NULL,
  "guide_recommendation" TEXT,
  "reason"               TEXT,
  "source"               TEXT NOT NULL DEFAULT 'MANUAL',
  "effective_from"       DATE NOT NULL,
  "effective_to"         DATE,
  "recorded_by_id"       TEXT,
  "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at"           TIMESTAMP(3),
  CONSTRAINT "batch_practice_notes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "batch_practice_notes_batch_id_metric_idx" ON "batch_practice_notes" ("batch_id", "metric");
DO $$ BEGIN
  ALTER TABLE "batch_practice_notes" ADD CONSTRAINT "batch_practice_notes_batch_id_fkey"
    FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 6. Replace the De Heus rearing chart with the Hy-Line Brown guide ─────
-- (January 2024 edition). Feed = midpoint of the guide's g/bird/day range;
-- weeks 18-19 take the laying table (mortality from arrival = 2.00% + laying %).
INSERT INTO "brooder_control_standards"
  ("week","deheus_phase","feeding_grams_per_bird","deheus_weekly_intake_kg","expected_weight_min_g","expected_weight_max_g","cumulative_mortality_pct","production_trays_per_week")
VALUES
  (1,  'Starter 1', 13.0, 0.091,   70,   80, 0.40, NULL),
  (2,  'Starter 1', 19.0, 0.133,  115,  145, 0.55, NULL),
  (3,  'Starter 1', 22.5, 0.158,  190,  220, 0.65, NULL),
  (4,  'Starter 2', 27.5, 0.193,  270,  320, 0.75, NULL),
  (5,  'Starter 2', 32.5, 0.228,  360,  420, 0.85, NULL),
  (6,  'Starter 2', 39.5, 0.277,  470,  520, 0.95, NULL),
  (7,  'Grower',    45.0, 0.315,  570,  640, 1.05, NULL),
  (8,  'Grower',    51.5, 0.361,  680,  760, 1.15, NULL),
  (9,  'Grower',    56.5, 0.396,  780,  880, 1.25, NULL),
  (10, 'Grower',    60.0, 0.420,  885,  995, 1.35, NULL),
  (11, 'Grower',    64.5, 0.452,  995, 1105, 1.45, NULL),
  (12, 'Grower',    67.0, 0.469, 1095, 1205, 1.55, NULL),
  (13, 'Developer', 69.0, 0.483, 1175, 1295, 1.63, NULL),
  (14, 'Developer', 71.5, 0.501, 1265, 1365, 1.70, NULL),
  (15, 'Developer', 73.5, 0.515, 1345, 1445, 1.78, NULL),
  (16, 'Pre-Lay',   76.0, 0.532, 1410, 1510, 1.85, NULL),
  (17, 'Pre-Lay',   78.5, 0.550, 1485, 1590, 2.00, NULL),
  (18, 'Laying',    80.5, 0.564, 1550, 1670, 2.05, NULL),
  (19, 'Laying',    89.5, 0.627, 1620, 1740, 2.08, NULL)
ON CONFLICT ("week") DO UPDATE SET
  "deheus_phase"             = EXCLUDED."deheus_phase",
  "feeding_grams_per_bird"   = EXCLUDED."feeding_grams_per_bird",
  "deheus_weekly_intake_kg"  = EXCLUDED."deheus_weekly_intake_kg",
  "expected_weight_min_g"    = EXCLUDED."expected_weight_min_g",
  "expected_weight_max_g"    = EXCLUDED."expected_weight_max_g",
  "cumulative_mortality_pct" = EXCLUDED."cumulative_mortality_pct",
  "production_trays_per_week" = NULL;
