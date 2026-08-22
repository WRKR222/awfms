-- Fixes recurring "Unique constraint failed on the fields: (`plan_ref`)"
-- errors on issuance_plans.
--
-- Root cause: IssuancePlanService generated planRef from
-- `issuancePlan.count() + 1` (a read), then `create()`'d the row (a
-- separate write) a moment later. Those two steps aren't atomic, so
-- concurrent callers (two Store users submitting around the same time,
-- an auto-draft firing alongside a manual create, a burst of requests)
-- can read the same count, compute the same planRef, and collide on the
-- unique constraint. An application-level retry loop was tried first but
-- still lost under real concurrency (observed: 4 collisions on the same
-- ref back to back), because retrying a racy read doesn't remove the
-- race, it just narrows the window.
--
-- Fix: a dedicated counter table incremented with a single atomic
-- `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` statement. Postgres
-- guarantees that statement can't hand the same value to two callers, so
-- the race is closed at the database level instead of retried around.
--
-- The counter is seeded from the current issuance_plans row count so
-- numbering continues from where it left off rather than restarting at 1.

CREATE TABLE "ref_counters" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ref_counters_pkey" PRIMARY KEY ("key")
);

INSERT INTO "ref_counters" ("key", "value")
VALUES ('issuance_plan', (SELECT COUNT(*) FROM "issuance_plans"))
ON CONFLICT ("key") DO NOTHING;
