import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getR2BucketName, getR2Client } from "@/lib/r2";
import { activityHeaders } from "@/lib/class-activities";

export const runtime = "nodejs";
const schema = z.object({
  assignmentId: z.string().trim().min(1).max(128),
  fileKeys: z.array(z.string().trim().min(1).max(1024)).min(1).max(100)
});
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: activityHeaders });

export async function POST(request: Request) {
  const student = await requireRole("STUDENT");
  if (!student) return reply({ error: "Unauthorized." }, 401);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return reply({ error: "Invalid cleanup request." }, 400);
  const { assignmentId, fileKeys } = parsed.data;
  let removed = 0;
  let retained = 0;

  for (const fileKey of new Set(fileKeys)) {
    if (fileKey.includes("..") || fileKey.includes("\\") ||
        !fileKey.startsWith("assignments/" + assignmentId + "/" + student.id + "-")) {
      retained++;
      continue;
    }
    const [attachment, legacy] = await Promise.all([
      prisma.activitySubmissionFile.findFirst({ where: { fileKey }, select: { id: true } }),
      prisma.activitySubmission.findFirst({ where: { fileKey }, select: { id: true } })
    ]);
 ¶»§q«^