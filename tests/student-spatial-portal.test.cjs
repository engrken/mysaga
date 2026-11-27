const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");

test("real student overview uses the spatial dashboard without removing existing student workflows", () => {
  const portal = read("src/components/Portal.tsx");
  assert.match(portal, /<OverviewDashboard[\s\S]*?grades=\{grades\}/);
  assert.match(portal, /<StudentActivities readOnly=\{user\.isDemo\}/);
  assert.match(portal, /<StudentClassEnrollment/);
  assert.match(portal, /student-grade-section/);
  assert.match(portal, /student-grade-\$\{g\.id\}/);
  assert.match(portal, /setStudentCustomizerRequested\(true\)/);
});

test("student theme preferences are account-scoped, validated, and never persisted for demo users", () => {
  const portal = read("src/components/Portal.tsx");
  const types = read("src/components/student-portal/types.ts");
  assert.match(portal, /saga-student-portal-preferences:v1:\$\{user\.id\}/);
  assert.match(portal, /if \(!studentPortalPreferencesReady \|\| teacher \|\| user\.isDemo\) return/);
  assert.match(portal, /mergeStudentPortalPreferences\(JSON\.parse\(saved\)\)/);
  assert.match(types, /url\.protocol === "https:" \|\| url\.protocol === "http:"/);
  assert.match(types, /STUDENT_PORTAL_DEFAULTS/);
  assert.match(types, /modules: \{ metrics: true, insights: true, courses: true \}/);
});

test("dashboard includes the requested KPI, insights, schedule, quick panel, and reset controls", () => {
  const dashboard = read("src/components/student-portal/OverviewDashboard.tsx");
  const customizer = read("src/components/student-portal/PortalCustomizer.tsx");
  const insights = read("src/components/student-portal/ClassInsightsPanel.tsx");
  const window = read("src/components/student-portal/DraggableGlassWindow.tsx");
  assert.match(dashboard, /ACADEMIC AVERAGE/);
  assert.match(dashboard, /ATTENDANCE RATE/);
  assert.match(dashboard, /PENDING ITEMS/);
  assert.match(dashboard, /active courses &amp; weekly schedule/i);
  assert.match(dashboard, /Live class &amp; tasks/);
  assert.match(dashboard, /<PortalCustomizer/);
  assert.match(dashboard, /onReset=\{onReset\}/);
  assert.match(customizer, /Default Light Glass/);
  assert.match(customizer, /Smoked Dark Glass/);
  assert.match(customizer, /Classic Original Theme/);
  assert.match(customizer, /Sunlit Study Room/);
  assert.match(customizer, /Blurred Café/);
  assert.match(customizer, /Minimal Silk/);
  assert.match(customizer, /Mesh Gradient/);
  assert.match(customizer, /Ocean Blue/);
  assert.match(customizer, /Emerald/);
  assert.match(customizer, /Violet/);
  assert.match(customizer, /Amber/);
  assert.match(customizer, /Rose/);
  assert.match(customizer, /Reset to Original/);
  assert.match(insights, /Attendance across recorded roll calls/);
  assert.match(insights, /not a registrar GPA/i);
  assert.match(window, /onPointerDown/);
  assert.match(window, /onPointerMove/);
  assert.match(window, /onMinimize/);
  assert.match(window, /student-glass-dock-pill/);
});

test("student grade API exposes actual attendance totals and course schedule used by insights", () => {
  const api = read("src/app/api/student/grades/route.ts");
  assert.match(api, /schedule: true/);
  assert.match(api, /schedule: subject\.schedule/);
  assert.match(api, /attendanceSummary: attendance/);
});

test("practice demo reuses all customization controls with session-only fictional data", () => {
  const demo = read("src/components/DemoWorkspace.tsx");
  const css = read("src/components/DemoWorkspace.module.css");
  assert.match(demo, /<OverviewDashboard/);
  assert.match(demo, /demoMode=\{true\}/);
  assert.match(demo, /Try Dark Glass/);
  assert.match(demo, /Reset Layout/);
  assert.match(demo, /setStudentPreferences\(STUDENT_PORTAL_DEFAULTS\)/);
  assert.doesNotMatch(demo, /localStorage|sessionStorage/);
  assert.match(css, /data-student-glass-theme="dark-glass"/);
  assert.match(css, /data-student-wallpaper="sunlit"/);
  assert.match(css, /data-student-wallpaper="custom"/);
});

test("glass layout has responsive stacking, floating drawer, and reduced-motion fallback", () => {
  const css = read("src/app/globals.css");
  assert.match(css, /backdrop-filter:blur\(27px\)/);
  assert.match(css, /@media\(max-width:767px\)/);
  assert.match(css, /student-floating-window\{left:12px!important;right:12px!important;top:auto!important;bottom:12px/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
});
