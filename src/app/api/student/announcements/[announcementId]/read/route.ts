import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Context = { params: Promise<{ announcementId: string }> };

export async function POST(_request: Request, context: Context) {
  const student = await requireRole("STUDENT");
  if (!student) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (student.isDemo) return NextResponse.json({ error: "The public demo is read-only." }, { status: 403 });
  const { announcementId } = await context.params;
  const now = new Date();
  const enrollmentIdentity = [
    { studentUserId: student.id },
    ...(student.studentNumber ? [{ studentUserId: null, studentNumber: { equals: student.studentNumber.trim(), mode: "insensitive" as const } }] : [])
  ];
  const announcement = await prisma.announcement.findFirst({
    where: {
      id: announcementId, schoolId: student.schoolId, status: "PUBLISHED", publishAt: { lte: now },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      subject: { enrollments: { some: { OR: enrollmentIdentity } } }
    },
    select: { id: true }
  });
  if (!announcement) return NextResponse.json({ error: "Announcement not found." }, { status: 404 });
  const read = await prisma.announcementRead.upsert({
    where: { announcementId_studentId: { announcementId, studentId: student.id } },
    create: { announcementId, studentId: student.id },
    update: {}
  });
  return NextResponse.json({ readAt: read.readAt }, { headers: { "Cache-Control": "private, no-store" } });
}
