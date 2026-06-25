-- ============================================================================
-- Migration: Fix vaccine dose column name drift
-- ----------------------------------------------------------------------------
-- The 20260626000000_brooder_daily_log_v2 migration physically added the
-- column as "vaccine_dose", but prisma/schema.prisma's BrooderLog.vaccineGivenDose
-- field is mapped to "vaccine_given_dose". This left Prisma Client out of sync
-- with the real table — any query touching this field would fail at runtime.
-- Renaming here brings the DB back in line with the schema. Idempotent: only
-- renames if the old name still exists and the new name doesn't yet.
-- ============================================================================

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'brooder_logs' AND column_name = 'vaccine_dose'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'brooder_logs' AND column_name = 'vaccine_given_dose'
  ) THEN
    ALTER TABLE "brooder_logs" RENAME COLUMN "vaccine_dose" TO "vaccine_given_dose";
  END IF;
END $$;
