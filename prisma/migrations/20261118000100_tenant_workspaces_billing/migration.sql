CREATE TYPE "TenantInvitationRole" AS ENUM ('TEACHER', 'SCHOOL_ADMIN');
CREATE TYPE "TenantInvoiceStatus" AS ENUM ('ISSUED', 'PAID', 'VOID');

ALTER TABLE "School" ADD COLUMN "billingEmail" TEXT;
ALTER TABLE "User" ADD COLUMN "isSchoolAdmin" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "TenantInvitation" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "invitedEmail" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "role" "TenantInvitationRole" NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TenantInvitation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TenantInvitation_tokenHash_key" ON "TenantInvitation"("tokenHash");
CREATE INDEX "TenantInvitation_schoolId_acceptedAt_expiresAt_idx" ON "TenantInvitation"("schoolId", "acceptedAt", "expiresAt");
ALTER TABLE "TenantInvitation" ADD CONSTRAINT "TenantInvitation_schoolId_fkey"
  FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TenantInvitation" ADD CONSTRAINT "TenantInvitation_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "TenantInvoice" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "invoiceNumber" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'PHP',
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dueAt" TIMESTAMP(3) NOT NULL,
  "status" "TenantInvoiceStatus" NOT NULL DEFAULT 'ISSUED',
  "paidAt" TIMESTAMP(3),
  "note" TEXT,
  "recordedBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TenantInvoice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TenantInvoice_invoiceNumber_key" ON "TenantInvoice"("invoiceNumber");
CREATE INDEX "TenantInvoice_schoolId_status_dueAt_idx" ON "TenantInvoice"("schoolId", "status", "dueAt");
ALTER TABLE "TenantInvoice" ADD CONSTRAINT "TenantInvoice_schoolId_fkey"
  FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "TenantInvoiceReminder" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "daysFromDue" INTEGER NOT NULL,
  "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TenantInvoiceReminder_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TenantInvoiceReminder_invoiceId_daysFromDue_key" ON "TenantInvoiceReminder"("invoiceId", "daysFromDue");
CREATE INDEX "TenantInvoiceReminder_sentAt_idx" ON "TenantInvoiceReminder"("sentAt");
ALTER TABLE "TenantInvoiceReminder" ADD CONSTRAINT "TenantInvoiceReminder_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "TenantInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
