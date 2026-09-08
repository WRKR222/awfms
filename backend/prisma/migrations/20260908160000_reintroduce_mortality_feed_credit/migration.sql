-- Re-introduces the "did this bird eat today's feed before it died"
-- capture that 20260908110000_remove_mortality_feed_surplus_system dropped,
-- redesigned and scoped more narrowly than before:
--
--   * BROODER ONLY (brooder_level_mortality_logs /
--     brooder_general_mortality_logs). The old system also touched
--     egg_collection_sessions (production stage) — that is NOT re-added
--     here; production-stage feed wastage (FeedWastageService.
--     recordProductionOverIssuance) does not currently read a mortality
--     feed-credit at all, and re-adding it there is a separate follow-up.
--   * Both fields stay fully OPTIONAL — an attendant is never blocked from
--     submitting a mortality log without them, matching the 3-popup daily
--     log's "not everything needs to be filled in" rule.
--   * Consumed by FeedWastageService.getTodaysMortalityFeedCreditKg(), which
--     nets the uneaten portion of today's standard per-bird ration out of
--     the day's "required" figure before flagging over-issuance, AND by
--     FeedWastageService.notifyStoreOfMortalityFeedCredit(), which alerts
--     the Store role right when a mortality carrying these fields is logged
--     so they can adjust today's issuance / tomorrow's planning.
--
-- fed_before_death: null = not captured (no credit assumed). false = died
-- before today's feed reached them — full per-bird ration credited.
-- true = feed_already_eaten_kg is the attendant's estimate of what they'd
-- already eaten; only the remainder is credited.

-- IF NOT EXISTS: these exact column names were DROPPED from these exact two
-- tables by 20260908110000_remove_mortality_feed_surplus_system earlier in
-- the same migration history. If that drop hasn't actually reached this
-- database yet (or an earlier attempt at THIS migration partially applied
-- before failing), a plain ADD COLUMN fails with "column already exists" —
-- IF NOT EXISTS makes this migration safe to (re-)run regardless of which
-- of those already happened here.
ALTER TABLE "brooder_level_mortality_logs"
  ADD COLUMN IF NOT EXISTS "fed_before_death" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "feed_already_eaten_kg" DECIMAL;

ALTER TABLE "brooder_general_mortality_logs"
  ADD COLUMN IF NOT EXISTS "fed_before_death" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "feed_already_eaten_kg" DECIMAL;
