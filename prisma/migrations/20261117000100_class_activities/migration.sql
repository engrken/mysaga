-- CreateEnum
CREATE TYPE "ClassActivityKind" AS ENUM ('QUIZ', 'ASSIGNMENT');

-- CreateEnum
CREATE TYPE "ClassActivityStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED');

-- CreateTable
CREATE TABLE "BankQuestion" (
    "id" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "answer" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassActivity" (
    "id" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "categoryId" TEXT,
    "assessmentId" TEXT,
    "title" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "kind" "ClassActivityKind" NOT NULL,
    "status" "ClassActivityStatus" NOT NULL DEFAULT 'DRAFT',
    "maxScore" DOUBLE PRECISION NOT NULL,
    "itemWeight" DOUBLE PRECISION,
    "practice" BOOLEAN NOT NULL DEFAULT false,
    "questions" JSONB NOT NULL,
    "dueAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClassActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivitySubmission" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "answers" JSONB,
    "text" TEXT,
    "driveUrl" TEXT,
    "points" DOUBLE PRECISION,
    "feedback" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "gradedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivitySubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BankQuestion_teacherId_createdAt_idx" ON "BankQuestion"("teacherId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClassActivity_assessmentId_key" ON "ClassActivity"("assessmentId");

-- CreateIndex
CREATE INDEX "ClassActivity_subjectId_status_createdAt_idx" ON "ClassActivity"("subjectId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ActivitySubmission_enrollmentId_idx" ON "ActivitySubmission"("enrollmentId");

-- CreateIndex
CREATE INDEX "ActivitySubmission_activityId_updatedAt_idx" ON "ActivitySubmission"("activityId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ActivitySubmission_activityId_enrollmentId_key" ON "ActivitySubmission"("activityId", "enrollmentId");

-- AddForeignKey
ALTER TABLE "BankQuestion" ADD CONSTRAINT "BankQuestion_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassActivity" ADD CONSTRAINT "ClassActivity_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassActivity" ADD CONSTRAINT "ClassActivity_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivitySubmission" ADD CONSTRAINT "ActivitySubmission_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "ClassActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivitySubmission" ADD CONSTRAINT "ActivitySubmission_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

