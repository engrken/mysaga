ALTER TABLE "StudentDirectory" ADD COLUMN "section" TEXT;
ALTER TABLE "User" ADD COLUMN "section" TEXT;
ALTER TABLE "Subject" ADD COLUMN "courseProgram" TEXT;
ALTER TABLE "Subject" ADD COLUMN "yearLevel" TEXT;
ALTER TABLE "Subject" ADD COLUMN "section" TEXT;

-- Backfill class metadata from the legacy combined field where it is unambiguous.
UPDATE "Subject"
SET "courseProgram" = NULLIF(btrim(split_part("courseYear", '-', 1)), ''),
    "yearLevel" = NULLIF(btrim(split_part("courseYear", '-', 2)), '')
WHERE "courseYear" IS NOT NULL AND position('-' in "courseYear") > 0;
