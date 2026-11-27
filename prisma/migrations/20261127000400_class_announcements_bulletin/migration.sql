CREATE TYPE "AnnouncementStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

CREATE TABLE "Announcement" (
  "id" TEXT NOT NULL, "schoolId" TEXT NOT NULL, "subjectId" TEXT NOT NULL, "authorId" TEXT NOT NULL,
  "title" TEXT NOT NULL, "body" TEXT NOT NULL,
  "status" "AnnouncementStatus" NOT NULL DEFAULT 'DRAFT',
  "isPinned" BOOLEAN NOT NULL DEFAULT false,
  "publishAt" TIMESTAMP(3), "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AnnouncementRead" (
  "id" TEXT NOT NULL, "announcementId" TEXT NOT NULL, "studentId" TEXT NOT NULL,
  "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnnouncementRead_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Announcement_schoolId_status_publishAt_idx" ON "Announcement"("schoolId", "status", "publishAt");
CREATE INDEX "Announcement_subjectId_status_isPinned_publishAt_idx" ON "Announcement"("subjectId", "status", "isPinned", "publishAt");
CREATE INDEX "Announcement_authorId_createdAt_idx" ON "Announcement"("authorId", "createdAt");
CREATE UNIQUE INDEX "AnnouncementRead_announcementId_studentId_key" ON "AnnouncementRead"("announcementId", "studentId");
CREATE INDEX "AnnouncementRead_studentId_readAt_idx" ON "AnnouncementRead"("studentId", "readAt");
ALTER TABLE "Announcement"
  ADD CONSTRAINT "Announcement_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Announcement_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Announcement_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AnnouncementRead"
  ADD CONSTRAINT "AnnouncementRead_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "AnnouncementRead_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
