import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Context = { params: Promise<{ announcementId: string }> };
const dateSchema = z.iso.datetime({ offset: true }).nullable().optional();
const schema = z.object({
  title: z.string().trim().min(3).max(160),
  body: z.string().trim().min(1).max(12000),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]),
  isPinned: z.boolean(),
  publishAt: dateSchema,
  expiresAt: dateSchema
});

export async function PATCH(request: Request, context: Context) {
  const teacher = await requireRole("TEACHER");
  if (!teacher) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (teacher.isDemo) return NextResponse.json({ error: "The public demo is read-only." }, { status: 403 });
  const { announcementId } = await context.params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the announcement details and publication dates." }, { status: 400 });
  const existing = await prisma.announcement.findFirst({
    where: { id: announcementId, schoolId: teacher.schoolId, authorId: teacher.id, subject: { schoolId: teacher.schoolId, teacherId: teacher.id } },
    select: { id: true, publishAt: true }
  });
  if (!existing) return NextResponse.json({ error: "Announcement not found." }, { status: 404 });
  const publishAt = parsed.data.status === "DRAFT" ? null : parsed.data.publishAt ? new Date(parsed.data.publishAt) : existing.publishAt ?? new Date();
  const expiresAt = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null;
  if (expiresAt && publishAt && expiresAt <= publishAt) return NextResponse.json({ error: "The expiration date must be later than the publish date." }, { status: 400 });
  const announcement = await prisma.announcement.update({
    where: { id: announcementId },
    data: { title: parsed.data.title, body: parsed.data.body, status: parsed.data.status, isPinned: parsed.data.isPinned, publishAt, expiresAt }
  });
  return NextResponse.json({ announcement }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function DELETE(_request: Request, context: Context) {
  const teacher = await requireRole("TEACHER");
  if (!teacher) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (teacher.isDemo) return NextResponse.json({ error: "The public demo is read-only." }, { status: 403 });
  const { announcementId } = await context.params;
  const existing = await prisma.announcement.findFirst({
    where: { id: announcementId, schoolId: teacher.schoolId, authorId: teacher.id, subject: { schoolId: teacher.schoolId, teacherId: teacher.id } },
    select: { id: true }
  });
  if (!existing) return NextResponse.json({ error: "Announcement not found." }, { status: 404 });
  await prisma.announcement.delete({ where: { id: announcementId } });
  return NextResponse.json({ ok: true });
}
