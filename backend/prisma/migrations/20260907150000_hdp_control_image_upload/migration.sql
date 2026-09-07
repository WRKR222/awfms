-- FIX: HDP% Controls can now be uploaded as a photo/scan image (read with
-- Claude's vision API), in addition to PDF/Excel/Word. This adds the new
-- enum value the upload path writes, and the column that stores the AI's
-- short interpretation of what it read from the image.

ALTER TYPE "HdpControlSourceFormat" ADD VALUE 'IMAGE';

ALTER TABLE "hdp_control_uploads" ADD COLUMN "ai_interpretation" TEXT;
