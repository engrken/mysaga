import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
const schema = z.object({ enrollmentId: z.string(), assessmentId: z.string(), points: z.number().min(0).nullable(), remark: z.enum(["EXCUSED", "ABSENT", "DID_NOT_SUBMIT", "PRESENT"]).nullable().optional() });
export async function PUT(request: Request) {
  const teacher = await requireRole("TEACHER"); if (!teacher) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json()); if (!parsed.success) return NextResponse.json({ error: "Invalid score." }, { status: 400 });
  const [enrollment, assessment] = await Promise.all([
    prisma.enrollment.findFirst({ where: { id: parsed.data.enrollmentId, subject: { teacherId: teacher.id, schoolId: teacher.schoolId } }, include: { subject: { select: { gradeStatus: true } } } }),
    prisma.assessment.findFirst({ where: { id: parsed.data.assessmentId, subject: { teacherId: teacher.id, schoolId: teacher.schoolId } }, include: { activity: { select: { id: true } } } })
  ]);
  if (!enrollment || !assessment || enrollment.subjectId !== assessment.subjectId) return NextResponse.json({ error: "Record not found." }, { status: 404 });
  if (enrollment.subject.gradeStatus === "VERIFIED") return NextResponse.json({ error: "This grade record is final. Recall it before changing scores." }, { status: 409 });
  const isAttendance = assessment.title.toLocaleLowerCase().startsWith("attendance ·");
  if (isAttendance && parsed.data.points !== null) return NextResponse.json({ error: "Attendance is recorded as present, absent, or excused days, not points." }, { status: 400 });
  if (parsed.data.points !== null && parsed.data.points > assessment.maxScore) return NextResponse.json({ error: "Score cannot exceed the maximum points." }, { status: 400 });
  if (parsed.data.remark === "PRESENT" && !isAttendance) return NextResponse.json({ error: "Present status is only valid for attendance days." }, { status: 400 });
  const points = parsed.data.remark ? null : parsed.data.points;
  const remark = parsed.data.remark ?? null;
  const save = async (tx: Pick<typeof prisma, "score" | "auditEvent">) => {
    await tx.score.upsert({ where: { enrollmentId_assessmentId: { enrollmentId: enrollment.id, assessmentId: assessment.id } }, create: { enrollmentId: enrollment.id, assessmentId: assessment.id, points, remark }, update: { points, remark } });
    await tx.auditEvent.create({ data: { actorId: teacher.id, action: remark ? `updated item status ${remark}` : "updated score", entity: "score", entityId: `${enrollment.id}:${assessment.id}` } });
  };
  if (assessment.activity) {
    const activityId = assessment.activity.id;
    const saved = await prisma.$transaction(async tx => {
      const [subject] = await tx.$queryRaw<Array<{ gradeStatus: string }>>`SELECT "gradeStatus" FROM "Subject" WHERE id = ${enrollment.subjectId} FOR UPDATE`;
      const activity = await tx.classActivity.findUnique({ where: { id: activityId }, select: { status: true, submissions: { where: { enrollmentId: enrollment.id }, select: { id: true } } } });
      if (subject?.gradeStatus !== "DRAFT" || activity?.status !== "CLOSED" || activity.submissions.length || points !== null) return false;
      await save(tx);
      return true;
    });
    if (!saved) return NextResponse.json({ error: "Grade submitted work in Activities. After closing the activity, you can set a status for missing submissions here." }, { status: 409 });
  } else {
    await save(prisma);
  }
  return NextResponse.json({ ok: true });
}
