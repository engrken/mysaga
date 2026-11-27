const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

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
  assert.match(api, /user\.isDemo/);
});

test("teacher Picker requests selected-file Drive access and verifies the same Google account", () => {
  const component = read("src/components/ActivityGoogleDrive.tsx");
  const api = read("src/app/api/activities/google-drive/route.ts");
  assert.match(component, /scope: "openid email https:\/\/www\.googleapis\.com\/auth\/drive\.file"/);
  assert.match(component, /setDeveloperKey\(config\.apiKey/);
  assert.match(component, /setAppId\(config\.appId/);
  assert.match(api, /mode === "picker"/);
  assert.match(api, /userInfo\.sub !== identity\.sub/);
  assert.match(api, /normalizeGoogleAccountEmail\(userInfo\.email\) !== portalEmail/);
  assert.doesNotMatch(api, /prisma\.(create|upsert|update)\(/);
});

test("teacher drafts use Picker, while student Drive opens require email verification", () => {
  const activities = read("src/components/ClassActivities.tsx");
  const component = read("src/components/ActivityGoogleDrive.tsx");
  assert.match(activities, /mode="picker"/);
  assert.match(activities, /mode="open"/);
  assert.match(activities, /activitiesGoogleDriveExploration/);
  assert.match(component, /Sign in with Google/);
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
  assert.match(privacy, /Activities Google Drive exploration/);
  assert.match(privacy, /must match the email/);
  assert.match(privacy, /contact the subject teacher/);
  assert.match(privacy, /does not copy the Drive file contents/);
  assert.match(privacy, /drive\.file/);
});
