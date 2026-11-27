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
  assert.deepEqual(grade.questionResults, { mc:¶»§q«^