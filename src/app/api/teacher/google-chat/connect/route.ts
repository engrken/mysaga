import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { createGoogleOAuthUrl } from "@/lib/google-chat";

export const runtime = "nodejs";

export async function GET() {
  const teacher = await requireRole("TEACHER");
  if (!teacher) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.redirect(await createGoogleOAuthUrl({ id: teacher.id, schoolId: teacher.schoolId }));
  } catch {
    return NextResponse.json({ error: "Google Chat is not configured yet." }, { status: 503 });
  }
}
