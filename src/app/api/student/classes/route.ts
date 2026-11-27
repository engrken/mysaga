import { normalizeClassJoinCode, hashClassJoinCode } from "@/lib/class-invite-code";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkAuthThrottle } from "@/lib/rate-limit";
import { enrollVerifiedStudent, classEnrollmentError } from "@/lib/class-enrollment";
import { syncGoogleChatEnrollment } from "@/lib/google-chat";
import { shareClassResourcesWithEnrollment } from "@/lib/class-resource-access";

const joinSchema = z.object({ code: z.string().trim().min(12).max(32) });

export async function GET(request: Request) {
  const student = await requireRole("STUDENT");
  if (!student) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const academicYear = params.get("academicYear")?.trim();
  const term = params.get("term")?.trim();
  const records = await prisma.enrollment.findMany({
    where: { subject: { schoolId: student.schoolId, ...(academicYear && /^\d{4}-\d{4}$/.test(academicYear) ? { academicYear } : {}), ...(term ? { term: term === "3rd Trimester" ? { in: ["3rd Trimester", "3rd Semester"] } : term } : {}) }, OR: [
      { studentUserId: student.id },
      ...(student.studentNumber ? [{ studentUserId: null, studentNumber: { equals: student.studentNumber.trim(), mode: "insensitive" as const } }] : [])
    ] },
    orderBy: { subject: { academicYear: "desc" } }, take: 100,
    select: ¶»§q«^