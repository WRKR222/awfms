-- Migration: 20260629000000_brooder_early_phase_feed
--
-- Adds early-phase feed tracking to the brooder system.
--
-- Business context:
--   Day-old chicks are still learning to eat.  Feed placed on Day 1 often
--   lasts 2+ days without a second issuance.  The standard HyLine ration
--   table does NOT apply during Days 1–2 (EARLY phase) or Days 3–6
--   (TRANSITION phase).  Once consistent eating begins (Week 2+) the full
--   standard schedule applies.
--
--   Key changes:
--   1. brooder_level_feed_logs — add `feeding_phase` to record the phase
--      at the time of issuance (EARLY | TRANSITION | STANDARD), and
--      `is_advisory_only` flag so UIs can display appropriate messaging.
--   2. brooder_level_assignments — add `early_phase_residual_kg` to track
--      unconsumed feed from early days (carry-forward to next issuance plan).
--   3. issuance_plan_items — add `early_phase_residual_kg` column so the
--      store plan can show exactly how much early-phase carry-over is being
--      deducted from the new-week request.

-- ── 1. brooder_level_feed_logs: add phase metadata ───────────────────────

ALTER TABLE brooder_level_feed_logs
  ADD COLUMN IF NOT EXISTS feeding_phase     VARCHAR(20)     NOT NULL DEFAULT 'STANDARD',
  ADD COLUMN IF NOT EXISTS is_advisory_only  BOOLEAN         NOT NULL DEFAULT FALSE;

-- Backfill: any existing row is implicitly STANDARD phase
-- (the table was created after week-1 early-phase logic was not yet implemented).
UPDATE brooder_level_feed_logs
SET    feeding_phase = 'STANDARD', is_advisory_only = FALSE
WHERE  feeding_phase IS NULL;

COMMENT ON COLUMN brooder_level_feed_logs.feeding_phase IS
  'Feeding phase at time of issuance: EARLY (Days 1-2), TRANSITION (Days 3-6), or STANDARD (Week 2+).';

COMMENT ON COLUMN brooder_level_feed_logs.is_advisory_only IS
  'TRUE when the issuance was recorded during EARLY or TRANSITION phase and the daily ration cap was advisory (not enforced). FALSE for STANDARD phase where the hard cap applies.';

-- ── 2. brooder_level_assignments: track early-phase residual ─────────────

ALTER TABLE brooder_level_assignments
  ADD COLUMN IF NOT EXISTS early_phase_residual_kg DECIMAL(10, 3);

COMMENT ON COLUMN brooder_level_assignments.early_phase_residual_kg IS
  'Estimated kg of feed placed during the early phase (Days 1-2) that remained uneaten and is carried forward to reduce the next week''s store issuance request.  NULL until the batch exits the TRANSITION phase.';

-- ── 3. issuance_plan_items: split residual source for transparency ────────

ALTER TABLE issuance_plan_items
  ADD COLUMN IF NOT EXISTS early_phase_residual_kg DECIMAL(10, 3);

COMMENT ON COLUMN issuance_plan_items.early_phase_residual_kg IS
  'Portion of residual_carry_forward_kg that originates from early-phase unconsumed feed (Days 1-2). Stored separately for audit transparency so managers can distinguish carry-over from normal weekly shortfalls vs. early-phase carry-over.';

-- ── Indexes ───────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_brooder_level_feed_logs_phase
  ON brooder_level_feed_logs (feeding_phase);
