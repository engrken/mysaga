import { prisma } from "@/lib/prisma";

export async function schoolStorageUsage(schoolId: string) {
  const [school, attachments, legacy, resources] = await Promise.all([
    prisma.school.findUnique({
      where: { id: schoolId },
      select: { storageQuotaBytes: true }
    }),
    prisma.activitySubmissionFile.aggregate({
      where: {
        storageProvider: "CLOUDFLARE_R2",
        fileKey: { not: null },
        submission: { activity: { subject: { schoolId } } }
      },
      _sum: { fileSize: true }
    }),
    prisma.activitySubmission.aggregate({
      where: {
        storageProvider: "CLOUDFLARE_R2",
        fileKey: { not: null },
        activity: { subject: { schoolId } }
      },
      _sum: { fileSize: true }
    }),
    prisma.classResource.aggregate({
      where: {
        storageProvider: "CLOUDFLARE_R2",
        fileKey: { not: null },
        archivedAt: null,
        subject: { schoolId }
      },
      _sum: { fileSize: true }
    })
  ]);
  if (!school) throw new Error("SCHOOL_NOT_FOUND");
  const attachmentBytes = attachments._sum.fileSize ?? BigInt(0);
  const legacyBytes = BigInt(legacy._sum.fileSize ?? 0);
  const resourceBytes = resources._sum.fileSize ?? BigInt(0);
  const usedBytes = attachmentBytes + legacyBytes + resourceBytes;
  const quotaBytes = school.storageQuotaBytes;
  return {
    usedBytes,
    quotaBytes,
    availableBytes: quotaBytes > usedBytes ? quotaBytes - usedBytes : BigInt(0),
    usagePercent: quotaBytes > BigInt(0) ¶»§q«^