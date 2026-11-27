import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getR2BucketName, getR2Client, sanitizeR2FileName } from "@/lib/r2";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Sign in to access this file." }, { status: 401 });

  const key = new URL(request.url).searchParams.get("key")?.trim() || "";
  if (!key || key.length > 1024 || key.includes("..") || key.includes("\\") ||
      (!key.startsWith("assignments/") && !key.startsWith("resources/"))) {
    return NextResponse.json({ error: "Invalid file reference." }, { status: 400 });
  }

  if (key.startsWith("resources/")) {
    const resource = await prisma.classResource.findFirst({
      where: {
        fileKey: key,
        storageProvider: "CLOUDFLARE_R2",
        archivedAt: null,
        retentionDeletedAt: null
      },
      select: {
        fileName: true, mimeType: true,
        subject: {
          select: {
            schoolId: true, teacherId: true,
            enrollments: { where: { studentUserId: user.id }, select: { id: true }, take: 1 }
          }
        }
      }
    });
    if (!resource) return NextResponse.json({ error: "File not found." }, { status: 404 });
    const canAccess = resource.subject¶»§q«^