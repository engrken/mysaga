import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSchoolAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Context = { params: Promise<{ schoolId: string }> };

const settingsSchema = z.object({
  name: z.string().trim().min(2).max(160),
  shortName: z.string().trim().min(1).max(24),
  portalTitle: z.string().trim().min(2).max(80),
  logoText: z.string().trim().min(1).max(8),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  privacyController: z.string().trim().max(160).nullable(),
  privacyContactEmail: z.union([z.string().trim().email().max(200), z.literal("")]).nullable(),
  privacyPolicyUrl: z.union([z.string().trim().url().max(500), z.literal("")]).nullable(),
  billingEmail: z.union([z.string().trim().email().max(200), z.literal("")]).nullable()
});

export async function GET(_request: Request, { params }: Context) {
  const { schoolId } = await params;
  const admin = await requireSchoolAdmin(schoolId);
  if (!admin) return NextResponse.json({ error: "School administrator access is required." }, { status: 403 });
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: {
      id: true, name: true, shortName: true, slug: true, portalTitle: true, logoText: true,
      primaryColor: true, privacyController: true, privacyContactEmail: true,
      privacyPolicyUrl: true, billingEmail: true, plan: true, subscriptionStatus: true,
      subscriptionExpiresAt: true
    }
  });
  if (!school) return NextResponse.json({ error: "School workspace not found." }, { status: 404 });
  return NextResponse.json({ school }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PATCH(request: Request, { params }: Context) {
  const { schoolId } = await params;
  const admin = await requireSchoolAdmin(schoolId);
  if (!admin) return NextResponse.json({ error: "School administrator access is required." }, { status: 403 });
  const parsed = settingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Review the school name, branding, and contact details." }, { status: 400 });
  const input = parsed.data;
  const name = input.name.replace(/\s+/g, " ");
  const shortName = input.shortName.replace(/\s+/g, " ");
  const duplicate = await prisma.school.findFirst({
    where: { id: { not: schoolId }, name: { equals: name, mode: "insensitive" } },
    select: { id: true }
  });
  if (duplicate) return NextResponse.json({ error: "Another school already uses this name." }, { status: 409 });

  const school = await prisma.$transaction(async tx => {
    const updated = await tx.school.update({
      where: { id: schoolId },
      data: {
        name, shortName, portalTitle: input.portalTitle.trim(), logoText: input.logoText.trim(),
        primaryColor: input.primaryColor.toLowerCase(),
        privacyController: input.privacyController?.trim() || null,
        privacyContactEmail: input.privacyContactEmail?.trim().toLowerCase() || null,
        privacyPolicyUrl: input.privacyPolicyUrl?.trim() || null,
        billingEmail: input.billingEmail?.trim().toLowerCase() || null
      },
      select: {
        id: true, name: true, shortName: true, slug: true, portalTitle: true, logoText: true,
        primaryColor: true, privacyController: true, privacyContactEmail: true,
        privacyPolicyUrl: true, billingEmail: true, updatedAt: true
      }
    });
    await tx.auditEvent.create({
      data: { actorId: admin.id, action: "updated school workspace profile and privacy contacts", entity: "school", entityId: schoolId }
    });
    return updated;
  });
  return NextResponse.json({ ok: true, school }, { headers: { "Cache-Control": "private, no-store" } });
}
