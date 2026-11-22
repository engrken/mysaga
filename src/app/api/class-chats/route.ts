import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { googleChatAccessToken, googleChatRequest } from "@/lib/google-chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cacheHeaders = { "Cache-Control": "private, no-store" };

function trustedSpaceUri(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !["chat.google.com", "mail.google.com"].includes(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function summarizeMemberships(statuses: Array<{ status: string }>) {
  return statuses.reduce<Record<string, number>>((summary, item) => {
    summary[item.status] = (summary[item.status] || 0) + 1;
    return summary;
  }, {});
}

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: cacheHeaders });

  if (user.role === "TEACHER") {
    const where = {
      schoolId: user.schoolId,
      teacherId: user.id,
      subject: { is: { schoolId: user.schoolId, teacherId: user.id } }
    };
    let spaces = await prisma.googleChatSpace.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      select: {
        id: true,
        spaceName: true,
        spaceUri: true,
        displayName: true,
        externalUserAllowed: true,
        subject: {
          select: {
            id: true,
            classId: true,
            code: true,
            title: true,
            term: true,
            academicYear: true,
            _count: { select: { enrollments: true } },
            googleChatMemberships: { select: { status: true } }
          }
        }
      }
    });

    // Existing Spaces were linked before SAGA stored Google's canonical
    // spaceUri. Resolve those once using the owning teacher's existing token.
    const missingUris = spaces.filter(item => !trustedSpaceUri(item.spaceUri));
    if (missingUris.length) {
      const connection = await prisma.googleChatConnection.findUnique({
        where: { schoolId_teacherId: { schoolId: user.schoolId, teacherId: user.id } }
      });
      if (connection) {
        try {
          const token = await googleChatAccessToken(connection);
          await Promise.allSettled(missingUris.map(async item => {
            const remote = await googleChatRequest<{ spaceUri?: string }>(token, item.spaceName);
            const spaceUri = trustedSpaceUri(remote.spaceUri);
            if (spaceUri) {
              await prisma.googleChatSpace.update({
                where: { id: item.id },
                data: { spaceUri }
              });
            }
          }));
          spaces = await prisma.googleChatSpace.findMany({
            where,
            orderBy: [{ createdAt: "desc" }],
            select: {
              id: true,
              spaceName: true,
              spaceUri: true,
              displayName: true,
              externalUserAllowed: true,
              subject: {
                select: {
                  id: true,
                  classId: true,
                  code: true,
                  title: true,
                  term: true,
                  academicYear: true,
                  _count: { select: { enrollments: true } },
                  googleChatMemberships: { select: { status: true } }
                }
              }
            }
          });
        } catch {
          // A temporarily unavailable Google token should not hide linked classes.
        }
      }
    }

    return NextResponse.json({
      role: "TEACHER",
      classes: spaces.map(item => ({
        subjectId: item.subject.id,
        classId: item.subject.classId,
        code: item.subject.code,
        title: item.subject.title,
        term: item.subject.term,
        academicYear: item.subject.academicYear,
        displayName: item.displayName,
        spaceUri: trustedSpaceUri(item.spaceUri),
        externalUserAllowed: item.externalUserAllowed,
        rosterCount: item.subject._count.enrollments,
        membershipCounts: summarizeMemberships(item.subject.googleChatMemberships)
      }))
    }, { headers: cacheHeaders });
  }

  if (user.role === "STUDENT") {
    const records = await prisma.enrollment.findMany({
      where: {
        subject: {
          schoolId: user.schoolId,
          googleChatSpace: { isNot: null }
        },
        OR: [
          { studentUserId: user.id },
          ...(user.studentNumber ? [{
            studentUserId: null,
            studentNumber: { equals: user.studentNumber.trim(), mode: "insensitive" as const }
          }] : [])
        ]
      },
      orderBy: [{ subject: { academicYear: "desc" } }, { subject: { code: "asc" } }],
      select: {
        googleChatMembership: { select: { status: true } },
        subject: {
          select: {
            id: true,
            classId: true,
            code: true,
            title: true,
            term: true,
            academicYear: true,
            googleChatSpace: {
              select: {
                displayName: true,
                spaceUri: true,
                externalUserAllowed: true
              }
            }
          }
        }
      }
    });

    const uniqueClasses = new Map<string, {
      subjectId: string;
      classId: string | null;
      code: string;
      title: string;
      term: string;
      academicYear: string;
      displayName: string;
      spaceUri: string | null;
      externalUserAllowed: boolean;
      membershipStatus: string | null;
    }>();
    for (const record of records) {
      const space = record.subject.googleChatSpace;
      if (!space || uniqueClasses.has(record.subject.id)) continue;
      uniqueClasses.set(record.subject.id, {
        subjectId: record.subject.id,
        classId: record.subject.classId,
        code: record.subject.code,
        title: record.subject.title,
        term: record.subject.term,
        academicYear: record.subject.academicYear,
        displayName: space.displayName,
        spaceUri: trustedSpaceUri(space.spaceUri),
        externalUserAllowed: space.externalUserAllowed,
        membershipStatus: record.googleChatMembership?.status ?? null
      });
    }

    return NextResponse.json({ role: "STUDENT", classes: [...uniqueClasses.values()] }, { headers: cacheHeaders });
  }

  return NextResponse.json({ error: "Unauthorized" }, { status: 403, headers: cacheHeaders });
}
