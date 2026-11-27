import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Context = { params: Promise<{ subjectId: string }> };
const dateSchema = z.iso.datetime({ offset: true }).nullable().optional();
const schema = z.object({
  title: z.string().trim().min(3).max(160),
  body: z.string().trim().min(1).max(12000),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).default("PUBLISHED"),
  isPinned: z.boolean().default(false),
  publishAt: dateSchema,
  expiresAt: dateSchema
});

function parseDates(input: z.infer<typeof schema>) {
  const publishAt = input.status === "DRAFT" ? null : input.publishAt ? new Date(input.publishAt) : new Date();
  const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
  if (expiresAt && publishAt && expiresAt <= publishAt) return { error: "The expiration date must be later than the publish date." } as const;
  return { publishAt, expiresAt } as const;
}

export async function GET(_request: Request, context: Context) {
  const teacher = await requireRole("TEACHER");
  if (!teacher) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (teacher.isDemo) return NextResponse.json({ error: "Announcements are unavailable in the read-only demo." }, { status: 403 });
  const { subjectId } = await context.params;
  const subject = await prisma.subject.findFirst({
    where: { id: subjectId, schoolId: teacher.schoolId, teacherId: teacher.id },
    select: { id: true, _count: { select: { enrollments: true } } }
  });
  if (!subject) return NextResponse.json({ error: "Class not found." }, { status: 404 });
  const announcements = await prisma.announcement.findMany({
    where: { schoolId: teacher.schoolId, subjectId, authorId: teacher.id },
    orderBy: [{ isPinned: "desc" }, { createdAt: "desc" }],
    include: { _count: { select: { reads: true } } }
  });
  return NextResponse.json({
    announcements: announcements.map(({ _count, ...item }) => ({ ...item, readCount: _count.reads, recipientCount: subject._count.enrollments }))
  }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request, context: Context) {
  const teacher = await requireRole("TEACHER");
  if (!teacher) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (teacher.isDemo) return NextResponse.json({ error: "The public demo is read-only." }, { status: 403 });
  const { subjectId } = await context.params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a title and announcement message, then check the schedule and expiration dates." }, { status: 400 });
  const subject = await prisma.subject.findFirst({
    where: { id: subjectId, schoolId: teacher.schoolId, teacherId: teacher.id },
    select: { id: true }
  });
  if (!subject) return NextResponse.json({ error: "Class not found." }, { status: 404 });
  const dates = parseDates(parsed.data);
  if ("error" in dates) return NextResponse.json({ error: dates.error }, { status: 400 });
  const announcement = await prisma.announcement.create({
    data: {
      schoolId: teacher.schoolId, subjectId, authorId: teacher.id,
      title: parsed.data.title, body: parsed.data.body, status: parsed.data.status,
      isPinned: parsed.data.isPinned, publishAt: dates.publishAt, expiresAt: dates.expiresAt
    }
  });
  return NextResponse.json({ announcement }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
}
