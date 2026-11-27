import { DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { assertActivitiesWritable } from "@/lib/activity-feature-flags";
import { activityEnrollmentIdentity, activityHeaders, validDriveLink } from "@/lib/class-activities";
import { getR2BucketName, getR2Client, getR2PrivateDownloadPath } from "@/lib/r2";

export const runtime = "nodejs";

const MAX_R2_FILE_SIZE = 5 * 1024 * 1024;
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
    fileUrl: z.string().trim().min(1).max(2048),
    ...fileBaseSchema,
    fileSize: z.number().int().positive().max(MAX_R2_FILE_SIZE)
  }),
  z.object({
    storageProvider: z.literal("GOOGLE_DRIVE"),
    fileUrl: z.string().trim().url().max(2048),
    ...fileBaseSchema,
    fileSize: z.number().int().positive()
  })
]);
const inputSchema = z.object({
  assignmentId: z.string().trim().min(1).max(128),
  text: z.string().trim().max(12000).optional(),
  att¶»§q«^