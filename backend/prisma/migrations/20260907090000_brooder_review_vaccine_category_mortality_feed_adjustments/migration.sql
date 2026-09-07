-- Four independent, additive changes — none of them touch existing data:
--
-- 1. StoreItemCategory: new VACCINE category, split out of MEDICATION so
--    attendant-facing Vaccine pickers (brooder + egg collection) never show
--    supplements or treatments. Existing MEDICATION items that are actually
--    vaccines are NOT auto-reclassified — Store/PM re-tag them by hand.
--
-- 2. BrooderReviewSection enum + brooder_daily_reviews table: lets a
--    Production Manager sign off (or return for re-recording) each section
--    of a batch's brooder day — Environment / Feed / Mortality / Vaccines /
--    Supplements / Treatments — independently. This table only ever holds
--    the review outcome, never the recorded data itself, so a "return"
--    never overwrites what the attendant entered.
--
-- 3. brooder_level_mortality_logs / brooder_general_mortality_logs: new
--    fed_before_death + feed_already_eaten_kg columns so a mortality entry
--    can say whether the bird had eaten yet — the input the feed-wastage
--    calculation needs to credit that bird's ration back as surplus.
--
-- 4. egg_collection_sessions: mortality_mode + mortality_row_breakdown (+
--    the General-mode fed-before-death/feed-eaten scalars) for per-row vs.
--    whole-house mortality recording, and feed_breakdown_json to record
--    more than one feed item per session (a Grower→Developer transition
--    day as two lines instead of one blended figure).

-- 1. VACCINE category
ALTER TYPE "StoreItemCategory" ADD VALUE 'VACCINE';

-- 2. PM daily brooder review, per section
CREATE TYPE "BrooderReviewSection" AS ENUM ('ENVIRONMENT', 'FEED', 'MORTALITY', 'VACCINES', 'SUPPLEMENTS', 'TREATMENTS');

CREATE TABLE "brooder_daily_reviews" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "log_date" DATE NOT NULL,
    "section" "BrooderReviewSection" NOT NULL,
    "status" "EntryStatus" NOT NULL DEFAULT 'PENDING',
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "return_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brooder_daily_reviews_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "brooder_daily_reviews_batch_id_log_date_section_key" ON "brooder_daily_reviews"("batch_id", "log_date", "section");
CREATE INDEX "brooder_daily_reviews_batch_id_log_date_idx" ON "brooder_daily_reviews"("batch_id", "log_date");
CREATE INDEX "brooder_daily_reviews_status_idx" ON "brooder_daily_reviews"("status");

ALTER TABLE "brooder_daily_reviews" ADD CONSTRAINT "brooder_daily_reviews_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "brooder_daily_reviews" ADD CONSTRAINT "brooder_daily_reviews_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. Mortality → feed adjustment inputs
ALTER TABLE "brooder_level_mortality_logs" ADD COLUMN "fed_before_death" TEXT, ADD COLUMN "feed_already_eaten_kg" DOUBLE PRECISION;
ALTER TABLE "brooder_general_mortality_logs" ADD COLUMN "fed_before_death" TEXT, ADD COLUMN "feed_already_eaten_kg" DOUBLE PRECISION;

-- 4. Egg collection: per-row mortality mode + multi-item feed breakdown
ALTER TABLE "egg_collection_sessions"
  ADD COLUMN "mortality_mode" TEXT NOT NULL DEFAULT 'GENERAL',
  ADD COLUMN "mortality_row_breakdown" JSONB,
  ADD COLUMN "mortality_fed_before_death" TEXT,
  ADD COLUMN "mortality_feed_already_eaten_kg" DECIMAL(8,3),
  ADD COLUMN "feed_breakdown_json" JSONB;
