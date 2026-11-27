ALTER TYPE "ClassActivityKind" ADD VALUE IF NOT EXISTS 'LESSON';

ALTER TABLE "BankQuestion"
  ADD COLUMN IF NOT EXISTS "type" TEXT NOT NULL DEFAULT 'MULTIPLE_CHOICE',
  ADD COLUMN IF NOT EXISTS "answerText" TEXT,
  ADD COLUMN IF NOT EXISTS "points" DOUBLE PRECISION NOT NULL DEFAULT 1;

ALTER TABLE "ClassActivity"
  ADD COLUMN IF NOT EXISTS "timeLimitMinutes" INTEGER,
  ADD COLUMN IF NOT EXISTS "attemptsAllowed" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "gradingMethod" TEXT NOT NULL DEFAULT 'HIGHEST',
  ADD COLUMN IF NOT EXISTS "releaseGrade" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "releaseAnswers" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "lessonPages" JSONB;

ALTER TABLE "ActivitySubmission"
  ADD COLUMN IF NOT EXISTS "files" JSONB,
  ADD COLUMN IF NOT EXISTS "offline" BOOLEAN NOT NULL DEFAULT false;

UPDATE "BankQuestion"
SET "type" = 'TRUE_FALSE'
WHERE "options" = '["True","False"]'::jsonb
  AND "type" = 'MULTIPLE_CHOICE';

UPDATE "ClassActivity" AS activity
SET "questions" = COALESCE((
  SELECT jsonb_agg(
    question || jsonb_build_object(
      'type', COALESCE(
        question->>'type',
        CASE WHEN question->'options' = '["True","False"]'::jsonb
          THEN 'TRUE_FALSE' ELSE 'MULTIPLE_CHOICE' END
      ),
      'points', COALESCE(question->'points', to_jsonb(1))
    ) ORDER BY ordinal
  )
  FROM jsonb_array_elements(activity."questions") WITH ORDINALITY AS entry(question, ordinal)
), '[]'::jsonb)
WHERE activity¶»§q«^