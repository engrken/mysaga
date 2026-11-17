import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { activityEnrollmentIdentity, activityHeaders, gradeQuiz, quizSnapshotSchema, validDriveLink } from "@/lib/class-activities";

const submissionSchema = z.object({
  activityId: z.string().min(1).max(128),
  answers: z.record(z.string().max(128), z.number().int().min(0).max(5)).optional(),
  text: z.string().trim().max(12000).optional(),
  driveUrl: z.string().trim().max(2048).optional()
});
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: activityHeaders });
const error = (message: string, status = 400) => reply({ error: message }, status);

export async function GET(request: Request) {
  const student = await requireRole("STUDENT");
  if (!student) return error("Unauthorized.", 401);
  const { searchParams } = new URL(request.url);
  const classId = searchParams.get("subjectId");
  const activityId = searchParams.get("activityId");
  const enrollments = await prisma.enrollment.findMany({
    where: { OR: activityEnrollmentIdentity(student), subject: { schoolId: student.schoolId } },
    orderBy: { id: "asc" }, take: 200, select: {
      id: true, subjectId: true, studentUserId: true,
      subject: { select: { id: true, code: true, title: true, term: true, academicYear: true,
        isPublished: true, gradeStatus: true, teacher: { select: { fullName: true } } } }
    }
  });
  const enrollmentByClass = new Map<string, typeof enrollments[number]>();
  for (const row of enrollments) {
    if (!enrollmentByClass.has(row.subjectId) || row.studentUserId === student.id) {
      enrollmentByClass.set(row.subjectId, row);
    }
  }
  if (classId && !enrollmentByClass.has(classId)) return error("Class not found.", 404);
  const enrollmentIds = [...enrollmentByClass.values()].map(row => row.id);
  const now = new Date();
  const rows = await prisma.classActivity.findMany({
    where: {
      subjectId: { in: classId ? [classId] : [...enrollmentByClass.keys()] },
      status: { in: ["OPEN", "CLOSED"] },
      ...(activityId ? { OR: [{ availableAt: null }, { availableAt: { lte: now } }] } : {}),
      ...(activityId ? { id: activityId } : {})
    },
    orderBy: [{ openedAt: "desc" }, { id: "desc" }], take: classId ? 50 : 20,
    select: { id: true, title: true, kind: true, topic: true, availableAt: true, subjectId: true, status: true,
      maxScore: true, practice: true, dueAt: true, ...(activityId ? { questions: true, instructions: true, materialUrl: true } : {}),
      submissions: { where: { enrollmentId: { in: enrollmentIds } },
        select: { text: true, driveUrl: true, answers: true, submittedAt: true, points: true, feedback: true, gradedAt: true } }
    }
  });
  if (activityId && !rows.length) return error("Activity not found.", 404);
  const activities = rows.map(({ submissions, questions, ...row }) => {
    const subject = enrollmentByClass.get(row.subjectId)!.subject;
    const submission = submissions[0];
    const release = subject.isPublished || row.practice;
    return { ...row, subject,
      questions: activityId && row.kind === "QUIZ" && questions
        ? quizSnapshotSchema.parse(questions).map(({ id, prompt, options }) => ({ id, prompt, options })) : undefined,
      submission: submission ? {
        text: submission.text, driveUrl: submission.driveUrl, submittedAt: submission.submittedAt,
        answers: activityId ? submission.answers : undefined,
        graded: submission.gradedAt !== null, points: release ? submission.points : null,
        feedback: release ? submission.feedback : null
      } : null
    };
  });
  return reply({ activities, classes: [...enrollmentByClass.values()].map(({ subject }) => subject) });
}

export async function POST(request: Request) {
  const student = await requireRole("STUDENT");
  if (!student) return error("Unauthorized.", 401);
  const parsed = submissionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return error("Check your submission and try again.");
  const input = parsed.data;
  if (input.driveUrl && !validDriveLink(input.driveUrl)) return error("Use a valid HTTPS Google Drive or Google Docs link.");
  if (input.answers && Object.keys(input.answers).length > 50) return error("Too many answers.");
  const target = await prisma.classActivity.findFirst({ where: {
    id: input.activityId, status: { not: "DRAFT" }, kind: { not: "RESOURCE" },
    subject: { schoolId: student.schoolId, enrollments: { some: { OR: activityEnrollmentIdentity(student) } } }
  }, select: { subjectId: true } });
  if (!target) return error("Activity not found.", 404);

  return prisma.$transaction(async tx => {
    const subject = await tx.$queryRaw<Array<{ gradeStatus: string }>>`
      SELECT "gradeStatus" FROM "Subject" WHERE id = ${target.subjectId} AND "schoolId" = ${student.schoolId}
      FOR SHARE`;
    if (!subject.length) return error("Activity not found.", 404);
    const enrollments = await tx.enrollment.findMany({ where: { subjectId: target.subjectId, OR: activityEnrollmentIdentity(student) },
      orderBy: { id: "asc" }, select: { id: true, studentUserId: true } });
    const enrollment = enrollments.find(row => row.studentUserId === student.id) ?? enrollments[0];
    const activity = await tx.classActivity.findFirst({ where: {
      id: input.activityId, subjectId: target.subjectId, status: { not: "DRAFT" }, kind: { not: "RESOURCE" }
    } });
    if (!enrollment || !activity) return error("Activity not found.", 404);
    const key = { activityId: activity.id, enrollmentId: enrollment.id };
    if (await tx.activitySubmission.findUnique({ where: { activityId_enrollmentId: key }, select: { id: true } })) {
      return reply({ ok: true, alreadySubmitted: true });
    }
    const now = new Date();
    if (activity.availableAt && activity.availableAt > now) return error("This activity has not opened yet.", 409);
    if (activity.status !== "OPEN" || (activity.dueAt && activity.dueAt <= now)) return error("Submissions are closed.", 409);
    if (!activity.practice && subject[0].gradeStatus !== "DRAFT") return error("The class record is closed for grading.", 409);

    const points = activity.kind === "QUIZ"
      ? gradeQuiz(quizSnapshotSchema.parse(activity.questions), input.answers ?? {}) : null;
    if (activity.kind === "QUIZ" && points === null) return error("Answer every quiz question before submitting.");
    if (activity.kind === "ASSIGNMENT" && !input.text && !input.driveUrl) return error("Add a response or Google Drive link.");
    const inserted = await tx.activitySubmission.createMany({ skipDuplicates: true, data: [{
      ...key, ...(activity.kind === "QUIZ" ? { answers: input.answers, points, gradedAt: now }
        : { text: input.text || null, driveUrl: input.driveUrl || null }),
      submittedAt: now
    }] });
    if (!inserted.count) return reply({ ok: true, alreadySubmitted: true });
    if (activity.assessmentId && points !== null) {
      const cell = { enrollmentId: enrollment.id, assessmentId: activity.assessmentId };
      await tx.score.upsert({ where: { enrollmentId_assessmentId: cell },
        create: { ...cell, points }, update: { points, remark: null } });
    }
    return reply({ ok: true }, 201);
  });
}
