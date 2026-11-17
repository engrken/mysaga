import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { activityTopicSchema, activityHeaders, questionSchema, quizSnapshotSchema, validDriveLink } from "@/lib/class-activities";

const id = z.string().trim().min(1).max(128);
const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("bank"), question: questionSchema, topic: activityTopicSchema.optional() }),
  z.object({ action: z.literal("tag-question"), questionId: id, topic: activityTopicSchema }),
  z.object({
    action: z.literal("draft"), subjectId: id, activityId: id.optional(),
    kind: z.enum(["QUIZ", "ASSIGNMENT", "RESOURCE"]), title: z.string().trim().min(1).max(120)
      .refine(title => !title.toLowerCase().startsWith("attendance ·")),
    instructions: z.string().trim().max(8000),
    practice: z.boolean(), categoryId: id.nullable(), dueAt: z.iso.datetime({ offset: true }).nullable(),
    maxScore: z.number().positive().max(100000),
    itemWeight: z.number().positive().max(100).nullable(),
    questionIds: z.array(id).max(50),
    inlineQuestions: z.array(questionSchema).max(50).default([]),
    topic: activityTopicSchema.optional(),
    materialUrl: z.string().trim().max(2048).nullable().optional(),
    availableAt: z.iso.datetime({ offset: true }).nullable().optional()
  }),
  z.object({ action: z.enum(["open", "close"]), subjectId: id, activityId: id }),
  z.object({ action: z.literal("grade"), subjectId: id, activityId: id, submissionId: id,
    points: z.number().min(0).max(100000), feedback: z.string().trim().max(4000) })
]);

const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: activityHeaders });
const error = (message: string, status = 400) => reply({ error: message }, status);
const activityFields = {
  id: true, title: true, kind: true, instructions: true, topic: true, categoryId: true, assessmentId: true,
  status: true, questions: true, materialUrl: true, availableAt: true, practice: true, maxScore: true, itemWeight: true, dueAt: true,
  _count: { select: { submissions: true } }
} as const;

export async function GET(request: Request) {
  const teacher = await requireRole("TEACHER");
  if (!teacher) return error("Unauthorized.", 401);
  const subjectScope = { teacherId: teacher.id, schoolId: teacher.schoolId };
  const { searchParams } = new URL(request.url);
  const subjectId = searchParams.get("subjectId");
  const activityId = searchParams.get("activityId");
  if (searchParams.get("view") === "recent") {
    const rows = await prisma.activitySubmission.findMany({
      where: { activity: { subject: subjectScope } },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 10,
      select: { id: true, updatedAt: true, gradedAt: true, enrollment: { select: { studentName: true } },
        activity: { select: { id: true, title: true, subject: { select: { id: true, code: true, title: true } } } } }
    });
    return reply({ submissions: rows });
  }
  if (!subjectId) return error("Choose a class.");
  const subject = await prisma.subject.findFirst({ where: { id: subjectId, ...subjectScope }, select: { id: true } });
  if (!subject) return error("Class not found.", 404);
  if (activityId) {
    const activity = await prisma.classActivity.findFirst({
      where: { id: activityId, subjectId }, select: { id: true }
    });
    if (!activity) return error("Activity not found.", 404);
    const cursor = searchParams.get("cursor");
    if (cursor && !await prisma.activitySubmission.findFirst({ where: { id: cursor, activityId }, select: { id: true } })) {
      return error("Invalid submission page.");
    }
    const rows = await prisma.activitySubmission.findMany({ where: { activityId }, orderBy: { id: "asc" }, take: 31,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, text: true, driveUrl: true, points: true, feedback: true, submittedAt: true, gradedAt: true,
        enrollment: { select: { studentName: true } } }
    });
    return reply({ submissions: rows.slice(0, 30), nextCursor: rows.length > 30 ? rows[29].id : null });
  }
  const topic = searchParams.get("topic");
  if (topic && topic.length > 100) return error("Invalid topic.");
  const [activities, bank, topics] = await Promise.all([
    prisma.classActivity.findMany({ where: { subjectId }, orderBy: { createdAt: "desc" }, take: 50, select: activityFields }),
    prisma.bankQuestion.findMany({ where: { teacherId: teacher.id, ...(topic === "" ? { topic: null } : topic ? { topic: { equals: topic, mode: "insensitive" } } : {}) }, orderBy: { createdAt: "desc" }, take: 200,
      select: { id: true, prompt: true, topic: true } }),
    prisma.bankQuestion.groupBy({ by: ["topic"], where: { teacherId: teacher.id, topic: { not: null } }, orderBy: { topic: "asc" } })
  ]);
  return reply({ activities, bank, topics: [...new Map(topics.map(({topic}) => [topic!.toLowerCase(), topic])).values()] });
}

export async function POST(request: Request) {
  const teacher = await requireRole("TEACHER");
  if (!teacher) return error("Unauthorized.", 401);
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return error("Check the activity settings and try again.");
  const input = parsed.data;
  if (input.action === "tag-question") {
    const updated = await prisma.bankQuestion.updateMany({
      where: { id: input.questionId, teacherId: teacher.id }, data: { topic: input.topic || null }
    });
    return updated.count ? reply({ ok: true }) : error("Question not found.", 404);
  }
  if (input.action === "bank") {
    const question = await prisma.bankQuestion.create({ data: { teacherId: teacher.id, topic: input.topic || null, ...input.question },
      select: { id: true, prompt: true, options: true, answer: true } });
    return reply({ question }, 201);
  }

  return prisma.$transaction(async tx => {
    const locked = await tx.$queryRaw<Array<{ gradeStatus: string }>>`
      SELECT "gradeStatus" FROM "Subject"
      WHERE id = ${input.subjectId} AND "teacherId" = ${teacher.id} AND "schoolId" = ${teacher.schoolId}
      FOR UPDATE`;
    if (!locked.length) return error("Class not found.", 404);
    const activity = input.activityId ? await tx.classActivity.findFirst({
      where: { id: input.activityId, subjectId: input.subjectId }
    }) : null;
    if (input.activityId && !activity) return error("Activity not found.", 404);

    if (input.action === "close") {
      if (activity?.status !== "OPEN") return error("Open the activity before closing it.", 409);
      await tx.classActivity.update({ where: { id: activity.id }, data: activity.kind === "RESOURCE" ? { status: "DRAFT", openedAt: null } : { status: "CLOSED" } });
      return reply({ ok: true });
    }
    if (input.action === "open" && activity?.status === "OPEN") return reply({ ok: true, assessmentId: activity.assessmentId });
    if (locked[0].gradeStatus !== "DRAFT") return error("Recall the class record to draft before making this change.", 409);

    if (input.action === "draft") {
      if (activity && activity.status !== "DRAFT") return error("Only draft activities can be edited.", 409);
      const practice = input.kind === "RESOURCE" || input.practice;
      if (!practice && input.categoryId && !await tx.gradeCategory.findFirst({
        where: { id: input.categoryId, subjectId: input.subjectId, children: { none: {} } }, select: { id: true }
      })) return error("Choose an assessment category from this class.");
      if (input.materialUrl && !validDriveLink(input.materialUrl)) return error("Use a valid HTTPS Google Drive or Google Docs link for the activity material.");
      const availableAt = input.availableAt ? new Date(input.availableAt) : null;
      const dueAt = input.dueAt ? new Date(input.dueAt) : null;
      if (availableAt && dueAt && availableAt >= dueAt) return error("The deadline must be after the opening date.");
      const ordered = [...new Set(input.questionIds)];
      const questions = input.kind === "QUIZ" ? await tx.bankQuestion.findMany({ where: {
        id: { in: ordered }, teacherId: teacher.id
      }, select: { id: true, prompt: true, options: true, answer: true } }) : [];
      if (input.kind === "QUIZ" && questions.length !== ordered.length) return error("Choose questions from your own question bank.");
      if (input.kind === "QUIZ" && ordered.length + input.inlineQuestions.length > 50) return error("A quiz can contain up to 50 questions.");
      const snapshot = input.kind === "QUIZ" ? [
        ...ordered.flatMap(questionId => questions.filter(question => question.id === questionId)),
        ...input.inlineQuestions.map(question => ({ ...question, id: `inline-${randomUUID()}` }))
      ] : [];
      const data = {
        subjectId: input.subjectId, kind: input.kind, title: input.title, instructions: input.instructions,
        practice, categoryId: practice ? null : input.categoryId, topic: input.topic || null, dueAt: input.kind === "RESOURCE" ? null : dueAt, availableAt, materialUrl: input.kind !== "QUIZ" ? input.materialUrl || null : null,
        itemWeight: !practice && input.categoryId ? input.itemWeight : null,
        maxScore: input.kind === "QUIZ" ? snapshot.length : input.kind === "RESOURCE" ? 0 : input.maxScore,
        questions: snapshot
      };
      const saved = activity
        ? await tx.classActivity.update({ where: { id: activity.id }, data, select: activityFields })
        : await tx.classActivity.create({ data, select: activityFields });
      return reply({ activity: saved });
    }
    if (input.action === "open" && activity) {
      if (activity.status !== "DRAFT") return error("This activity is already closed.", 409);
      if (activity.dueAt && activity.dueAt <= new Date()) return error("Choose a deadline in the future.");
      if (activity.kind === "QUIZ" && !quizSnapshotSchema.parse(activity.questions).length) {
        return error("Add at least one question before opening the quiz.");
      }
      if (activity.kind === "RESOURCE" && !activity.materialUrl && !activity.instructions) {
        return error("Add resource content or a Google Drive link before publishing.");
      }
      let assessmentId: string | null = null;
      if (!activity.practice) {
        if (!activity.categoryId) return error("Choose an assessment category before opening a graded activity.");
        const category = await tx.gradeCategory.findFirst({
          where: { id: activity.categoryId, subjectId: input.subjectId, children: { none: {} } },
          select: { id: true, assessments: { select: { weight: true } } }
        });
        if (!category) return error("Choose an existing assessment category in the activity’s draft.", 409);
        if (category.assessments.some(item => (item.weight === null) !== (activity.itemWeight === null))) {
          return error("Match the class category’s item weighting before opening this activity.");
        }
        const assessment = await tx.assessment.create({ data: {
          subjectId: input.subjectId, categoryId: category.id, title: activity.title,
          maxScore: activity.maxScore, weight: activity.itemWeight, dueDate: activity.dueAt
        }, select: { id: true } });
        assessmentId = assessment.id;
      }
      await tx.classActivity.update({ where: { id: activity.id },
        data: { status: "OPEN", openedAt: new Date(), assessmentId } });
      await tx.auditEvent.create({ data: { actorId: teacher.id, entity: "activity", entityId: activity.id, action: "opened class activity" } });
      return reply({ ok: true, assessmentId });
    }
    if (input.action === "grade" && activity) {
      if (activity.kind !== "ASSIGNMENT" || activity.status === "DRAFT") return error("This activity cannot be graded here.");
      if (input.points > activity.maxScore) return error("Score exceeds the maximum points.");
      const submission = await tx.activitySubmission.findFirst({
        where: { id: input.submissionId, activityId: activity.id, enrollment: { subjectId: input.subjectId } },
        select: { id: true, enrollmentId: true, points: true, feedback: true }
      });
      if (!submission) return error("Submission not found.", 404);
      if (submission.points === input.points && submission.feedback === input.feedback) return reply({ ok: true });
      await tx.activitySubmission.update({ where: { id: submission.id },
        data: { points: input.points, feedback: input.feedback, gradedAt: new Date() } });
      if (activity.assessmentId) {
        const cell = { enrollmentId: submission.enrollmentId, assessmentId: activity.assessmentId };
        await tx.score.upsert({ where: { enrollmentId_assessmentId: cell },
          create: { ...cell, points: input.points }, update: { points: input.points, remark: null } });
      }
      await tx.auditEvent.create({ data: { actorId: teacher.id, entity: "activity-submission", entityId: submission.id,
        action: `graded assignment: ${submission.points ?? "ungraded"} → ${input.points}` } });
      return reply({ ok: true });
    }
    return error("Unsupported activity change.");
  });
}
