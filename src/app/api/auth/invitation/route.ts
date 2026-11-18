import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { tenantInvitationDigest } from "@/lib/tenant-invitations";

const querySchema = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) });

export async function GET(request: Request) {
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: "This invitation link is invalid or expired." }, { status: 400 });
  const invitation = await prisma.tenantInvitation.findUnique({
    where: { tokenHash: tenantInvitationDigest(parsed.data.token) },
    select: {
      invitedEmail: true, role: true, expiresAt: true, acceptedAt: true,
      school: { select: { id: true, name: true, isActive: true } }
    }
  });
  if (!invitation || invitation.acceptedAt || invitation.expiresAt <= new Date() || !invitation.school.isActive) {
    return NextResponse.json({ error: "This invitation link is invalid or expired." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json({
    email: invitation.invitedEmail,
    role: invitation.role,
    school: { id: invitation.school.id, name: invitation.school.name }
  }, { headers: { "Cache-Control": "no-store" } });
}
