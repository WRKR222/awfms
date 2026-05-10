-- ============================================================================
-- AWFMS: Egg Pricing Connection — Migration
-- File: prisma/migrations/egg_pricing_connection/migration.sql
--
-- FIX-04: Store finalStarterEggs + finalBrokenSellable at tally lock time
--         so the locked tally record is a complete egg-category audit trail.
-- ============================================================================

ALTER TABLE egg_tally_verifications
  ADD COLUMN IF NOT EXISTS final_starter_eggs    INTEGER,
  ADD COLUMN IF NOT EXISTS final_broken_sellable INTEGER;

-- Index for efficient accountant pricing queries
CREATE INDEX IF NOT EXISTS idx_tally_verif_locked_date
  ON egg_tally_verifications(is_locked, verification_date DESC)
  WHERE is_locked = true;
