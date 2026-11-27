import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { googleChatAccessToken } from "@/lib/google-chat";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const teacher = await requireRole("TEACHER");
  if (!teacher) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const subjectId = new URL(request.url).searchParams.get("subjectId")?.trim();
  if (!subjectId) return NextResponse.json({ error: "Class is required." }, { status: 400 });
  const subject = await prisma.subject.findFirst({
    where: { id: subjectId, schoolId: teacher.schoolId, teacherId: teacher.id },
    select: { id: true }
  });
  if (!subject) return NextResponse.json({ error: "Class not found." }, { status: 404 });
  const connection = await prisma.googleChatConnection.findUnique({
    where: { schoolId_teacherId: { schoolId: teacher.schoolId, teacherId: teacher.id } }
  });
  if (!connection) return NextResponse.json({
    error: "Connect your Google account to use Google Drive resources.",
    driveAuthorizationNeeded: true
  }, { status: 409 });
  if (!connection.scopes.split(/\s+/).includes("https://www.googleapis.com/auth/drive.file")) {
    return NextResponse.json({
      error: "Reconnect Google and approve Drive access to use the resource picker.",
      driveAuthorizationNeeded: true
    }, { status: 409 });
  }
  const apiKey = process.env.GOOGLE_PICKER_API_KEY?.tr¶»§q«^