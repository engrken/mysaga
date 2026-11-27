import { removeGoogleChatEnrollment, removeGoogleChatSubjectMembers, syncGoogleChatEnrollment } from "@/lib/google-chat";
import { revokeClassResourceAccessForEnrollment, shareClassResourcesWithEnrollment } from "@/lib/class-resource-access";
import { SCHOOL_PLAN_LIMITS } from "@/lib/plans";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { calculateFinal, equivalentFromBands, LECTURE_LAB_GRADING_TEMPLATE, LECTURE_ONLY_GRADING_TEMPLATE, LABORATORY_ONLY_GRADING_TEMPLATE, expectedChildAllocation, remainingChildAllocation, firstOverallocatedCategoryGroup } from "@/lib/grades";
import { scheduleWeekdays, weekdayFromDate } from "@/lib/schedule-days";

type Context = { params: Promise<{ subjectId: string }> };
async function ownedSubject(subjectId: string, teacherId: string, schoolId: string) {
  return prisma.subject.findFirst({ where: { id: subjectId, teacherId, schoolId }, include: { categories: { orderBy: { sortOrder: "asc" } }, gradeBands: { orderBy: { sortOrder: "asc" } }, assessments: { orderBy: [{ categoryId: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }] }, enrollments: { orderBy: { studentName: "asc" }, include: { scores: { select: { assessmentId: true, points: true, remark: true } }, _count: { select: { gradeChangeHistory: true } } } } } });
}
async function ownedSubjectForMutation(subjectId: string, teacherId: string, schoolId: string) {
  return prisma.sub¶»§q«^