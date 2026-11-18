import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSchoolAdmin } from "@/lib/auth";
import { sendPortalEmail } from "@/lib/mailer";
import { prisma } from "@/lib/prisma";
import { checkAuthThrottle } from "@/lib/rate-limit";
import { createTenantInvitationToken, tenantInvitationUrl } from "@/lib/tenant-invitations";

type Context = { params: Promise<{ schoolId: string }> };
const createSchema = z.object({
  email: z.string().trim().email().max(200),
  role: z.enum(["TEACHER", "SCHOOL_ADMIN"]).default("TEACHER")
});

export async function GET(_request: Request, { params }: Context) {
  const { schoolId } = await params;
  const admin = await requireSchoolAdmin(schoolId);
  if (!admin) return NextResponse.json({ error: "School administrator access is required." }, { status: 403 });
  const invitations = await prisma.tenantInvitation.findMany({
    where: { schoolId, acceptedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: { id: true, invitedEmail: true, role: true, expiresAt: true, createdAt: true }
  });
  return NextResponse.json({ invitations }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request, { params }: Context) {
  const { schoolId } = await params;
  const admin = await requireSchoolAdmin(schoolId);
  if (!admin) return NextResponse.json({ error: "School administrator access is required." }, { status: 403 });
  const throttle = await checkAuthThrottle(request, `tenant-invitation:${admin.id}`, 5, undefined, "identity");
  if (!throttle.allowed) return NextResponse.json({ error: "Too many invitations sent. Try again in 15 minutes." }, { status: 429 });
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid email address and invitation role." }, { status: 400 });
  if (parsed.data.role === "SCHOOL_ADMIN" && !admin.isTenantManager) {
    return NextResponse.json({ error: "Only the platform administrator can appoint another school administrator." }, { status: 403 });
  }
  const email = parsed.data.email.toLowerCase();
  const school = await prisma.school.findUnique({ where: { id: schoolId }, select: { id: true, name: true } });
  if (!school) return NextResponse.json({ error: "School workspace not found." }, { status: 404 });
  if (await prisma.user.findFirst({ where: { schoolId, email: { equals: email, mode: "insensitive" } }, select: { id: true } })) {
    return NextResponse.json({ error: "This email already has an account in the school." }, { status: 409 });
  }
  const { token, tokenHash } = createTenantInvitationToken();
  const invitationUrl = tenantInvitationUrl(token, request.url);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const invitation = await prisma.$transaction(async tx => {
    await tx.tenantInvitation.deleteMany({
      where: { schoolId, invitedEmail: email, acceptedAt: null }
    });
    const created = await tx.tenantInvitation.create({
      data: {
        schoolId, invitedEmail: email, tokenHash, role: parsed.data.role,
        expiresAt, createdById: admin.id
      },
      select: { id: true, invitedEmail: true, role: true, expiresAt: true }
    });
    await tx.auditEvent.create({
      data: { actorId: admin.id, action: `invited ${parsed.data.role === "SCHOOL_ADMIN" ? "a school administrator" : "a teacher"}`, entity: "school-invitation", entityId: created.id }
    });
    return created;
  });

  let emailSent = false;
  try {
    await sendPortalEmail({
      to: email,
      subject: `Invitation to ${school.name} on SAGA`,
      text: `You have been invited to join ${school.name} on SAGA as ${parsed.data.role === "SCHOOL_ADMIN" ? "a school administrator" : "a teacher"}.\n\nCreate your teacher account using this invitation: ${invitationUrl}\n\nThe invitation expires in 7 days. If you did not expect this message, you can ignore it.`
    });
    emailSent = true;
  } catch (error) {
    console.error("SAGA_TENANT_INVITATION_EMAIL_FAILED", error instanceof Error ? error.message : "unknown");
  }
  return NextResponse.json({
    ok: true, invitation, emailSent,
    invitationUrl: emailSent ? undefined : invitationUrl
  }, { status: 201, headers: { "Cache-Control": "no-store" } });
}

const revokeSchema = z.object({ invitationId: z.string().min(1).max(100) });

export async function DELETE(request: Request, { params }: Context) {
  const { schoolId } = await params;
  const admin = await requireSchoolAdmin(schoolId);
  if (!admin) return NextResponse.json({ error: "School administrator access is required." }, { status: 403 });
  const parsed = revokeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose an invitation to revoke." }, { status: 400 });
  const revoked = await prisma.tenantInvitation.deleteMany({
    where: { id: parsed.data.invitationId, schoolId, acceptedAt: null }
  });
  if (!revoked.count) return NextResponse.json({ error: "That invitation is no longer pending." }, { status: 404 });
  await prisma.auditEvent.create({
    data: { actorId: admin.id, action: "revoked a school invitation", entity: "school-invitation", entityId: parsed.data.invitationId }
  });
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
