ALTER TABLE "User"
  ADD COLUMN "positionTitle" TEXT;

ALTER TABLE "School"
  ADD COLUMN "notedByName" TEXT,
  ADD COLUMN "notedByPosition" TEXT;

-- Preserve existing Dean names as the initial Noted by signatory.
UPDATE "School"
SET
  "notedByName" = COALESCE(NULLIF(BTRIM("notedByName"), ''), NULLIF(BTRIM("deanName"), '')),
  "notedByPosition" = COALESCE(NULLIF(BTRIM("notedByPosition"), ''), CASE
    WHEN NULLIF(BTRIM("deanName"), '') IS NOT NULL THEN 'Dean'
    ELSE NULL
  END);

-- Existing faculty accounts begin with the conventional Instructor title.
UPDATE "User"
SET "positionTitle" = 'Instructor'
WHERE "role" = 'TEACHER' AND "positionTitle" IS NULL;