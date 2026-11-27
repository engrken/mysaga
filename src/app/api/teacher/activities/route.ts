import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { activityTopicSchema, activityHeaders, questionSchema, quizSnapshotSchema, lessonPagesSchema, sanitizeLessonHtml, gradeQuizAnswers, QuizAnswer, validDriveLink } from "@/lib/class-activities";
import { assertActivitiesWritable } from "@/lib/activity-feature-flags";
import { buildQuizStatistics } from "@/lib/activity-statistics";

const id = z.string().trim().min(1).max(128);
const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("bank"), question: questionSchema, topic: activityTopicSchema.optional() }),
  z.object({ action: z.literal("tag-question"), questionId: id, topic: activityTopicSchema }),
  z.object({
    action: z.literal("draft"), subjectId: id, activityId: id.optional(),
    kind: z.enum(["QUIZ", "ASSIGNMENT", "RESOURCE", "LESSON"]), title: z.string().trim().min(1).max(120)
      .refine(title => !title.toLowerCase().startsWith("attendance Â·")),
    instructions: z.string().trim().max(8000),
    practice: z.boolean(), categoryId: id.nullable(), dueAt: z.iso.datetime({ offset: true }).nullable(),
    maxScore: z.number().positive().max(100000),
    itemWeight: z.number().positive().max(100).nullable(),
    questionIds: z.array(id).max(50),
    inlineQuestions: z.array(questionSchema).max(50).default([]),
    topic: activityTopicSchema.optio¶»§q«^