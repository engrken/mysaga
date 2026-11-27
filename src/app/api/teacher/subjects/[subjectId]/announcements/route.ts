import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
type Context = { params: Promise<{ subjectId: string }> };

const createSchema = z.object({
  title: z.string().trim().min(3).max(160),
  body: z.string().trim().min(3).max(6000),
  pinned: z.boolean().optional().default(false),
  expiresAt: z.string().datetime().optional().nullable()
});

async function ownedSubject(subjectId: string, teacher: { id: string; schoolId: string }) {
  return prisma.subject.findFirst({
    where: { id: subjectId, schoolId: teacher.schoolId, teacherId: teacher.id },
    select: { id: true, title: true, code: true }
  });
}

export async function GET(_request: Request, context: Context) {
  const teacher = await requireRole("TEACHER");
  if (!teacher) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const { subjectId } = await context.params;
  if (!await ownedSubject(subjectId, teacher)) return NextResponse.json({ error: "Class not found." }, { status: 404 });
  const announcements = await prisma.classAnnouncement.findMany({
    where: { subjectId, archivedAt: null },
    orderBy: [{ pinned: "desc" }, { publishedAt: "desc" }],
    take: 100
  });
  return NextResponse.json({ announcements }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, context: Context) {
  const teacher = await requireRole("TE¶»§q«^