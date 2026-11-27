import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getR2PrivateDownloadPath } from "@/lib/r2";
import { assertActivitiesWritable } from "@/lib/activity-feature-flags";
import {
  activityEnrollmentIdentity, activityHeaders, gradeQuizAnswers, QuizAnswer,
  quizSnapshotSchema, sanitizeLessonHtml
} from "@/lib/class-activities";


const submissionSchema = z.object({
  action: z.enum(["start-quiz", "submit-quiz"]).optional(),
  activityId: z.string().min(1).max(128),
  attemptId: z.string().min(1).max(128).optional(),
  answers: z.record(z.string().max(128), z.union([z.number().int(), z.string().max(12000)])).optional(),
  text: z.string().trim().max(12000).optional(),
});
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: activityHeaders });
const error = (message: string, status = 400) => reply({ error: message }, status);

function aggregateQuizScore(scores: number[], method: string) {
  if (!scores.length) return 0;
  if (method === "FIRST") return scores[0];
  if (method === "LAST") return scores[scores.length - 1];
  if (method === "AVERAGE") return scores.reduce((sum, score) => sum + score, 0) / scores.length;
  return Math.max(...scores);
}

export async function GET(request: Request) {
  const student = await requireRole("STUDENT");
  if (!student) return error("Unauthorized.", 401);
  const { searchParams } = new URL(request.¶»§q«^