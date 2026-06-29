-- Migration: 20260629000001_brooder_log_multi_vaccine
--
-- Adds multi-vaccine and multi-supplement JSON array columns to brooder_logs.
--
-- Context:
--   The original schema stored only a single vaccineGiven + vaccineGivenDose
--   and a single supplement + supplementDose per daily log row. The frontend
--   supported adding multiple vaccines/supplements by firing parallel POST
--   requests, which raced against the once-daily uniqueness partial index and
--   caused 400 "already recorded" errors for every request after the first.
--
--   Fix: store arrays in JSONB columns. The backend now accepts a single POST
--   with vaccines[] and supplements[] arrays and writes them atomically.
--   The old single-entry columns are retained for backward compatibility
--   (populated with the first entry in each array).

ALTER TABLE brooder_logs
  ADD COLUMN IF NOT EXISTS vaccines_json    JSONB,
  ADD COLUMN IF NOT EXISTS supplements_json JSONB;

COMMENT ON COLUMN brooder_logs.vaccines_json IS
  'Array of { name, dose, route } objects for all vaccines given in this daily entry. Preferred over the legacy vaccine_given / vaccine_given_dose columns. NULL for session logs or entries with no vaccines.';

COMMENT ON COLUMN brooder_logs.supplements_json IS
  'Array of { name, dose } objects for all supplements given in this daily entry. Preferred over the legacy supplement / supplement_dose columns. NULL for session logs or entries with no supplements.';

-- Optional: back-fill existing rows that have legacy single-vaccine data
-- so they render consistently in the new UI.
UPDATE brooder_logs
SET vaccines_json = jsonb_build_array(
      jsonb_build_object(
        'name', vaccine_given,
        'dose', COALESCE(vaccine_given_dose, ''),
        'route', 'DRINKING_WATER'
      )
    )
WHERE vaccine_given IS NOT NULL
  AND log_session IS NULL
  AND vaccines_json IS NULL;

UPDATE brooder_logs
SET supplements_json = jsonb_build_array(
      jsonb_build_object(
        'name', supplement,
        'dose', COALESCE(supplement_dose, '')
      )
    )
WHERE supplement IS NOT NULL
  AND log_session IS NULL
  AND supplements_json IS NULL;

-- GIN index for efficient JSON containment queries (e.g. "find all logs with vaccine X")
CREATE INDEX IF NOT EXISTS idx_brooder_logs_vaccines_json
  ON brooder_logs USING GIN (vaccines_json)
  WHERE vaccines_json IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_brooder_logs_supplements_json
  ON brooder_logs USING GIN (supplements_json)
  WHERE supplements_json IS NOT NULL;
