import Link from "next/link";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import AcademicAssistant from "@/components/AcademicAssistant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ schoolId: string }> };

export default async function AcademicAssistantPage({ params }: PageProps) {
  const { schoolId } = await params;
  const teacher = await requireRole("TEACHER");
  if (!teacher || teacher.isDemo) {
    redirect(`/login?schoolId=${encodeURIComponent(teacher?.school.id ?? schoolId)}`);
  }
  if (schoolId !== teacher.school.slug) {
    redirect(`/${encodeURIComponent(teacher.school.slug)}/academic-assistant`);
  }

  return (
    <main style={{ minHeight: "100vh", background: "#f4f7fb", padding: "clamp(18px, 4vw, 42px) 16px 64px" }}>
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        <Link href={`/${encodeURIComponent(teacher.school.slug)}/overview`} style={{ color: "#24558b", textDecoration: "none", fontWeight: 700 }}>← Back to SAGA Overview</Link>
        <header style={{ margin: "26px 0 22px" }}>
          <p style={{ margin: 0, color: "#4b6b8f", fontSize: 12, fontWeight: 800, letterSpacing: ".12em", textTransform: "uppercase" }}>COGNIX · Academic Agent</p>
          <h1 style={{ margin: "8px 0", color: "#142d4a", fontSize: "clamp(28px, 4vw, 40px)" }}>Academic Assistant</h1>
          <p style={{ margin: 0, color: "#53677f", lineHeight: 1.65 }}>Create general lesson outlines, study guides, and practice questions without connecting to SAGA academic records.</p>
        </header>
        <AcademicAssistant />
        <p style={{ marginTop: 20, color: "#718096", fontSize: 12, lineHeight: 1.6 }}>
          Generated materials are drafts, not official school policy or curriculum determinations. Teachers remain responsible for review and classroom suitability.
        </p>
      </div>
    </main>
  );
}
