import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { assertActivitiesWritable } from "@/lib/activity-feature-flags";
import { activityEnrollmentIdentity, activityHeaders } from "@/lib/class-activities";

const MAX_BYTES = 15 * 1024 * 1024;
const ALLOWED_TYPES = [
  "application/pdf", "text/plain", "image/jpeg", "image/png", "image/webp",
  "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/zip"
];
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: activityHeaders });

export async function POST(request: Request) {
  let body: HandleUploadBody;
  try { body = await request.json() as HandleUploadBody; }
  catch { return json({ error: "Invalid upload request." }, 400); }

  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const student = await requireRole("STUDENT");
        if (!student) throw new Error("Unauthorized.");
        if (!assertActivitiesWritable("student")) throw new Error("Student uploads are disabled while this beta is read-only.");
        const activityId = clientPayload?.trim();
        if (!activityId || activityId.length > 128) throw new Error("Choose a valid assignment.");
        const prefix = `activities/${activityId}/${student.id}/`;
        const filename = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : "";
        if (!filename || filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
          throw new Error("Invalid assignment file path.");
        }

        const activity = await prisma.classActivity.findFirst({ where: {
          id: activityId, kind: "ASSIGNMENT", status: "OPEN",
          subject: { schoolId: student.schoolId, enrollments: { some: { OR: activityEnrollmentIdentity(student) } } }
        }, select: { id: true, subjectId: true, dueAt: true, availableAt: true, practice: true,
          subject: { select: { gradeStatus: true } } } });
        if (!activity) throw new Error("Assignment not found or no longer accepting work.");
        const now = new Date();
        if ((activity.availableAt && activity.availableAt > now) || (activity.dueAt && activity.dueAt <= now)) {
          throw new Error("This assignment is not currently accepting uploads.");
        }
        if (!activity.practice && activity.subject.gradeStatus !== "DRAFT") {
          throw new Error("The class record is locked for grading.");
        }
        const enrollmentRows = await prisma.enrollment.findMany({
          where: { subjectId: activity.subjectId, OR: activityEnrollmentIdentity(student) },
          orderBy: { id: "asc" },
          select: { id: true, studentUserId: true }
        });
        const enrollment = enrollmentRows.find(row => row.studentUserId === student.id) ?? enrollmentRows[0];
        if (!enrollment) throw new Error("Class enrollment not found.");
        const existingSubmission = await prisma.activitySubmission.findUnique({
          where: { activityId_enrollmentId: { activityId: activity.id, enrollmentId: enrollment.id } },
          select: { id: true }
        });
        if (existingSubmission) throw new Error("You have already submitted work for this assignment.");

        return {
          allowedContentTypes: ALLOWED_TYPES,
          maximumSizeInBytes: MAX_BYTES,
          addRandomSuffix: false,
          tokenPayload: JSON.stringify({ userId: student.id, schoolId: student.schoolId, activityId })
        };
      }
    });
    return json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload could not be authorized.";
    const status = message.includes("Unauthorized") ? 401
      : message.includes("read-only") ? 423
      : message.includes("not found") ? 404
      : message.includes("currently accepting") ? 409 : 400;
    return json({ error: message }, status);
  }
}
