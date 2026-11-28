import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { googleChatAccessToken, googleChatRequest, googleConnectionMatchesSAGAAccount, GOOGLE_CHAT_SCOPES } from "@/lib/google-chat";

export const runtime = "nodejs";
type Context = { params: Promise<{ subjectId: string }> };
const schema = z.object({ displayName: z.string().trim().min(1).max(100).optional(), spaceName: z.string().regex(/^spaces\/[A-Za-z0-9_-]+$/).optional() });

export async function GET(_request: Request, context: Context) {
  const teacher = await requireRole("TEACHER");
  if (!teacher) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { subjectId } = await context.params;
  const subject = await prisma.subject.findFirst({
    where: { id: subjectId, schoolId: teacher.schoolId, teacherId: teacher.id },
    select: { googleChatSpace: { select: { spaceName: true, displayName: true, spaceUri: true, externalUserAllowed: true, createdAt: true } } }
  });
  if (!subject) return NextResponse.json({ error: "Class not found." }, { status: 404 });
  return NextResponse.json({ space: subject.googleChatSpace }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request, context: Context) {
  const teacher = await requireRole("TEACHER");
  if (!teacher) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { subjectId } = await context.params;
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid Google Chat Space name." }, { status: 400 });
  const subject = await prisma.subject.findFirst({
    where: { id: subjectId, schoolId: teacher.schoolId, teacherId: teacher.id },
    select: { id: true, title: true, code: true, googleChatSpace: { select: { id: true } } }
  });
  if (!subject) return NextResponse.json({ error: "Class not found." }, { status: 404 });
  if (subject.googleChatSpace) return NextResponse.json({ error: "A Google Chat Space is already linked to this class." }, { status: 409 });
  const connection = await prisma.googleChatConnection.findUnique({
    where: { schoolId_teacherId: { schoolId: teacher.schoolId, teacherId: teacher.id } }
  });
  if (!connection || !googleConnectionMatchesSAGAAccount(connection, teacher)) {
    return NextResponse.json({ error: "Connect the Google account that matches your SAGA teacher profile." }, { status: 409 });
  }
  const grantedScopes = new Set(connection.scopes.split(/\s+/).filter(Boolean));
  if (!GOOGLE_CHAT_SCOPES.every(scope => grantedScopes.has(scope))) {
    return NextResponse.json({ error: "Reconnect Google services and approve the required Chat permissions." }, { status: 409 });
  }
  try {
    const token = await googleChatAccessToken(connection);
    const defaultName = `${subject.code} — ${subject.title}`.slice(0, 100);
    const space = parsed.data.spaceName
      ? await googleChatRequest<{ name: string; displayName?: string; spaceUri?: string; externalUserAllowed?: boolean }>(token, parsed.data.spaceName)
      : await googleChatRequest<{ name: string; displayName?: string; spaceUri?: string; externalUserAllowed?: boolean }>(token, "spaces", {
          method: "POST",
          body: JSON.stringify({ spaceType: "SPACE", displayName: parsed.data.displayName || defaultName, externalUserAllowed: true })
        });
    if (parsed.data.spaceName) {
      const existingMemberships = await googleChatRequest<{ members?: Array<{ name?: string }> }>(
        token, `${space.name}/members?pageSize=2`
      );
      if ((existingMemberships.members || []).length > 1) {
        return NextResponse.json({ error: "Only link an empty Space (with you as its sole member). Create a new Space if this one already has other participants, so SAGA can enforce the class roster." }, { status: 409 });
      }
      const alreadyLinked = await prisma.googleChatSpace.findUnique({ where: { spaceName: space.name }, select: { id: true } });
      if (alreadyLinked) return NextResponse.json({ error: "This Google Chat Space is already linked to another SAGA class." }, { status: 409 });
    }
    if (space.externalUserAllowed !== true) {
      return NextResponse.json({ error: "Choose a Space that allows external users, so students using Gmail or another Workspace can be invited when school policies permit." }, { status: 400 });
    }
    const saved = await prisma.googleChatSpace.create({
      data: {
        schoolId: teacher.schoolId, subjectId, teacherId: teacher.id,
        spaceName: space.name, displayName: space.displayName || parsed.data.displayName || defaultName, spaceUri: space.spaceUri || null, externalUserAllowed: true
      },
      select: { spaceName: true, displayName: true, spaceUri: true, externalUserAllowed: true, createdAt: true }
    });
    return NextResponse.json({ space: saved }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create a Google Chat Space.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
