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
    ctx.addIssue({ code: "custom", message: "Multiple choice needs 2â€“6 distinct options and one correct option." });
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
}¶»§q«^