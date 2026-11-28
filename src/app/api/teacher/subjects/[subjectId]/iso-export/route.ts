import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { calculateCategoryPercent, calculateGradeBreakdown, normalizeRemark } from "@/lib/grades";

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
  logoPngBase64: z.string().min(8).max(500_000),
  components: z.array(z.object({
    name: z.string().trim().min(1).max(160),
    percentage: z.number().min(0).max(100)
  })).max(30).optional().default([])
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
  affiliationLine2: "Member: Association of Christian Schools, Colleges in Asia (ACUCA)",
  pageNo: "1"
};

function cleanComponentName(name: string) {
  const parts = name.split("/");
  return (parts.length > 1 ? parts[parts.length - 1] : name).trim().toUpperCase();
}
function domainHeaderName(name: string) {
  const clean = cleanComponentName(name);
  if (/^LECTURE\b|^LECT\./i.test(clean)) return "LECT.";
  if (/^LABORATORY\b|^LAB\b|^LAB\./i.test(clean)) return "LAB.";
  return clean;
}
function domainWeightLabel(weight: number) {
  return Number(weight.toFixed(2)).toFixed(2) + "%";
}

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
  const defaults = FCU_DEFAULTS;
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
      typeof saved[key] === "string" && saved[key].trim()
        ? saved[key]
        : defaults[key as keyof typeof defaults]
    ])
  ) as typeof defaults;
  const affiliations = Array.isArray(saved.accreditationAffiliations)
    ? saved.accreditationAffiliations.filter((value): value is string => typeof value === "string").map(value => value.trim()).filter(Boolean).slice(0, 10)
    : [saved.affiliationLine1, saved.affiliationLine2].filter((value): value is string => typeof value === "string" && Boolean(value.trim()));
  const normalizedAffiliations = affiliations.length ? affiliations : [defaults.affiliationLine1, defaults.affiliationLine2];
  return {
    header: {
      organizationName: teacher.school.name.toLocaleUpperCase(),
      organizationAddress: config.organizationAddress || teacher.school.address?.trim() || FCU_DEFAULTS.organizationAddress,
      formName: config.formName,
      formNo: config.formNo,
      effectivity: config.effectivity,
      issuingOffice: config.issuingOffice.replace(/[‘’]/g, "'"),
      revisionNo: config.revisionNo,
      eomsTitle: config.eomsTitle + "\n" + config.isoStandard,
      affiliationLine1: normalizedAffiliations[0] || "",
      affiliationLine2: normalizedAffiliations[1] || "",
      accreditationAffiliations: normalizedAffiliations,
      pageNo: config.pageNo,
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

  const rootDomains = subject.categories.filter(category => !category.parentId)
    .slice().sort((a, b) => a.sortOrder - b.sortOrder);
  const selectedComponents = parsed.data.components.filter(component =>
    !parsed.data.components.some(other => other.name.toLocaleLowerCase() === component.name.toLocaleLowerCase() && other !== component)
  ).map(component => {
    const category = subject.categories.find(item =>
      categoryPath(item, subject.categories).trim().toLocaleLowerCase() === component.name.trim().toLocaleLowerCase()
    );
    return category?.parentId ? { ...component, category } : null;
  }).filter((item): item is NonNullable<typeof item> => item !== null);
  if (selectedComponents.length !== parsed.data.components.length) {
    return NextResponse.json({ error: "One or more selected export components are no longer available in this class." }, { status: 400 });
  }
  const componentValues = selectedComponents.map(component => ({
    ...component,
    title: cleanComponentName(component.name)
  }));
  const pairedColumnCount = rootDomains.length + componentValues.length;
  const totalColumn = 3 + pairedColumnCount * 2;
  const headers = [
    "NO.",
    "NAME OF STUDENTS",
    ...rootDomains.flatMap(domain => ["EQ", domainWeightLabel(domain.weight)]),
    ...componentValues.flatMap(component => ["EQ", domainWeightLabel(component.percentage)]),
    "TG", "FG", "REMARKS"
  ];
  const headerGroups = [
    ...rootDomains.map((domain, index) => ({
      startColumn: 3 + index * 2,
      endColumn: 4 + index * 2,
      title: domainHeaderName(domain.name) + " " + domainWeightLabel(domain.weight)
    })),
    ...componentValues.map((component, index) => ({
      startColumn: 3 + (rootDomains.length + index) * 2,
      endColumn: 4 + (rootDomains.length + index) * 2,
      title: component.title + " " + domainWeightLabel(component.percentage)
    }))
  ];
  const rowSpanColumns = [1, 2, totalColumn, totalColumn + 1, totalColumn + 2];
  const numericColumns = Array.from({ length: pairedColumnCount * 2 }, (_, index) => 3 + index)
    .concat([totalColumn]);

  const groupedAssessments = new Map<string, typeof subject.assessments>();
  for (const assessment of subject.assessments) {
    const items = groupedAssessments.get(assessment.categoryId) ?? [];
    items.push(assessment);
    groupedAssessments.set(assessment.categoryId, items);
  }
  const gradeBands = subject.gradeBands.slice().sort((a, b) => b.minPercent - a.minPercent);
  const effectiveWeight = (category: CategoryLike) => {
    let root = category;
    const visited = new Set([category.id]);
    while (root.parentId) {
      if (visited.has(root.parentId)) return 0;
      visited.add(root.parentId);
      const parent = subject.categories.find(item => item.id === root.parentId);
      if (!parent) return 0;
      root = parent;
    }
    return category.id === root.id ? root.weight : root.weight * category.weight / 100;
  };
  const componentPercent = (category: CategoryLike, enrollment: typeof subject.enrollments[number]) => {
    const descendantLeaves = subject.categories.filter(candidate => {
      let current: CategoryLike | undefined = candidate;
      const visited = new Set<string>();
      while (current && current.id !== category.id && current.parentId && !visited.has(current.id)) {
        visited.add(current.id);
        current = subject.categories.find(item => item.id === current?.parentId);
      }
      return current?.id === category.id && !subject.categories.some(item => item.parentId === candidate.id);
    });
    const attendance = category.name.toLocaleLowerCase().includes("attendance");
    let weighted = 0;
    let totalWeight = 0;
    for (const leaf of descendantLeaves) {
      const items = subject.assessments.filter(item =>
        item.categoryId === leaf.id && (attendance
          ? item.title.toLocaleLowerCase().startsWith("attendance ·")
          : !item.title.toLocaleLowerCase().startsWith("attendance ·"))
      );
      const percent = calculateCategoryPercent({
        conversionBase: attendance ? 100 : category.conversionBase,
        assessments: items.map(item => ({
          title: item.title,
          dueDate: item.dueDate,
          maxScore: item.maxScore,
          weight: item.weight,
          scores: [enrollment.scores.find(score => score.assessmentId === item.id) ?? { points: null, remark: null }]
        }))
      });
      const weight = effectiveWeight(leaf);
      if (percent !== null && weight > 0) {
        weighted += percent * weight;
        totalWeight += weight;
      }
    }
    return totalWeight > 0 ? Number((weighted / totalWeight).toFixed(2)) : null;
  };
  const rows: unknown[][] = subject.enrollments.map((enrollment, index) => {
    const breakdown = calculateGradeBreakdown(subject.categories.map(category => ({
      id: category.id,
      parentId: category.parentId,
      weight: category.weight,
      conversionBase: category.conversionBase,
      assessments: (groupedAssessments.get(category.id) ?? []).map(assessment => {
        const score = enrollment.scores.find(value => value.assessmentId === assessment.id);
        return {
          title: assessment.title,
          dueDate: assessment.dueDate,
          maxScore: assessment.maxScore,
          weight: assessment.weight,
          scores: score ? [score] : []
        };
      })
    })));
    const domainById = new Map(breakdown.domains.map(item => [item.categoryId, item]));
    const rootValues = rootDomains.flatMap(domain => {
      const summary = domainById.get(domain.id);
      return [summary?.rawEquivalentPercent ?? null, summary?.parentWeightedScore ?? null];
    });
    const extraValues = componentValues.flatMap(component => {
      const percent = componentPercent(component.category, enrollment);
      return [percent, percent === null ? null : Number((percent * component.percentage / 100).toFixed(2))];
    });
    const domainValues = [...rootValues, ...extraValues];
    const shares = rootValues.filter((_, columnIndex) => columnIndex % 2 === 1)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    const total = shares.length ? Number(shares.reduce((sum, value) => sum + value, 0).toFixed(2)) : null;
    const band = gradeBands.find(item => total !== null && total >= item.minPercent);
    const remark = normalizeRemark(enrollment.remarks?.trim() ? enrollment.remarks : band?.remarks);
    const dropped = remark === "DROPPED";
    return [
      index + 1,
      enrollment.studentName || "",
      ...domainValues.map(value => dropped || value === null ? "" : value),
      dropped || total === null ? "" : total,
      dropped ? "" : enrollment.finalGradeOverride ?? band?.finalGrade ?? "",
      remark
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
    headerGroups,
    rowSpanColumns,
    numericColumns,
    pageNo: configuredHeader.header.pageNo,
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
