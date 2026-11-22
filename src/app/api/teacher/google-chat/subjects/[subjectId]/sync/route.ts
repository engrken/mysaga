import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { syncGoogleChatEnrollment } from "@/lib/google-chat";

export const runtime = "nodejs";
type Context = { params: Promise<{ subjectId: string }> };

export async function POST(_request: Request, context: Context) {
  const teacher = await requireRole("TEACHER");
  if (!teacher) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { subjectId } = await context.params;
  const subject = await prisma.subject.findFirst({
    where: { id: subjectId, schoolId: teacher.schoolId, teacherId: teacher.id, googleChatSpace: { isNot: null } },
    select: { id: true }
  });
  if (!subject) return NextResponse.json({ error: "Class or linked Google Chat Space not found." }, { status: 404 });
  const pendingWhere: Prisma.EnrollmentWhereInput = {
    subjectId,
    studentUserId: { not: null },
    OR: [
      { googleChatMembership: { is: null } },
      { googleChatMembership: { is: { status: { in: ["PENDING", "FAILED"] } } } }
    ]
  };
  const enrollments = await prisma.enrollment.findMany({
    where: pendingWhere, select: { id: true }, orderBy: { createdAt: "asc" }, take: 25
  });
  let synced = 0;
  let failed = 0;
  for (let i = 0; i < enrollments.length; i += 5) {
    const batch = await Promise.all(enrollments.slice(i, i + 5).map(enrollment => syncGoogleChatEnrollment(enrollment.id, teacher.schoolId)));
    for (const result of batch) {
      if (result.synced) synced++;
      else if (result.reason !== "not-configured" && result.reason !== "teacher-not-connected") failed++;
    }
  }
  const remaining = await prisma.enrollment.count({ where: pendingWhere });
  return NextResponse.json({ processed: enrollments.length, synced, failed, remaining }, { headers: { "Cache-Control": "no-store" } });
}
