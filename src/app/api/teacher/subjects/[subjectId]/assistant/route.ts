import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { checkAuthThrottle } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";
import { todayManila } from "@/lib/tenant-operations";
import {
  classifyAssistantMessage,
  getStaticHelpAnswer,
} from "@/lib/virtual-assistant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
};

const schema = z.object({
  message: z.string().trim().min(2).max(800),
}).strict();

type RouteContext = { params: Promise<{ subjectId: string }> };

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

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeZone: "Asia/Manila",
  }).format(value);
}

function gradeStatusLabel(status: string) {
  if (status === "VERIFIED") return "Verified to Registrar · Final";
  if (status === "SUBMITTED") return "Submitted · Awaiting verification";
  return "Draft · Not submitted";
}

async function systemHelp(topic: Parameters<typeof getStaticHelpAnswer>[0], requestId: string) {
  const fallback = getStaticHelpAnswer(topic);
  const endpoint = cognixEndpoint();
  if (!endpoint) return { answer: fallback, fallback: true };

  try {
    const response = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${endpoint.token}`,
        "Content-Type": "application/json",
      },
      // Only a fixed help-topic identifier crosses the SAGA/COGNIX boundary.
      // The teacher's message, subject ID, workspace context, and academic
      // records are intentionally excluded.
      body: JSON.stringify({
        apiVersion: "1",
        app: "saga",
        task: "system-help",
        requestId,
        input: { topic },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });

    const result = await response.json().catch(() => null);
    if (!response.ok || typeof result?.answer !== "string" || !result.answer.trim()) {
      return { answer: fallback, fallback: true };
    }
    return { answer: result.answer.trim(), fallback: false };
  } catch {
    return { answer: fallback, fallback: true };
  }
}

/**
 * The route is read-only. It authenticates the teacher and resolves exactly
 * one subject with teacher + school ownership predicates. Only class-level
 * aggregates and non-personal activity/assessment metadata are selected.
 */
export async function POST(request: Request, context: RouteContext) {
  const teacher = await requireRole("TEACHER");
  if (!teacher || teacher.isDemo) {
    return NextResponse.json(
      { error: "unauthorized", message: "An active, non-demo teacher session is required." },
      { status: 401, headers },
    );
  }

  const { subjectId } = await context.params;
  if (!subjectId || subjectId.length > 160) {
    return NextResponse.json(
      { error: "invalid_class", message: "Open a class workspace before using the assistant." },
      { status: 400, headers },
    );
  }

  const throttle = await checkAuthThrottle(
    request,
    `saga-virtual-assistant:${teacher.id}`,
    20,
    60 * 60 * 1_000,
    "identity",
  );
  if (!throttle.allowed) {
    return NextResponse.json(
      { error: "rate_limited", message: "The SAGA Virtual Assistant is limited to 20 messages per hour. Please try again later." },
      { status: 429, headers },
    );
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 4_000) {
    return NextResponse.json(
      { error: "payload_too_large", message: "The message is too large." },
      { status: 413, headers },
    );
  }

  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 4_000) {
      return NextResponse.json(
        { error: "payload_too_large", message: "The message is too large." },
        { status: 413, headers },
      );
    }
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json(
      { error: "invalid_json", message: "Provide a valid assistant message." },
      { status: 400, headers },
    );
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", message: "Enter a question about this class workspace or how to use SAGA." },
      { status: 400, headers },
    );
  }

  const intent = classifyAssistantMessage(parsed.data.message);
  const subject = await prisma.subject.findFirst({
    where: {
      id: subjectId,
      teacherId: teacher.id,
      schoolId: teacher.schoolId,
    },
    select: {
      id: true,
      code: true,
      classId: true,
      title: true,
      term: true,
      academicYear: true,
      courseYear: true,
      schedule: true,
      isPublished: true,
      gradeStatus: true,
      _count: {
        select: {
          enrollments: true,
          activities: true,
        },
      },
    },
  });

  if (!subject) {
    return NextResponse.json(
      { error: "class_not_found", message: "This class is not available in your current teacher and school workspace." },
      { status: 404, headers },
    );
  }

  if (intent.kind === "individual-record") {
    return NextResponse.json({
      apiVersion: "1",
      status: "completed",
      source: "saga-workspace",
      answer: "I can help with class-level summaries, but I do not display individual student names, IDs, grades, scores, remarks, or attendance marks in chat. Open Class roster, Record scores, Attendance, or Final grades & submit inside this class workspace to view the authorized student-level records. Those records remain inside SAGA and are never sent to COGNIX.",
    }, { headers });
  }

  if (intent.kind === "system-help") {
    const requestId = `saga-help-${randomUUID()}`;
    const result = await systemHelp(intent.topic, requestId);
    return NextResponse.json({
      apiVersion: "1",
      status: "completed",
      source: result.fallback ? "saga-help-library" : "cognix-system-help",
      answer: result.answer,
      warnings: result.fallback
        ? ["COGNIX system guidance was unavailable, so SAGA used its built-in help instructions."]
        : ["Only a fixed SAGA help-topic code was sent to COGNIX. Your message and class data were not sent."],
    }, { headers });
  }

  if (intent.kind === "unknown") {
    return NextResponse.json({
      apiVersion: "1",
      status: "completed",
      source: "saga-help-library",
      answer: "I can help with this active class workspace or explain how to use SAGA. Try asking for a class overview, enrollment count, upcoming assessments, grade-sheet status, attendance-session count, activity summary, or instructions for the roster, grading setup, score entry, attendance, activities, and grade submission.",
    }, { headers });
  }

  const windowStart = new Date(todayManila() + "T00:00:00+08:00");
  const windowEnd = new Date(windowStart);
  windowEnd.setUTCDate(windowEnd.getUTCDate() + 7);
  const dateWindow = `${formatDate(windowStart)} – ${formatDate(new Date(windowEnd.getTime() - 86_400_000))}`;

  let answer = "";
  if (intent.intent === "enrollment-count") {
    const count = subject._count.enrollments;
    answer = `There ${count === 1 ? "is" : "are"} ${count} ${count === 1 ? "student" : "students"} enrolled in ${subject.code} · ${subject.title}. This is a class-level count; no student names or identifiers were loaded.`;
  } else if (intent.intent === "assessment-count") {
    const count = await prisma.assessment.count({
      where: {
        subjectId: subject.id,
        NOT: { title: { startsWith: "Attendance ·", mode: "insensitive" } },
      },
    });
    answer = `This class has ${count} ${count === 1 ? "assessment item" : "assessment items"} configured, excluding attendance sessions.`;
  } else if (intent.intent === "upcoming-assessments") {
    const upcoming = await prisma.assessment.findMany({
      where: {
        subjectId: subject.id,
        dueDate: { gte: windowStart, lt: windowEnd },
        NOT: { title: { startsWith: "Attendance ·", mode: "insensitive" } },
      },
      orderBy: { dueDate: "asc" },
      take: 10,
      select: { title: true, dueDate: true },
    });
    answer = upcoming.length
      ? `Assessments with due dates in the next seven days (${dateWindow}):\n\n${upcoming.map(item => `• ${item.title} — ${item.dueDate ? formatDate(item.dueDate) : "No due date"}`).join("\n")}\n\nThis list includes assessment schedule details only, not student scores or submissions.`
      : `I found no non-attendance assessment items with due dates in the next seven days (${dateWindow}) for this class.`;
  } else if (intent.intent === "grade-workflow") {
    answer = `The grade-sheet status for ${subject.code} · ${subject.title} is: ${gradeStatusLabel(subject.gradeStatus)}. ${subject.gradeStatus === "DRAFT" ? "The sheet is still in draft and can be reviewed in Final grades & submit." : subject.gradeStatus === "SUBMITTED" ? "The sheet has been submitted and is awaiting the school's verification step." : "The sheet is verified and marked final."}`;
  } else if (intent.intent === "attendance-sessions") {
    const count = await prisma.assessment.count({
      where: { subjectId: subject.id, title: { startsWith: "Attendance ·", mode: "insensitive" } },
    });
    answer = `This class has ${count} recorded attendance ${count === 1 ? "session" : "sessions"} set up. I did not load or inspect individual attendance marks.`;
  } else if (intent.intent === "activity-overview") {
    const activities = await prisma.classActivity.findMany({
      where: { subjectId: subject.id },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { title: true, kind: true, status: true, dueAt: true },
    });
    answer = activities.length
      ? `This class has ${subject._count.activities} activities. The latest ${activities.length} are:\n\n${activities.map(item => `• ${item.title} — ${item.kind.toLowerCase()}, ${item.status.toLowerCase().replace("_", " ")}${item.dueAt ? `, due ${formatDate(item.dueAt)}` : ""}`).join("\n")}\n\nNo student submissions or marks were loaded.`
      : "There are no class activities in this workspace yet.";
  } else if (intent.intent === "grade-visibility") {
    answer = subject.isPublished
      ? "This class's grade records are currently marked Visible to students. Review the grade-visibility control in the class summary before making any change."
      : "This class's grade records are currently marked Hidden from students. Review the grade-visibility control in the class summary before making any change.";
  } else {
    const assessmentCount = await prisma.assessment.count({
      where: {
        subjectId: subject.id,
        NOT: { title: { startsWith: "Attendance ·", mode: "insensitive" } },
      },
    });
    answer = [
      `Class overview: ${subject.code} · ${subject.title}`,
      `Class ID: ${subject.classId || "Not set"}`,
      `Course/year: ${subject.courseYear || "Not set"}`,
      `Academic period: ${subject.term} · ${subject.academicYear}`,
      `Schedule: ${subject.schedule || "Not set"}`,
      `Enrolled students: ${subject._count.enrollments}`,
      `Assessment items (excluding attendance sessions): ${assessmentCount}`,
      `Class activities: ${subject._count.activities}`,
      `Grade-sheet status: ${gradeStatusLabel(subject.gradeStatus)}`,
      `Student visibility: ${subject.isPublished ? "Visible" : "Hidden"}`,
      "",
      "This overview uses current-class metadata and aggregate counts only. Individual student records and marks were not loaded.",
    ].join("\n");
  }

  return NextResponse.json({
    apiVersion: "1",
    status: "completed",
    source: "saga-workspace",
    answer,
    asOf: new Date().toISOString(),
  }, { headers });
}
