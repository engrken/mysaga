import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = file => fs.readFileSync(path.join(process.cwd(), file), "utf8");

test("SAGA login exposes a school-scoped Continue with Google option", () => {
  const login = read("src/app/login/page.tsx");
  const route = read("src/app/api/auth/google/route.ts");
  assert.match(login, /Continue with Google/);
  assert.match(login, /\/api\/auth\/google\?schoolId=/);
  assert.match(login, /Use the Google email registered to your selected school/);
  assert.match(route, /schoolId/);
  assert.match(route, /createGoogleSignInOAuthUrl\(schoolId\)/);
  assert.match(route, /school\.subscriptionStatus !== "ACTIVE"/);
});

test("Google sign-in uses state, nonce, PKCE, and server-verified OpenID identity", () => {
  const auth = read("src/lib/google-auth.ts");
  assert.match(auth, /scope: "openid email profile"/);
  assert.match(auth, /code_challenge_method: "S256"/);
  assert.match(auth, /code_verifier: verifierCookie/);
  assert.match(auth, /NONCE_COOKIE/);
  assert.match(auth, /VERIFIER_COOKIE/);
  assert.match(auth, /payload\.nonce !== nonceCookie/);
  assert.match(auth, /issuer: \["accounts\.google\.com", "https:\/\/accounts\.google\.com"\]/);
  assert.match(auth, /audience: clientId/);
  assert.match(auth, /payload\.email_verified !== true/);
  assert.match(auth, /email: \{ equals: email, mode: "insensitive" \}/);
});

test("Google sign-in only authenticates an existing user in the selected school", () => {
  const auth = read("src/lib/google-auth.ts");
  assert.match(auth, /schoolId: statePayload\.schoolId/);
  assert.match(auth, /GOOGLE_ACCOUNT_NOT_FOUND/);
  assert.match(auth, /createSession\(/);
  assert.doesNotMatch(auth, /prisma\.user\.create\(/);
  assert.doesNotMatch(auth, /prisma\.user\.upsert\(/);
});

test("teacher Google login automatically requests Drive and Chat permissions", () => {
  const auth = read("src/lib/google-auth.ts");
  const chat = read("src/lib/google-chat.ts");
  assert.match(auth, /if \(user\.role === "TEACHER"\)/);
  assert.match(auth, /GOOGLE_SERVICE_SCOPES\.every/);
  assert.match(auth, /createGoogleOAuthUrl\(/);
  assert.match(chat, /GOOGLE_DRIVE_SCOPE = "https:\/\/www\.googleapis\.com\/auth\/drive\.file"/);
  assert.match(chat, /chat\.spaces\.readonly/);
  assert.match(chat, /chat\.spaces\.create/);
  assert.match(chat, /chat\.memberships/);
  assert.match(chat, /chat\.messages\.create/);
});

test("Google Chat service authorization must remain tied to the SAGA teacher identity", () => {
  const chat = read("src/lib/google-chat.ts");
  assert.match(chat, /expectedGoogleSubject/);
  assert.match(chat, /payload\.expectedGoogleSubject !== identity\.sub/);
  assert.match(chat, /identity\.email\.trim\(\)\.toLowerCase\(\) !== user\.email\.trim\(\)\.toLowerCase\(\)/);
  assert.match(chat, /include_granted_scopes: "true"/);
  assert.match(chat, /access_type: "offline"/);
});

test("OAuth callback dispatches Google login and Google service authorization separately", () => {
  const callback = read("src/app/api/integrations/google/callback/route.ts");
  assert.match(callback, /purpose === "google-login"/);
  assert.match(callback, /completeGoogleSignInOAuth/);
  assert.match(callback, /purpose === "google-chat-oauth"/);
  assert.match(callback, /completeGoogleOAuth/);
});

test("SAGA sessions identify Google-authenticated users without persisting Google passwords or tokens", () => {
  const auth = read("src/lib/auth.ts");
  assert.match(auth, /authProvider: googleIdentity \? "GOOGLE" : "PASSWORD"/);
  assert.match(auth, /googleSubject: googleIdentity\?\.subject/);
  assert.match(auth, /googleEmail: googleIdentity\?\.email/);
  assert.match(auth, /authProvider: payload\.authProvider === "GOOGLE"/);
  assert.doesNotMatch(auth, /googleAccessToken|googleRefreshToken|password.*google/i);
});

test("teacher Drive Picker reuses the same saved Google service connection", () => {
  const route = read("src/app/api/activities/google-drive/route.ts");
  const picker = read("src/components/ActivityGoogleDrive.tsx");
  assert.match(route, /prisma\.googleChatConnection\.findUnique/);
  assert.match(route, /connection\.googleEmail/);
  assert.match(route, /connection\.googleSubject/);
  assert.match(route, /googleChatAccessToken\(connection\)/);
  assert.match(picker, /action=token/);
  assert.doesNotMatch(picker, /initTokenClient/);
  assert.match(picker, /if \(mode !== "open" \|\| config\?\.identityVerified/);
  assert.match(picker, /google\.accounts\.id\.renderButton/);
});

test("students use their Google SAGA session or verify a matching Google email before opening Drive", () => {
  const route = read("src/app/api/activities/google-drive/route.ts");
  const picker = read("src/components/ActivityGoogleDrive.tsx");
  assert.match(route, /user\.authProvider === "GOOGLE"/);
  assert.match(route, /normalizeGoogleAccountEmail\(user\.googleEmail/);
  assert.match(route, /GOOGLE_EMAIL_MISMATCH/);
  assert.match(route, /please contact your subject teacher/i);
  assert.match(picker, /Your Google account matches your SAGA Portal email/);
});

test("unified Google sign-in does not enable Activity publishing or submission writes", () => {
  const env = read(".env.example");
  const server = read("src/lib/activity-feature-flags.ts");
  assert.match(env, /SAGA_ACTIVITIES_PUBLISH_ENABLED=false/);
  assert.match(env, /SAGA_ACTIVITIES_TEACHER_WRITE=false/);
  assert.match(env, /SAGA_ACTIVITIES_STUDENT_WRITE=false/);
  assert.match(server, /SAGA_ACTIVITIES_PUBLISH_ENABLED === "true"/);
});

test("unified sign-in uses its own same-origin callback while legacy Chat keeps its configured callback", () => {
  const auth = read("src/lib/google-auth.ts");
  const chat = read("src/lib/google-chat.ts");
  const env = read(".env.example");
  assert.match(auth, /GOOGLE_SSO_REDIRECT_URI/);
  assert.match(chat, /redirectUri\?: string/);
  assert.match(chat, /redirectUri,\s*purpose: "google-chat-oauth"/);
  assert.match(chat, /typeof payload\.redirectUri === "string" \? payload\.redirectUri : requiredEnv\("GOOGLE_REDIRECT_URI"\)/);
  assert.match(env, /GOOGLE_REDIRECT_URI=/);
  assert.match(env, /GOOGLE_SSO_REDIRECT_URI=/);
});

test("Chat service tokens cannot be used with a different SAGA email or Google subject", () => {
  const chat = read("src/lib/google-chat.ts");
  const routes = [
    read("src/app/api/teacher/google-chat/spaces/route.ts"),
    read("src/app/api/teacher/google-chat/subjects/[subjectId]/space/route.ts"),
    read("src/app/api/teacher/google-chat/subjects/[subjectId]/announcements/route.ts"),
    read("src/app/api/teacher/google-chat/subjects/[subjectId]/sync/route.ts")
  ].join("\\n");
  assert.match(chat, /connection\.googleEmail\.trim\(\)\.toLowerCase\(\) !== user\.email\.trim\(\)\.toLowerCase\(\)/);
  assert.match(chat, /user\.authProvider === "GOOGLE" && connection\.googleSubject !== user\.googleSubject/);
  assert.equal((routes.match(/googleConnectionMatchesSAGAAccount\(connection, teacher\)/g) || []).length, 4);
  const reconnect = read("src/app/api/teacher/google-chat/connect/route.ts");
  const connectionStatus = read("src/app/api/teacher/google-chat/connection/route.ts");
  assert.match(reconnect, /redirectUri: process\.env\.GOOGLE_SSO_REDIRECT_URI/);
  assert.match(connectionStatus, /connection\.googleSubject === teacher\.googleSubject/);
});

test("refresh tokens are never reused when a teacher changes their Google identity", () => {
  const chat = read("src/lib/google-chat.ts");
  assert.match(chat, /sameExistingGoogleAccount = existingConnection\?\.googleSubject === identity\.sub/);
  assert.match(chat, /if \(!tokens\.refresh_token && !sameExistingGoogleAccount\)/);
});

test("stored Google OAuth scopes are tokenized on whitespace", () => {
  const files = [
    "src/lib/google-auth.ts",
    "src/lib/google-chat.ts",
    "src/app/api/teacher/google-chat/connection/route.ts",
    "src/app/api/teacher/google-chat/spaces/route.ts",
    "src/app/api/teacher/google-chat/subjects/[subjectId]/space/route.ts",
    "src/app/api/teacher/google-chat/subjects/[subjectId]/announcements/route.ts",
    "src/app/api/teacher/google-chat/subjects/[subjectId]/sync/route.ts",
    "src/app/api/activities/google-drive/route.ts"
  ];
  for (const file of files) {
    const source = read(file);
    assert.ok(source.includes(String.raw`split(/\s+/)`), `${file} must split OAuth scopes on whitespace`);
    assert.ok(!source.includes(String.raw`split(/\\s+/)`), `${file} must not split OAuth scopes on a literal backslash`);
  }
});
