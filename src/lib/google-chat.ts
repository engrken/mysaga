import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { prisma } from "@/lib/prisma";

const GOOGLE_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/chat.spaces.readonly",
  "https://www.googleapis.com/auth/chat.spaces.create",
  "https://www.googleapis.com/auth/chat.memberships",
  "https://www.googleapis.com/auth/chat.messages.create"
];

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name} configuration.`);
  return value;
}

function oauthKey() {
  const secret = requiredEnv("AUTH_SECRET");
  if (secret.length < 32) throw new Error("AUTH_SECRET must contain at least 32 characters.");
  return new TextEncoder().encode(secret);
}

function encryptionKey() {
  const raw = requiredEnv("GOOGLE_TOKEN_ENCRYPTION_KEY");
  let key = /^[a-f0-9]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32 && Buffer.byteLength(raw, "utf8") === 32) key = Buffer.from(raw, "utf8");
  if (key.length !== 32) throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY must encode exactly 32 random bytes (base64 or 64-character hex).");
  return key;
}

export function encryptGoogleToken(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map(part => part.toString("base64url")).join(".");
}

export function decryptGoogleToken(value: string) {
  const [ivText, tagText, dataText] = value.split(".");
  if (!ivText || !tagText || !dataText) throw new Error("Stored Google token has an invalid format.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(dataText, "base64url")), decipher.final()]).toString("utf8");
}

export async function createGoogleOAuthUrl(user: { id: string; schoolId: string }) {
  const clientId = requiredEnv("GOOGLE_CLIENT_ID");
  const redirectUri = requiredEnv("GOOGLE_REDIRECT_URI");
  const state = await new SignJWT({ uid: user.id, sid: user.schoolId, purpose: "google-chat-oauth" })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("10m").setJti(randomBytes(16).toString("hex")).sign(oauthKey());
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state
  }).toString();
  return url.toString();
}

export async function completeGoogleOAuth(code: string, state: string) {
  const { payload } = await jwtVerify(state, oauthKey(), { algorithms: ["HS256"] });
  if (payload.purpose !== "google-chat-oauth" || typeof payload.uid !== "string" || typeof payload.sid !== "string") {
    throw new Error("Invalid Google authorization state.");
  }
  const user = await prisma.user.findFirst({
    where: { id: payload.uid, schoolId: payload.sid, role: "TEACHER", emailVerifiedAt: { not: null } },
    select: { id: true, schoolId: true }
  });
  if (!user) throw new Error("The teacher account is no longer available.");

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: requiredEnv("GOOGLE_CLIENT_ID"),
      client_secret: requiredEnv("GOOGLE_CLIENT_SECRET"),
      redirect_uri: requiredEnv("GOOGLE_REDIRECT_URI"),
      grant_type: "authorization_code"
    }),
    cache: "no-store"
  });
  const tokens = await tokenResponse.json().catch(() => null) as null | {
    access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string
  };
  if (!tokenResponse.ok || !tokens?.access_token) {
    throw new Error("Google authorization did not return the required offline access. Reconnect and approve the requested access.");
  }

  const grantedScopes = new Set((tokens.scope || GOOGLE_SCOPES.join(" ")).split(/\s+/));
  if (GOOGLE_SCOPES.some(scope => !grantedScopes.has(scope))) {
    throw new Error("Google authorization did not include every required Chat permission. Reconnect and approve all requested permissions.");
  }

  const identityResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` }, cache: "no-store"
  });
  const identity = await identityResponse.json().catch(() => null) as null | {
    sub?: string; email?: string; email_verified?: boolean
  };
  if (!identityResponse.ok || !identity?.sub || !identity.email || identity.email_verified !== true) {
    throw new Error("Google did not return a verified email address for this account.");
  }

  const existingConnection = await prisma.googleChatConnection.findUnique({
    where: { schoolId_teacherId: { schoolId: user.schoolId, teacherId: user.id } },
    select: { encryptedRefreshToken: true }
  });
  if (!tokens.refresh_token && !existingConnection) {
    throw new Error("Google did not grant offline access. Reconnect and approve the requested access.");
  }

  await prisma.googleChatConnection.upsert({
    where: { schoolId_teacherId: { schoolId: user.schoolId, teacherId: user.id } },
    create: {
      schoolId: user.schoolId, teacherId: user.id, googleSubject: identity.sub,
      googleEmail: identity.email.toLowerCase(),
      encryptedAccessToken: encryptGoogleToken(tokens.access_token),
      encryptedRefreshToken: tokens.refresh_token ? encryptGoogleToken(tokens.refresh_token) : existingConnection!.encryptedRefreshToken,
      accessTokenExpiresAt: new Date(Date.now() + Math.max(60, tokens.expires_in ?? 3600) * 1000),
      scopes: tokens.scope ?? GOOGLE_SCOPES.join(" ")
    },
    update: {
      googleSubject: identity.sub, googleEmail: identity.email.toLowerCase(),
      encryptedAccessToken: encryptGoogleToken(tokens.access_token),
      encryptedRefreshToken: tokens.refresh_token ? encryptGoogleToken(tokens.refresh_token) : existingConnection!.encryptedRefreshToken,
      accessTokenExpiresAt: new Date(Date.now() + Math.max(60, tokens.expires_in ?? 3600) * 1000),
      scopes: tokens.scope ?? GOOGLE_SCOPES.join(" ")
    }
  });
  return { email: identity.email.toLowerCase(), user };
}

export async function googleChatAccessToken(connection: {
  id: string; encryptedAccessToken: string; encryptedRefreshToken: string; accessTokenExpiresAt: Date
}) {
  if (connection.accessTokenExpiresAt.getTime() > Date.now() + 60_000) {
    return decryptGoogleToken(connection.encryptedAccessToken);
  }
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requiredEnv("GOOGLE_CLIENT_ID"),
      client_secret: requiredEnv("GOOGLE_CLIENT_SECRET"),
      refresh_token: decryptGoogleToken(connection.encryptedRefreshToken),
      grant_type: "refresh_token"
    }),
    cache: "no-store"
  });
  const data = await response.json().catch(() => null) as null | { access_token?: string; expires_in?: number };
  if (!response.ok || !data?.access_token) throw new Error("Google connection expired or was revoked. Ask the teacher to reconnect Google Chat.");
  await prisma.googleChatConnection.update({
    where: { id: connection.id },
    data: {
      encryptedAccessToken: encryptGoogleToken(data.access_token),
      accessTokenExpiresAt: new Date(Date.now() + Math.max(60, data.expires_in ?? 3600) * 1000)
    }
  });
  return data.access_token;
}

export async function googleChatRequest<T>(accessToken: string, path: string, init: RequestInit = {}) {
  const response = await fetch(`https://chat.googleapis.com/v1/${path.replace(/^\//, "")}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init.headers || {})
    },
    cache: "no-store"
  });
  const data = await response.json().catch(() => null) as T | null;
  if (!response.ok) {
    const error = data && typeof data === "object" && "error" in data
      ? String((data as { error?: { message?: string } }).error?.message || "Google Chat API request failed.")
      : "Google Chat API request failed.";
    const failure = new Error(error) as Error & { status?: number };
    failure.status = response.status;
    throw failure;
  }
  return data as T;
}

export async function syncGoogleChatEnrollment(enrollmentId: string, schoolId: string) {
  const enrollment = await prisma.enrollment.findFirst({
    where: { id: enrollmentId, subject: { schoolId }, student: { is: { schoolId, role: "STUDENT", emailVerifiedAt: { not: null } } } },
    select: {
      id: true, student: { select: { email: true } },
      subject: { select: { id: true, schoolId: true, teacherId: true, googleChatSpace: { select: { spaceName: true } } } }
    }
  });
  if (!enrollment?.student?.email || !enrollment.subject.googleChatSpace) return { synced: false, reason: "not-configured" };
  const spaceName = enrollment.subject.googleChatSpace.spaceName;
  const studentEmail = enrollment.student.email.toLowerCase();
  const [connection] = await prisma.googleChatConnection.findMany({
    where: { schoolId, teacherId: enrollment.subject.teacherId }, take: 1
  });
  if (!connection) return { synced: false, reason: "teacher-not-connected" };

  const sync = await prisma.googleChatMembershipSync.upsert({
    where: { enrollmentId },
    create: {
      schoolId, subjectId: enrollment.subject.id, enrollmentId,
      studentEmail, status: "PENDING"
    },
    update: { studentEmail, status: "PENDING", lastError: null }
  });
  try {
    const token = await googleChatAccessToken(connection);
    const membership = await googleChatRequest<{ name?: string; state?: string }>(
      token, `${spaceName}/members`,
      { method: "POST", body: JSON.stringify({ member: { name: `users/${studentEmail}`, type: "HUMAN" } }) }
    );
    await prisma.googleChatMembershipSync.update({
      where: { id: sync.id },
      data: {
        googleMembershipName: membership.name ?? null,
        status: membership.state === "INVITED" ? "INVITED" : "MEMBER",
        attempts: { increment: 1 }, lastAttemptAt: new Date(), lastError: null
      }
    });
    return { synced: true, status: membership.state === "INVITED" ? "INVITED" : "MEMBER" };
  } catch (error) {
    const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 0;
    const message = error instanceof Error ? error.message.slice(0, 500) : "Google Chat sync failed.";
    await prisma.googleChatMembershipSync.update({
      where: { id: sync.id },
      data: { status: "FAILED", attempts: { increment: 1 }, lastAttemptAt: new Date(), lastError: message }
    });
    if (status === 409) {
      try {
        const token = await googleChatAccessToken(connection);
        const existing = await googleChatRequest<{ name?: string; state?: string }>(
          token, `${spaceName}/members/${encodeURIComponent(studentEmail)}`
        );
        await prisma.googleChatMembershipSync.update({
          where: { id: sync.id },
          data: {
            googleMembershipName: existing.name ?? null,
            status: existing.state === "INVITED" ? "INVITED" : "MEMBER",
            lastError: null
          }
        });
        return { synced: true, status: existing.state === "INVITED" ? "INVITED" : "MEMBER" };
      } catch {
        // A conflict is only treated as an existing membership after Google confirms it.
      }
    }
    return { synced: false, reason: message };
  }
}

export async function removeGoogleChatEnrollment(enrollmentId: string, schoolId: string) {
  const sync = await prisma.googleChatMembershipSync.findFirst({
    where: { enrollmentId, schoolId },
    select: {
      id: true, googleMembershipName: true,
      subject: { select: { teacherId: true } }
    }
  });
  if (!sync) return { ok: true };
  if (!sync.googleMembershipName) {
    await prisma.googleChatMembershipSync.update({ where: { id: sync.id }, data: { status: "REMOVED" } });
    return { ok: true };
  }
  const connection = await prisma.googleChatConnection.findUnique({
    where: { schoolId_teacherId: { schoolId, teacherId: sync.subject.teacherId } }
  });
  if (!connection) return { ok: false, error: "Reconnect the teacher's Google account before removing this member." };
  try {
    const token = await googleChatAccessToken(connection);
    await googleChatRequest<unknown>(token, sync.googleMembershipName, { method: "DELETE" });
    await prisma.googleChatMembershipSync.update({
      where: { id: sync.id },
      data: { status: "REMOVED", lastError: null, lastAttemptAt: new Date() }
    });
    return { ok: true };
  } catch (error) {
    const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 0;
    if (status === 404 || status === 410) {
      await prisma.googleChatMembershipSync.update({ where: { id: sync.id }, data: { status: "REMOVED", lastError: null } });
      return { ok: true };
    }
    const message = error instanceof Error ? error.message.slice(0, 500) : "Google Chat member removal failed.";
    await prisma.googleChatMembershipSync.update({
      where: { id: sync.id }, data: { status: "FAILED", attempts: { increment: 1 }, lastAttemptAt: new Date(), lastError: message }
    });
    return { ok: false, error: message };
  }
}

export async function removeGoogleChatSubjectMembers(subjectId: string, schoolId: string) {
  const records = await prisma.googleChatMembershipSync.findMany({
    where: { subjectId, schoolId, status: { not: "REMOVED" } },
    select: { enrollmentId: true }
  });
  for (const record of records) {
    const result = await removeGoogleChatEnrollment(record.enrollmentId, schoolId);
    if (!result.ok) return result;
  }
  return { ok: true };
}
