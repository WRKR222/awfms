-- Migration: add PRICING_SET to NotificationType enum
-- Fix: pricing.service.ts was casting 'PRICING_SET' as any because the enum
--      value was missing, causing an internal server error on every price save.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'PRICING_SET'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'NotificationType')
  ) THEN
    ALTER TYPE "NotificationType" ADD VALUE 'PRICING_SET';
  END IF;
END
$$;
