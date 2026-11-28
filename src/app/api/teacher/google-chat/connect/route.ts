import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { createGoogleOAuthUrl, googleOAuthRedirectUriForOrigin } from "@/lib/google-chat";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const teacher = await requireRole("TEACHER");
  if (!teacher) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const returnTo = `/${encodeURIComponent(teacher.school.slug)}/overview?googleServices=connected`;
    return NextResponse.redirect(await createGoogleOAuthUrl(
      { id: teacher.id, schoolId: teacher.schoolId },
      {
        loginHint: teacher.email,
        redirectUri: googleOAuthRedirectUriForOrigin(new URL(request.url).origin),
        returnTo
      }
    ));
  } catch {
    return NextResponse.json({ error: "Google Drive and Chat authorization is not configured yet." }, { status: 503 });
  }
}
