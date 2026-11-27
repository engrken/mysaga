import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { assertActivitiesWritable } from "@/lib/activity-feature-flags";
import {
  activityEnrollmentIdentity, activityHeaders, gradeQuizAnswers, QuizAnswer,
  quizSnapshotSchema, sanitizeLessonHtml
} from "@/lib/class-activities";


const submissionSchema = z.object({
  action: z.enum(["start-quiz", "submit-quiz"]).optional(),
  activityId: z.string().min(1).max(128),
  attemptId: z.string().min(1).max(128).optional(),
  answers: z.record(z.string().max(128), z.union([z.number().int(), z.string().max(12000)])).optional(),
  text: z.string().trim().max(12000).optional(),
});
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: activityHeaders });
const error = (message: string, status = 400) => reply({ error: message }, status);

function aggregateQuizScore(scores: number[], method: string) {
  if (!scores.length) return 0;
  if (method === "FIRST") return scores[0];
  if (method === "LAST") return scores[scores.length - 1];
  if (method === "AVERAGE") return scores.reduce((sum, score) => sum + score, 0) / scores.length;
  return Math.max(...scores);
}

export async function GET(request: Request) {
  const student = await requireRole("STUDENT");
  if (!student) return error("Unauthorized.", 401);
  const { searchParams } = new URL(request.url);
  const classId = searchParams.get("subjectId");
  const activityId = searchParams.get("activityId");
  const academicYear = searchParams.get("academicYear")?.trim();
  const term = searchParams.get("term")?.trim();
  if (academicYear && !/^\d{4}-\d{4}$/.test(academicYear)) return error("Choose a valid academic year.");
  const enrollments = await prisma.enrollment.findMany({
    where: { OR: activityEnrollmentIdentity(student), subject: { schoolId: student.schoolId,
      ...(academicYear ? { academicYear } : {}),
      ...(term ? { term: term === "3rd Trimester" ? { in: ["3rd Trimester", "3rd Semester"] } : term } : {}) } },
    orderBy: { id: "asc" }, take: 200,
    select: { id: true, subjectId: true, studentUserId: true,
      subject: { select: { id: true, code: true, title: true, term: true, academicYear: true,
        isPublished: true, gradeStatus: true, teacher: { select: { fullName: true } } } } }
  });
  const enrollmentByClass = new Map<string, typeof enrollments[number]>();
  for (const row of enrollments) {
    if (!enrollmentByClass.has(row.subjectId) || row.studentUserId === student.id) enrollmentByClass.set(row.subjectId, row);
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
    select: {
      id: true, title: true, kind: true, topic: true, availableAt: true, subjectId: true, status: true,
      maxScore: true, practice: true, dueAt: true, timeLimitMinutes: true, attemptsAllowed: true,
      releaseGrade: true, releaseAnswers: true,
      ...(activityId ? { questions: true, instructions: true, materialUrl: true, lessonPages: true } : {}),
      submissions: { where: { enrollmentId: { in: enrollmentIds } },
        select: { text: true, driveUrl: true, files: true, storageProvider: true, fileUrl: true,
          fileName: true, fileSize: true, mimeType: true, offline: true, submittedAt: true,
          points: true, feedback: true, gradedAt: true } },
      quizAttempts: { where: { enrollmentId: { in: enrollmentIds } },
        orderBy: { attemptNumber: "desc" }, select: { id: true, attemptNumber: true, startedAt: true,
          submittedAt: true, points: true, feedback: true, gradedAt: true } }
    }
  });
  if (activityId && !rows.length) return error("Activity not found.", 404);
  const activities = rows.map(({ submissions, quizAttempts, questions, lessonPages, ...row }) => {
    const enrollment = enrollmentByClass.get(row.subjectId)!;
    const subject = enrollment.subject;
    const submission = submissions[0];
    const release = (subject.isPublished || row.practice) && row.releaseGrade;
    const attempts = quizAttempts.map(attempt => ({
      id: attempt.id, attemptNumber: attempt.attemptNumber, startedAt: attempt.startedAt,
      submittedAt: attempt.submittedAt, graded: attempt.gradedAt !== null,
      points: release ? attempt.points : null, feedback: release ? attempt.feedback : null
    }));
    return {
      ...row, subject,
      questions: activityId && row.kind === "QUIZ" && questions
        ? quizSnapshotSchema.parse(questions).map(question => ({
            id: question.id, type: question.type, prompt: question.prompt,
            options: question.options, points: question.points,
            ...(release && row.releaseAnswers ? { answer: question.answer, answerText: question.answerText } : {})
          })) : undefined,
      lessonPages: activityId && row.kind === "LESSON" && Array.isArray(lessonPages)
        ? (lessonPages as Array<{ id: string; title: string; content: string; nextPageId?: string | null; branches?: { label: string; targetPageId: string }[] }>)
            .map(page => ({ ...page, content: sanitizeLessonHtml(page.content) })) : undefined,
      attempts, attemptsRemaining: Math.max(0, row.attemptsAllowed - attempts.length),
      submission: submission ? {
        text: submission.text, driveUrl: submission.driveUrl, files: submission.files, offline: submission.offline,
        storageProvider: submission.storageProvider, fileUrl: submission.fileUrl, fileName: submission.fileName,
        fileSize: submission.fileSize, mimeType: submission.mimeType,
        submittedAt: submission.submittedAt, graded: submission.gradedAt !== null,
        points: release ? submission.points : null, feedback: release ? submission.feedback : null
      } : null
    };
  });
  return reply({ studentId: student.id, activities, classes: [...enrollmentByClass.values()].map(({ subject }) => subject) });
}

export async function POST(request: Request) {
  const student = await requireRole("STUDENT");
  if (!student) return error("Unauthorized.", 401);
  if (!assertActivitiesWritable("student")) return error("Student activity submissions are disabled while this beta is read-only.", 423);
  const parsed = submissionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return error("Check your submission and try again.");
  const input = parsed.data;
  if (!input.action) return error("Assignment submissions now use the R2 submission endpoint.", 410);
  if (input.files && (input.files.reduce((sum, file) => sum + file.size, 0) > 30 * 1024 * 1024)) {
    return error("Attachments must total 30 MB or less.");
  }
  const target = await prisma.classActivity.findFirst({ where: {
    id: input.activityId, status: { not: "DRAFT" }, kind: "QUIZ",
    subject: { schoolId: student.schoolId, enrollments: { some: { OR: activityEnrollmentIdentity(student) } } }
  }, select: { id: true, subjectId: true } });
  if (!target) return error("Activity not found.", 404);
  const enrollmentRows = await prisma.enrollment.findMany({
    where: { subjectId: target.subjectId, OR: activityEnrollmentIdentity(student) },
    orderBy: { id: "asc" }, select: { id: true, studentUserId: true }
  });
  const enrollment = enrollmentRows.find(row => row.studentUserId === student.id) ?? enrollmentRows[0];
  if (!enrollment) return error("Class enrollment not found.", 404);

  if (input.action === "start-quiz") {
    const started = await prisma.$transaction(async tx => {
      const lock = await tx.$queryRaw<Array<{ gradeStatus: string }>>`
        SELECT "gradeStatus" FROM "Subject" WHERE id = ${target.subjectId} AND "schoolId" = ${student.schoolId} FOR UPDATE`;
      const activity = await tx.classActivity.findFirst({ where: {
        id: target.id, subjectId: target.subjectId, kind: "QUIZ", status: "OPEN"
      }, select: { id: true, availableAt: true, dueAt: true, attemptsAllowed: true, practice: true } });
      if (!lock.length || !activity) return { error: "Quiz is not available.", status: 404 as const };
      const now = new Date();
      if (activity.availableAt && activity.availableAt > now) return { error: "Quiz has not opened yet.", status: 409 as const };
      if (activity.dueAt && activity.dueAt <= now) return { error: "The quiz deadline has passed.", status: 409 as const };
      if (!activity.practice && lock[0].gradeStatus !== "DRAFT") return { error: "The class record is closed for grading.", status: 409 as const };
      const pending = await tx.quizAttempt.findFirst({ where: {
        activityId: activity.id, enrollmentId: enrollment.id, submittedAt: null
      }, orderBy: { attemptNumber: "desc" } });
      if (pending) return { attempt: pending };
      const count = await tx.quizAttempt.count({ where: { activityId: activity.id, enrollmentId: enrollment.id } });
      if (count >= activity.attemptsAllowed) return { error: "You have used all allowed attempts.", status: 409 as const };
      const attempt = await tx.quizAttempt.create({ data: {
        activityId: activity.id, enrollmentId: enrollment.id, attemptNumber: count + 1
      } });
      return { attempt };
    });
    if ("error" in started && typeof started.error === "string") return error(started.error, started.status ?? 409);
    return reply({ attemptId: started.attempt.id, attemptNumber: started.attempt.attemptNumber,
      startedAt: started.attempt.startedAt }, 201);
  }
  const activity = await prisma.classActivity.findFirst({
    where: { id: target.id, subjectId: target.subjectId, status: "OPEN" },
    select: { id: true, kind: true, dueAt: true, availableAt: true, timeLimitMinutes: true,
      questions: true, assessmentId: true, practice: true, gradingMethod: true, maxScore: true }
  });
  if (!activity) return error("Activity is no longer accepting work.", 409);
  const now = new Date();
  if (activity.availableAt && activity.availableAt > now) return error("This activity has not opened yet.", 409);
  if (activity.dueAt && activity.dueAt <= now) return error("The deadline has passed.", 409);

  if (input.action === "submit-quiz") {
    if (activity.kind !== "QUIZ" || !input.attemptId || !input.answers) return error("Quiz attempt details are missing.");
    const questions = quizSnapshotSchema.parse(activity.questions);
    const answerIds = Object.keys(input.answers);
    if (answerIds.length !== questions.length || questions.some(question => input.answers?.[question.id] === undefined)) {
      return error("Answer every question before submitting.");
    }
    for (const question of questions) {
      const value = input.answers[question.id];
      if (question.type === "ESSAY" || question.type === "SHORT_ANSWER") {
        if (typeof value !== "string") return error("Written answers must be text.");
      } else if (typeof value !== "number" || !Number.isInteger(value) ||
          (value !== -1 && (value < 0 || value >= question.options.length))) {
        return error("Choose a valid option for every answered multiple-choice question.");
      }
    }
    const attempt = await prisma.quizAttempt.findFirst({ where: {
      id: input.attemptId, activityId: activity.id, enrollmentId: enrollment.id, submittedAt: null
    }, select: { id: true, startedAt: true, attemptNumber: true } });
    if (!attempt) return error("This quiz attempt is no longer active.", 409);
    if (activity.timeLimitMinutes && now.getTime() >
      attempt.startedAt.getTime() + activity.timeLimitMinutes * 60_000 + 30_000) {
      return error("The time limit has expired. This attempt can no longer be submitted.", 409);
    }
    const grade = gradeQuizAnswers(questions, input.answers as Record<string, QuizAnswer>);
    const updated = await prisma.quizAttempt.update({ where: { id: attempt.id }, data: {
      answers: input.answers, points: grade.autoGradedPoints,
      submittedAt: now, gradedAt: grade.manualGradingRequired ? null : now
    }, select: { id: true, attemptNumber: true, points: true, gradedAt: true } });
    if (!grade.manualGradingRequired && activity.assessmentId) {
      const rows = await prisma.quizAttempt.findMany({ where: {
        activityId: activity.id, enrollmentId: enrollment.id, gradedAt: { not: null }
      }, orderBy: { attemptNumber: "asc" }, select: { points: true } });
      const scores = rows.map(row => row.points ?? 0);
      const score = aggregateQuizScore(scores, activity.gradingMethod);
      const cell = { enrollmentId: enrollment.id, assessmentId: activity.assessmentId };
      await prisma.score.upsert({ where: { enrollmentId_assessmentId: cell },
        create: { ...cell, points: score }, update: { points: score, remark: null } });
    }
    return reply({ ok: true, attemptId: updated.id, attemptNumber: updated.attemptNumber,
      points: updated.gradedAt ? updated.points : null, manualGrading: grade.manualGradingRequired }, 201);
  }

  return error("Assignment submissions must use the R2 submission endpoint.", 410);
