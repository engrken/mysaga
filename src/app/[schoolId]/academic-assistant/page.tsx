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

  const query = await searchParams;
  const requestedSubjectId = typeof query.class === "string" ? query.class.slice(0, 160) : "";
  if (schoolId !== teacher.school.slug) {
    redirect(`/${encodeURIComponent(teacher.school.slug)}/academic-assistant?class=${encodeURIComponent(requestedSubjectId)}`);
  }
  if (!requestedSubjectId) {
    redirect(`/${encodeURIComponent(teacher.school.slug)}/classes`);
  }

  // Resolve exactly the class from which the assistant was opened. Do not
  // load the teacher's subject directory or offer a class switcher here.
  const subject = await prisma.subject.findFirst({
    where: {
      id: requestedSubjectId,
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
    },
  });
  if (!subject) notFound();

  return (
    <main style={{ minHeight: "100vh", background: "#f4f7fb", padding: "clamp(18px, 4vw, 42px) 16px 64px" }}>
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        <Link href={`/${encodeURIComponent(teacher.school.slug)}/classes`} style={{ color: "#24558b", textDecoration: "none", fontWeight: 700 }}>← Back to classes</Link>
        <header style={{ margin: "26px 0 22px" }}>
          <p style={{ margin: 0, color: "#4b6b8f", fontSize: 12, fontWeight: 800, letterSpacing: ".12em", textTransform: "uppercase" }}>SAGA · Workspace copilot</p>
          <h1 style={{ margin: "8px 0", color: "#142d4a", fontSize: "clamp(28px, 4vw, 40px)" }}>SAGA Virtual Assistant</h1>
          <p style={{ margin: 0, color: "#53677f", lineHeight: 1.65 }}>Get help using SAGA and ask read-only questions about the class workspace you opened. To ask about another class, return to My classes and open that workspace first.</p>
        </header>

        <AcademicAssistant
          key={subject.id}
          subjectId={subject.id}
          subjectContext={{
            code: subject.code,
            title: subject.title,
            classId: subject.classId,
            courseYear: subject.courseYear,
            academicYear: subject.academicYear,
            term: subject.term,
          }}
        />
      </div>
    </main>
  );
}
