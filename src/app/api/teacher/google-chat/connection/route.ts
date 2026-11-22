import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const teacher = await requireRole("TEACHER");
  if (!teacher) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const connection = await prisma.googleChatConnection.findUnique({
    where: { schoolId_teacherId: { schoolId: teacher.schoolId, teacherId: teacher.id } },
    select: { googleEmail: true, createdAt: true, updatedAt: true }
  });
  return NextResponse.json({ connected: Boolean(connection), connection }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function DELETE() {
  const teacher = await requireRole("TEACHER");
  if (!teacher) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prisma.googleChatConnection.deleteMany({ where: { schoolId: teacher.schoolId, teacherId: teacher.id } });
  return NextResponse.json({ ok: true });
}
