import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { syncGoogleChatEnrollment } from "@/lib/google-chat";

export const runtime = "nodejs";
type Context = { params: Promise<{ subjectId: string }> };

export async function POST(_request: Request, context: Context) {
  const teacher = await requireRole("TEACHER");
  if (!teacher) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { subjectId } = await context.params;
  const subject = await prisma.subject.findFirst({
    where: { id: subjectId, schoolId: teacher.schoolId, teacherId: teacher.id, googleChatSpace: { isNot: null } },
    select: { id: true, enrollments: { where: { studentUserId: { not: null } }, select: { id: true } } }
  });
  if (!subject) return NextResponse.json({ error: "Class or linked Google Chat Space not found." }, { status: 404 });
  let synced = 0;
  let failed = 0;
  for (const enrollment of subject.enrollments) {
    const result = await syncGoogleChatEnrollment(enrollment.id, teacher.schoolId);
    if (result.synced) synced++;
    else if (result.reason !== "not-configured" && result.reason !== "teacher-not-connected") failed++;
  }
  return NextResponse.json({ total: subject.enrollments.length, synced, failed }, { headers: { "Cache-Control": "no-store" } });
}
