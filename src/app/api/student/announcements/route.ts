import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const student = await requireRole("STUDENT");
  if (!student) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (student.isDemo) return NextResponse.json({ announcements: [] }, { headers: { "Cache-Control": "private, no-store" } });
  const now = new Date();
  const enrollmentIdentity = [
    { studentUserId: student.id },
    ...(student.studentNumber ? [{ studentUserId: null, studentNumber: { equals: student.studentNumber.trim(), mode: "insensitive" as const } }] : [])
  ];
  const announcements = await prisma.announcement.findMany({
    where: {
      schoolId: student.schoolId, status: "PUBLISHED", publishAt: { lte: now },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      subject: { enrollments: { some: { OR: enrollmentIdentity } } }
    },
    orderBy: [{ isPinned: "desc" }, { publishAt: "desc" }, { createdAt: "desc" }],
    include: {
      subject: { select: { id: true, classId: true, code: true, title: true, term: true, academicYear: true } },
      author: { select: { fullName: true } },
      reads: { where: { studentId: student.id }, select: { readAt: true }, take: 1 }
    }
  });
  return NextResponse.json({
    announcements: announcements.map(({ reads, ...item }) => ({ ...item, readAt: reads[0]?.readAt ?? null }))
  }, { headers: { "Cache-Control": "private, no-store" } });
}
