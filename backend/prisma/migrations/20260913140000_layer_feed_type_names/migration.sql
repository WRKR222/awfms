-- Migration: layer_feed_type_names
--
-- Adds the 3 missing layer feed-stage names (CHICK_CRUMBS, DEVELOPER_MASH,
-- PRELAYER_MASH) to the FeedType enum, so the fixed feed-type list now
-- offered on Egg Collection and Brooder feed logging (Chick Mash, Chick
-- Crumbs, Grower's Mash, Developer's Mash, Prelayer's Mash, Layer's Mash)
-- has a matching enum value for every option. Used by
-- FeedIntakeLog.feedType and BrooderGeneralFeedLog.feedType.
--
-- ALTER TYPE ... ADD VALUE cannot run in the same transaction as a statement
-- that uses the new value — left as its own top-level statement, same as
-- every other enum-value addition in this migrations folder.

ALTER TYPE "FeedType" ADD VALUE IF NOT EXISTS 'CHICK_CRUMBS';
ALTER TYPE "FeedType" ADD VALUE IF NOT EXISTS 'DEVELOPER_MASH';
ALTER TYPE "FeedType" ADD VALUE IF NOT EXISTS 'PRELAYER_MASH';
