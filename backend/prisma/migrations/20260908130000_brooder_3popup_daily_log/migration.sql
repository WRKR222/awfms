-- Brooder daily log redesign: 3 time-gated attendant popups (Morning ≤9am,
-- 11am popup ≤1pm, 3pm popup ≤5pm) replacing the single combined form.
--
-- 1. brooder_logs: the MORNING popup records TWO environmental readings
--    (3am + 6am) instead of the one reading MIDDAY/EVENING record — add 8
--    nullable columns for those. Existing temperature/humidity_percent/
--    light_intensity_lux/lighting_ok columns keep serving MIDDAY/EVENING.
-- 2. Add an optional log_session tag (reusing the existing BrooderLogSession
--    enum) to the sub-log tables so a feeding/mortality/treatment can be
--    traced back to which popup it was logged from. All nullable — existing
--    rows and any writes outside the 3-popup flow are unaffected.

ALTER TABLE "brooder_logs"
  ADD COLUMN "reading_3am_temperature"          DOUBLE PRECISION,
  ADD COLUMN "reading_3am_humidity_percent"     DOUBLE PRECISION,
  ADD COLUMN "reading_3am_light_intensity_lux"  INTEGER,
  ADD COLUMN "reading_3am_lighting_ok"          BOOLEAN,
  ADD COLUMN "reading_6am_temperature"          DOUBLE PRECISION,
  ADD COLUMN "reading_6am_humidity_percent"     DOUBLE PRECISION,
  ADD COLUMN "reading_6am_light_intensity_lux"  INTEGER,
  ADD COLUMN "reading_6am_lighting_ok"          BOOLEAN;

ALTER TABLE "brooder_level_feed_logs"
  ADD COLUMN "log_session" "BrooderLogSession";

ALTER TABLE "brooder_general_feed_logs"
  ADD COLUMN "log_session" "BrooderLogSession";

ALTER TABLE "brooder_level_mortality_logs"
  ADD COLUMN "log_session" "BrooderLogSession";

ALTER TABLE "brooder_general_mortality_logs"
  ADD COLUMN "log_session" "BrooderLogSession";

ALTER TABLE "brooder_treatment_logs"
  ADD COLUMN "log_session" "BrooderLogSession";
