-- Migration: 20260725000000_remove_residual_carry_forward
--
-- Context:
--   The "residual feed carried forward" concept — netting an unused balance
--   from the previous week's approved issuance plan against the current
--   week's feed issuance — has been removed from both the attendant and
--   store views. Net-to-issue is now computed directly from this week's
--   schedule vs. this week's issued quantity, with no carry-forward term.
--
--   `residual_carry_forward_kg` on issuance_plan_items backed that
--   calculation and is no longer written or read anywhere in the app.

ALTER TABLE "issuance_plan_items" DROP COLUMN IF EXISTS "residual_carry_forward_kg";
