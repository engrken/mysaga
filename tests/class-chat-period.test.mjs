import assert from "node:assert/strict";
import test from "node:test";
import { isSameAcademicPeriod } from "../src/lib/academic-period.ts";

test("matches legacy semester names and dash variants", () => {
  assert.equal(isSameAcademicPeriod({ academicYear: "2026–2027", term: "First Semester" }, "2026-2027", "1st Semester"), true);
});
test("excludes a different semester in the same year", () => {
  assert.equal(isSameAcademicPeriod({ academicYear: "2026-2027", term: "2nd Semester" }, "2026-2027", "1st Semester"), false);
});
test("matches the selected trimester only", () => {
  assert.equal(isSameAcademicPeriod({ academicYear: "2026 - 2027", term: "Third Trimester" }, "2026-2027", "3rd Trimester"), true);
  assert.equal(isSameAcademicPeriod({ academicYear: "2026-2027", term: "2nd Trimester" }, "2026-2027", "3rd Trimester"), false);
});
test("excludes a different academic year", () => {
  assert.equal(isSameAcademicPeriod({ academicYear: "2025-2026", term: "First Semester" }, "2026-2027", "1st Semester"), false);
});
