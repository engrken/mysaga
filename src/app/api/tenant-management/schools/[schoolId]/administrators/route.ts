import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantManager, tenantManagerIdentity } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Context = { params: Promise<{ schoolId: string }> };
const schema = z.object({ userId: z.string().min(1).max(100), isSchoolAdmin: z.boolean() });

export async function PATCH(request: Request, { params }: Context) {
  const manager = await requireTenantManager();
  if (!manager) return NextResponse.json({ error: "Platform administrator access is required." }, { status: 403 });
  const { schoolId } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a teacher and administrator access setting." }, { status: 400 });
  const teacher = await prisma.user.findFirst({
    where: { id: parsed.data.userId, schoolId, role: "TEACHER" },
    select: { id: true, isSchoolAdmin: true, email: true, tenantManagerEmail: true, role: true }
  });
  if (!teacher) return NextResponse.json({ error: "Teacher account not found in this school." }, { status: 404 });
  if (await tenantManagerIdentity(teacher)) {
    return NextResponse.json({ error: "Platform administrator access is managed separately." }, { status: 409 });
  }
  if (teacher.isSchoolAdmin === parsed.data.isSchoolAdmin) {
    return NextResponse.json({ ok: true, isSchoolAdmin: teacher.isSchoolAdmin });
  }
  const changed = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${schoolId}))::text`;
    if (!parsed.data.isSchoolAdmin) {
      const adminCount = await tx.user.count({ where: { schoolId, role: "TEACHER", isSchoolAdmin: true } });
      if (adminCount <= 1) return "LAST_ADMIN" as const;
    }
    const updated = await tx.user.updateMany({
      where: { id: teacher.id, schoolId, role: "TEACHER", isSchoolAdmin: teacher.isSchoolAdmin },
      data: { isSchoolAdmin: parsed.data.isSchoolAdmin }
    });
    if (updated.count !== 1) return "CHANGED" as const;
    await tx.auditEvent.create({
      data: {
        actorId: manager.id,
        action: `${parsed.data.isSchoolAdmin ? "appointed" : "removed"} a school administrator`,
        entity: "user", entityId: teacher.id
      }
    });
    return "UPDATED" as const;
  });
  if (changed === "LAST_ADMIN") {
    return NextResponse.json({ error: "Appoint another school administrator before removing the last one." }, { status: 409 });
  }
  if (changed !== "UPDATED") {
    return NextResponse.json({ error: "This account changed in another session. Refresh and retry." }, { status: 409 });
  }
  return NextResponse.json({ ok: true, isSchoolAdmin: parsed.data.isSchoolAdmin }, { headers: { "Cache-Control": "no-store" } });
}
