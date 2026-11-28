import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { activityEnrollmentIdentity, activityHeaders } from "@/lib/class-activities";
import { activitiesGoogleDriveExploration, normalizeGoogleAccountEmail } from "@/lib/google-drive-activities";
import { GOOGLE_DRIVE_SCOPE, googleChatAccessToken } from "@/lib/google-chat";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const identitySchema = z.object({
  subjectId: z.string().trim().min(1).max(128),
  mode: z.literal("identity"),
  credential: z.string().min(100).max(12000)
});
const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: activityHeaders });
const error = (message: string, status = 400, code?: string) =>
  reply({ error: message, ...(code ? { code } : {}) }, status);

function isSameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

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

  if (mode === "open") {
    const identityVerified = user.authProvider === "GOOGLE" &&
      Boolean(user.googleSubject) &&
      normalizeGoogleAccountEmail(user.googleEmail || "") === normalizeGoogleAccountEmail(user.email);
    return reply({ clientId, identityVerified, email: identityVerified ? user.email : null });
  }

  const apiKey = process.env.GOOGLE_DRIVE_API_KEY?.trim();
  const appId = process.env.GOOGLE_DRIVE_APP_ID?.trim();
  if (!apiKey || !appId) {
    return error("The Google Drive Picker still needs its restricted API key and Google Cloud project number.", 503);
  }

  const connection = await prisma.googleChatConnection.findUnique({
    where: { schoolId_teacherId: { schoolId: user.schoolId, teacherId: user.id } }
  });
  if (!connection) {
    return error("Sign in to SAGA using the Google account registered to your teacher profile to enable Drive and Chat.", 409, "GOOGLE_SERVICES_NOT_CONNECTED");
  }
  const portalEmail = normalizeGoogleAccountEmail(user.email);
  if (normalizeGoogleAccountEmail(connection.googleEmail) !== portalEmail ||
      (user.authProvider === "GOOGLE" && user.googleSubject !== connection.googleSubject)) {
    return error("Your saved Google services connection uses a different account. Reconnect using the same Google account you use for SAGA Portal.", 403, "GOOGLE_ACCOUNT_MISMATCH");
  }

  const grantedScopes = new Set(connection.scopes.split(/\s+/).filter(Boolean));
  if (!grantedScopes.has(GOOGLE_DRIVE_SCOPE)) {
    return error("Google Drive permission is not enabled yet. Use Reconnect Google services in the class Chat settings.", 409, "GOOGLE_DRIVE_SCOPE_MISSING");
  }

  if (params.get("action") === "token") {
    try {
      const accessToken = await googleChatAccessToken(connection);
      return reply({ accessToken });
    } catch {
      return error("Your Google services connection expired or was revoked. Reconnect Google Drive & Chat from the class Chat settings.", 409);
    }
  }

  return reply({ clientId, apiKey, appId, identityVerified: true, email: connection.googleEmail });
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return error("Google identity verification must be requested from SAGA Portal.", 403);
  const user = await getSession();
  if (!user || !["TEACHER", "STUDENT"].includes(user.role)) return error("Sign in to SAGA first.", 401);
  if (user.isDemo) return error("Google Drive is disabled in the read-only demo.", 403);
  if (!activitiesGoogleDriveExploration) return error("Google Drive exploration is not enabled.", 404);

  const parsed = identitySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return error("The Google sign-in response was incomplete.");
  const input = parsed.data;
  if (user.role !== "STUDENT") return error("Use SAGA's Google sign-in to connect teacher Drive and Chat services.", 403);
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

  const googleEmail = normalizeGoogleAccountEmail(identity.email);
  const portalEmail = normalizeGoogleAccountEmail(user.email);
  if (googleEmail !== portalEmail) {
    return error("The Google account you selected does not match the email registered in your SAGA Portal student account. Choose the correct Google account. If your registered email needs to be corrected, please contact your subject teacher.", 403, "GOOGLE_EMAIL_MISMATCH");
  }

  return reply({ verified: true, email: googleEmail });
}
