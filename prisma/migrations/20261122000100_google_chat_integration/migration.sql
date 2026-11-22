CREATE TYPE "GoogleChatSyncStatus" AS ENUM ('PENDING', 'INVITED', 'MEMBER', 'REMOVED', 'FAILED');

CREATE TABLE "GoogleChatConnection" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "teacherId" TEXT NOT NULL,
  "googleSubject" TEXT NOT NULL,
  "googleEmail" TEXT NOT NULL,
  "encryptedAccessToken" TEXT NOT NULL,
  "encryptedRefreshToken" TEXT NOT NULL,
  "accessTokenExpiresAt" TIMESTAMP(3) NOT NULL,
  "scopes" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GoogleChatConnection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GoogleChatSpace" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "teacherId" TEXT NOT NULL,
  "spaceName" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "externalUserAllowed" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GoogleChatSpace_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GoogleChatMembershipSync" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "enrollmentId" TEXT NOT NULL,
  "studentEmail" TEXT NOT NULL,
  "googleMembershipName" TEXT,
  "status" "GoogleChatSyncStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "lastAttemptAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GoogleChatMembershipSync_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GoogleChatConnection_schoolId_teacherId_key" ON "GoogleChatConnection"("schoolId", "teacherId");
CREATE INDEX "GoogleChatConnection_schoolId_googleEmail_idx" ON "GoogleChatConnection"("schoolId", "googleEmail");
CREATE UNIQUE INDEX "GoogleChatSpace_subjectId_key" ON "GoogleChatSpace"("subjectId");
CREATE UNIQUE INDEX "GoogleChatSpace_spaceName_key" ON "GoogleChatSpace"("spaceName");
CREATE INDEX "GoogleChatSpace_schoolId_teacherId_idx" ON "GoogleChatSpace"("schoolId", "teacherId");
CREATE UNIQUE INDEX "GoogleChatMembershipSync_enrollmentId_key" ON "GoogleChatMembershipSync"("enrollmentId");
CREATE INDEX "GoogleChatMembershipSync_schoolId_status_updatedAt_idx" ON "GoogleChatMembershipSync"("schoolId", "status", "updatedAt");
CREATE INDEX "GoogleChatMembershipSync_subjectId_status_idx" ON "GoogleChatMembershipSync"("subjectId", "status");

ALTER TABLE "GoogleChatConnection" ADD CONSTRAINT "GoogleChatConnection_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GoogleChatConnection" ADD CONSTRAINT "GoogleChatConnection_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GoogleChatSpace" ADD CONSTRAINT "GoogleChatSpace_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GoogleChatSpace" ADD CONSTRAINT "GoogleChatSpace_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GoogleChatSpace" ADD CONSTRAINT "GoogleChatSpace_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GoogleChatMembershipSync" ADD CONSTRAINT "GoogleChatMembershipSync_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GoogleChatMembershipSync" ADD CONSTRAINT "GoogleChatMembershipSync_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GoogleChatMembershipSync" ADD CONSTRAINT "GoogleChatMembershipSync_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
