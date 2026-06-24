-- ============================================================================
-- Migration: Brooder Feed, Weight & Mortality Control Standards
-- ----------------------------------------------------------------------------
-- Implements the HyLine Brown rearing schedule as a control standard table,
-- adds per-level mortality tracking with row/level granularity, adds a
-- weekly residual feed carry-forward column to BrooderLevelFeedLog, and
-- registers the new notification types used for threshold alerts.
-- ============================================================================

-- ── 1. HyLine Brown rearing standard table ───────────────────────────────────
-- One row per week (weeks 1-19, matching the chart). Ignored columns per spec:
--   "Surviving Birds" (batch-size specific) and
--   "Total Weekly Feed for the Flock (Bags)" (batch-size specific).

CREATE TABLE IF NOT EXISTS "brooder_control_standards" (
  "id"                       UUID        NOT NULL DEFAULT gen_random_uuid(),
  "week"                     INTEGER     NOT NULL,               -- 1-19
  "deheus_phase"             TEXT        NOT NULL,               -- e.g. 'Starter Crumbs'
  "feeding_grams_per_bird"   DECIMAL(8,2) NOT NULL,             -- g/bird/day
  "deheus_weekly_intake_kg"  DECIMAL(8,3) NOT NULL,             -- kg/bird/week
  "expected_weight_min_g"    DECIMAL(10,2) NOT NULL,            -- HyLine min (g)
  "expected_weight_max_g"    DECIMAL(10,2) NOT NULL,            -- HyLine max (g)
  "cumulative_mortality_pct" DECIMAL(5,2) NOT NULL,             -- cumulative % mortality ceiling
  "production_trays_per_week" DECIMAL(8,2),                     -- non-null only from wk 18
  "created_at"               TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "brooder_control_standards_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "brooder_control_standards_week_unique" UNIQUE ("week")
);

-- Seed with HyLine Brown rearing data from the provided chart
INSERT INTO "brooder_control_standards"
  ("week","deheus_phase","feeding_grams_per_bird","deheus_weekly_intake_kg","expected_weight_min_g","expected_weight_max_g","cumulative_mortality_pct","production_trays_per_week")
VALUES
  (1,  'Starter Crumbs', 16.5, 0.12, 110.0, 117.0, 0.4,  NULL),
  (2,  'Starter Crumbs', 18.5, 0.13, 119.0, 126.0, 0.6,  NULL),
  (3,  'Starter Crumbs', 22.0, 0.15, 186.0, 197.0, 0.7,  NULL),
  (4,  'Starter Crumbs', 27.0, 0.19, 266.0, 281.0, 0.8,  NULL),
  (5,  'Starter Crumbs', 32.0, 0.22, 357.0, 377.0, 0.9,  NULL),
  (6,  'Starter Crumbs', 38.5, 0.27, 456.0, 482.0, 1.0,  NULL),
  (7,  'Grower',         44.5, 0.31, 561.0, 593.0, 1.1,  NULL),
  (8,  'Grower',         50.0, 0.35, 668.0, 706.0, 1.2,  NULL),
  (9,  'Grower',         55.0, 0.39, 772.0, 816.0, 1.3,  NULL),
  (10, 'Grower',         59.0, 0.41, 871.0, 921.0, 1.4,  NULL),
  (11, 'Developer',      63.0, 0.44, 963.0, 1018.0, 1.5, NULL),
  (12, 'Developer',      65.5, 0.46, 1046.0,1105.0, 1.6, NULL),
  (13, 'Developer',      68.0, 0.48, 1120.0,1184.0, 1.6, NULL),
  (14, 'Developer',      70.5, 0.49, 1186.0,1254.0, 1.7, NULL),
  (15, 'Developer',      72.5, 0.51, 1246.0,1317.0, 1.8, NULL),
  (16, 'Developer',      75.5, 0.53, 1302.0,1377.0, 1.9, NULL),
  (17, 'Prelayer',       79.5, 0.56, 1357.0,1434.0, 2.0, NULL),
  (18, 'Prelayer',       83.5, 0.58, 1411.0,1492.0, 2.0, 3.1),
  (19, 'Prelayer',       89.0, 0.62, 1467.0,1551.0, 2.1, 337.2)
ON CONFLICT ("week") DO NOTHING;

-- ── 2. Per-level mortality log (Row + Level granularity) ─────────────────────
-- Separate from BrooderLog (batch-wide). Records every mortality/culling
-- event pinpointed to an exact cage position. The service also decrements
-- BrooderLevelAssignment.bird_count and Batch.current_bird_count on insert.

CREATE TABLE IF NOT EXISTS "brooder_level_mortality_logs" (
  "id"              UUID        NOT NULL DEFAULT gen_random_uuid(),
  "level_id"        UUID        NOT NULL,
  "batch_id"        UUID        NOT NULL,
  "log_date"        DATE        NOT NULL,
  "mortality_count" INTEGER     NOT NULL DEFAULT 0,
  "culling_count"   INTEGER     NOT NULL DEFAULT 0,
  "cause"           TEXT,                                        -- MortalityCause value
  "notes"           TEXT,
  "logged_by_id"    UUID        NOT NULL,
  "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "brooder_level_mortality_logs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "brooder_level_mortality_logs_level_fk"
    FOREIGN KEY ("level_id") REFERENCES "brooder_levels"("id") ON DELETE CASCADE,
  CONSTRAINT "brooder_level_mortality_logs_batch_fk"
    FOREIGN KEY ("batch_id") REFERENCES "batches"("id"),
  CONSTRAINT "brooder_level_mortality_logs_user_fk"
    FOREIGN KEY ("logged_by_id") REFERENCES "users"("id")
);

CREATE INDEX IF NOT EXISTS "brooder_level_mortality_logs_level_date_idx"
  ON "brooder_level_mortality_logs"("level_id", "log_date");
CREATE INDEX IF NOT EXISTS "brooder_level_mortality_logs_batch_idx"
  ON "brooder_level_mortality_logs"("batch_id");

-- ── 3. Residual feed balance carry-forward on IssuancePlan ───────────────────
-- When the previous week's issuance plan closes out with unused feed,
-- the residual must be deducted from the next week's plan (req 4).
-- We track it as a nullable decimal on IssuancePlanItem — stores stores can
-- see "this item already has Xkg residual from last week".

ALTER TABLE "issuance_plan_items"
  ADD COLUMN IF NOT EXISTS "residual_carry_forward_kg" DECIMAL(10,3);

-- ── 4. Register new NotificationType enum values ──────────────────────────────
-- BROODER_FEED_OVERISSUE  — feed issuance exceeds the calculated ration
-- BROODER_WEIGHT_ANOMALY  — weighed sample outside HyLine min/max band
-- BROODER_MORTALITY_HIGH  — cumulative mortality % exceeds week standard

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'BROODER_FEED_OVERISSUE';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'BROODER_WEIGHT_ANOMALY';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'BROODER_MORTALITY_HIGH';
