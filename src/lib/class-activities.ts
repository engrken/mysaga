import { z } from "zod";

export const questionSchema = z.object({
  prompt: z.string().trim().min(1).max(1000),
  options: z.array(z.string().trim().min(1).max(300)).min(2).max(6),
  answer: z.number().int().min(0)
}).refine(q => q.answer < q.options.length && new Set(q.options).size === q.options.length,
  "Choose a correct answer and use distinct options.");

export const quizSnapshotSchema = z.array(z.object({
  id: z.string(), prompt: z.string(), options: z.array(z.string()), answer: z.number().int()
}));
export type QuizQuestion = z.infer<typeof quizSnapshotSchema>[number];

export function gradeQuiz(questions: QuizQuestion[], answers: Record<string, number>) {
  if (Object.keys(answers).length !== questions.length ||
      questions.some(question => !Number.isInteger(answers[question.id]) ||
        answers[question.id] < 0 || answers[question.id] >= question.options.length)) return null;
  return questions.reduce((score, question) => score + Number(answers[question.id] === question.answer), 0);
}

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


export const activityTopicSchema = z.string().trim().max(100).transform(value => value.replace(/\s+/g, " "));

export function activityEnrollmentIdentity(student: { id: string; studentNumber: string | null }) {
  return [{ studentUserId: student.id }, ...(student.studentNumber ? [{
    studentUserId: null, studentNumber: { equals: student.studentNumber.trim(), mode: "insensitive" as const }
  }] : [])];
}
