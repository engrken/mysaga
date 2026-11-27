import test from "node:test";
import assert from "node:assert/strict";
import {
  questionSchema,
  gradeQuizAnswers,
  lessonPagesSchema,
  sanitizeLessonHtml,
  validDriveLink
} from "../src/lib/class-activities.ts";

test("question bank validates all supported question types", () => {
  assert.equal(questionSchema.safeParse({
    type: "MULTIPLE_CHOICE", prompt: "Select the answer", options: ["A", "B"], answer: 1
  }).success, true);
  assert.equal(questionSchema.safeParse({
    type: "TRUE_FALSE", prompt: "A statement", options: ["True", "False"], answer: 0
  }).success, true);
  assert.equal(questionSchema.safeParse({
    type: "SHORT_ANSWER", prompt: "What is 2 + 2?", options: [], answerText: "4"
  }).success, true);
  assert.equal(questionSchema.safeParse({
    type: "ESSAY", prompt: "Explain the process", options: []
  }).success, true);
});

test("multiple-choice, true/false and short-answer grading returns weighted points", () => {
  const questions = [
    { id: "mc", type: "MULTIPLE_CHOICE", prompt: "MC", options: ["a", "b"], answer: 1, points: 2 },
    { id: "tf", type: "TRUE_FALSE", prompt: "TF", options: ["True", "False"], answer: 0, points: 1 },
    { id: "sa", type: "SHORT_ANSWER", prompt: "SA", options: [], answer: 0, answerText: "Ohm", points: 3 }
  ];
  const grade = gradeQuizAnswers(questions, { mc: 1, tf: 0, sa: " ohm " });
  assert.equal(grade.points, 6);
  assert.equal(grade.manualGradingRequired, false);
  assert.deepEqual(grade.questionResults, { mc: true, tf: true, sa: true });
});

test("essay questions remain pending manual grading", () => {
  const grade = gradeQuizAnswers([
    { id: "essay", type: "ESSAY", prompt: "Explain", options: [], answer: 0, points: 5 }
  ], { essay: "A written response" });
  assert.equal(grade.points, 0);
  assert.equal(grade.manualGradingRequired, true);
  assert.equal(grade.questionResults.essay, null);
});

test("lesson branches and sequential targets must resolve to lesson pages", () => {
  const pages = [
    { id: "intro", title: "Introduction", content: "<p>Start</p>", nextPageId: "review", branches: [] },
    { id: "review", title: "Review", content: "<p>Review</p>", nextPageId: null,
      branches: [{ label: "Continue", targetPageId: "intro" }] }
  ];
  assert.equal(lessonPagesSchema.safeParse(pages).success, true);
  assert.equal(lessonPagesSchema.safeParse([{ ...pages[0], nextPageId: "missing" }]).success, false);
});

test("lesson content strips scripts and unsafe link schemes", () => {
  const safe = sanitizeLessonHtml('<p>Welcome</p><script>alert(1)</script><a href="javascript:alert(1)">bad</a>');
  assert.match(safe, /Welcome/);
  assert.doesNotMatch(safe, /<script|javascript:/i);
});

test("Drive links are restricted to HTTPS Drive and Docs hosts", () => {
  assert.equal(validDriveLink("https://drive.google.com/file/d/abc/view"), true);
  assert.equal(validDriveLink("https://docs.google.com/document/d/abc/edit"), true);
  assert.equal(validDriveLink("http://drive.google.com/file/d/abc"), false);
  assert.equal(validDriveLink("https://evil.example/drive.google.com"), false);
});
