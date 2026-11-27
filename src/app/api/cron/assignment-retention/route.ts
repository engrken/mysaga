import { timingSafeEqual } from "node:crypto";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendPortalEmail } from "@/lib/mailer";
import { getR2BucketName, getR2Client } from "@/lib/r2";

export const runtime = "nodejs";
const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 100;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  const supplied = request.headers.get("authorization") || "";
  const expected = secret ? `Bearer ${secret}` : "";
  if (!secret || Buffer.byteLength(supplied) !== Buffer.byteLength(expected)) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

function expiryDate(submittedAt: Date) {
  return new Date(submittedAt.getTime() + 365 * DAY_MS);
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const now = new Date();
  let notices30 = 0;
  let notices7 = 0;
  let deletedFiles = 0;
  let skipped = 0;
  let failed = 0;

  const submissions = await prisma.activitySubmission.findMany({
    where: {
      OR: [
        { retentionDeletedAt: null, storageProvider: "CLOUDFLARE_R2", fileKey: { not: null } },
        { retentionDeletedAt: null, attachments: { some: { storageProvider: "CLOUDFLARE_R2", fileKey: { not: null } } } }
      ],
      activity: { subject: { gradeStatus: "VERIFIED" } }¶»§q«^