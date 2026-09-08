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

ALTER TABLE "brooder_level_mortality_logs"
  ADD COLUMN "fed_before_death" BOOLEAN,
  ADD COLUMN "feed_already_eaten_kg" DECIMAL;

ALTER TABLE "brooder_general_mortality_logs"
  ADD COLUMN "fed_before_death" BOOLEAN,
  ADD COLUMN "feed_already_eaten_kg" DECIMAL;
