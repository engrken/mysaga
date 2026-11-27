import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { createSession, tenantManagerIdentity } from "@/lib/auth";
import {
  GOOGLE_SERVICE_SCOPES,
  createGoogleOAuthUrl,
  signGoogleOAuthState,
  verifyGoogleOAuthState
} from "@/lib/google-chat";

const NONCE_COOKIE = "saga_google_login_nonce";
const VERIFIER_COOKIE = "saga_google_login_verifier";
const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

function requiredGoogleEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new GoogleSignInError("GOOGLE_NOT_CONFIGURED", "Google Sign-In is not configured yet.");
  return value;
}

function withQuery(path: string, key: string, value: string) {
  const url = new URL(path, "https://saga.invalid");
  url.searchParams.set(key, value);
  return url.pathname + url.search;
}

export class GoogleSignInError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "GoogleSignInError";
  }
}

export async function createGoogleSignInOAuthUrl(schoolId: string) {
  const clientId = requiredGoogleEnv("GOOGLE_CLIENT_ID");
  const redirectUri = requiredGoogleEnv("GOOGLE_REDIRECT_URI");
  const nonce = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const signedState = await signGoogleOAuthState({
    purpose: "google-login",
    schoolId,
    nonce
  });

  const secure = process.env.NODE_ENV === "production";
  const jar = await cookies();
  const options = {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 10 * 60
  };
  jar.set(NONCE_COOKIE, nonce, options);
  jar.set(VERIFIER_COOKIE, verifier, options);

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: signedState,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
    include_granted_scopes: "true"
  }).toString();
  return url.toString();
}

export async function clearGoogleSignInCookies() {
  const jar = await cookies();
  jar.delete(NONCE_COOKIE);
  jar.delete(VERIFIER_COOKIE);
}

export async function completeGoogleSignInOAuth(code: string, state: string) {
  const jar = await cookies();
  const nonceCookie = jar.get(NONCE_COOKIE)?.value;
  const verifierCookie = jar.get(VERIFIER_COOKIE)?.value;
  await clearGoogleSignInCookies();

  const statePayload = await verifyGoogleOAuthState(state).catch(() => null);
  if (!statePayload || statePayload.purpose !== "google-login" ||
      typeof statePayload.schoolId !== "string" || typeof statePayload.nonce !== "string" ||
      !nonceCookie || nonceCookie !== statePayload.nonce || !verifierCookie) {
    throw new GoogleSignInError("INVALID_GOOGLE_STATE", "This Google sign-in request expired. Please try again.");
  }

  const clientId = requiredGoogleEnv("GOOGLE_CLIENT_ID");
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: requiredGoogleEnv("GOOGLE_CLIENT_SECRET"),
      redirect_uri: requiredGoogleEnv("GOOGLE_REDIRECT_URI"),
      grant_type: "authorization_code",
      code_verifier: verifierCookie
    }),
    cache: "no-store"
  });
  const tokens = await tokenResponse.json().catch(() => null) as null | {
    id_token?: string; error?: string; error_description?: string
  };
  if (!tokenResponse.ok || !tokens?.id_token) {
    throw new GoogleSignInError("GOOGLE_TOKEN_EXCHANGE_FAILED", "Google could not complete sign-in. Please try again.");
  }

  const { payload } = await jwtVerify(tokens.id_token, GOOGLE_JWKS, {
    algorithms: ["RS256"],
    issuer: ["accounts.google.com", "https://accounts.google.com"],
    audience: clientId
  });
  if (payload.nonce !== nonceCookie || typeof payload.sub !== "string" || !payload.sub ||
      typeof payload.email !== "string" || payload.email_verified !== true) {
    throw new GoogleSignInError("GOOGLE_IDENTITY_UNVERIFIED", "Google did not provide a verified email identity. Please try another account.");
  }

  const email = payload.email.trim().toLowerCase();
  const user = await prisma.user.findFirst({
    where: {
      schoolId: statePayload.schoolId,
      email: { equals: email, mode: "insensitive" }
    },
    include: {
      school: {
        select: {
          slug: true,
          isActive: true,
          subscriptionStatus: true,
          subscriptionExpiresAt: true
        }
      }
    }
  });
  if (!user || !["TEACHER", "STUDENT"].includes(user.role)) {
    throw new GoogleSignInError(
      "GOOGLE_ACCOUNT_NOT_FOUND",
      "This Google email is not registered for the selected school. Use the email linked to your SAGA account or contact your subject teacher."
    );
  }
  if (!user.school.isActive || user.school.subscriptionStatus !== "ACTIVE" ||
      (user.school.subscriptionExpiresAt && user.school.subscriptionExpiresAt <= new Date())) {
    throw new GoogleSignInError("SCHOOL_INACTIVE", "This school workspace is inactive or its subscription has expired. Contact SAGA support.");
  }

  if (!user.emailVerifiedAt) {
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: new Date() }
    });
  }

  const manager = (await tenantManagerIdentity(user)) !== null;
  await createSession({
    id: user.id,
    role: user.role,
    schoolId: user.schoolId,
    emailIdentityChangedAt: user.emailIdentityChangedAt
  }, manager, false, { subject: payload.sub, email });

  const returnTo = `/${encodeURIComponent(user.school.slug)}/overview?googleSignIn=success`;
  let redirectTo = returnTo;

  if (user.role === "TEACHER") {
    const connection = await prisma.googleChatConnection.findUnique({
      where: { schoolId_teacherId: { schoolId: user.schoolId, teacherId: user.id } },
      select: { googleSubject: true, googleEmail: true, scopes: true }
    });
    const existingScopes = new Set((connection?.scopes || "").split(/\\s+/).filter(Boolean));
    const servicesReady = Boolean(
      connection &&
      connection.googleSubject === payload.sub &&
      connection.googleEmail.trim().toLowerCase() === email &&
      GOOGLE_SERVICE_SCOPES.every(scope => existingScopes.has(scope))
    );

    if (connection && connection.googleSubject !== payload.sub) {
      const linkedSpaces = await prisma.googleChatSpace.count({
        where: { schoolId: user.schoolId, teacherId: user.id }
      });
      if (linkedSpaces > 0) {
        redirectTo = withQuery(returnTo, "googleServices", "account-mismatch");
      }
    }

    if (!servicesReady && redirectTo === returnTo) {
      try {
        redirectTo = await createGoogleOAuthUrl(
          { id: user.id, schoolId: user.schoolId },
          {
            expectedGoogleSubject: payload.sub,
            loginHint: email,
            returnTo: withQuery(returnTo, "googleServices", "connected")
          }
        );
      } catch {
        redirectTo = withQuery(returnTo, "googleServices", "setup-required");
      }
    }
  }

  return { redirectTo };
}
