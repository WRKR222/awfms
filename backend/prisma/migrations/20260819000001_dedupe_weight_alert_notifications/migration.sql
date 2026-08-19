-- Companion cleanup to 20260819000000_dedupe_weight_alerts_unique_batch_date.
--
-- That migration dedupes the ProductionWeightAlert rows themselves (what
-- the Production Report review page's weight-flag panel reads). But each
-- duplicate alert that was ever created also fired its own notifyRole()
-- call, which inserted its own row into the separate `notifications`
-- table (what the Director's notification bell/feed reads). Deduping
-- ProductionWeightAlert alone does NOT remove those already-sent
-- duplicate notifications — this migration does that half.
--
-- Scope: only WEIGHT_BELOW_STANDARD / WEIGHT_ABOVE_STANDARD notifications
-- (the ones WeightAlertService sends). For each (user, type, title,
-- message) group — i.e. truly identical notification text, which is what
-- a same-batch/same-day/same-figure re-upload produces — keep the
-- EARLIEST row (so the Director's original read/unread state on the
-- first-ever copy of that notification is preserved) and delete the
-- rest.
--
-- Note: if a re-upload happened to carry a corrected weight figure, that
-- produces slightly different message text and is NOT collapsed here —
-- that's treated as distinct information, not a duplicate. Going forward
-- this can't recur anyway: WeightAlertService.evaluateWeightSample now
-- notifies only on the first time a given (batch, day) is flagged.

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, type, title, message
      ORDER BY created_at ASC
    ) AS rn
  FROM "notifications"
  WHERE type IN ('WEIGHT_BELOW_STANDARD', 'WEIGHT_ABOVE_STANDARD')
)
DELETE FROM "notifications"
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
