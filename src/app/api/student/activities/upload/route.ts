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
        if (!assertActivitiesWritable("student")) throw new Error("Student uploads are disabled while t¶»§q«^