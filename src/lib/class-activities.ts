import sanitizeHtml from "sanitize-html";
import { z } from "zod";

export const questionTypes = ["MULTIPLE_CHOICE", "TRUE_FALSE", "ESSAY", "SHORT_ANSWER"] as const;
export const questionSchema = z.object({
  type: z.enum(questionTypes).default("MULTIPLE_CHOICE"),
  prompt: z.string().trim().min(1).max(1000),
  options: z.array(z.string().trim().min(1).max(300)).max(6).default([]),
  answer: z.number().int().min(0).default(0),
  answerText: z.string().trim().max(500).optional(),
  points: z.number().positive().max(1000).default(1)
}).superRefine((question, ctx) => {
  if (question.type === "MULTIPLE_CHOICE" && (question.options.length < 2 ||
      question.answer >= question.options.length || new Set(question.options).size !== question.options.length)) {
    ctx.addIssue({ code: "custom", message: "Multiple choice needs 2–6 distinct options and one correct option." });
  }
  if (question.type === "TRUE_FALSE" &&
      (question.answer > 1 || question.options.length !== 2 ||
        question.options[0] !== "True" || question.options[1] !== "False")) {
    ctx.addIssue({ code: "custom", message: "True/False questions must use the True and False choices." });
  }
  if (question.type === "SHORT_ANSWER" && !question.answerText?.trim()) {
    ctx.addIssue({ code: "custom", message: "Add the expected short answer." });
  }
  if (question.type === "ESSAY" && question.options.length) {
    ctx.addIssue({ code: "custom", message: "Essay questions do not use answer options." });
  }
});

export const quizSnapshotSchema = z.array(z.object({
  id: z.string(), type: z.enum(questionTypes).default("MULTIPLE_CHOICE"),
  prompt: z.string(), options: z.array(z.string()).default([]),
  answer: z.number().int().default(0), answerText: z.string().optional(),
  points: z.number().positive().default(1)
}));
export type QuizQuestion = z.infer<typeof quizSnapshotSchema>[number];
export type QuizAnswer = string | number;

export function gradeQuiz(questions: QuizQuestion[], answers: Record<string, number>) {
  if (Object.keys(answers).length !== questions.length ||
      questions.some(question => !Number.isInteger(answers[question.id]) ||
        answers[question.id] < 0 || answers[question.id] >= question.options.length)) return null;
  return questions.reduce((score, question) => score + Number(answers[question.id] === question.answer), 0);
}

export function gradeQuizAnswers(questions: QuizQuestion[], answers: Record<string, QuizAnswer>) {
  let points = 0;
  let autoGradedPoints = 0;
  let manualGradingRequired = false;
  const questionResults: Record<string, boolean | null> = {};
  for (const question of questions) {
    const answer = answers[question.id];
    let correct: boolean | null = false;
    if (question.type === "ESSAY") {
      correct = null;
      manualGradingRequired = true;
    } else if (question.type === "SHORT_ANSWER") {
      const normalize = (value: string) => value.trim().replace(/\\s+/g, " ").toLocaleLowerCase();
      correct = typeof answer === "string" && !!question.answerText &&
        normalize(answer) === normalize(question.answerText);
    } else {
      correct = typeof answer === "number" && answer === question.answer;
    }
    questionResults[question.id] = correct;
    if (correct === true) {
      points += question.points;
      autoGradedPoints += question.points;
    }
  }
  return { points, autoGradedPoints, manualGradingRequired, questionResults };
}

export function sanitizeLessonHtml(value: string) {
  return sanitizeHtml(value, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "h1", "h2", "u", "s"]),
    allowedAttributes: { a: ["href", "name", "target", "rel"], img: ["src", "alt", "width", "height"], "*": ["class"] },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer", target: "_blank" })
    }
  });
}

export const lessonPagesSchema = z.array(z.object({
  id: z.string().trim().min(1).max(128),
  title: z.string().trim().min(1).max(120),
  content: z.string().max(50000),
  nextPageId: z.string().nullable().optional(),
  branches: z.array(z.object({
    label: z.string().trim().min(1).max(120),
    targetPageId: z.string().trim().min(1).max(128)
  })).max(8).default([])
})).min(1).max(50).superRefine((pages, ctx) => {
  const ids = new Set(pages.map(page => page.id));
  if (ids.size !== pages.length) ctx.addIssue({ code: "custom", message: "Lesson page IDs must be unique." });
  pages.forEach((page, index) => {
    if (page.nextPageId && !ids.has(page.nextPageId)) {
      ctx.addIssue({ code: "custom", path: [index, "nextPageId"], message: "Choose an existing next page." });
    }
    page.branches.forEach((branch, branchIndex) => {
      if (!ids.has(branch.targetPageId)) {
        ctx.addIssue({ code: "custom", path: [index, "branches", branchIndex, "targetPageId"], message: "Choose an existing branch target." });
      }
    });
  });
});

export function validDriveLink(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      ["drive.google.com", "docs.google.com"].includes(url.hostname);
  } catch {
    return false;
  }
}

export const activityHeaders = { "Cache-Control": "private, no-store" };
export const activityTopicSchema = z.string().trim().max(100).transform(value => value.replace(/\\s+/g, " "));

export function activityEnrollmentIdentity(student: { id: string; studentNumber: string | null }) {
  return [{ studentUserId: student.id }, ...(student.studentNumber ? [{
    studentUserId: null, studentNumber: { equals: student.studentNumber.trim(), mode: "insensitive" as const }
  }] : [])];
}
