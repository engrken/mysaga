ALTER TABLE "Assessment"
ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "subjectId", "categoryId"
      ORDER BY "createdAt" ASC, "id" ASC
    ) - 1 AS position
  FROM "Assessment"
)
UPDATE "Assessment" AS assessment
SET "sortOrder" = ranked.position
FROM ranked
WHERE assessment."id" = ranked."id";

DROP INDEX IF EXISTS "Assessment_subjectId_categoryId_idx";
CREATE INDEX "Assessment_subjectId_categoryId_sortOrder_idx"
ON "Assessment"("subjectId", "categoryId", "sortOrder");
