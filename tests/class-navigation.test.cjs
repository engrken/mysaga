const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const source = fs.readFileSync(path.join(__dirname, "../src/lib/class-navigation.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const syntheticModule = { exports: {} };
new Function("exports", "module", compiled)(syntheticModule.exports, syntheticModule);
const { courseCodeSlug, classRouteKey, classWorkspaceHref, parseClassWorkspaceQuery, resolveClassSelection, resolveClassRoute } = syntheticModule.exports;
const subjects = [{ id: "class-a", code: "ECE 18", academicYear: "2026-2027", term: "1st Semester" }, { id: "class-b", code: "ECE 6", academicYear: "2025-2026", term: "2nd Semester" }];

test("overview and sidebar links open a human-readable course URL", () => {
  const url = classWorkspaceHref("fcu", "class-a", "setup", {}, subjects);
  assert.equal(url, "/fcu/classes/ece-18");
  assert.equal(resolveClassRoute("ece-18", subjects)?.id, "class-a");
});
test("duplicate codes in separate terms use stable disambiguation", () => {
  const sameCode = [...subjects, { id: "class-c", code: "ECE-18", academicYear: "2027-2028", term: "1st Semester" }];
  assert.equal(classRouteKey(sameCode[0], sameCode), "ece-18--class-a");
  assert.equal(classWorkspaceHref("fcu", "class-c", "record", undefined, sameCode), "/fcu/classes/ece-18--class-c?section=record");
  assert.equal(resolveClassRoute("ece-18--class-c", sameCode)?.id, "class-c");
  assert.equal(resolveClassRoute("ece-18", sameCode), null);
});
test("deep links restore workspace section and student search", () => {
  const url = classWorkspaceHref("fcu", "class-a", "record", { student: "2026 007" }, subjects);
  assert.equal(url, "/fcu/classes/ece-18?section=record&student=2026+007");
  const decoded = parseClassWorkspaceQuery(Object.fromEntries(new URL(url, "https://example.test").searchParams));
  assert.equal(decoded.section, "record");
  assert.equal(decoded.student, "2026 007");
});
test("attendance shortcuts persist the requested section after page remount", () => {
  const url = classWorkspaceHref("fcu", "class-b", "attendance", { attendanceToday: true }, subjects);
  assert.equal(url, "/fcu/classes/ece-6?section=attendance&attendanceToday=1");
  assert.equal(parseClassWorkspaceQuery(Object.fromEntries(new URL(url, "https://example.test").searchParams)).attendanceToday, true);
});
test("the class directory stays unselected until a teacher opens a class", () => {
  assert.equal(resolveClassSelection(subjects, "", "All School Years", "All Terms"), "");
  assert.equal(resolveClassSelection(subjects, "class-b", "All School Years", "All Terms"), "class-b");
  assert.equal(resolveClassSelection(subjects, "class-b", "2026-2027", "1st Semester"), "class-a");
  assert.equal(resolveClassSelection([], "class-b", "All School Years", "All Terms"), "");
});
test("legacy bookmarked class IDs survive the redirect while data is loading", () => {
  assert.equal(classWorkspaceHref("fcu", "class-a"), "/fcu/classes?class=class-a");
  assert.equal(parseClassWorkspaceQuery({ class: "class-a" }).classId, "class-a");
});
test("slugs are URL-safe and cannot cross to another class", () => {
  assert.equal(courseCodeSlug("ECE 18 / Wireless"), "ece-18-wireless");
  assert.equal(classWorkspaceHref("FCU & More", "class-a", "final", undefined, subjects), "/FCU%20%26%20More/classes/ece-18?section=final");
  assert.equal(resolveClassRoute("unknown-course", subjects), null);
  assert.equal(resolveClassRoute("ece-18--class-evil", subjects), null);
});

test("teacher class directory is scoped to the active Overview academic period without sidebar quick access", () => {
  const portal = fs.readFileSync(path.join(__dirname, "../src/components/Portal.tsx"), "utf8");
  assert.ok(portal.includes("academicYear=${encodeURIComponent(academicYear)}&term=${encodeURIComponent(activeTerm)}"));
  assert.doesNotMatch(portal, /QUICK ACCESS|sidebarClassQuery|classNavOpen/);
});

test("student grades use the Overview academic period without separate year and term filters", () => {
  const portal = fs.readFileSync(path.join(__dirname, "../src/components/Portal.tsx"), "utf8");
  assert.ok(portal.includes("view=summary&academicYear=${encodeURIComponent(academicYear)}&term=${encodeURIComponent(activeTerm)}"));
  assert.doesNotMatch(portal, /studentYearFilter|studentTermFilter/);
});


test("class directory has dedicated responsive and dark-mode presentation styles", () => {
  const styles = fs.readFileSync(path.join(__dirname, "../src/app/globals.css"), "utf8");
  for (const selector of [
    ".class-directory-hero{",
    ".class-directory-stats{",
    ".class-directory-stat{",
    ".class-directory-grid{",
    ".class-directory-card{",
    ".class-directory-card:focus-visible{",
    ".class-directory-pagination{",
    '.portal-layout[data-bs-theme="dark"] .class-directory-card,'
  ]) {
    assert.ok(styles.includes(selector), "Missing class directory style: " + selector);
  }
  assert.ok(styles.includes("@media(max-width:760px){"));
  assert.ok(styles.includes(".class-directory-grid{grid-template-columns:1fr;"));
  assert.ok(styles.includes("@media(max-width:1100px){"));
  assert.ok(styles.includes(".class-directory-stats{grid-template-columns:repeat(2,minmax(0,1fr))}"));
});
