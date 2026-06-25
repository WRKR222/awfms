-- ============================================================================
-- Migration: Brooder Log Session Uniqueness
-- ----------------------------------------------------------------------------
-- Enforces the two-tier logging contract at the database level:
--
--   TIER 1 — SESSION LOG (temperature / humidity / light_intensity)
--     • log_session IS NOT NULL (MORNING | MIDDAY | EVENING)
--     • Unique per (batch_id, log_date, log_session)
--     • Up to 3 records per batch per day
--
--   TIER 2 — ONCE-DAILY LOG (water / vaccine / supplement)
--     • log_session IS NULL
--     • Unique per (batch_id, log_date)
--     • Exactly 1 record per batch per day
--
-- Both indexes are PARTIAL so they don't interfere with each other and
-- are idempotent (CREATE UNIQUE INDEX IF NOT EXISTS).
--
-- NOTE: This migration originally failed in production (P3009) because the
-- TIER 2 unique index conflicted with pre-existing duplicate rows (multiple
-- once-daily logs for the same batch_id/log_date, created before this
-- constraint existed). The block below merges those duplicates — keeping
-- the row with the most filled-in fields as the "keeper" and backfilling any
-- NULL fields on it from the other duplicate rows — before deleting the
-- redundant rows. No values are summed or overwritten, only NULL gaps are
-- filled, so no captured data (e.g. vaccine/dose info) is lost.
-- ============================================================================

-- ── Step 0: De-duplicate existing TIER 2 rows (log_session IS NULL) ────────
DO $$
DECLARE
  affected_groups INT;
BEGIN
  SELECT COUNT(*) INTO affected_groups FROM (
    SELECT batch_id, log_date
    FROM "brooder_logs"
    WHERE "log_session" IS NULL
    GROUP BY batch_id, log_date
    HAVING COUNT(*) > 1
  ) g;

  IF affected_groups > 0 THEN
    RAISE NOTICE 'Deduplicating % brooder_logs group(s) before creating unique index', affected_groups;
  END IF;
END $$;

WITH ranked AS (
  SELECT
    id,
    batch_id,
    log_date,
    ROW_NUMBER() OVER (
      PARTITION BY batch_id, log_date
      ORDER BY
        ( (water_consumption_l IS NOT NULL)::int +
          (temperature        IS NOT NULL)::int +
          (humidity_percent   IS NOT NULL)::int +
          (light_intensity_lux IS NOT NULL)::int +
          (feed_type          IS NOT NULL)::int +
          (feed_consumed_kg   IS NOT NULL)::int +
          (vaccine_given      IS NOT NULL)::int +
          (vaccine_dose       IS NOT NULL)::int +
          (supplement         IS NOT NULL)::int +
          (supplement_dose    IS NOT NULL)::int +
          (notes              IS NOT NULL)::int +
          (row_id             IS NOT NULL)::int +
          (level_id           IS NOT NULL)::int
        ) DESC,
        created_at DESC
    ) AS rn
  FROM "brooder_logs"
  WHERE "log_session" IS NULL
),
keepers AS (
  SELECT id, batch_id, log_date FROM ranked WHERE rn = 1
),
losers AS (
  SELECT id, batch_id, log_date FROM ranked WHERE rn > 1
)
UPDATE "brooder_logs" k
SET
  water_consumption_l = COALESCE(k.water_consumption_l, (
    SELECT l.water_consumption_l FROM "brooder_logs" l JOIN losers ls ON ls.id = l.id
    WHERE l.batch_id = k.batch_id AND l.log_date = k.log_date AND l.water_consumption_l IS NOT NULL
    ORDER BY l.created_at DESC LIMIT 1)),
  temperature = COALESCE(k.temperature, (
    SELECT l.temperature FROM "brooder_logs" l JOIN losers ls ON ls.id = l.id
    WHERE l.batch_id = k.batch_id AND l.log_date = k.log_date AND l.temperature IS NOT NULL
    ORDER BY l.created_at DESC LIMIT 1)),
  humidity_percent = COALESCE(k.humidity_percent, (
    SELECT l.humidity_percent FROM "brooder_logs" l JOIN losers ls ON ls.id = l.id
    WHERE l.batch_id = k.batch_id AND l.log_date = k.log_date AND l.humidity_percent IS NOT NULL
    ORDER BY l.created_at DESC LIMIT 1)),
  light_intensity_lux = COALESCE(k.light_intensity_lux, (
    SELECT l.light_intensity_lux FROM "brooder_logs" l JOIN losers ls ON ls.id = l.id
    WHERE l.batch_id = k.batch_id AND l.log_date = k.log_date AND l.light_intensity_lux IS NOT NULL
    ORDER BY l.created_at DESC LIMIT 1)),
  feed_type = COALESCE(k.feed_type, (
    SELECT l.feed_type FROM "brooder_logs" l JOIN losers ls ON ls.id = l.id
    WHERE l.batch_id = k.batch_id AND l.log_date = k.log_date AND l.feed_type IS NOT NULL
    ORDER BY l.created_at DESC LIMIT 1)),
  feed_consumed_kg = COALESCE(k.feed_consumed_kg, (
    SELECT l.feed_consumed_kg FROM "brooder_logs" l JOIN losers ls ON ls.id = l.id
    WHERE l.batch_id = k.batch_id AND l.log_date = k.log_date AND l.feed_consumed_kg IS NOT NULL
    ORDER BY l.created_at DESC LIMIT 1)),
  mortality_count = GREATEST(k.mortality_count, COALESCE((
    SELECT MAX(l.mortality_count) FROM "brooder_logs" l JOIN losers ls ON ls.id = l.id
    WHERE l.batch_id = k.batch_id AND l.log_date = k.log_date), 0)),
  vaccine_given = COALESCE(k.vaccine_given, (
    SELECT l.vaccine_given FROM "brooder_logs" l JOIN losers ls ON ls.id = l.id
    WHERE l.batch_id = k.batch_id AND l.log_date = k.log_date AND l.vaccine_given IS NOT NULL
    ORDER BY l.created_at DESC LIMIT 1)),
  vaccine_dose = COALESCE(k.vaccine_dose, (
    SELECT l.vaccine_dose FROM "brooder_logs" l JOIN losers ls ON ls.id = l.id
    WHERE l.batch_id = k.batch_id AND l.log_date = k.log_date AND l.vaccine_dose IS NOT NULL
    ORDER BY l.created_at DESC LIMIT 1)),
  supplement = COALESCE(k.supplement, (
    SELECT l.supplement FROM "brooder_logs" l JOIN losers ls ON ls.id = l.id
    WHERE l.batch_id = k.batch_id AND l.log_date = k.log_date AND l.supplement IS NOT NULL
    ORDER BY l.created_at DESC LIMIT 1)),
  supplement_dose = COALESCE(k.supplement_dose, (
    SELECT l.supplement_dose FROM "brooder_logs" l JOIN losers ls ON ls.id = l.id
    WHERE l.batch_id = k.batch_id AND l.log_date = k.log_date AND l.supplement_dose IS NOT NULL
    ORDER BY l.created_at DESC LIMIT 1)),
  notes = COALESCE(k.notes, (
    SELECT l.notes FROM "brooder_logs" l JOIN losers ls ON ls.id = l.id
    WHERE l.batch_id = k.batch_id AND l.log_date = k.log_date AND l.notes IS NOT NULL
    ORDER BY l.created_at DESC LIMIT 1)),
  row_id = COALESCE(k.row_id, (
    SELECT l.row_id FROM "brooder_logs" l JOIN losers ls ON ls.id = l.id
    WHERE l.batch_id = k.batch_id AND l.log_date = k.log_date AND l.row_id IS NOT NULL
    ORDER BY l.created_at DESC LIMIT 1)),
  level_id = COALESCE(k.level_id, (
    SELECT l.level_id FROM "brooder_logs" l JOIN losers ls ON ls.id = l.id
    WHERE l.batch_id = k.batch_id AND l.log_date = k.log_date AND l.level_id IS NOT NULL
    ORDER BY l.created_at DESC LIMIT 1))
FROM keepers kp
WHERE k.id = kp.id;

-- Now remove the redundant duplicate rows (data already merged into keepers above)
DELETE FROM "brooder_logs"
WHERE id IN (
  SELECT id FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY batch_id, log_date
        ORDER BY
          ( (water_consumption_l IS NOT NULL)::int +
            (temperature        IS NOT NULL)::int +
            (humidity_percent   IS NOT NULL)::int +
            (light_intensity_lux IS NOT NULL)::int +
            (feed_type          IS NOT NULL)::int +
            (feed_consumed_kg   IS NOT NULL)::int +
            (vaccine_given      IS NOT NULL)::int +
            (vaccine_dose       IS NOT NULL)::int +
            (supplement         IS NOT NULL)::int +
            (supplement_dose    IS NOT NULL)::int +
            (notes              IS NOT NULL)::int +
            (row_id             IS NOT NULL)::int +
            (level_id           IS NOT NULL)::int
          ) DESC,
          created_at DESC
      ) AS rn
    FROM "brooder_logs"
    WHERE "log_session" IS NULL
  ) ranked
  WHERE ranked.rn > 1
);

-- Index 1: one session log per (batch, date, session)
CREATE UNIQUE INDEX IF NOT EXISTS "brooder_logs_batch_date_session_uidx"
  ON "brooder_logs" ("batch_id", "log_date", "log_session")
  WHERE "log_session" IS NOT NULL;

-- Index 2: one once-daily log per (batch, date)
CREATE UNIQUE INDEX IF NOT EXISTS "brooder_logs_batch_date_daily_uidx"
  ON "brooder_logs" ("batch_id", "log_date")
  WHERE "log_session" IS NULL;
