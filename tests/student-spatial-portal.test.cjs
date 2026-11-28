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
  assert.match(portal, /setStudentCustomizerRequestedRoute\(targetPage\)/);
});

test("student theme preferences are account-scoped, validated, and never persisted for demo users", () => {
  const portal = read("src/components/Portal.tsx");
  const types = read("src/components/student-portal/types.ts");
  assert.match(portal, /saga-student-portal-preferences:v1:\$\{user\.id\}/);
  assert.match(portal, /if \(!studentPortalPreferencesReady \|\| teacher \|\| user\.isDemo\) return/);
  assert.match(portal, /mergeStudentPortalPreferences\(JSON\.parse\(saved\)\)/);
  assert.match(types, /url\.protocol === "https:"/);
  assert.match(types, /STUDENT_PORTAL_DEFAULTS/);
  assert.match(types, /modules: \{ metrics: true, insights: true, courses: true \}/);
  assert.match(types, /modulePositions: \{ metrics: \{ x: 0, y: 0 \}, insights: \{ x: 0, y: 0 \}, courses: \{ x: 0, y: 0 \} \}/);
});

test("dashboard includes the requested KPI, insights, schedule, quick panel, and reset controls", () => {
  const dashboard = read("src/components/student-portal/OverviewDashboard.tsx");
  const customizer = read("src/components/student-portal/PortalCustomizer.tsx");
  const types = read("src/components/student-portal/types.ts");
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
  assert.match(customizer, /Soft Midnight Blue Glass/);
  assert.match(customizer, /Classic Original Theme/);
  assert.match(customizer, /Sunlit Study Room/);
  assert.match(customizer, /Blurred Café/);
  assert.match(customizer, /Minimal Silk/);
  assert.match(customizer, /Mesh Gradient/);
  assert.match(types, /Rose/);
  assert.match(types, /Amber/);
  assert.match(types, /Violet/);
  assert.match(types, /Emerald/);
  assert.match(types, /Ocean Blue/);
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

test("freeform mode enables independently draggable and persistent overview modules", () => {
  const dashboard = read("src/components/student-portal/OverviewDashboard.tsx");
  const module = read("src/components/student-portal/DraggableGlassModule.tsx");
  const customizer = read("src/components/student-portal/PortalCustomizer.tsx");
  const css = read("src/app/globals.css");
  assert.match(dashboard, /enabled=\{activeLayoutMode === "freeform"\}/);
  assert.match(dashboard, /updateModulePosition\("metrics"/);
  assert.match(dashboard, /updateModulePosition\("insights"/);
  assert.match(dashboard, /updateModulePosition\("courses"/);
  assert.match(dashboard, /const activeLayoutMode = isCompactOrTouchViewport \? "snapped" : preferences\.layout/);
  assert.match(module, /onPointerDown=\{begin\}/);
  assert.match(module, /onPointerMove=\{move\}/);
  assert.match(module, /onKeyDown=\{nudge\}/);
  assert.match(customizer, /drag the small handle above each overview module/i);
  assert.match(css, /student-module-drag-handle/);
});

test("demo sign-in always returns safe JSON and the browser handles empty or malformed responses", () => {
  const route = read("src/app/api/auth/demo/route.ts");
  const entry = read("src/components/ActualDemoEntry.tsx");
  assert.match(route, /catch \(error\)/);
  assert.match(route, /\[demo-session\] Unable to create a public demo session/);
  assert.match(route, /NextResponse\.json\([\s\S]*?temporarily unavailable/);
  assert.match(entry, /const responseText = await response\.text\(\)/);
  assert.match(entry, /try \{\s*data = JSON\.parse\(responseText\)/);
  assert.match(entry, /returned an empty response/);
  assert.ok(entry.includes('data.redirect.startsWith("//")'));
});

test("Announcements and Class Chats reuse the same draggable floating appearance window as Overview", () => {
  const portal = read("src/components/Portal.tsx");
  const appearance = read("src/components/student-portal/StudentAppearanceWindow.tsx");
  const window = read("src/components/student-portal/DraggableGlassWindow.tsx");
  const types = read("src/components/student-portal/types.ts");
  const css = read("src/app/globals.css");
  assert.ok(portal.includes("student-portal-topbar-inner"));
  assert.ok(portal.includes("<StudentAppearanceWindow"));
  assert.ok(portal.includes("requested={studentCustomizerRequested}"));
  assert.equal((portal.match(/<StudentAppearanceWindow/g) || []).length, 2);
  assert.ok(portal.includes('aria-controls="student-appearance-window-host"'));
  assert.ok(appearance.includes("<DraggableGlassWindow"));
  assert.ok(appearance.includes('title="Customize appearance"'));
  assert.ok(appearance.includes('minimizedLabel="Customize appearance"'));
  assert.ok(appearance.includes("<PortalCustomizer"));
  assert.ok(appearance.includes("preferences.panelPosition"));
  assert.ok(appearance.includes("onPositionChange={updatePosition}"));
  assert.ok(window.includes("minimizedLabel?: string"));
  assert.ok(window.includes("student-glass-dock-pill"));
  assert.ok(types.includes("panelPosition: { x: 0, y: 0 }"));
  assert.ok(css.includes(":has(.student-floating-window) .student-portal-topbar-inner"));
  assert.ok(css.includes(":has(.student-floating-window:not(.is-minimized))"));
  assert.ok(css.includes("max-width:1180px"));
  assert.ok(css.includes("@media(max-width:767px)"));
  assert.doesNotMatch(css, /student-page-customizer-panel|student-page-customizer-trigger/);
});


test("student appearance requests are route-scoped and freeform is limited to Academic Overview", () => {
  const portal = read("src/components/Portal.tsx");
  const appearance = read("src/components/student-portal/StudentAppearanceWindow.tsx");
  const customizer = read("src/components/student-portal/PortalCustomizer.tsx");
  assert.match(portal, /studentCustomizerRequestedRoute, setStudentCustomizerRequestedRoute/);
  assert.match(portal, /studentCustomizerRequestedRoute === tab/);
  assert.match(portal, /setStudentCustomizerRequestedRoute\(null\)/);
  assert.match(portal, /const targetPage = tab === "overview" \|\| tab === "chats" \|\| tab === "announcements"/);
  assert.match(portal, /data-student-layout=\{!teacher \? \(isCompactOrTouchViewport \|\| tab !== "overview" \? "snapped" : studentPortalPreferences\.layout\) : undefined\}/);
  assert.match(appearance, /useState\(true\)/);
  assert.match(appearance, /layout: "snapped"/);
  assert.match(appearance, /allowFreeform=\{false\}/);
  assert.match(appearance, /onChange=\{updatePagePreferences\}/);
  assert.match(customizer, /allowFreeform = true/);
  assert.match(customizer, /disabled=\{!allowFreeform && value === "freeform"\}/);
  assert.match(customizer, /Freeform window positioning is available only on Academic Overview/);
});

test("student floating panels obey the portal overlay hierarchy and responsive backdrop", () => {
  const window = read("src/components/student-portal/DraggableGlassWindow.tsx");
  const css = read("src/app/globals.css");
  assert.match(window, /student-floating-window-backdrop/);
  assert.ok(window.includes('aria-label={\`Close \${title.toLowerCase()}\`}'));
  assert.match(window, /clampPanelX/);
  assert.match(window, /clampPanelY/);
  assert.match(css, /isolation:isolate/);
  assert.match(css, /portal-top-nav\{z-index:90!important\}/);
  assert.match(css, /student-floating-window\{z-index:var\(--student-panel-z,42\)!important\}/);
  assert.match(css, /student-glass-dock-pill\{z-index:43!important\}/);
  assert.match(css, /student-floating-window-backdrop\{[\s\S]*?z-index:38/);
  assert.match(css, /modal-backdrop-custom\{z-index:1000!important\}/);
  assert.match(css, /portal-toast-stack\{z-index:1200!important\}/);
  assert.match(css, /portal-waiting\{z-index:10000!important\}/);
  assert.match(css, /content-wrap:has\(\.student-floating-window:not\(\.is-minimized\)\)/);
});

test("structured student pages use the complete content width without a persistent side panel column", () => {
  const portal = read("src/components/Portal.tsx");
  const appearance = read("src/components/student-portal/StudentAppearanceWindow.tsx");
  const css = read("src/app/globals.css");
  assert.match(portal, /tab === "chats"[\s\S]*?<StudentAppearanceWindow/);
  assert.match(portal, /tab === "announcements"[\s\S]*?<StudentAppearanceWindow/);
  assert.match(appearance, /useState\(true\)/);
  assert.match(css, /\.student-theme-page\{[\s\S]*?width:100%/);
  assert.match(css, /\.student-announcements,[\s\S]*?\.class-chats-page\{[\s\S]*?width:100%/);
  assert.match(css, /\.portal-layout > \.main-area\{[\s\S]*?min-height:100dvh/);
  assert.match(css, /\.portal-layout > \.main-area > \.content-wrap\{[\s\S]*?width:min\(100%,1680px\)/);
});


test("secondary-page customization reset preserves the saved Academic Overview layout preference", () => {
  const portal = read("src/components/Portal.tsx");
  const appearance = read("src/components/student-portal/StudentAppearanceWindow.tsx");
  assert.match(portal, /function resetStudentPortalPreferences\(preserveOverviewLayout = false\)/);
  assert.match(portal, /preserveOverviewLayout[\s\S]*?layout: studentPortalPreferences\.layout/);
  assert.equal((portal.match(/onReset=\{\(\) => resetStudentPortalPreferences\(true\)\}/g) || []).length, 2);
  assert.match(appearance, /onChange\(\{ \.\.\.next, layout: preferences\.layout \}\)/);
});


test("mobile and touch viewports force snapped layouts while desktop mouse users retain Freeform", () => {
  const portal = read("src/components/Portal.tsx");
  const dashboard = read("src/components/student-portal/OverviewDashboard.tsx");
  const module = read("src/components/student-portal/DraggableGlassModule.tsx");
  const customizer = read("src/components/student-portal/PortalCustomizer.tsx");
  assert.match(portal, /matchMedia\("\(max-width: 767px\), \(pointer: coarse\)"\)/);
  assert.match(portal, /isCompactOrTouchViewport \|\| tab !== "overview" \? "snapped" : studentPortalPreferences\.layout/);
  assert.match(dashboard, /const activeLayoutMode = isCompactOrTouchViewport \? "snapped" : preferences\.layout/);
  assert.equal((dashboard.match(/enabled=\{activeLayoutMode === "freeform"\}/g) || []).length, 3);
  assert.match(dashboard, /allowFreeform=\{!isCompactOrTouchViewport\}/);
  assert.match(dashboard, /layout: preferences\.layout/);
  assert.match(customizer, /disabled=\{!allowFreeform && value === "freeform"\}/);
  assert.match(module, /event\.pointerType !== "mouse"/);
  assert.match(module, /matchMedia\("\(max-width: 767px\), \(pointer: coarse\)"\)/);
});

test("mobile floating panels lock background scrolling and restore the previous scroll position", () => {
  const panel = read("src/components/student-portal/DraggableGlassWindow.tsx");
  assert.match(panel, /if \(minimized \|\| typeof window === "undefined"\) return/);
  assert.match(panel, /compactQuery = window\.matchMedia\("\(max-width: 767px\), \(pointer: coarse\)"\)/);
  assert.match(panel, /body\.style\.position = "fixed"/);
  assert.match(panel, /body\.style\.top =/);
  assert.match(panel, /html\.style\.overflow = "hidden"/);
  assert.match(panel, /window\.scrollTo\(0, restoreY\)/);
  assert.match(panel, /compactQuery\.removeListener\(syncScrollLock\)/);
  assert.match(panel, /event\.pointerType !== "mouse"/);
});

test("mobile panel presentation is a full-width bottom sheet with a touch backdrop and persistent close header", () => {
  const panel = read("src/components/student-portal/DraggableGlassWindow.tsx");
  const css = read("src/app/globals.css");
  assert.match(panel, /student-floating-window-backdrop/);
  assert.match(css, /@media\(max-width:767px\), \(pointer:coarse\)/);
  assert.match(css, /inset:0;[\s\S]*?z-index:48/);
  assert.match(css, /pointer-events:auto/);
  assert.match(css, /backdrop-filter:blur\(5px\)/);
  assert.match(css, /width:100%!important/);
  assert.match(css, /max-height:min\(88dvh/);
  assert.match(css, /border-radius:22px 22px 0 0/);
  assert.match(css, /student-floating-window-head\{[\s\S]*?position:sticky/);
  assert.match(css, /student-window-minimize\{[\s\S]*?position:sticky/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /portal-top-nav\{z-index:30!important\}/);
  assert.match(css, /student-floating-window\{[\s\S]*?z-index:50!important/);
});

test("mobile navigation, demo alert actions, and long page titles wrap without horizontal bleed", () => {
  const css = read("src/app/globals.css");
  const banner = read("src/components/RealDemoBanner.module.css");
  const demoCss = read("src/components/DemoWorkspace.module.css");
  assert.match(css, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /overflow-wrap:anywhere/);
  assert.match(css, /overflow-x:clip/);
  assert.match(css, /-webkit-overflow-scrolling:touch/);
  assert.match(banner, /padding:12px 16px/);
  assert.match(banner, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(banner, /flex:1 1 138px/);
  assert.match(demoCss, /safetyBar\{[\s\S]*?flex-wrap:wrap/);
  assert.match(demoCss, /100dvh/);
  assert.match(demoCss, /overflow-x:clip/);
});

test("student app and Practice Demo use dynamic viewport sizing and touch-safe structured scrolling", () => {
  const css = read("src/app/globals.css");
  const demoCss = read("src/components/DemoWorkspace.module.css");
  const layout = read("src/app/layout.tsx");
  assert.match(css, /min-height:100dvh/);
  assert.match(css, /max-height:min\(88dvh/);
  assert.match(css, /overscroll-behavior:contain/);
  assert.match(css, /touch-action:pan-y/);
  assert.match(demoCss, /min-height:100dvh/);
  assert.match(demoCss, /overflow-x:auto/);
  assert.match(layout, /viewportFit: "cover"/);
});


test("Practice Demo bottom-sheet selectors target shared global components in CSS Modules", () => {
  const demoCss = read("src/components/DemoWorkspace.module.css");
  assert.match(demoCss, /:global\(\.student-floating-window-backdrop\)/);
  assert.match(demoCss, /:global\(\.student-floating-window\)/);
  assert.match(demoCss, /:global\(\.student-floating-window-head\)/);
  assert.match(demoCss, /:global\(\.student-floating-window-body\)/);
  assert.match(demoCss, /@supports not \(height:100dvh\)/);
});
