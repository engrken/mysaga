import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { checkAuthThrottle } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
};

const schema = z.object({
  subjectId: z.string().trim().min(1).max(160),
  resourceType: z.enum(["lesson-outline", "study-guide", "practice-questions"]),
  level: z.enum([
    "Elementary",
    "Junior High School",
    "Senior High School",
    "Higher Education",
    "Adult Learning",
  ]),
  topic: z.string().trim().min(3).max(120),
}).strict();

function containsPersonalOrRecordData(topic: string) {
  return (
    /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/i.test(topic) ||
    /(?:\+?63[\s-]?9\d{2}[\s-]?\d{3}[\s-]?\d{4}|09\d{9})\b/.test(topic) ||
    /\b\d{7,}\b/.test(topic) ||
    /\b(?:student|learner|teacher|parent|guardian)\s+(?:name|id|number|email|phone|address|grade|score|attendance|record|roster)\b/i.test(topic) ||
    /\b(?:lrn|student\s*id|contact\s*(?:number|details)|email\s*address)\s*[:=#]/i.test(topic) ||
    /\b(?:grade|score|attendance|remark|record|roster)\s+(?:of|for)\s+[\p{L}][\p{L}\s'-]{1,40}/iu.test(topic)
  );
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
 * This route reads exactly one teacher-owned Subject row and selects only
 * instructional metadata. It never loads enrollments, assessments, scores,
 * grades, activities, or attendance relations.
 */
export async function POST(request: Request) {
  const teacher = await requireRole("TEACHER");
  if (!teacher || teacher.isDemo) {
    return NextResponse.json(
      { error: "unauthorized", message: "An active, non-demo teacher session is required." },
      { status: 401, headers },
    );
  }

  const throttle = await checkAuthThrottle(
    request,
    `cognix-academic-assistant:${teacher.id}`,
    10,
    60 * 60 * 1_000,
    "identity",
  );
  if (!throttle.allowed) {
    return NextResponse.json(
      { error: "rate_limited", message: "Academic Assistant is limited to 10 requests per hour. Please try again later." },
      { status: 429, headers },
    );
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 5_000) {
    return NextResponse.json(
      { error: "payload_too_large", message: "The topic request is too large." },
      { status: 413, headers },
    );
  }

  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 5_000) {
      return NextResponse.json(
        { error: "payload_too_large", message: "The topic request is too large." },
        { status: 413, headers },
      );
    }
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json(
      { error: "invalid_json", message: "Provide a valid resource request." },
      { status: 400, headers },
    );
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", message: "Choose a resource type, learning level, topic, and a class you teach." },
      { status: 400, headers },
    );
  }

  if (containsPersonalOrRecordData(parsed.data.topic)) {
    return NextResponse.json(
      { error: "personal_data_not_allowed", message: "Use a generic academic topic only. Do not enter personal details, identifiers, grades, scores, attendance, or records." },
      { status: 400, headers },
    );
  }

  // Tenant and ownership checks are part of the query. Select scalar
  // instructional fields only; never include student or academic relations.
  const subject = await prisma.subject.findFirst({
    where: {
      id: parsed.data.subjectId,
      teacherId: teacher.id,
      schoolId: teacher.schoolId,
    },
    select: {
      code: true,
      title: true,
      courseYear: true,
      term: true,
    },
  });
  if (!subject) {
    return NextResponse.json(
      { error: "class_not_found", message: "That class subject is unavailable or is not assigned to your teacher account." },
      { status: 404, headers },
    );
  }

  const classContextText = [subject.code, subject.title, subject.courseYear ?? "", subject.term].join(" ");
  if (containsPersonalOrRecordData(classContextText)) {
    return NextResponse.json(
      { error: "invalid_class_context", message: "The selected subject details contain information that cannot be sent to the Academic Assistant. Ask your school administrator to review the class subject settings." },
      { status: 400, headers },
    );
  }

  const endpoint = cognixEndpoint();
  if (!endpoint) {
    return NextResponse.json(
      { error: "not_configured", message: "The secure COGNIX connection is not configured." },
      { status: 503, headers },
    );
  }

  const requestId = `saga-academic-${randomUUID()}`;
  try {
    const response = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${endpoint.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        apiVersion: "1",
        app: "saga",
        task: "learning-resource",
        requestId,
        input: {
          resourceType: parsed.data.resourceType,
          subject: subject.title,
          level: parsed.data.level,
          topic: parsed.data.topic,
          classContext: {
            subjectCode: subject.code,
            courseYear: subject.courseYear ?? "",
            term: subject.term,
          },
        },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    });

    const result = await response.json().catch(() => null);
    if (!response.ok) {
      return NextResponse.json(
        {
          error: typeof result?.error === "string" ? result.error : "cognix_unavailable",
          message: typeof result?.message === "string"
            ? result.message
            : "COGNIX could not complete the request. No SAGA records were accessed or changed.",
          requestId,
        },
        { status: response.status, headers },
      );
    }

    return NextResponse.json({
      apiVersion: "1",
      status: "completed",
      requestId,
      answer: typeof result?.answer === "string" ? result.answer : "",
      warnings: Array.isArray(result?.warnings) ? result.warnings.filter((item: unknown) => typeof item === "string").slice(0, 4) : [],
      usage: result?.usage ?? null,
    }, { headers });
  } catch {
    return NextResponse.json(
      { error: "cognix_unavailable", message: "COGNIX could not be reached. No SAGA records were accessed or changed.", requestId },
      { status: 502, headers },
    );
  }
}
