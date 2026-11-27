import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getR2PrivateDownloadPath } from "@/lib/r2";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const student = await requireRole("STUDENT");
  if (!student) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const query = new URL(request.url).searchParams;
  const academicYear = query.get("academicYear")?.trim();
  const term = query.get("term")?.trim();
  const resources = await prisma.classResource.findMany({
    where: {
      archivedAt: null,
      retentionDeletedAt: null,
      subject: {
        schoolId: student.schoolId,
        ...(academicYear ? { academicYear } : {}),
        ...(term ? { term } : {}),
        enrollments: { some: { studentUserId: student.id } }
      }
    },
    include: {
      subject: {
        select: {
          id: true, code: true, classId: true, title: true, term: true, academicYear: true,
          teacher: { select: { fullName: true } }
        }
      }
    },
    orderBy: [{ publishedAt: "desc" }],
    take: 250
  });
  return NextResponse.json({
    resources: resources.map(resource => ({
      ...resource,
      fileSize: Number(resource.fileSize),
      fileUrl: resource.storageProvider === "CLOUDFLARE_R2" && resource.fileKey
        ? getR2PrivateDownloadPath(resource.fileKey) : resource.fileUrl
    }))
  }, { headers: { "Cache-Control": "priva¶»§q«^