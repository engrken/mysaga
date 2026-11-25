import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import AcademicAssistant from "@/components/AcademicAssistant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ schoolId: string }>;
  searchParams: Promise<{ class?: string | string[] }>;
};

export default async function AcademicAssistantPage({ params, searchParams }: PageProps) {
  const { schoolId } = await params;
  const teacher = await requireRole("TEACHER");
  if (!teacher || teacher.isDemo) {
    redirect(`/login?schoolId=${encodeURIComponent(teacher?.school.id ?? schoolId)}`);
  }
  if (schoolId !== teacher.school.slug) {
    redirect(`/${encodeURIComponent(teacher.school.slug)}/academic-assistant`);
  }

  const query = await searchParams;
  const requestedSubjectId = typeof query.class === "string" ? query.class.slice(0, 160) : "";
  // This list is intentionally limited to scalar instructional metadata from
  // subjects owned by the signed-in teacher in the current tenant.
  const subjects = await prisma.subject.findMany({
    where: { teacherId: teacher.id, schoolId: teacher.schoolId },
    select: { id: true, code: true, title: true, term: true, courseYear: true },
    orderBy: [{ academicYear: "desc" }, { code: "asc" }, { term: "asc" }],
  });
  const selectedSubject = requestedSubjectId
    ? subjects.find(subject => subject.id === requestedSubjectId) ?? null
    : null;
  if (requestedSubjectId && !selectedSubject) notFound();

  return (
    <main style={{ minHeight: "100vh", background: "#f4f7fb", padding: "clamp(18px, 4vw, 42px) 16px 64px" }}>
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        <Link href={`/${encodeURIComponent(teacher.school.slug)}/overview`} style={{ color: "#24558b", textDecoration: "none", fontWeight: 700 }}>← Back to SAGA Overview</Link>
        <header style={{ margin: "26px 0 22px" }}>
          <p style={{ margin: 0, color: "#4b6b8f", fontSize: 12, fontWeight: 800, letterSpacing: ".12em", textTransform: "uppercase" }}>COGNIX · Academic Agent</p>
          <h1 style={{ margin: "8px 0", color: "#142d4a", fontSize: "clamp(28px, 4vw, 40px)" }}>Academic Assistant</h1>
          <p style={{ margin: 0, color: "#53677f", lineHeight: 1.65 }}>Create lesson outlines, study guides, and practice questions grounded in a subject from your own SAGA class workspaces. Student-level academic records remain in SAGA.</p>
        </header>

        {!selectedSubject ? (
          <section style={{ border: "1px solid #d7e0eb", borderRadius: 16, background: "#fff", padding: "clamp(18px, 3vw, 28px)" }}>
            <h2 style={{ margin: "0 0 6px", color: "#173454", fontSize: 21 }}>Choose a class workspace</h2>
            <p style={{ margin: "0 0 18px", color: "#64788f", fontSize: 13, lineHeight: 1.6 }}>Only classes assigned to your teacher account are listed. Open the assistant from a class to keep its subject context attached.</p>
            {subjects.length ? (
              <div style={{ display: "grid", gap: 10 }}>
                {subjects.map(subject => (
                  <Link key={subject.id} href={`?class=${encodeURIComponent(subject.id)}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", border: "1px solid #dbe4ee", borderRadius: 10, padding: 14, color: "#234464", textDecoration: "none" }}>
                    <span><strong>{subject.code} · {subject.title}</strong><small style={{ display: "block", marginTop: 4, color: "#617992" }}>{subject.courseYear || "Course/year not set"} · {subject.term}</small></span>
                    <span aria-hidden="true">Open assistant →</span>
                  </Link>
                ))}
              </div>
            ) : (
              <p style={{ margin: 0, color: "#64788f" }}>No class subjects are currently assigned to your teacher account.</p>
            )}
          </section>
        ) : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
              <Link href={`/${encodeURIComponent(teacher.school.slug)}/academic-assistant`} style={{ color: "#24558b", textDecoration: "none", fontWeight: 700 }}>← Change class</Link>
              <Link href={`/${encodeURIComponent(teacher.school.slug)}/classes`} style={{ color: "#24558b", textDecoration: "none", fontWeight: 700 }}>Open class workspace →</Link>
            </div>
            <AcademicAssistant
              key={selectedSubject.id}
              subjectId={selectedSubject.id}
              subjectContext={{
                code: selectedSubject.code,
                title: selectedSubject.title,
                courseYear: selectedSubject.courseYear,
                term: selectedSubject.term,
              }}
            />
          </>
        )}

        <p style={{ marginTop: 20, color: "#718096", fontSize: 12, lineHeight: 1.6 }}>
          Generated materials are drafts. Teachers remain responsible for reviewing accuracy, age-appropriateness, and suitability before classroom use.
        </p>
      </div>
    </main>
  );
}
