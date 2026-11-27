import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { activityEnrollmentIdentity, activityHeaders } from "@/lib/class-activities";
import { activitiesGoogleDriveExploration } from "@/lib/google-drive-activities";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const identitySchema = z.object({
  subjectId: z.string().trim().min(1).max(128),
  mode: z.enum(["identity", "picker"]),
  credential: z.string().min(100).max(12000),
  accessToken: z.string().min(20).max(8192).optional()
});
const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: activityHeaders });
const error = (message: string, status = 400, code?: string) =>
  reply({ error: message, ...(code ? { code } : {}) }, status);

type PortalIdentity = {
  id: string;
  schoolId: string;
  role: string;
  email: string;
  studentNumber: string | null;
  isDemo?: boolean;
};

async function authorizedSubject(user: PortalIdentity, subjectId: string) {
  if (user.role === "TEACHER") {
    return prisma.subject.findFirst({
      where: { id: subjectId, schoolId: user.schoolId, teacherId: user.id },
      select: { id: true }
    });
  }
  if (user.role === "STUDENT") {
    return prisma.subject.findFirst({
      where: {
        id: subjectId,
        schoolId: user.schoolId,
        enrollments: { some: { OR: activityEnrollmentIdentity(user) } }
      },
      select: { id: true }
    });
  }
  return null;
}

function normalized(value: string) {
  return value.trim().toLowerCase();
}

export async function GET(request: Request) {
  const user = await getSession();
  if (!user || !["TEACHER", "STUDENT"].includes(user.role)) return error("Sign in to SAGA first.", 401);
  if (user.isDemo) return error("Google Drive is disabled in the read-only demo.", 403);
  if (!activitiesGoogleDriveExploration) return error("Google Drive exploration is not enabled.", 404);

  const params = new URL(request.url).searchParams;
  const subjectId = params.get("subjectId") || "";
  const mode = params.get("mode");
  if ((mode !== "open" && mode !== "picker") ||
      (mode === "open" && user.role !== "STUDENT") ||
      (mode === "picker" && user.role !== "TEACHER")) {
    return error("This Google Drive action is not available for your account.", 403);
  }
  if (!await authorizedSubject(user, subjectId)) return error("This class is not available to your SAGA account.", 404);

  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  if (!clientId) return error("Google Sign-In is not configured yet.", 503);
  if (mode === "open") return reply({ clientId });

  const apiKey = process.env.GOOGLE_DRIVE_API_KEY?.trim();
  const appId = process.env.GOOGLE_DRIVE_APP_ID?.trim();
  if (!apiKey || !appId) {
    return error("The Google Drive Picker still needs its restricted API key and Google Cloud project number.", 503);
  }
  return reply({ clientId, apiKey, appId });
}

export async function POST(request: Request) {
  const user = await getSession();
  if (!user || !["TEACHER", "STUDENT"].includes(user.role)) return error("Sign in to SAGA first.", 401);
  if (user.isDemo) return error("Google Drive is disabled in the read-only demo.", 403);
  if (!activitiesGoogleDriveExploration) return error("Google Drive exploration is not enabled.", 404);

  const parsed = identitySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return error("The Google sign-in response was incomplete.");
  const input = parsed.data;
  if ((input.mode === "identity" && user.role !== "STUDENT") ||
      (input.mode === "picker" && user.role !== "TEACHER")) {
    return error("This Google Drive action is not available for your account.", 403);
  }
  if (input.mode === "picker" && !input.accessToken) return error("Google Drive access was not granted.", 400);
  if (!await authorizedSubject(user, input.subjectId)) {
    return error("This class is not available to your SAGA account.", 404);
  }

  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  if (!clientId) return error("Google Sign-In is not configured yet.", 503);

  let identity: JWTPayload & { email?: string; email_verified?: boolean };
  try {
    const verified = await jwtVerify(input.credential, GOOGLE_JWKS, {
      algorithms: ["RS256"],
      issuer: ["accounts.google.com", "https://accounts.google.com"],
      audience: clientId
    });
    identity = verified.payload as JWTPayload & { email?: string; email_verified?: boolean };
  } catch {
    return error("Google could not verify this sign-in. Please try again.", 401);
  }

  if (typeof identity.sub !== "string" || !identity.sub ||
      typeof identity.email !== "string" || identity.email_verified !== true) {
    return error("Google must provide a verified email address for this account.", 401);
  }

  const googleEmail = normalized(identity.email);
  const portalEmail = normalized(user.email);
  if (googleEmail !== portalEmail) {
    const mismatchMessage = user.role === "STUDENT"
      ? "The Google account you selected does not match the email registered in your SAGA Portal student account. Choose the correct Google account. If your registered email needs to be corrected, please contact your subject teacher."
      : "The Google account you selected does not match the email registered in your SAGA Portal teacher account. Choose your registered Google account.";
    return error(mismatchMessage, 403, "GOOGLE_EMAIL_MISMATCH");
  }

  if (input.mode === "picker") {
    const userInfoResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: "Bearer " + input.accessToken },
      cache: "no-store"
    });
    const userInfo = await userInfoResponse.json().catch(() => null) as null | {
      sub?: string; email?: string; email_verified?: boolean
    };
    if (!userInfoResponse.ok || !userInfo?.sub || userInfo.sub !== identity.sub ||
        !userInfo.email || userInfo.email_verified !== true ||
        normalized(userInfo.email) !== portalEmail) {
      return error("Google Drive access must use the same verified Google account as your SAGA teacher account.", 403, "GOOGLE_EMAIL_MISMATCH");
    }
  }

  return reply({ verified: true, email: googleEmail });
}
