import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { GOOGLE_DRIVE_SCOPE, GOOGLE_SERVICE_SCOPES } from "@/lib/google-chat";

export async function GET() {
  const teacher = await requireRole("TEACHER");
  if (!teacher) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const connection = await prisma.googleChatConnection.findUnique({
    where: { schoolId_teacherId: { schoolId: teacher.schoolId, teacherId: teacher.id } },
    select: { googleEmail: true, scopes: true, createdAt: true, updatedAt: true }
  });
  if (!connection) {
    return NextResponse.json({ connected: false, connection: null }, {
      headers: { "Cache-Control": "private, no-store" }
    });
  }
  const scopes = new Set(connection.scopes.split(/\s+/).filter(Boolean));
  const chatScopes = GOOGLE_SERVICE_SCOPES.filter(scope => scope !== GOOGLE_DRIVE_SCOPE);
  return NextResponse.json({
    connected: true,
    connection: {
      googleEmail: connection.googleEmail,
      createdAt: connection.createdAt,
      updatedAt: connection.updatedAt,
      matchesPortalEmail:
        connection.googleEmail.trim().toLowerCase() === teacher.email.trim().toLowerCase() &&
        (teacher.authProvider !== "GOOGLE" || connection.googleSubject === teacher.googleSubject),
      driveEnabled: scopes.has(GOOGLE_DRIVE_SCOPE),
      chatEnabled: chatScopes.every(scope => scopes.has(scope))
    }
  }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function DELETE() {
  const teacher = await requireRole("TEACHER");
  if (!teacher) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prisma.googleChatConnection.deleteMany({ where: { schoolId: teacher.schoolId, teacherId: teacher.id } });
  return NextResponse.json({ ok: true });
}
