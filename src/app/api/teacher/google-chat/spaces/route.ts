import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { googleChatAccessToken, googleChatRequest } from "@/lib/google-chat";

export const runtime = "nodejs";

export async function GET() {
  const teacher = await requireRole("TEACHER");
  if (!teacher) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const connection = await prisma.googleChatConnection.findUnique({
    where: { schoolId_teacherId: { schoolId: teacher.schoolId, teacherId: teacher.id } }
  });
  if (!connection) return NextResponse.json({ error: "Connect your Google account first." }, { status: 409 });
  try {
    const token = await googleChatAccessToken(connection);
    const result = await googleChatRequest<{ spaces?: Array<{ name: string; displayName?: string; externalUserAllowed?: boolean }>; nextPageToken?: string }>(
      token, "spaces?pageSize=100&filter=spaceType%3DSPACE"
    );
    return NextResponse.json({
      spaces: (result.spaces || []).map(space => ({
        name: space.name, displayName: space.displayName || space.name,
        externalUserAllowed: space.externalUserAllowed === true
      }))
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not list Google Chat Spaces." }, { status: 502 });
  }
}
