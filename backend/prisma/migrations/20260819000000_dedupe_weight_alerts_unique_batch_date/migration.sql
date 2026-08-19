-- Fix: production report re-uploads (or updated reports whose date range
-- overlaps previously-flagged days) were minting a brand-new
-- ProductionWeightAlert every single time reconcileWeight() ran for a
-- given row, even when a Director had already acknowledged/resolved the
-- flag for that exact batch + day. Result: the same week's flag piling up
-- duplicated on every re-upload, both in the report review UI and in the
-- Director's notification feed.
--
-- This migration:
--   1. Deduplicates any existing duplicate rows for the same
--      (batch_id, sample_date), keeping the one a Director has already
--      acted on (RESOLVED > ACKNOWLEDGED > OPEN) and, among ties, the most
--      recently created row (freshest feed/mortality context + AI read).
--   2. Adds a UNIQUE constraint on (batch_id, sample_date) so the
--      application layer can upsert instead of insert going forward (see
--      WeightAlertService.evaluateWeightSample).

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY batch_id, sample_date
      ORDER BY
        CASE status
          WHEN 'RESOLVED' THEN 0
          WHEN 'ACKNOWLEDGED' THEN 1
          ELSE 2
        END,
        created_at DESC
    ) AS rn
  FROM "production_weight_alerts"
)
DELETE FROM "production_weight_alerts"
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

DROP INDEX IF EXISTS "production_weight_alerts_batch_id_sample_date_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "production_weight_alerts_batch_id_sample_date_key"
  ON "production_weight_alerts" ("batch_id", "sample_date");
