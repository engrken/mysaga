CREATE TABLE "ClassAnnouncement" (
    "id" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "body" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ClassAnnouncement_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ClassAnnouncement_subjectId_publishedAt_idx" ON "ClassAnnouncement"("subjectId", "publishedAt");
CREATE INDEX "ClassAnnouncement_subjectId_archivedAt_pinned_publishedAt_idx" ON "ClassAnnouncement"("subjectId", "archivedAt", "pinned", "publishedAt");
ALTER TABLE "ClassAnnouncement" ADD CONSTRAINT "ClassAnnouncement_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "School"
ADD COLUMN "storageQuotaBytes" BIGINT NOT NULL DEFAULT 10737418240;

ALTER TABLE "ActivitySubmission"
ADD COLUMN "retentionNotice30At" TIMESTAMP(3),
ADD COLUMN "retentionNotice7At" TIMESTAMP(3),
ADD COLUMN "retentionDeletedAt" TIMESTAMP(3);

ALTER TABLE "ActivitySubmissionFile"
ADD COLUMN "retentionNotice30At" TIMESTAMP(3),
ADD COLUMN "retentionNotice7At" TIMESTAMP(3);

CREATE INDEX "ActivitySubmissionFile_retention_idx"
ON "ActivitySubmissionFile"("storageProvider", "createdAt", "retentionNotice30At", "retentionNotice7At");
CREATE INDEX "Activit¶»§q«^