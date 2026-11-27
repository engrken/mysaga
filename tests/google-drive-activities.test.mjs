import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = file => fs.readFileSync(path.join(process.cwd(), file), "utf8");

test("Google Drive Activities is gated by both exploration switches", () => {
  const serverFlag = read("src/lib/google-drive-activities.ts");
  const clientFlag = read("src/lib/activity-feature-flags.client.ts");
  const api = read("src/app/api/activities/google-drive/route.ts");
  assert.match(serverFlag, /activitiesExplorationOnly/);
  assert.match(serverFlag, /SAGA_ACTIVITIES_GOOGLE_DRIVE_EXPLORATION === "true"/);
  assert.match(clientFlag, /NEXT_PUBLIC_SAGA_ACTIVITIES_GOOGLE_DRIVE_EXPLORATION === "true"/);
  assert.match(api, /if \(!activitiesGoogleDriveExploration\)/);
});

test("Google ID tokens are verified against Google's keys, issuer and configured OAuth client", () => {
  const api = read("src/app/api/activities/google-drive/route.ts");
  assert.match(api, /createRemoteJWKSet\(new URL\("https:\/\/www\.googleapis\.com\/oauth2\/v3\/certs"\)\)/);
  assert.match(api, /jwtVerify\(input\.credential, GOOGLE_JWKS/);
  assert.match(api, /isSameOriginRequest\(request\)/);
  assert.match(api, /new URL\(origin\)\.origin === new URL\(request\.url\)\.origin/);
  assert.match(api, /algorithms: \["RS256"\]/);
  assert.match(api, /issuer: \["accounts\.google\.com", "https:\/\/accounts\.google\.com"\]/);
  assert.match(api, /audience: clientId/);
  assert.match(api, /identity\.email_verified !== true/);
  assert.match(api, /typeof identity\.sub !== "string"/);
});

test("Google email must match the current verified SAGA account email", () => {
  const api = read("src/app/api/activities/google-drive/route.ts");
  const helper = read("src/lib/google-drive-activities.ts");
  assert.match(api, /normalizeGoogleAccountEmail\(identity\.email\)/);
  assert.match(api, /normalizeGoogleAccountEmail\(user\.email\)/);
  assert.match(api, /googleEmail !== portalEmail/);
  assert.match(helper, /trim\(\)\.toLowerCase\(\)/);
  assert.match(api, /GOOGLE_EMAIL_MISMATCH/);
  assert.match(api, /please contact your subject teacher/i);
});

test("Google access is role, tenant, subject and enrollment scoped", () => {
  const api = read("src/app/api/activities/google-drive/route.ts");
  assert.match(api, /getSession\(\)/);
  assert.match(api, /user\.schoolId, teacherId: user\.id/);
  assert.match(api, /enrollments: \{ some: \{ OR: activityEnrollmentIdentity\(user\) \} \}/);
  assert.match(api, /mode === "open" && user\.role !== "STUDENT"/);
  assert.match(api, /mode === "picker" && user\.role !== "TEACHER"/);
  assert.match(api, /user\.role !== "STUDENT"/);
  assert.match(api, /mode: z\.literal\("identity"\)/);
  assert.match(api, /user\.isDemo/);
});

test("teacher Picker uses the saved SAGA Google services connection and narrow Drive scope", () => {
  const component = read("src/components/ActivityGoogleDrive.tsx");
  const api = read("src/app/api/activities/google-drive/route.ts");
  const services = read("src/lib/google-chat.ts");
  assert.match(services, /https:\/\/www\.googleapis\.com\/auth\/drive\.file/);
  assert.match(component, /setDeveloperKey\(config\.apiKey/);
  assert.match(component, /setAppId\(config\.appId/);
  assert.match(component, /setOAuthToken\(String\(tokenData\.accessToken\)\)/);
  assert.match(api, /googleChatAccessToken\(connection\)/);
  assert.match(api, /connection\.googleEmail/);
  assert.match(api, /GOOGLE_DRIVE_SCOPE/);
  assert.match(api, /GOOGLE_ACCOUNT_MISMATCH/);
});

test("teacher drafts use Picker, while student Drive opens require email verification", () => {
  const activities = read("src/components/ClassActivities.tsx");
  const component = read("src/components/ActivityGoogleDrive.tsx");
  assert.match(activities, /mode="picker"/);
  assert.match(activities, /mode="open"/);
  assert.match(activities, /activitiesGoogleDriveExploration/);
  assert.match(component, /Verify Google account for Drive access/);
  assert.match(component, /Your Google account matches your SAGA Portal email/);
  assert.match(component, /Open in Google Drive/);
});

test("Google Drive controls do not enable Activity publishing or student submission writes", () => {
  const serverFlags = read("src/lib/activity-feature-flags.ts");
  const clientFlags = read("src/lib/activity-feature-flags.client.ts");
  const env = read(".env.example");
  assert.match(env, /SAGA_ACTIVITIES_PUBLISH_ENABLED=false/);
  assert.match(env, /SAGA_ACTIVITIES_STUDENT_WRITE=false/);
  assert.match(env, /SAGA_ACTIVITIES_GOOGLE_DRIVE_EXPLORATION=false/);
  assert.match(serverFlags, /SAGA_ACTIVITIES_PUBLISH_ENABLED === "true"/);
  assert.match(serverFlags, /flag === "true"/);
  assert.match(clientFlags, /NEXT_PUBLIC_SAGA_ACTIVITIES_PUBLISH_ENABLED === "true"/);
});

test("privacy notice documents Google account email matching and Drive file handling", () => {
  const privacy = read("src/app/privacy/page.tsx");
  assert.match(privacy, /Google Sign-In is an alternative way to authenticate/);
  assert.match(privacy, /matches the verified\s+Google email to an existing account/);
  assert.match(privacy, /does not copy the Drive file contents/);
  assert.match(privacy, /drive\.file/);
  assert.match(privacy, /encrypted Google service\s+tokens/);
});
