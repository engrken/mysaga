import { DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { assertActivitiesWritable } from "@/lib/activity-feature-flags";
import { activityHeaders } from "@/lib/class-activities";
import { getR2BucketName, getR2Client, getR2PrivateDownloadPath } from "@/lib/r2";
import { revokeClassResourcePermissions } from "@/lib/class-resource-access";
import { googleChatAccessToken } from "@/lib/google-chat";
import { DriveFileMetadata, DrivePermission, googleDriveRequest } from "@/lib/google-drive";

export const runtime = "nodejs";
type Context = { params: Promise<{ subjectId: string }> };
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: activityHeaders });
const schema = z.discriminatedUnion("storageProvider", [
  z.object({
    storageProvider: z.literal("GOOGLE_DRIVE"),
    googleDriveFileId: z.string().trim().min(1).max(256)
  }),
  z.object({
    storageProvider: z.literal("CLOUDFLARE_R2"),
    fileKey: z.string().trim().min(1).max(1024),
    fileUrl: z.string().trim().min(1).max(2048),
    fileName: z.string().trim().min(1).max(180),
    fileSize: z.number().int().positive().max(100 * 1024 * 1024),
    mimeType: z.string().trim().min(1).max(255)
  })
]);

async function ownedSubject(subjectId: string, teacher: { id: string; schoolId: string }) {
  return prisma.subj¶»§q«^