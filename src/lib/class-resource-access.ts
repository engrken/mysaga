import { googleChatAccessToken } from "@/lib/google-chat";
import { prisma } from "@/lib/prisma";
import { googleDriveRequest, type DrivePermission } from "@/lib/google-drive";

function isAlreadyRemoved(cause: unknown) {
  return cause && typeof cause === "object" && "status" in cause && Number(cause.status) === 404;
}

export async function shareClassResourcesWithEnrollment(enrollmentId: string, schoolId: string) {
  const enrollment = await prisma.enrollment.findFirst({
    where: { id: enrollmentId, subject: { schoolId } },
    select: {
      subjectId: true,
      student: { select: { email: true, emailVerifiedAt: true } },
      subject: { select: { teacherId: true } }
    }
  });
  const email = enrollment?.student?.email?.trim().toLowerCase();
  if (!enrollment || !email || !enrollment.student?.emailVerifiedAt) {
    return { ok: true, skipped: true, shared: 0 };
  }

  const resources = await prisma.classResource.findMany({
    where: {
      subjectId: enrollment.subjectId,
      storageProvider: "GOOGLE_DRIVE",
      googleDriveFileId: { not: null },
      archivedAt: null,
      retentionDeletedAt: null
    },
    select: { id: true, googleDriveFileId: true }
  });
  if (!resources.length) return { ok: true, skipped: false, shared: 0 };

  const connection = await prisma.googleChatConnection.findUnique({
    where: { schoolId_teacherId: { schoolId, teacherId: enrollment.subject.teacherId } }
  });
  if (!connection) return { ok: false, shared: 0, error: "The clas¶»§q«^