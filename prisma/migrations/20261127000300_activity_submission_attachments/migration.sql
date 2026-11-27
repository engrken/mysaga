CREATE TABLE "ActivitySubmissionFile" (
  "id" TEXT NOT NULL,
  "submissionId" TEXT NOT NULL,
  "storageProvider" "StorageProvider" NOT NULL,
  "fileKey" TEXT,
  "fileUrl" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "fileSize" BIGINT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ActivitySubmissionFile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ActivitySubmissionFile_fileKey_key"
  ON "ActivitySubmissionFile"("fileKey");

CREATE INDEX "ActivitySubmissionFile_submissionId_createdAt_idx"
  ON "ActivitySubmissionFile"("submissionId", "createdAt");

ALTER TABLE "ActivitySubmissionFile"
  ADD CONSTRAINT "ActivitySubmissionFile_submissionId_fkey"
  FOREIGN KEY ("submissionId") REFERENCES "ActivitySubmission"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
