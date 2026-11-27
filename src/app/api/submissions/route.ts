import { DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { assertActivitiesWritable } from "@/lib/activity-feature-flags";
import { activityEnrollmentIdentity, activityHeaders, validDriveLink } from "@/lib/class-activities";
import { getR2BucketName, getR2Client, getR2PublicUrl } from "@/lib/r2";

export const runtime = "nodejs";

const MAX_R2_FILE_SIZE = 5 * 1024 * 1024;
const DRIVE_FILE_SIZE_MIN = MAX_R2_FILE_SIZE + 1;
const mimeTypePattern = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i;
const fileBaseSchema = {
  fileName: z.string().trim().min(1).max(180),
  fileSize: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  mimeType: z.string().trim().min(1).max(255).regex(mimeTypePattern)
};
const attachmentSchema = z.discriminatedUnion("storageProvider", [
  z.object({
    storageProvider: z.literal("CLOUDFLARE_R2"),
    fileKey: z.string().trim().min(1).max(1024),
    fileUrl: z.string().trim().url().max(2048),
    ...fileBaseSchema,
    fileSize: z.number().int().positive().max(MAX_R2_FILE_SIZE)
  }),
  z.object({
    storageProvider: z.literal("GOOGLE_DRIVE"),
    fileUrl: z.string().trim().url().max(2048),
    ...fileBaseSchema,
    fileSize: z.number().int().min(DRIVE_FILE_SIZE_MIN)
  })
]);
const inputSchema = z.object({
  assignmentId: z.string().trim().min(1).max(128),
  text: z.string().trim().max(12000).optional(),
  attachments: z.array(attachmentSchema).optional()
}).superRefine((value, context) => {
  if (!value.text && !value.attachments?.length) {
    context.addIssue({ code: "custom", message: "Add a text response or at least one attachment." });
  }
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
  if (!parsed.success) return error("Check your submission details. R2 files must be 5 MB or smaller; larger files need a Google Drive link.");
  const input = parsed.data;
  const attachments = input.attachments ?? [];

  // Validate every Drive link and verify each R2 object from storage metadata only.
  const verifiedAttachments: Array<{
    storageProvider: "CLOUDFLARE_R2" | "GOOGLE_DRIVE";
    fileKey: string | null;
    fileUrl: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
  }> = [];

  for (const attachment of attachments) {
    if (attachment.storageProvider === "GOOGLE_DRIVE") {
      if (!validDriveLink(attachment.fileUrl)) return error("Use a valid HTTPS Google Drive or Google Docs share link.");
      verifiedAttachments.push({
        storageProvider: "GOOGLE_DRIVE",
        fileKey: null,
        fileUrl: attachment.fileUrl,
        fileName: attachment.fileName,
        fileSize: attachment.fileSize,
        mimeType: attachment.mimeType
      });
      continue;
    }

    if (attachment.fileKey.includes("..") || attachment.fileKey.includes("\\") ||
        !attachment.fileKey.startsWith("assignments/" + input.assignmentId + "/" + student.id + "-")) {
      return error("One of the uploaded files does not belong to your assignment submission.", 403);
    }
    try {
      if (attachment.fileUrl !== getR2PublicUrl(attachment.fileKey)) {
        return error("One of the uploaded file URLs is invalid.", 400);
      }
      const object = await getR2Client().send(new HeadObjectCommand({
        Bucket: getR2BucketName(), Key: attachment.fileKey
      }));
      if (object.ContentLength !== attachment.fileSize || object.ContentType !== attachment.mimeType) {
        return error("One of the uploaded files could not be verified. Please upload it again.", 422);
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "";
      console.error("R2 uploaded object verification failed:", message);
      return error("One of the uploaded files could not be verified. Please upload it again.", 422);
    }
    verifiedAttachments.push({
      storageProvider: "CLOUDFLARE_R2",
      fileKey: attachment.fileKey,
      fileUrl: attachment.fileUrl,
      fileName: attachment.fileName,
      fileSize: attachment.fileSize,
      mimeType: attachment.mimeType
    });
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
      where: key,
      select: {
        id: true, fileKey: true, offline: true,
        attachments: { select: { id: true, storageProvider: true, fileKey: true } }
      }
    });
    if (existing?.offline) return null;

    const row = await tx.activitySubmission.upsert({
      where: key,
      create: {
        activityId: activity.id,
        enrollmentId: enrollment.id,
        text: input.text || null,
        driveUrl: null,
        files: [],
        storageProvider: null,
        fileKey: null,
        fileUrl: null,
        fileName: null,
        fileSize: null,
        mimeType: null,
        offline: false,
        points: null,
        feedback: null,
        gradedAt: null,
        submittedAt: now
      },
      update: {
        text: input.text || null,
        driveUrl: null,
        files: [],
        storageProvider: null,
        fileKey: null,
        fileUrl: null,
        fileName: null,
        fileSize: null,
        mimeType: null,
        offline: false,
        points: null,
        feedback: null,
        gradedAt: null,
        submittedAt: now
      },
      select: { id: true }
    });

    const previousFileKeys = [
      existing?.fileKey ?? null,
      ...(existing?.attachments ?? [])
        .filter(file => file.storageProvider === "CLOUDFLARE_R2" && file.fileKey)
        .map(file => file.fileKey)
    ].filter((value): value is string => !!value);

    await tx.activitySubmissionFile.deleteMany({ where: { submissionId: row.id } });
    if (verifiedAttachments.length) {
      await tx.activitySubmissionFile.createMany({
        data: verifiedAttachments.map(file => ({ submissionId: row.id, ...file, fileSize: BigInt(file.fileSize) }))
      });
    }
    return { submissionId: row.id, previousFileKeys };
  });

  if (!saved) return error("The class record is locked or this work was recorded offline by the teacher.", 409);
  const retainedKeys = new Set(verifiedAttachments
    .filter(file => file.storageProvider === "CLOUDFLARE_R2" && file.fileKey)
    .map(file => file.fileKey as string));
  for (const previousFileKey of new Set(saved.previousFileKeys)) {
    if (retainedKeys.has(previousFileKey)) continue;
    try {
      await getR2Client().send(new DeleteObjectCommand({
        Bucket: getR2BucketName(), Key: previousFileKey
      }));
    } catch (cause) {
      console.error("A previous R2 submission file could not be removed:", cause);
    }
  }
  return reply({ ok: true, submissionId: saved.submissionId }, 200);
}
