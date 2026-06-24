-- ============================================================================
-- Migration: visitor_advance_notices — datetime precision + contact fields
-- ----------------------------------------------------------------------------
-- 1. expected_date was DATE (day-only) — widened to TIMESTAMP(3) so Store's
--    advance-visit form can capture an exact expected arrival time, not just
--    a day. Existing rows and the Manager flow's date-only submissions keep
--    working unchanged — they just read back with a 00:00 time component,
--    same as before.
-- 2. Added optional phone / id_number / notes — contact/identification detail
--    for supplier and delivery-driver visits logged by Store.
-- ============================================================================

ALTER TABLE "visitor_advance_notices"
  ALTER COLUMN "expected_date" TYPE TIMESTAMP(3) USING "expected_date"::timestamp;

ALTER TABLE "visitor_advance_notices" ADD COLUMN IF NOT EXISTS "phone" TEXT;
ALTER TABLE "visitor_advance_notices" ADD COLUMN IF NOT EXISTS "id_number" TEXT;
ALTER TABLE "visitor_advance_notices" ADD COLUMN IF NOT EXISTS "notes" TEXT;
