import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normalizeFacultyId } from "@/lib/account-identifiers";

const schema = z.object({
  fullName: z.string().trim().min(2).max(120),
  facultyId: z.string().trim().max(40).optional(),
  schoolAddress: z.string().trim().max(300).optional(),
  departmentName: z.string().trim().max(160).optional(),
  deanName: z.string().trim().max(120).optional(),
  isoHeaderConfig: z.object({
    organizationAddress: z.string().trim().max(300),
    formName: z.string().trim().max(120),
    formNo: z.string().trim().max(80),
    effectivity: z.string().trim().max(80),
    issuingOffice: z.string().trim().max(120),
    revisionNo: z.string().trim().max(40),
    eomsTitle: z.string().trim().max(160),
    isoStandard: z.string().trim().max(80),
    affiliationLine1: z.string().trim().max(240),
    affiliationLine2: z.string().trim().max(240)
  }).optional(),
  defaultGradeSheetComponents: z.array(z.object({ name: z.string().trim().min(1).max(40), percentage: z.number().min(0).max(100) })).min(1).max(30).optional()
});

export async function PATCH(request: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid full name and Faculty ID." }, { status: 400 });
  if (parsed.data.defaultGradeSheetComponents && new Set(parsed.data.defaultGradeSheetComponents.map(item => item.name.toLocaleLowerCase())).size !== parsed.data.defaultGradeSheetComponents.length) return NextResponse.json({ error: "Default grading categories must be unique." }, { status: 400 });

  if ((parsed.data.facultyId !== undefined || parsed.data.schoolAddress !== undefined || parsed.data.departmentName !== undefined || parsed.data.deanName !== undefined || parsed.data.isoHeaderConfig !== undefined || parsed.data.defaultGradeSheetComponents !== undefined) && user.role !== "TEACHER") {
    return NextResponse.json({ error: "Only faculty accounts can edit faculty and school letterhead details." }, { status: 403 });
  }
  const facultyId = parsed.data.facultyId === undefined
    ? undefined : normalizeFacultyId(parsed.data.facultyId);
  if (parsed.data.facultyId !== undefined && !facultyId) {
    return NextResponse.json({
      error: "Faculty ID must contain 3–40 letters, numbers, hyphens, periods, underscores, or slashes."
    }, { status: 400 });
  }
  if (parsed.data.defaultGradeSheetComponents) {
    const components = parsed.data.defaultGradeSheetComponents;
    const total = components.reduce((sum, item) => sum + item.percentage, 0);
    const names = components.map(item => item.name.toLocaleLowerCase());
    if (Math.abs(total - 100) > 0.01 || new Set(names).size !== names.length) {
      return NextResponse.json({ error: "Default component names must be unique and their percentages must total 100%." }, { status: 400 });
    }
  }
  const changedFacultyId = facultyId !== undefined && facultyId !== user.facultyId;

  try {
    const updated = await prisma.$transaction(async tx => {
      const result = await tx.user.updateMany({
        where: { id: user.id, schoolId: user.schoolId },
        data: {
          fullName: parsed.data.fullName,
          ...(facultyId !== undefined ? { facultyId } : {})
        }
      });
      if (result.count && changedFacultyId) await tx.auditEvent.create({
        data: {
          actorId: user.id,
          action: "updated Faculty ID",
          entity: "user",
          entityId: user.id
        }
      });
      if (result.count && parsed.data.defaultGradeSheetComponents !== undefined) await tx.user.update({ where: { id: user.id }, data: { defaultGradeSheetComponents: JSON.stringify(parsed.data.defaultGradeSheetComponents) } });
      if (result.count && (parsed.data.schoolAddress !== undefined || parsed.data.departmentName !== undefined || parsed.data.deanName !== undefined || parsed.data.isoHeaderConfig !== undefined)) await tx.school.update({
        where: { id: user.schoolId },
        data: {
          ...(parsed.data.schoolAddress !== undefined ? { address: parsed.data.schoolAddress || null } : {}),
          ...(parsed.data.departmentName !== undefined ? { departmentName: parsed.data.departmentName || null } : {}),
          ...(parsed.data.deanName !== undefined ? { deanName: parsed.data.deanName || null } : {}),
          ...(parsed.data.isoHeaderConfig !== undefined ? { isoHeaderConfig: JSON.stringify(parsed.data.isoHeaderConfig) } : {})
        }
      });
      return result;
    });
    if (!updated.count) return NextResponse.json({ error: "Profile not found." }, { status: 404 });
    return NextResponse.json({ ok: true, facultyId: facultyId ?? user.facultyId });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return NextResponse.json({
        error: "This Faculty ID is already in use by another teacher at your school."
      }, { status: 409 });
    }
    return NextResponse.json({ error: "Unable to update your profile. Please try again." }, { status: 500 });
  }
}
