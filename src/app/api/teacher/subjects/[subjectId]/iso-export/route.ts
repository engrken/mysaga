import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { calculateCategoryPercent, calculateGradeBreakdown } from "@/lib/grades";

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
type Component = { name: string; percentage: number };

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
  affiliationLine1: "Member Association of Christian Schools, Colleges and Universities-Accrediting Council, Inc. (ACSCU-ACI)",
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

function descendantIds(categoryId: string, categories: CategoryLike[]) {
  const ids = new Set([categoryId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const category of categories) {
      if (category.parentId && ids.has(category.parentId) && !ids.has(category.id)) {
        ids.add(category.id);
        changed = true;
      }
    }
  }
  return ids;
}

function effectiveCategoryWeight(category: CategoryLike, categories: CategoryLike[]) {
  let root = category;
  const visited = new Set([category.id]);
  while (root.parentId) {
    if (visited.has(root.parentId)) return 0;
    visited.add(root.parentId);
    const parent = categories.find(item => item.id === root.parentId);
    if (!parent) return 0;
    root = parent;
  }
  return category.id === root.id ? root.weight : root.weight * category.weight / 100;
}

function calculationCategories(subject: any, enrollment: any) {
  const scoreByAssessment = new Map(
    enrollment.scores.map((score: any) => [score.assessmentId, score])
  );
  const itemsByCategory = new Map<string, any[]>();
  for (const assessment of subject.assessments) {
    const items = itemsByCategory.get(assessment.categoryId) ?? [];
    const score = scoreByAssessment.get(assessment.id);
    items.push({
      title: assessment.title,
      dueDate: assessment.dueDate,
      maxScore: assessment.maxScore,
      weight: assessment.weight,
      scores: score ? [score] : []
    });
    itemsByCategory.set(assessment.categoryId, items);
  }
  return subject.categories.map((category: CategoryLike) => ({
    id: category.id,
    parentId: category.parentId,
    weight: category.weight,
    conversionBase: category.conversionBase,
    assessments: itemsByCategory.get(category.id) ?? []
  }));
}

function componentPercent(subject: any, enrollment: any, componentRoot: CategoryLike) {
  if (componentRoot.name.toLocaleLowerCase().includes("attendance")) {
    const includedIds = descendantIds(componentRoot.id, subject.categories);
    const assessments = subject.assessments.filter((item: any) =>
      item.title.toLocaleLowerCase().startsWith("attendance ·") && includedIds.has(item.categoryId)
    );
    if (!assessments.length) return null;
    return calculateCategoryPercent({
      conversionBase: 100,
      assessments: assessments.map((item: any) => ({
        id: item.id,
        title: item.title,
        dueDate: item.dueDate,
        maxScore: item.maxScore,
        weight: item.weight,
        scores: [enrollment.scores.find((score: any) => score.assessmentId === item.id) || { points: null, remark: null }]
      }))
    });
  }

  const includedIds = descendantIds(componentRoot.id, subject.categories);
  const leaves = subject.categories.filter((category: CategoryLike) =>
    includedIds.has(category.id) && !subject.categories.some((child: CategoryLike) => child.parentId === category.id)
  );
  let weighted = 0;
  let totalWeight = 0;
  for (const category of leaves) {
    const assessments = subject.assessments.filter((item: any) =>
      item.categoryId === category.id && !item.title.toLocaleLowerCase().startsWith("attendance ·")
    );
    const percent = calculateCategoryPercent({
      conversionBase: componentRoot.conversionBase,
      assessments: assessments.map((item: any) => ({
        id: item.id,
        title: item.title,
        dueDate: item.dueDate,
        maxScore: item.maxScore,
        weight: item.weight,
        scores: [enrollment.scores.find((score: any) => score.assessmentId === item.id) || { points: null, remark: null }]
      }))
    });
    const weight = effectiveCategoryWeight(category, subject.categories);
    if (percent !== null && weight > 0) {
      weighted += percent * weight;
      totalWeight += weight;
    }
  }
  return totalWeight > 0 ? Number((weighted / totalWeight).toFixed(2)) : null;
}

function componentContribution(
  subject: any,
  enrollment: any,
  component: Component,
  breakdown: ReturnType<typeof calculateGradeBreakdown>
) {
  const root = subject.categories.find((category: CategoryLike) =>
    categoryPath(category, subject.categories).trim().toLocaleLowerCase() === component.name.trim().toLocaleLowerCase()
  );
  if (!root) return null;

  // Top-level course groups display their actual earned course contribution.
  if (!root.parentId) {
    const includedIds = descendantIds(root.id, subject.categories);
    const contributions = breakdown.items.filter(item => includedIds.has(item.categoryId));
    if (!contributions.some(item => item.earnedCourse !== null)) return null;
    return Number(contributions.reduce((sum, item) => sum + (item.earnedCourse ?? 0), 0).toFixed(2));
  }

  const percent = componentPercent(subject, enrollment, root);
  return percent === null ? null : Number((percent * component.percentage / 100).toFixed(2));
}

function readHeaderConfig(teacher: any) {
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
      organizationName: isFcu ? "FILAMER CHRISTIAN UNIVERSITY, INC." : teacher.school.name.toLocaleUpperCase(),
      organizationAddress: config.organizationAddress,
      formName: config.formName,
      formNo: config.formNo,
      effectivity: config.effectivity,
      issuingOffice: config.issuingOffice.replace(/[‘’]/g, "'"),
      revisionNo: config.revisionNo,
      eomsTitle: config.eomsTitle + " (" + config.isoStandard + ")",
      affiliationLine1: config.affiliationLine1,
      affiliationLine2: config.affiliationLine2,
      submittedBy: teacher.fullName,
      deanName: teacher.school.deanName || ""
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

  const rows: unknown[][] = subject.enrollments.map((enrollment, index) => {
    const calculation = calculationCategories(subject, enrollment);
    const breakdown = calculateGradeBreakdown(calculation);
    const special = ["INC", "NP", "DROPPED"].includes(enrollment.remarks || "");
    const scores = academicAssessments.map(item =>
      enrollment.scores.find(score => score.assessmentId === item.id)?.points ?? ""
    );
    const components = parsed.data.componentNames.map(name => {
      if (special) return "";
      return componentContribution(
        subject,
        enrollment,
        { name, percentage: subject.categories.find(category =>
          categoryPath(category, subject.categories).trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase()
        )?.weight ?? 0 },
        breakdown
      ) ?? "";
    });
    const band = subject.gradeBands.slice().sort((a, b) => b.minPercent - a.minPercent).find(item =>
      breakdown.totalPercent !== null && breakdown.totalPercent >= item.minPercent
    );
    const totalGrade = special || breakdown.totalPercent === null
      ? ""
      : Number(breakdown.totalPercent.toFixed(2));
    const finalGrade = special ? "" : enrollment.finalGradeOverride || band?.finalGrade || "";
    return [
      index + 1,
      enrollment.studentName || "",
      ...scores,
      ...components,
      totalGrade,
      finalGrade,
      enrollment.remarks || band?.remarks || ""
    ];
  });

  const logoBytes = Buffer.from(parsed.data.logoPngBase64, "base64");
  if (
    logoBytes.length < 8 ||
    logoBytes.length > 350_000 ||
    !logoBytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return NextResponse.json({ error: "The university seal/name image is invalid." }, { status: 400 });
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
      academicYear: subject.academicYear
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
