-- Migration: Add REJECTED value to LPOStatus enum
-- Safe to apply: ALTER TYPE ADD VALUE is idempotent via DO block

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'REJECTED'
      AND enumtypid = (
        SELECT oid FROM pg_type WHERE typname = 'LPOStatus'
      )
  ) THEN
    ALTER TYPE "LPOStatus" ADD VALUE 'REJECTED' AFTER 'APPROVED';
  END IF;
END$$;
