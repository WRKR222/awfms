-- Persist what egg type an advance booking is for (was previously used only
-- transiently for price lookup and thrown away, so fulfillBooking() had no
-- way to carry it onto the resulting SalesOrderItem).
ALTER TABLE "advance_bookings" ADD COLUMN "egg_type" TEXT NOT NULL DEFAULT 'STANDARD_EGGS';

-- BOOKING_FULFILLED was referenced by bookings.service.ts::fulfillBooking()
-- but never added to the enum, so fulfilling a booking crashed the
-- notification step of every fulfillment.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'BOOKING_FULFILLED';
