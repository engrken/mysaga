import { randomUUID } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { schoolStorageUsage } from "@/lib/storage-quota";
import { assertActivitiesWritable } from "@/lib/activity-feature-flags";
import { activityEnrollmentIdentity, activityHeaders } from "@/lib/class-activities";
import { getR2BucketName, getR2Client, getR2PrivateDownloadPath, sanitizeR2FileName } from "@/lib/r2";

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
    return error("Student assignment upload¶»§q«^