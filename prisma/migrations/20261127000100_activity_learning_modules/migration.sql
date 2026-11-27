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
WHERE activity."kind" = 'QUIZ'
  AND jsonb_typeof(activity."questions") = 'array';


CREATE TABLE IF NOT EXISTS "QuizAttempt" (
  "id" TEXT NOT NULL,
  "activityId" TEXT NOT NULL,
  "enrollmentId" TEXT NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "answers" JSONB,
  "points" DOUBLE PRECISION,
  "manualGrades" JSONB,
  "feedback" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "submittedAt" TIMESTAMP(3),
  "gradedAt" TIMESTAMP(3),
  CONSTRAINT "QuizAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "QuizAttempt_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "ClassActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "QuizAttempt_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "QuizAttempt_activityId_enrollmentId_attemptNumber_key"
  ON "QuizAttempt"("activityId", "enrollmentId", "attemptNumber");
CREATE INDEX IF NOT EXISTS "QuizAttempt_activityId_submittedAt_idx"
  ON "QuizAttempt"("activityId", "submittedAt");
CREATE INDEX IF NOT EXISTS "QuizAttempt_enrollmentId_idx" ON "QuizAttempt"("enrollmentId");

INSERT INTO "QuizAttempt" (
  "id", "activityId", "enrollmentId", "attemptNumber", "answers", "points", "startedAt", "submittedAt", "gradedAt"
)
SELECT md5(random()::text || clock_timestamp()::text), s."activityId", s."enrollmentId",
  1, s."answers", s."points", s."submittedAt", s."submittedAt", s."gradedAt"
FROM "ActivitySubmission" s
JOIN "ClassActivity" a ON a."id" = s."activityId"
WHERE a."kind" = 'QUIZ'
  AND NOT EXISTS (
    SELECT 1 FROM "QuizAttempt" existing
    WHERE existing."activityId" = s."activityId" AND existing."enrollmentId" = s."enrollmentId"
  );
