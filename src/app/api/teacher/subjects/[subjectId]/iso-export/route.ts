import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const maxDuration = 60;

type Context = { params: Promise<{ subjectId: string }> };
type CategoryLike = {
  id: string;
  parentId: string | null;
  name: string;
  weight: number;
  conversionBase: number;
};

const requestSchema = z.object({
  componentNames: z.array(z.string().trim().min(1).max(120)).max(40),
  logoPngBase64: z.string().min(8).max(500_000)
});

const FCU_DEFAULTS = {
  organizationAddress: "Roxas Avenue, Roxas City, Capiz, Philippines",
  formName: "COLLEGIATE GRADING SHEET",
  formNo: "FCU-EOMS-RO-006-F",
  effectivity: "October 1, 2025",
  issuingOffice: "REGISTRAR’S OFFICE",
  revisionNo: "1",
  eomsTitle: "EDUCATIONAL ORGANIZATION MANAGEMENT SYSTEM",
  isoStandard: "ISO 21001:2025",
  affiliationLine1: "Member: Association of Christian Schools, Colleges and Universities-Accrediting Council, Inc. (ACSCU-ACI)",
  affiliationLine2: "Member: Association of Christian Schools, Colleges in Asia (ACUCA)"
};

function categoryPath(category: CategoryLike, categories: CategoryLike[]) {
  const names = [category.name];
  const visited = new Set([category.id]);
  let parent = categories.find(item => item.id === category.parentId);
  while (parent && !visited.has(parent.id)) {
    names.unshift(parent.name);
    visited.add(parent.id);
    parent = categories.find(item => item.id === parent?.parentId);
  }
  return names.join(" / ");
}

function normalizeSignatureName(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLocaleUpperCase();
}

function resolveClassId(subject: any) {
  const classId = String(subject.classId ?? "").trim();
  if (!classId || /^migration[_-]\d{4}[_-]/i.test(classId)) return "";
  return classId;
}

function readHeaderConfig(teacher: any) {
  const teacherPosition = String(teacher.positionTitle ?? "").trim().replace(/\s+/g, " ");
  const notedByName = normalizeSignatureName(teacher.notedByName);
  const notedByPosition = String(teacher.notedByPosition ?? "").trim().replace(/\s+/g, " ");
  if (!String(teacher.fullName ?? "").trim() || !teacherPosition || !notedByName || !notedByPosition) {
    return { error: "Complete all signatory details in your Profile Information before exporting." } as const;
  }
  const isFcu = /filamer christian university/i.test(teacher.school.name) ||
    teacher.school.slug.toLocaleLowerCase() === "fcu";
  const defaults = isFcu ? FCU_DEFAULTS : {
    organizationAddress: "", formName: "", formNo: "", effectivity: "",
    issuingOffice: "", revisionNo: "", eomsTitle: "", isoStandard: "",
    affiliationLine1: "", affiliationLine2: ""
  };
  let saved: Record<string, unknown> = {};
  try {
    const value = JSON.parse(teacher.school.isoHeaderConfig || "{}");
    if (value && typeof value === "object" && !Array.isArray(value)) saved = value;
  } catch {
    saved = {};
  }
  const config = Object.fromEntries(
    Object.keys(defaults).map(key => [
      key,
      typeof saved[key] === "string" ? saved[key] : defaults[key as keyof typeof defaults]
    ])
  ) as typeof defaults;
  if (Object.values(config).some(value => !value.trim())) {
    return { error: "Complete all ISO document-control fields in Profile information before exporting." } as const;
  }
  return {
    header: {
      organizationName: teacher.school.name.toLocaleUpperCase(),
      organizationAddress: teacher.school.address?.trim() || config.organizationAddress,
      formName: config.formName,
      formNo: config.formNo,
      effectivity: config.effectivity,
      issuingOffice: config.issuingOffice.replace(/[‘’]/g, "'"),
      revisionNo: config.revisionNo,
      eomsTitle: config.eomsTitle + "\n" + config.isoStandard,
      affiliationLine1: config.affiliationLine1,
      affiliationLine2: config.affiliationLine2,
      submittedBy: normalizeSignatureName(teacher.fullName),
      teacherPosition,
      notedByName,
      notedByPosition
    }
  } as const;
}

export async function POST(request: Request, context: Context) {
  const teacher = await requireRole("TEACHER");
  if (!teacher) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 600_000) {
    return NextResponse.json({ error: "The export request is too large." }, { status: 413 });
  }
  const input = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid ISO workbook request." }, { status: 400 });
  }

  const { subjectId } = await context.params;
  const subject = await prisma.subject.findFirst({
    where: { id: subjectId, teacherId: teacher.id, schoolId: teacher.schoolId },
    include: {
      categories: { orderBy: { sortOrder: "asc" } },
      gradeBands: { orderBy: { sortOrder: "asc" } },
      assessments: { orderBy: [{ categoryId: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }] },
      enrollments: {
        orderBy: { studentName: "asc" },
        include: { scores: { select: { assessmentId: true, points: true, remark: true } } }
      }
    }
  });
  if (!subject) return NextResponse.json({ error: "Subject not found." }, { status: 404 });

  const configuredHeader = readHeaderConfig(teacher);
  if ("error" in configuredHeader) {
    return NextResponse.json({ error: configuredHeader.error }, { status: 409 });
  }

  const academicAssessments = subject.assessments.filter(item =>
    !item.title.toLocaleLowerCase().startsWith("attendance ·")
  );
  const assessmentHeaders = academicAssessments.map(item => {
    const category = subject.categories.find(value => value.id === item.categoryId);
    return (category ? categoryPath(category, subject.categories) + " · " : "") +
      item.title + " (Max " + item.maxScore + ")";
  });
  const headers = [
    "NO.",
    "NAME OF STUDENTS",
    ...assessmentHeaders,
    ...parsed.data.componentNames.map(name => name + " (%)"),
    "TOTAL GRADE (%)",
    "FINAL GRADE",
    "REMARKS"
  ];

  // Export persisted score records as-is. No exporter-side grade calculations.
  const rows: unknown[][] = subject.enrollments.map((enrollment, index) => {
    const scores = academicAssessments.map(item => {
      const score = enrollment.scores.find(value => value.assessmentId === item.id);
      return score?.points ?? score?.remark ?? "";
    });
    return [
      index + 1,
      enrollment.studentName || "",
      ...scores,
      ...parsed.data.componentNames.map(() => ""),
      "",
      enrollment.finalGradeOverride ?? "",
      enrollment.remarks ?? ""
    ];
  });

  const logoBytes = Buffer.from(parsed.data.logoPngBase64, "base64");
  if (
    logoBytes.length < 8 ||
    logoBytes.length > 350_000 ||
    !logoBytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return NextResponse.json({ error: "The circular university seal image is invalid." }, { status: 400 });
  }

  const filename = subject.code.replace(/[^a-z0-9-_]+/gi, "-") + "-iso-grading-sheet.xlsx";
  const payload = {
    filename,
    sheetName: "ISO Grading Sheet",
    header: configuredHeader.header,
    class: {
      courseCode: subject.code,
      courseTitle: subject.title,
      id: subject.id,
      semester: subject.term,
      academicYear: subject.academicYear,
      classId: resolveClassId(subject),
    },
    headers,
    rows,
    logoPngBase64: parsed.data.logoPngBase64
  };
  const body = JSON.stringify(payload);
  const secret = process.env.AUTH_SECRET || "";
  if (secret.length < 32) {
    return NextResponse.json({ error: "The export service is not configured." }, { status: 503 });
  }
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", secret)
    .update("SAGA-ISO-EXPORT-v1\n" + timestamp + "\n" + body)
    .digest("hex");

  // Production deployment URLs may require Vercel Authentication when called
  // server-to-server. Use the stable production alias in production so this
  // internal call does not hit the protected deployment-specific hostname.
  // Preview deployments keep their own deployment URL (and optional bypass).
  const configuredFunctionUrl = process.env.ISO_EXPORT_FUNCTION_URL?.trim();
  const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  const deploymentHost = process.env.VERCEL_URL?.trim();
  const functionHost = process.env.VERCEL_ENV === "production"
    ? productionHost || deploymentHost
    : deploymentHost || productionHost;
  const baseUrl = configuredFunctionUrl ||
    (functionHost ? "https://" + functionHost + "/api/iso_export" : "");
  if (!baseUrl) {
    return NextResponse.json({ error: "The Python XLSX function is available after deployment to Vercel." }, { status: 503 });
  }

  try {
    const headersForPython: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Saga-Iso-Timestamp": timestamp,
      "X-Saga-Iso-Signature": signature
    };
    if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
      headersForPython["x-vercel-protection-bypass"] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    }
    const pythonResponse = await fetch(baseUrl, {
      method: "POST",
      headers: headersForPython,
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(45_000)
    });
    if (!pythonResponse.ok) {
      const responseText = await pythonResponse.text();
      let message = "The Python Excel generator returned HTTP " + pythonResponse.status + ".";
      try {
        const responseBody = JSON.parse(responseText);
        if (typeof responseBody.error === "string") message = responseBody.error;
      } catch {
        // Do not return HTML deployment-protection pages or raw server traces.
      }
      return NextResponse.json({ error: message }, { status: 502 });
    }
    const workbookBytes = await pythonResponse.arrayBuffer();
    return new Response(workbookBytes, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="' + filename + '"',
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    console.error("ISO openpyxl export failed:", error);
    return NextResponse.json({ error: "Unable to generate the ISO Excel sheet. Please try again." }, { status: 502 });
  }
}
