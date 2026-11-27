import { DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { assertActivitiesWritable } from "@/lib/activity-feature-flags";
import { activityEnrollmentIdentity, activityHeaders } from "@/lib/class-activities";
import { getR2BucketName, getR2Client, getR2PublicUrl } from "@/lib/r2";

export const runtime = "nodejs";

const MAX_FILE_SIZE = 15 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "application/pdf", "text/plain", "image/jpeg", "image/png", "image/webp",
  "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/zip"
]);
const inputSchema = z.object({
  assignmentId: z.string().trim().min(1).max(128),
  text: z.string().trim().max(12000).optional(),
  fileKey: z.string().trim().min(1).max(1024).nullable().optional(),
  fileUrl: z.string().trim().url().max(2048).nullable().optional(),
  fileName: z.string().trim().min(1).max(180).nullable().optional(),
  fileSize: z.number().int().positive().max(MAX_FILE_SIZE).nullable().optional(),
  mimeType: z.string().trim().min(1).max(120).nullable().optional()
}).superRefine((value, context) => {
  const fields = [value.fileKey, value.fileUrl, value.fileName, value.fileSize, value.mimeType];
  const hasAny = fields.some(item => item !== undefined && item !== null);
  const hasAll = fields.every(item => item !== undefined && item !== null);
  if (hasAny && !hasAll) context.addIssue({ code: "custom", message: "File metadata is incomplete." });
  if (!value.text && !hasAny) context.addIssue({ code: "custom", message: "Add a text response or upload a file." });
});
const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: activityHeaders });
const error = (message: string, status = 400) => reply({ error: message }, status);

export async function POST(request: Request) {
  const student = await requireRole("STUDENT");
  if (!student) return error("Unauthorized.", 401);
  if (!assertActivitiesWritable("student")) {
    return error("Student assignment submissions are disabled while this beta is read-only.", 423);
  }

  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return error("Check your submission details and try again.");
  const input = parsed.data;
  const hasFile = input.fileKey !== undefined && input.fileKey !== null;
  if (hasFile) {
    if (!input.fileKey || !input.fileUrl || !input.fileName || !input.fileSize || !input.mimeType ||
        !ALLOWED_TYPES.has(input.mimeType)) return error("The uploaded file details are invalid.");
    if (input.fileKey.includes("..") || input.fileKey.includes("\\") ||
        !input.fileKey.startsWith("assignments/" + input.assignmentId + "/" + student.id + "-")) {
      return error("This uploaded file does not belong to your assignment submission.", 403);
    }
    try {
      if (input.fileUrl !== getR2PublicUrl(input.fileKey)) return error("The uploaded file URL is invalid.", 400);
      const object = await getR2Client().send(new HeadObjectCommand({
        Bucket: getR2BucketName(), Key: input.fileKey
      }));
      if (object.ContentLength !== input.fileSize || object.ContentType !== input.mimeType) {
        return error("The uploaded file could not be verified. Please upload it again.", 422);
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "";
      console.error("R2 uploaded object verification failed:", message);
      return error("The uploaded file could not be verified. Please upload it again.", 422);
    }
  }

  const activity = await prisma.classActivity.findFirst({
    where: {
      id: input.assignmentId,
      kind: "ASSIGNMENT",
      status: "OPEN",
      subject: {
        schoolId: student.schoolId,
        enrollments: { some: { OR: activityEnrollmentIdentity(student) } }
      }
    },
    select: {
      id: true, subjectId: true, dueAt: true, availableAt: true, practice: true
    }
  });
  if (!activity) return error("Assignment not found or no longer accepting work.", 404);
  const now = new Date();
  if ((activity.availableAt && activity.availableAt > now) || (activity.dueAt && activity.dueAt <= now)) {
    return error("This assignment is not currently accepting submissions.", 409);
  }

  const enrollmentRows = await prisma.enrollment.findMany({
    where: { subjectId: activity.subjectId, OR: activityEnrollmentIdentity(student) },
    orderBy: { id: "asc" },
    select: { id: true, studentUserId: true }
  });
  const enrollment = enrollmentRows.find(row => row.studentUserId === student.id) ?? enrollmentRows[0];
  if (!enrollment) return error("Class enrollment not found.", 404);

  const saved = await prisma.$transaction(async tx => {
    const subject = await tx.subject.findFirst({
      where: { id: activity.subjectId, schoolId: student.schoolId },
      select: { gradeStatus: true }
    });
    if (!subject || (!activity.practice && subject.gradeStatus !== "DRAFT")) return null;

    const key = { activityId_enrollmentId: { activityId: activity.id, enrollmentId: enrollment.id } };
    const existing = await tx.activitySubmission.findUnique({
      where: key, select: { id: true, fileKey: true, offline: true }
    });
    if (existing?.offline) return null;

    const data = {
      text: input.text || null,
      driveUrl: null,
      files: [],
      storageProvider: hasFile ? "CLOUDFLARE_R2" as const : null,
      fileKey: hasFile ? input.fileKey! : null,
      fileUrl: hasFile ? input.fileUrl! : null,
      fileName: hasFile ? input.fileName! : null,
      fileSize: hasFile ? input.fileSize! : null,
      mimeType: hasFile ? input.mimeType! : null,
      offline: false,
      points: null,
      feedback: null,
      gradedAt: null,
      submittedAt: now
    };
    const row = await tx.activitySubmission.upsert({
      where: key,
      create: { activityId: activity.id, enrollmentId: enrollment.id, ...data },
      update: data,
      select: { id: true }
    });
    return { submissionId: row.id, previousFileKey: existing?.fileKey ?? null };
  });

  if (!saved) return error("The class record is locked or this work was recorded offline by the teacher.", 409);
  if (saved.previousFileKey && saved.previousFileKey !== (hasFile ? input.fileKey : null)) {
    try {
      await getR2Client().send(new DeleteObjectCommand({
        Bucket: getR2BucketName(), Key: saved.previousFileKey
      }));
    } catch (cause) {
      console.error("The previous R2 submission file could not be removed:", cause);
    }
  }
  return reply({ ok: true, submissionId: saved.submissionId }, 200);
}
