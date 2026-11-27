import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { googleChatAccessToken, googleChatRequest, googleConnectionMatchesSAGAAccount, GOOGLE_CHAT_SCOPES } from "@/lib/google-chat";

export const runtime = "nodejs";

export async function GET() {
  const teacher = await requireRole("TEACHER");
  if (!teacher) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
