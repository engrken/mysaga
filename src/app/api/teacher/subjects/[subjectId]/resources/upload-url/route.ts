import { randomUUID } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { assertActivitiesWritable } from "@/lib/activity-feature-flags";
import { activityHeaders } from "@/lib/class-activities";
import { getR2BucketName, getR2Client, getR2PrivateDownloadPath, sanitizeR2FileName } from "@/lib/r2";
import { schoolStorageUsage } from "@/lib/storage-quota";

export const runtime = "nodejs";
type Context = { params: Promise<{ subjectId: string }> };
const schema = z.object({
  fileName: z.string().trim().min(1).max(180),
  fileType: z.string().trim().max(255).optional().default("application/octet-stream"),
  fileSize: z.number().int().positive().max(100 * 1024 * 1024)
});

export async function POST(request: Request, context: Context) {
  const teacher = await requireRole("TEACHER");
  if (!teacher) return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers: activityHeaders });
  if (!assertActivitiesWritable("teacher")) return NextResponse.json({ error: "Class resources are read-only while this beta is in exploration mode." }, { status: 423, headers: activityHeaders });
  const { subjectId } = await context.params;
  const subject = await prisma.subject.findFirst({
    where: { id: subjectId, schoolId: teacher.schoolId, te¶»§q«^