import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const student = await requireRole("STUDENT");
  if (!student) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const now = new Date();
  const query = new URL(request.url).searchParams;
  const academicYear = query.get("academicYear")?.trim();
  const term = query.get("term")?.trim();
  const announcements = await prisma.classAnnouncement.findMany({
    where: {
      archivedAt: null,
      publishedAt: { lte: now },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      subject: {
        schoolId: student.schoolId,
        ...(academicYear ? { academicYear } : {}),
        ...(term ? { term } : {}),
        enrollments: { some: { studentUserId: student.id } }
      }
    },
    include: {
      subject: {
        select: {
          id: true, code: true, classId: true, title: true, term: true, academicYear: true,
          teacher: { select: { fullName: true } }
        }
      }
    },
    orderBy: [{ pinned: "desc" }, { publishedAt: "desc" }],
    take: 100
  });
  return NextResponse.json({ announcements }, { headers: { "Cache-Control": "no-store" } });
}
