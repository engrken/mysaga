import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { assertActivitiesWritable } from "@/lib/activity-feature-flags";
import {
  activityEnrollmentIdentity, activityHeaders, gradeQuizAnswers, QuizAnswer,
  quizSnapshotSchema, validDriveLink, sanitizeLessonHtml
} from "@/lib/class-activities";

const fileSchema = z.object({
  pathname: z.string().min(1).max(512),
  filename: z.string().min(1).max(180),
  contentType: z.string().min(1).max(120),
  size: z.number().int().positive().max(15 * 1024 * 1024)
});
const submissionSchema = z.object({
  action: z.enum(["start-quiz", "submit-quiz"]).optional(),
  activityId: z.string().min(1).max(128),
  attemptId: z.string().min(1).max(128).optional(),
  answers: z.record(z.string().max(128), z.union([z.number().int(), z.string().max(12000)])).optional(),
  text: z.string().trim().max(12000).optional(),
  driveUrl: z.string().trim().max(2048).optional(),
  files: z.array(fileSchema).max(10).optional()
});
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: activityHeaders });
const error = (message: string, status = 400) => reply({ error: message }, status);

function aggregateQuizScore(scores: number[], method: string) {
  if (!scores.length) return 0;
  if (method === "FIRST") return scores[0];
  if (method === "LAST") return scores[scores.length - 1];
  if (method === "AVERAGE") return scores.r¶»§q«^