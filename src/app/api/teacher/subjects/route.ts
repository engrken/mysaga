import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SAMPLE_GRADE_BANDS } from "@/lib/grades";
import { SCHOOL_PLAN_LIMITS } from "@/lib/plans";

const schema = z.object({ classId: z.string().trim().max(40).optional().transform(value => value || null), code: z.string().trim().min(1).max(30), title: z.string().trim().min(2).max(160), term: z.string().trim().min(1).max(40), academicYear: z.string().trim().min(4).max(20), schedule: z.string().trim().max(4000).optional(), courseYear: z.string().trim().max(80).optional(), courseProgram: z.string().trim().max(120).optional(), yearLevel: z.string().trim().max(40).optional(), section: z.string().trim().max(40).optional() });
export async function GET(request: Request) {
  const teacher = await requireRole("TEACHER");
  if (!teacher) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const academicYear = params.get("academicYear")?.trim();
  const term = params.get("term")?.trim();
  const includeAllSemesters = params.get("includeAllSemesters") === "1";
  const validAcademicYear = !!academicYear && /^\\d{4}-\\d{4}$/.test(academicYear);
  if (includeAllSemesters && !validAcademicYear) {
    return NextResponse.json({ error: "Choose a valid academic year to load grading setup sources." }, { status: 400 });
  }
  const subjects = await prisma.subject.findMany({
    where: {
      teacherId: teacher.id,
      schoolId: teacher.schoolId,
      ...(validAcademicYear ? { academicYear } : {}),
      ...(includeAllSemesters
        ? { term: { in: ["1st Semester", "2nd Semester"] } }
        : term ? { term: term === "3rd Trimester" ? { in: ["3rd Trimester", "3rd Semester"] } : term } : {})
    },
    orderBy: [{ academicYear: "desc" }, { term: "asc" }, { code: "asc" }],
    include: { _count: { select: { enrollments: true } } }
  });
  return NextResponse.json(
    { subjects },
    { headers: { "Cache-Control": "no-store" } }
  );
}
export async function POST(request: Request) {
  const teacher = await requireRole("TEACHER");
  if (!teacher) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Complete the subject details." }, { status: 400 });
  if (parsed.data.classId && await prisma.subject.findFirst({ where: { schoolId: teacher.schoolId, classId: { equals: parsed.data.classId, mode: "insensitive" } }, select: { id: true } })) return NextResponse.json({ error: "That Class ID is already used in this school." }, { status: 409 });
  const school = await prisma.school.findUnique({ where: { id: teacher.schoolId }, select: { plan: true } });
  const classCount = await prisma.subject.count({ where: { schoolId: teacher.schoolId, academicYear: parsed.data.academicYear } });
  const classLimit = SCHOOL_PLAN_LIMITS[school?.plan || "FREE"].classes;
  if (classCount >= classLimit) return NextResponse.json({ error: `Your school plan allows ${classLimit} classes. Upgrade the school plan to add another class.` }, { status: 402 });
  const subject = await prisma.subject.create({ data: { ...parsed.data, term: parsed.data.term === "Trimester" ? "3rd Semester" : parsed.data.term, schoolId: teacher.schoolId, teacherId: teacher.id, gradeBands: { create: SAMPLE_GRADE_BANDS.map((band, sortOrder) => ({ ...band, sortOrder })) } } });
  await prisma.auditEvent.create({ data: { actorId: teacher.id, action: "created", entity: "subject", entityId: subject.id } });
  return NextResponse.json({ subject }, { status: 201 });
}

const visibilitySchema = z.object({
  subjectIds: z.array(z.string().min(1)).min(1).max(200),
  isPublished: z.boolean()
});

export async function PATCH(request: Request) {
  const teacher = await requireRole("TEACHER");
  if (!teacher) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = visibilitySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Select valid classes and a visibility setting." }, { status: 400 });
  const ids = [...new Set(parsed.data.subjectIds)];
  const owned = await prisma.subject.findMany({
    where: { id: { in: ids }, teacherId: teacher.id, schoolId: teacher.schoolId },
    select: { id: true, isPublished: true }
  });
  if (owned.length !== ids.length) return NextResponse.json({ error: "A selected class was not found or is not yours." }, { status: 403 });
  const changed = owned.filter(subject => subject.isPublished !== parsed.data.isPublished).map(subject => subject.id);
  if (changed.length) {
    await prisma.$transaction(async tx => {
      await tx.subject.updateMany({
        where: { id: { in: changed }, teacherId: teacher.id, schoolId: teacher.schoolId },
        data: { isPublished: parsed.data.isPublished }
      });
      await tx.auditEvent.createMany({
        data: changed.map(id => ({ actorId: teacher.id, entity: "subject", entityId: id, action: parsed.data.isPublished ? "made student grades visible" : "hid student grades" }))
      });
    });
  }
  return NextResponse.json({ ok: true, updated: changed.length }, { headers: { "Cache-Control": "no-store" } });
}
