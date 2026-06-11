-- AlterEnum: Add BIRD_MORTALITY to HealthEventType
-- This migration adds the BIRD_MORTALITY enum value which behaves identically
-- to CULLING but semantically represents unintentional bird deaths (as opposed
-- to deliberate culling). Both brooder and production-house paths are supported.

ALTER TYPE "health_event_type" ADD VALUE IF NOT EXISTS 'BIRD_MORTALITY';
