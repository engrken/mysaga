const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const source = fs.readFileSync(path.join(__dirname, "../src/lib/account-identifiers.ts"), "utf8");
const js = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022
} }).outputText;
const mod = { exports: {} };
new Function("exports", "module", js)(mod.exports, mod);
const { normalizeStudentLoginId, normalizeFacultyId, resolveLoginIdentifier } = mod.exports;

test("email login is normalized without confusing a Student ID for an email", () => {
  assert.deepEqual(resolveLoginIdentifier("EMAIL", " Faculty@School.EDU.PH "), {
    type: "EMAIL", value: "faculty@school.edu.ph"
  });
  assert.equal(resolveLoginIdentifier("EMAIL", "2026-00123"), null);
});

test("Student ID sign-in is school-scoped by caller and case-normalized", () => {
  assert.equal(normalizeStudentLoginId("  abc-123  "), "ABC-123");
  assert.deepEqual(resolveLoginIdentifier("STUDENT_ID", "  ABC-00017  "), {
    type: "STUDENT_ID", value: "ABC-00017"
  });
  assert.equal(resolveLoginIdentifier("STUDENT_ID", ""), null);
  assert.equal(resolveLoginIdentifier("STUDENT_ID", "x".repeat(41)), null);
});

test("Faculty ID accepts realistic school-issued IDs but rejects spaces and invalid chars", () => {
  assert.equal(normalizeFacultyId(" fac-2026-001 "), "FAC-2026-001");
  assert.equal(normalizeFacultyId("A12/011"), "A12/011");
  assert.equal(normalizeFacultyId("FAC 01"), null);
  assert.equal(normalizeFacultyId("x"), null);
  assert.equal(normalizeFacultyId("a".repeat(41)), null);
});

test("Primary portal navigation replaces the sidebar and keeps My Classes as an active-period dropdown", () => {
  const portal = fs.readFileSync(path.join(__dirname, "../src/components/Portal.tsx"), "utf8");
  const styles = fs.readFileSync(path.join(__dirname, "../src/app/globals.css"), "utf8");
  assert.ok(portal.includes('<header className="portal-top-nav">'));
  assert.ok(portal.includes('<nav className="portal-top-links" aria-label="Primary navigation">'));
  assert.ok(portal.includes('<div className="portal-top-actions"><AccountMenu'));
  assert.doesNotMatch(portal, /<aside className="sidebar"/);
  assert.ok(portal.includes("portal-nav-class-menu"));
  assert.ok(portal.includes('aria-haspopup="true"'));
  assert.ok(portal.includes("aria-expanded={classesMenuOpen}"));
  assert.ok(portal.includes("subjects.length ? subjects.map(subject => <button"));
  assert.ok(portal.includes("onClick={() => { setClassesMenuOpen(false); openClass(subject.id); }}"));
  const account = fs.readFileSync(path.join(__dirname, "../src/components/AccountMenu.tsx"), "utf8");
  assert.doesNotMatch(portal, /Private by default|Academic records are protected|portal-top-privacy/);
  assert.ok(account.includes('<div className="account-menu-privacy" role="note">'));
  assert.ok(account.includes("Private by default"));
  assert.ok(account.includes("Academic records are protected"));
  assert.ok(styles.includes(".portal-top-actions{display:flex;align-items:center;justify-content:flex-end"));
  assert.ok(styles.includes(".account-menu-privacy{display:flex;align-items:center"));
  assert.ok(styles.includes(".portal-top-actions{grid-column:2;grid-row:1}"));
  assert.ok(portal.includes("Grade Simulator"));
  assert.ok(portal.includes("Help &amp; guides"));
  assert.ok(styles.includes("portal-nav-class-menu:hover .portal-top-class-list"));
  assert.ok(styles.includes("portal-nav-class-menu:focus-within .portal-top-class-list"));
  assert.ok(styles.includes("portal-nav-class-menu.is-open .portal-top-class-list"));
  assert.ok(styles.includes("@media(max-width:760px)"));
  assert.ok(styles.includes(".portal-top-links{grid-column:1/-1"));
  assert.ok(styles.includes(".portal-layout[data-bs-theme=\"dark\"] .portal-top-nav"));
});

test("Faculty ID migration protects existing records and unique school assignment", () => {
  const migration = fs.readFileSync(path.join(__dirname,
    "../prisma/migrations/20261113000100_faculty_id/migration.sql"), "utf8");
  assert.match(migration, /WHERE "role" = 'TEACHER'/);
  assert.match(migration, /RANDOM\(\)/);
  assert.match(migration, /CREATE UNIQUE INDEX "User_schoolId_facultyId_key"/);
});
