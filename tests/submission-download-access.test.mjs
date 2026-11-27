import test from "node:test";
import assert from "node:assert/strict";
import { canDownloadSubmissionFile } from "../src/lib/submission-download-access.ts";

const ownership = {
  schoolId: "school-a",
  teacherId: "teacher-a",
  enrollment: {
    studentUserId: "student-a",
    studentNumber: "2026-001"
  }
};

test("only the assigned teacher in the same school can download a submission", () => {
  assert.equal(canDownloadSubmissionFile({
    id: "teacher-a", role: "TEACHER", schoolId: "school-a"
  }, ownership), true);
  assert.equal(canDownloadSubmissionFile({
    id: "teacher-b", role: "TEACHER", schoolId: "school-a"
  }, ownership), false);
  assert.equal(canDownloadSubmissionFile({
    id: "teacher-a", role: "TEACHER", schoolId: "school-b"
  }, ownership), false);
});

test("only the owning student in the same school can download a submission", () => {
  assert.equal(canDownloadSubmissionFile({
    id: "student-a", role: "STUDENT", schoolId: "school-a", studentNumber: "2026-001"
  }, ownership), true);
  assert.equal(canDownloadSubmissionFile({
    id: "student-b", role: "STUDENT", schoolId: "school-a", studentNumber: "2026-001"
  }, ownership), false);
  assert.equal(canDownloadSubmissionFile({
    id: "student-a", role: "STUDENT", schoolId: "school-b", studentNumber: "2026-001"
  }, ownership), false);
});

test("legacy roster-only enrollments use a case-insensitive student-number match", () => {
  const legacyOwnership = {
    ...ownership,
    enrollment: { studentUserId: null, studentNumber: "  Fcu-2026-17 " }
  };
  assert.equal(canDownloadSubmissionFile({
    id: "student-a", role: "STUDENT", schoolId: "school-a", studentNumber: "fcu-2026-17"
  }, legacyOwnership), true);
  assert.equal(canDownloadSubmissionFile({
    id: "student-a", role: "STUDENT", schoolId: "school-a", studentNumber: "fcu-2026-18"
  }, legacyOwnership), false);
});

test("a linked enrollment does not fall back to a matching number for another account", () => {
  const linkedOwnership = {
    ...ownership,
    enrollment: { studentUserId: "student-original", studentNumber: "2026-001" }
  };
  assert.equal(canDownloadSubmissionFile({
    id: "student-other", role: "STUDENT", schoolId: "school-a", studentNumber: "2026-001"
  }, linkedOwnership), false);
});
