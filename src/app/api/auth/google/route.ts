import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkAuthThrottle } from "@/lib/rate-limit";
import { createGoogleSignInOAuthUrl } from "@/lib/google-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const schoolId = url.searchParams.get("schoolId")?.trim();
  if (!schoolId) {
    return NextResponse.redirect(new URL("/login?googleError=school-required", url.origin));
  }

  const throttle = await checkAuthThrottle(request, `google-sign-in:${schoolId}`, 8);
  if (!throttle.allowed) {
    return NextResponse.redirect(new URL("/login?googleError=throttled", url.origin));
  }

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { isActive: true, subscriptionStatus: true, subscriptionExpiresAt: true }
  });
  if (!school || !school.isActive || school.subscriptionStatus !== "ACTIVE" ||
      (school.subscriptionExpiresAt && school.subscriptionExpiresAt <= new Date())) {
    return NextResponse.redirect(new URL("/login?googleError=school-inactive", url.origin));
  }

  try {
    return NextResponse.redirect(await createGoogleSignInOAuthUrl(schoolId), {
      headers: { "Cache-Control": "no-store" }
    });
  } catch {
    return NextResponse.redirect(new URL("/login?googleError=not-configured", url.origin));
  }
}
