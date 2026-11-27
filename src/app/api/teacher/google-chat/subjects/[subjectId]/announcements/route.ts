import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { googleChatAccessToken, googleChatRequest, googleConnectionMatchesSAGAAccount } from "@/lib/google-chat";

export const runtime = "nodejs";
type Context = { params: Promise<{ subjectId: string }> };
const schema = z.object({ text: z.string().trim().min(1).max(4000) });

export async function POST(request: Request, context: Context) {
  const teacher = await requireRole("TEACHER");
  if (!teacher) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { subjectId } = await context.params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Write an announcement of up to 4,000 characters." }, { status: 400 });
  const subject = await prisma.subject.findFirst({
    where: { id: subjectId, schoolId: teacher.schoolId, teacherId: teacher.id },
    select: { googleChatSpace: { select: { spaceName: true } } }
  });
  if (!subject?.googleChatSpace) return NextResponse.json({ error: "Link a Google Chat Space to this class first." }, { status: 409 });
  const connection = await prisma.googleChatConnection.findUnique({
    where: { schoolId_teacherId: { schoolId: teacher.schoolId, teacherId: teacher.id } }
  });
  if (!connection || !googleConnectionMatchesSAGAAccount(connection, teacher)) {
    return NextResponse.json({ error: "Connect the Google account that matches your SAGA teacher profile." }, { status: 409 });
  }
  const grantedScopes = new Set(connection.scopes.split(/\\s+/).filter(Boolean));
  if (!grantedScopes.has("https://www.googleapis.com/auth/chat.messages.create")) {
    return NextResponse.json({ error: "Reconnect Google services and approve the Chat message permission." }, { status: 409 });
  }
  try {
    const token = await googleChatAccessToken(connection);
    const message = await googleChatRequest<{ name?: string }>(token, `${subject.googleChatSpace.spaceName}/messages`, {
      method: "POST", body: JSON.stringify({ text: parsed.data.text })
    });
    return NextResponse.json({ ok: true, messageName: message.name ?? null }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not send the announcement." }, { status: 502 });
  }
}
