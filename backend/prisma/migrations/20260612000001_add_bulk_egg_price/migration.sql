-- Migration: add price_per_egg_bulk to daily_egg_prices
-- pricePerEggBulk = price applied when a single order/booking contains >= 330 STANDARD eggs
-- pricePerEgg     = price applied when 1–329 STANDARD eggs are sold (unchanged field)

ALTER TABLE daily_egg_prices
  ADD COLUMN IF NOT EXISTS price_per_egg_bulk DECIMAL(8, 4) NULL;
