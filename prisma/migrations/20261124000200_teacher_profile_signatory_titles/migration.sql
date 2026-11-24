ALTER TABLE "User"
  ADD COLUMN "notedByName" TEXT,
  ADD COLUMN "notedByPosition" TEXT;

-- Give each existing teacher an independent starting copy of the school's
-- current Noted by / Dean settings. Future changes are stored per account.
UPDATE "User" AS teacher
SET
  "notedByName" = COALESCE(
    NULLIF(BTRIM(school."notedByName"), ''),
    NULLIF(BTRIM(school."deanName"), '')
  ),
  "notedByPosition" = COALESCE(
    NULLIF(BTRIM(school."notedByPosition"), ''),
    'Dean'
  )
FROM "School" AS school
WHERE teacher."schoolId" = school."id"
  AND teacher."role" = 'TEACHER';

-- Signatories are now personal teacher-profile data, not school-wide data.
ALTER TABLE "School"
  DROP COLUMN "notedByName",
  DROP COLUMN "notedByPosition",
  DROP COLUMN "deanName";