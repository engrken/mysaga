import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { activityHeaders } from "@/lib/class-activities";
import { getR2BucketName, getR2Client, sanitizeR2FileName } from "@/lib/r2";
import { canDownloadSubmissionFile } from "@/lib/submission-download-access";

export const runtime = "nodejs";

const json = (message: string, status: number) =>
  NextResponse.json({ error: message }, { status, headers: activityHeaders });

function safeDisposition(fileName: string) {
  const safeName = sanitizeR2FileName(fileName);
  return 'attachment; filename="' + safeName + '"';
}

export async function GET(request: Request) {
  const user = await getSession();
  if (!user || (user.role !== "TEACHER" && user.role !== "STUDENT")) {
    return json("Sign in to access this file.", 401);
  }

  const params = new URL(request.url).searchParams;
  const attachmentId = params.get("attachmentId")?.trim();
  const submissionId = params.get("submissionId")?.trim();
  if (!!attachmentId === !!submissionId ||
      (attachmentId && attachmentId.length > 128) ||
      (submissionId && submissionId.length > 128)) {
    return json("File not found.", 404);
  }

  const whereActivity = {
    subject: {
      schoolId: user.schoolId,
      ...(user.role === "TEACHER" ? { teacherId: user.id } : {})
    }
  };
  const whereEnrollment = user.role === "STUDENT"
    ? { enrollment: { OR: [
        { studentUserId: user.id },
        ...(user.studentNumber ? [{
          studentUserId: null,
          studentNumber: { equals: user.studentNumber.trim(), mode: "insensitive" as const }
        }] : [])
      ] } }
    : {};

  let fileKey: string | null | undefined;
  let fileName: string | null | undefined;

  if (attachmentId) {
    const attachment = await prisma.activitySubmissionFile.findFirst({
      where: {
        id: attachmentId,
        storageProvider: "CLOUDFLARE_R2",
        fileKey: { not: null },
        submission: {
          activity: whereActivity,
          ...whereEnrollment
        }
      },
      select: {
        fileKey: true,
        fileName: true,
        submission: {
          select: {
            enrollment: { select: { studentUserId: true, studentNumber: true } },
            activity: { select: { subject: { select: { schoolId: true, teacherId: true } } } }
          }
        }
      }
    });
    if (!attachment?.fileKey || !canDownloadSubmissionFile({
      id: user.id, role: user.role, schoolId: user.schoolId, studentNumber: user.studentNumber
    }, {
      schoolId: attachment.submission.activity.subject.schoolId,
      teacherId: attachment.submission.activity.subject.teacherId,
      enrollment: attachment.submission.enrollment
    })) {
      return json("File not found.", 404);
    }
    fileKey = attachment.fileKey;
    fileName = attachment.fileName;
  } else if (submissionId) {
    const submission = await prisma.activitySubmission.findFirst({
      where: {
        id: submissionId,
        storageProvider: "CLOUDFLARE_R2",
        fileKey: { not: null },
        activity: whereActivity,
        ...whereEnrollment
      },
      select: {
        fileKey: true,
        fileName: true,
        enrollment: { select: { studentUserId: true, studentNumber: true } },
        activity: { select: { subject: { select: { schoolId: true, teacherId: true } } } }
      }
    });
    if (!submission?.fileKey || !canDownloadSubmissionFile({
      id: user.id, role: user.role, schoolId: user.schoolId, studentNumber: user.studentNumber
    }, {
      schoolId: submission.activity.subject.schoolId,
      teacherId: submission.activity.subject.teacherId,
      enrollment: submission.enrollment
    })) {
      return json("File not found.", 404);
    }
    fileKey = submission.fileKey;
    fileName = submission.fileName;
  }

  if (!fileKey || !fileName || fileKey.includes("..") || fileKey.includes("\\")) {
    return json("File not found.", 404);
  }

  try {
    const command = new GetObjectCommand({
      Bucket: getR2BucketName(),
      Key: fileKey,
      ResponseContentType: "application/octet-stream",
      ResponseContentDisposition: safeDisposition(fileName),
      ResponseCacheControl: "private, no-store"
    });
    const signedUrl = await getSignedUrl(getR2Client(), command, { expiresIn: 180 });
    return NextResponse.redirect(signedUrl, {
      status: 302,
      headers: {
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer"
      }
    });
  } catch (cause) {
    console.error("Authorized private R2 download could not be signed:", cause);
    return json("The file is temporarily unavailable. Please try again.", 503);
  }
}
