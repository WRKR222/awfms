-- ============================================================================
-- Migration: ProductionWeightAlert + BirdWeightReportUpload
-- ----------------------------------------------------------------------------
-- Both models (and the three enums ProductionWeightAlert depends on) are
-- declared in schema.prisma but no migration was ever generated for them,
-- so neither table exists on the deployed database while the generated
-- Prisma client already queries them. Same drift class as the
-- bird_weight_samples column fixes in the two preceding migrations.
-- Idempotent (IF NOT EXISTS / DO $$ ... EXCEPTION guards for the enums).
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE "WeightAlertSource" AS ENUM ('PRODUCTION_REPORT', 'FARM_EVENT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "WeightAlertDirection" AS ENUM ('BELOW_MIN', 'ABOVE_MAX');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "WeightAlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "production_weight_alerts" (
  "id"                 TEXT NOT NULL,
  "batch_id"           TEXT NOT NULL,
  "source"             "WeightAlertSource" NOT NULL,
  "source_id"          TEXT,
  "sample_date"        DATE NOT NULL,
  "sample_count"       INTEGER,
  "average_weight_g"   DECIMAL(8,2) NOT NULL,
  "standard_min_g"     INTEGER NOT NULL,
  "standard_max_g"     INTEGER NOT NULL,
  "age_weeks"          INTEGER NOT NULL,
  "direction"          "WeightAlertDirection" NOT NULL,
  "deviation_g"        DECIMAL(8,2) NOT NULL,
  "deviation_pct"      DECIMAL(6,2) NOT NULL,
  "feed_context"       JSONB,
  "mortality_context"  JSONB,
  "ai_analysis"        TEXT,
  "status"             "WeightAlertStatus" NOT NULL DEFAULT 'OPEN',
  "acknowledged_by_id" TEXT,
  "acknowledged_at"    TIMESTAMP(3),
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "production_weight_alerts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "production_weight_alerts_batch_id_sample_date_idx"
  ON "production_weight_alerts" ("batch_id", "sample_date");

CREATE INDEX IF NOT EXISTS "production_weight_alerts_status_idx"
  ON "production_weight_alerts" ("status");

DO $$ BEGIN
  ALTER TABLE "production_weight_alerts"
    ADD CONSTRAINT "production_weight_alerts_batch_id_fkey"
    FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "bird_weight_report_uploads" (
  "id"             TEXT NOT NULL,
  "file_name"      TEXT NOT NULL,
  "rows"           JSONB NOT NULL,
  "row_count"      INTEGER NOT NULL,
  "uploaded_by_id" TEXT NOT NULL,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "bird_weight_report_uploads_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "bird_weight_report_uploads_uploaded_by_id_created_at_idx"
  ON "bird_weight_report_uploads" ("uploaded_by_id", "created_at");
