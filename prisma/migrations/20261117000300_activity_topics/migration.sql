ALTER TYPE "ClassActivityKind" ADD VALUE 'RESOURCE';
ALTER TABLE "ClassActivity" ADD COLUMN "topic" TEXT;
ALTER TABLE "BankQuestion" ADD COLUMN "topic" TEXT;
CREATE INDEX "BankQuestion_teacherId_topic_createdAt_idx" ON "BankQuestion"("teacherId", "topic", "createdAt");
