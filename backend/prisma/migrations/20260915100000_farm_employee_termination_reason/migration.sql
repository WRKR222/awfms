-- Records why an employee was terminated. Nullable at the column level
-- (existing rows have no value to backfill) but required going forward by
-- FarmHRService.updateEmployee whenever status is set to TERMINATED.
ALTER TABLE "farm_employees" ADD COLUMN "termination_reason" TEXT;
