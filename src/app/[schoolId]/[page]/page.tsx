import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Portal from "@/components/Portal";
import { classWorkspaceHref, parseClassWorkspaceQuery } from "@/lib/class-navigation";

type PageName = "overview" | "classes" | "profile" | "simulator" | "chats" | "announcements" | "resources";
type RouteProps = { params: Promise<{ schoolId: string; page: string }>; searchParams: Promise<{ class?: string | string[]; section?: string | string[]; student?: string | string[]; attendanceToday?: string | string[] }> };

export default async function SchoolPage({ params, searchParams }: RouteProps) {
  const { schoolId, page } = await params;
  const school = await prisma.school.findFirst({ where: { OR: [{ slug: schoolId }, { slugAliases: { has: schoolId } }] }, select: { id: true, slug: true } });
  if (!school) notFound();
  const user = await getSession();
  if (!user) redirect(`/login?schoolId=${encodeURIComponent(school.id)}`);
  if (user.schoolId !== school.id) redirect(`/${encodeURIComponent(user.school.slug)}/overview`);
  if (schoolId !== user.school.slug) redirect(`/${encodeURIComponent(user.school.slug)}/overview`);
  if (page !== "overview" && page !== "classes" && page !== "profile" && page !== "simulator" && page !== "chats" && page !== "announcements" && page !== "resources") notFound();
  if (page === "classes" && user.role !== "TEACHER") redirect(`/${encodeURIComponent(user.school.slug)}/ov¶»§q«^