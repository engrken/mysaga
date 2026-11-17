import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { StudentActivities } from "@/components/ClassActivities";
import { getSession } from "@/lib/auth";
import { activityEnrollmentIdentity } from "@/lib/class-activities";
import { prisma } from "@/lib/prisma";

export default async function StudentClassActivitiesPage({ params }: { params: Promise<{ subjectId: string }> }) {
  const student = await getSession();
  if (!student) redirect("/login");
  const overview = `/${encodeURIComponent(student.school.slug)}/overview`;
  if (student.role !== "STUDENT") redirect(overview);
  const { subjectId } = await params;
  const subject = await prisma.subject.findFirst({
    where: { id: subjectId, schoolId: student.schoolId, enrollments: { some: { OR: activityEnrollmentIdentity(student) } } },
    select: { code: true, title: true }
  });
  if (!subject) notFound();
  return <main className="container py-4">
    <Link href={overview} className="btn btn-outline-secondary btn-sm mb-3">Back to overview</Link>
    <h1 className="h3 mb-3">{subject.code} · {subject.title}</h1>
    <StudentActivities subjectId={subjectId} readOnly={student.isDemo}/>
  </main>;
}
