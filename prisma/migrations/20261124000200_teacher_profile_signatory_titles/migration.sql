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

-- Keep the legacy School columns for this rollout. The currently serving
-- production application still selects School.deanName while Vercel builds
-- and promotes this profile-based version. Remove these unused columns in a
-- later migration after this version is live in production.
