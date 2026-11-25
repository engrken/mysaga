import Link from "next/link";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { todayManila } from "@/lib/tenant-operations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ schoolId: string }> };

function countLabel(value: number, singular: string, plural = singular + "s") {
  return value + " " + (value === 1 ? singular : plural);
}

export default async function TeacherSummaryPage({ params }: PageProps) {
  const { schoolId } = await params;
  const teacher = await requireRole("TEACHER");
  if (!teacher || teacher.isDemo) {
    redirect("/login?schoolId=" + encodeURIComponent(teacher?.school.id ?? schoolId));
  }
  if (schoolId !== teacher.school.slug) {
    redirect("/" + encodeURIComponent(teacher.school.slug) + "/teacher-summary");
  }

  // Use the same Manila calendar-day boundary as the SAGA teacher overview.
  const windowStart = new Date(todayManila() + "T00:00:00.000Z");
  const windowEnd = new Date(windowStart);
  windowEnd.setUTCDate(windowEnd.getUTCDate() + 7);
  const subjects = await prisma.subject.findMany({
    where: { teacherId: teacher.id, schoolId: teacher.schoolId },
    select: {
      gradeStatus: true,
      _count: {
        select: {
          enrollments: true,
          assessments: {
            where: {
              dueDate: { gte: windowStart, lt: windowEnd },
              NOT: { title: { startsWith: "Attendance ·", mode: "insensitive" } },
            },
          },
        },
      },
    },
  });

  let enrollmentRecords = 0;
  let assessmentsDue = 0;
  let draftClasses = 0;
  let submittedClasses = 0;
  let verifiedClasses = 0;
  for (const subject of subjects) {
    enrollmentRecords += subject._count.enrollments;
    assessmentsDue += subject._count.assessments;
    if (subject.gradeStatus === "DRAFT") draftClasses += 1;
    if (subject.gradeStatus === "SUBMITTED") submittedClasses += 1;
    if (subject.gradeStatus === "VERIFIED") verifiedClasses += 1;
  }

  const assignedClasses = subjects.length;
  const windowLastDay = new Date(windowEnd.getTime() - 86_400_000);
  const dateFormat = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeZone: "Asia/Manila" });
  const windowLabel = dateFormat.format(windowStart) + " – " + dateFormat.format(windowLastDay);
  const insight = assignedClasses === 0
    ? "No class subjects are currently assigned to your teacher account."
    : "You currently have " + countLabel(assignedClasses, "assigned class") + " with " + countLabel(enrollmentRecords, "enrollment record") + ". " +
      countLabel(assessmentsDue, "assessment") + " are due during this seven-day window.";

  const nextSteps: string[] = [];
  if (assessmentsDue > 0) {
    nextSteps.push("Review the schedule and readiness of " + countLabel(assessmentsDue, "assessment") + " due in this window.");
  }
  if (draftClasses > 0) {
    nextSteps.push("Review the draft grade sheets for " + countLabel(draftClasses, "class") + " when the records are ready.");
  }
  if (submittedClasses > 0) {
    nextSteps.push("Track verification progress for " + countLabel(submittedClasses, "submitted class grade sheet") + ".");
  }
  if (nextSteps.length === 0) {
    nextSteps.push("There are no assessments due in this window, and no draft or submitted grade sheets are flagged by these workflow counts.");
  }

  return (
    <main style={{ minHeight: "100vh", background: "#f4f7fb", padding: "clamp(18px, 4vw, 42px) 16px 64px" }}>
      <div style={{ maxWidth: 1040, margin: "0 auto" }}>
        <Link href={"/" + encodeURIComponent(teacher.school.slug) + "/overview"} style={{ color: "#24558b", textDecoration: "none", fontWeight: 700 }}>← Back to SAGA Overview</Link>
        <header style={{ margin: "26px 0 22px" }}>
          <p style={{ margin: 0, color: "#4b6b8f", fontSize: 12, fontWeight: 800, letterSpacing: ".12em", textTransform: "uppercase" }}>SAGA · Local report</p>
          <h1 style={{ margin: "8px 0", color: "#142d4a", fontSize: "clamp(28px, 4vw, 40px)" }}>Teacher Summary</h1>
          <p style={{ margin: 0, color: "#53677f", lineHeight: 1.65 }}>A current operational snapshot of your assigned classes, upcoming assessments, and grade workflow.</p>
        </header>

        <section style={{ border: "1px solid #d7e0eb", borderRadius: 16, background: "#fff", boxShadow: "0 12px 30px rgba(20,45,74,.06)", padding: "clamp(18px, 3vw, 28px)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <div>
              <p style={{ margin: 0, color: "#52708f", fontSize: 11, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase" }}>Your summary</p>
              <h2 style={{ margin: "6px 0 0", color: "#173454", fontSize: 21 }}>{insight}</h2>
            </div>
            <span style={{ borderRadius: 999, background: "#eef4fb", padding: "7px 11px", color: "#355d83", fontSize: 12, fontWeight: 700 }}>Next 7 days · Philippines time</span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 190px), 1fr))", gap: 12, marginTop: 22 }}>
            {[
              { label: "Assigned classes", value: assignedClasses, detail: "Class subjects assigned to you" },
              { label: "Enrollment records", value: enrollmentRecords, detail: "Across your assigned classes" },
              { label: "Assessments due", value: assessmentsDue, detail: windowLabel },
            ].map((item) => (
              <article key={item.label} style={{ border: "1px solid #dce5ef", borderRadius: 12, background: "#f9fbfe", padding: 16 }}>
                <p style={{ margin: 0, color: "#617992", fontSize: 12, fontWeight: 700 }}>{item.label}</p>
                <p style={{ margin: "5px 0", color: "#173454", fontSize: 32, fontWeight: 800, lineHeight: 1.15, fontVariantNumeric: "tabular-nums" }}>{item.value}</p>
                <p style={{ margin: 0, color: "#71849a", fontSize: 11, lineHeight: 1.5 }}>{item.detail}</p>
              </article>
            ))}
          </div>

          <section style={{ marginTop: 24, borderTop: "1px solid #e4ebf2", paddingTop: 20 }}>
            <h2 style={{ margin: "0 0 12px", color: "#173454", fontSize: 18 }}>Grade workflow</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 150px), 1fr))", gap: 10 }}>
              {[
                { label: "Draft", value: draftClasses },
                { label: "Submitted", value: submittedClasses },
                { label: "Verified", value: verifiedClasses },
              ].map((item) => (
                <div key={item.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, border: "1px solid #e1e8f0", borderRadius: 10, padding: "12px 14px" }}>
                  <span style={{ color: "#526b85", fontSize: 13, fontWeight: 700 }}>{item.label}</span>
                  <strong style={{ color: "#173454", fontSize: 22, fontVariantNumeric: "tabular-nums" }}>{item.value}</strong>
                </div>
              ))}
            </div>
          </section>

          <section style={{ marginTop: 24, borderTop: "1px solid #e4ebf2", paddingTop: 20 }}>
            <h2 style={{ margin: "0 0 10px", color: "#173454", fontSize: 18 }}>Suggested next steps</h2>
            <ul style={{ margin: 0, paddingLeft: 20, color: "#526b85", fontSize: 13, lineHeight: 1.8 }}>
              {nextSteps.map((step) => <li key={step}>{step}</li>)}
            </ul>
          </section>

          <aside role="note" style={{ marginTop: 22, padding: 15, borderRadius: 10, background: "#eef7f1", border: "1px solid #cfe6d6", color: "#365d44", fontSize: 12, lineHeight: 1.7 }}>
            <strong>Privacy:</strong> This report is calculated inside SAGA from teacher- and school-scoped aggregate counts and grade-workflow statuses. It does not retrieve individual student names, IDs, personal details, grades, scores, or attendance records. No data from this report is sent to COGNIX or an external AI provider.
          </aside>
          <p style={{ margin: "14px 0 0", color: "#7a8da2", fontSize: 11 }}>This is a read-only operational summary, not an evaluation of teaching performance or student outcomes.</p>
        </section>
      </div>
    </main>
  );
}
