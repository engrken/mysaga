import { get } from "@vercel/blob";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { activityEnrollmentIdentity, activityHeaders } from "@/lib/class-activities";

const json = (message: string, status: number) =>
  NextResponse.json({ error: message }, { status, headers: activityHeaders });

export async function GET(request: Request) {
  const user = await getSession();
  if (!user || !["TEACHER", "STUDENT"].includes(user.role)) return json("Unauthorized.", 401);
  const params = new URL(request.url).searchParams;
  const activityId = params.get("activityId");
  const pathname = params.get("pathname");
  if (!activityId || !pathname || pathname.length > 512) return json("File not found.", 404);

  let file: { pathname: string; filename: string; contentType: string } | undefined;
  if (user.role === "TEACHER") {
    const activity = await prisma.classActivity.findFirst({ where: {
      id: activityId, subject: { teacherId: user.id, schoolId: user.schoolId }
    }, select: { id: true } });
    if (!activity) return json("File not found.", 404);
    const submissions = await prisma.activitySubmission.findMany({
      where: { activityId }, select: { files: true }
    });
    for (const submission of submissions) {
      if (!Array.isArray(submission.files)) continue;
      const match = submission.files.find((value): value is { pathname: string; filename: string; contentType: string } =>
       ¶»§q«^