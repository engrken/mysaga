import { randomUUID } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { assertActivitiesWritable } from "@/lib/activity-feature-flags";
import { activityEnrollmentIdentity, activityHeaders } from "@/lib/class-activities";
import { getR2BucketName, getR2Client, sanitizeR2FileName } from "@/lib/r2";

export const runtime = "nodejs";

export const MAX_R2_FILE_SIZE = 5 * 1024 * 1024;
const mimeTypePattern = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i;
const inputSchema = z.object({
  assignmentId: z.string().trim().min(1).max(128),
  fileName: z.string().trim().min(1).max(180),
  fileType: z.string().trim().max(255).regex(mimeTypePattern).optional(),
  fileSize: z.number().int().positive().max(MAX_R2_FILE_SIZE)
});
const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: activityHeaders });
const error = (message: string, status = 400) => reply({ error: message }, status);

export async function POST(request: Request) {
  const student = await requireRole("STUDENT");
  if (!student) return error("Unauthorized.", 401);
  if (!assertActivitiesWritable("student")) {
    return error("Student assignment uploads are disabled while this beta is read-only.", 423);
  }

  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return error("Files uploaded to SAGA must be 5 MB or smaller. Use Google Drive for larger files.");
  const input = parsed.data;
  const mimeType = input.fileType || "application/octet-stream";
  const safeName = sanitizeR2FileName(input.fileName);

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
      id: true, subjectId: true, dueAt: true, availableAt: true, practice: true,
      subject: { select: { gradeStatus: true } }
    }
  });
  if (!activity) return error("Assignment not found or no longer accepting work.", 404);
  const now = new Date();
  if ((activity.availableAt && activity.availableAt > now) || (activity.dueAt && activity.dueAt <= now)) {
    return error("This assignment is not currently accepting uploads.", 409);
  }
  if (!activity.practice && activity.subject.gradeStatus !== "DRAFT") {
    return error("The class record is locked for grading.", 409);
  }

  const enrollment = await prisma.enrollment.findFirst({
    where: { subjectId: activity.subjectId, OR: activityEnrollmentIdentity(student) },
    select: { id: true }
  });
  if (!enrollment) return error("Class enrollment not found.", 404);
  const existingSubmission = await prisma.activitySubmission.findUnique({
    where: { activityId_enrollmentId: { activityId: activity.id, enrollmentId: enrollment.id } },
    select: { offline: true }
  });
  if (existingSubmission?.offline) return error("This assignment is recorded as offline work by the teacher.", 409);

  try {
    const fileKey = "assignments/" + activity.id + "/" + student.id + "-" +
      Date.now() + "-" + randomUUID() + "-" + safeName;
    const uploadHeaders = {
      "Content-Type": mimeType,
      "Content-Disposition": 'attachment; filename="' + safeName + '"'
    };
    const command = new PutObjectCommand({
      Bucket: getR2BucketName(),
      Key: fileKey,
      ContentType: mimeType,
      ContentDisposition: uploadHeaders["Content-Disposition"]
    });
    const uploadUrl = await getSignedUrl(getR2Client(), command, {
      expiresIn: 15 * 60,
      signableHeaders: new Set(["content-type", "content-disposition"])
    });
    return reply({
      uploadUrl,
      uploadHeaders,
      fileKey,
      fileName: safeName,
      fileSize: input.fileSize,
      mimeType
    }, 201);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "R2 is not configured.";
    console.error("R2 presigned upload URL could not be generated:", message);
    return error("File storage is not configured. Contact the portal administrator.", 503);
  }
}
