import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { todayManila } from "@/lib/tenant-operations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function dayAfter(date: Date) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

function cognixEndpoint() {
  const raw = process.env.COGNIX_API_URL?.trim();
  const token = process.env.COGNIX_API_KEY?.trim();
  if (!raw || !token) return null;

  try {
    const base = new URL(raw);
    if (base.protocol !== "https:" || base.username || base.password) return null;
    base.pathname = "/api/v1/agent";
    base.search = "";
    base.hash = "";
    return { url: base.toString(), token };
  } catch {
    return null;
  }
}

/**
 * Sends only teacher-scoped aggregate counts to COGNIX.
 * No student-level records, grades, attendance marks, or write operations.
 */
export async function POST() {
  const teacher = await requireRole("TEACHER");
  if (!teacher || teacher.isDemo) {
    return NextResponse.json(
      { error: "unauthorized", message: "An active, non-demo teacher session is required." },
      { status: 401 },
    );
  }

  const endpoint = cognixEndpoint();
  if (!endpoint) {
    return NextResponse.json(
      { error: "not_configured", message: "The COGNIX connection is not configured." },
      { status: 503 },
    );
  }

  try {
    const today = new Date(`${todayManila()}T00:00:00.000Z`);
    const end = new Date(today);
    end.setUTCDate(end.getUTCDate() + 7);

    const subjects = await prisma.subject.findMany({
      where: { teacherId: teacher.id, schoolId: teacher.schoolId },
      select: {
        gradeStatus: true,
        _count: {
          select: {
            enrollments: true,
            assessments: {
              where: { dueDate: { gte: today, lt: end } },
            },
          },
        },
      },
    });

    const summary = {
      reportingPeriod: {
        start: today.toISOString().slice(0, 10),
        endExclusive: end.toISOString().slice(0, 10),
        timezone: "Asia/Manila",
      },
      totals: {
        assignedSubjects: subjects.length,
        enrollmentRecords: subjects.reduce((sum, item) => sum + item._count.enrollments, 0),
        assessmentsDueWithinSevenDays: subjects.reduce((sum, item) => sum + item._count.assessments, 0),
        gradeWorkflow: {
          draftSubjects: subjects.filter((item) => item.gradeStatus === "DRAFT").length,
          submittedSubjects: subjects.filter((item) => item.gradeStatus === "SUBMITTED").length,
          verifiedSubjects: subjects.filter((item) => item.gradeStatus === "VERIFIED").length,
        },
      },
    };

    const response = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${endpoint.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        app: "saga",
        task: "Provide a concise teacher-facing overview using only these aggregate counts. Explain that enrollment records may include the same learner in multiple subjects. Do not infer individual student performance, invent causes, or recommend changing grades.",
        context: summary,
        requestId: `saga-${randomUUID()}`,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });

    const result = await response.json().catch(() => null);
    if (!response.ok) {
      return NextResponse.json(
        {
          error: typeof result?.error === "string" ? result.error : "cognix_unavailable",
          message: "COGNIX could not complete this request. No SAGA records were changed.",
        },
        { status: response.status === 503 ? 503 : 502 },
      );
    }

    return NextResponse.json(result, { status: 200 });
  } catch {
    return NextResponse.json(
      { error: "integration_error", message: "The COGNIX request failed. No SAGA records were changed." },
      { status: 502 },
    );
  }
}
