import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { todayManila } from "@/lib/tenant-operations";
import { absenceDates, ATTENDANCE_MARKS, attendanceDays, attendanceRiskSummary, consecutiveLateAbsences, HIGH_RISK_ABSENCE_PERCENT } from "@/lib/attendance";
import { scheduleWeekdays } from "@/lib/schedule-days";

function parseDate(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

function nextDay(date: Date) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

function scheduleForWeekday(raw: string | null, weekday: number) {
  if (!raw?.trim()) return [] as string[];
  try {
    const rows = JSON.parse(raw) as Array<{ label?: string; day?: string; startTime?: string; endTime?: string }>;
    if (Array.isArray(rows)) return rows.filter(row => scheduleWeekdays(JSON.stringify([row])).includes(weekday)).map(row => `${row.label || "Class"}${row.startTime || row.endTime ? ` · ${row.startTime || ""}${row.startTime && row.endTime ? "–" : ""}${row.endTime || ""}` : ""}`);
  } catch { /* Legacy free-text schedules are checked by scheduleWeekdays below. */ }
  return scheduleWeekdays(raw).includes(weekday) ? [raw] : [];
}

export async function GET(request: Request) {
  const teacher = await requireRole("TEACHER");
  if (!teacher) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const from = parseDate(params.get("from"));
  const to = parseDate(params.get("to"));
  if (!from || !to || from > to) return NextResponse.json({ error: "Choose a valid date range." }, { status: 400 });
  const rangeEnd = nextDay(to);
  const manilaDate = todayManila();
  const today = new Date(`${manilaDate}T00:00:00.000Z`);
  const academicYear = params.get("academicYear")?.trim();
  const term = params.get("term")?.trim();
  if (academicYear && !/^\d{4}-\d{4}$/.test(academicYear)) return NextResponse.json({ error: "Choose a valid academic year." }, { status: 400 });
  const subjectScope = { teacherId: teacher.id, schoolId: teacher.schoolId, ...(academicYear ? { academicYear } : {}), ...(term ? { term: term === "3rd Trimester" ? { in: ["3rd Trimester", "3rd Semester"] } : term } : {}) };

  const [subjects, upcomingAttendance, upcomingAssessments, attendanceCounts, todaysAttendance, attendanceSessions] = await Promise.all([
    prisma.subject.findMany({
      where: subjectScope,
      select: {
        id: true, code: true, title: true, classId: true, academicYear: true, term: true, gradeStatus: true, schedule: true,
        enrollments: { select: { id: true, studentUserId: true, studentNumber: true, studentName: true } },
        assessments: {
          where: { dueDate: { gte: from, lt: rangeEnd } },
          select: {
            id: true, title: true, dueDate: true,
            category: { select: { name: true } }
          }
        }
      }
    }),
    prisma.assessment.findMany({
      where: { subject: subjectScope, title: { startsWith: "Attendance ·" }, dueDate: { gte: today } },
      orderBy: { dueDate: "asc" }, take: 48,
      select: { id: true, title: true, dueDate: true, attendanceType: true, scheduleOverrideReason: true, _count: { select: { scores: { where: { remark: { in: [...ATTENDANCE_MARKS] } } } } }, subject: { select: { id: true, code: true, title: true, _count: { select: { enrollments: true } } } } }
    }),
    prisma.assessment.findMany({
      where: { subject: subjectScope, NOT: { title: { startsWith: "Attendance ·" } }, dueDate: { gte: today } },
      orderBy: { dueDate: "asc" }, take: 8,
      select: { id: true, title: true, dueDate: true, attendanceType: true, scheduleOverrideReason: true, _count: { select: { scores: { where: { remark: { in: [...ATTENDANCE_MARKS] } } } } }, subject: { select: { id: true, code: true, title: true, _count: { select: { enrollments: true } } } } }
    })
    ,
    prisma.score.groupBy({
      by: ["remark"],
      where: { assessment: { subject: subjectScope, title: { startsWith: "Attendance ·" }, dueDate: { gte: from, lt: rangeEnd } } },
      _count: { _all: true }
    }),
    // The selected analytics range may not include today.
    prisma.assessment.findMany({
      where: { subject: subjectScope, title: { startsWith: "Attendance ·" }, dueDate: { gte: today, lt: nextDay(today) } },
      select: {
        subjectId: true,
        _count: { select: { scores: { where: { remark: { in: [...ATTENDANCE_MARKS] } } } } },
        subject: { select: { _count: { select: { enrollments: true } } } }
      }
    }),
    prisma.assessment.findMany({
      where: {
        subject: subjectScope,
        title: { startsWith: "Attendance ·", mode: "insensitive" },
        OR: [{ dueDate: null }, { dueDate: { lt: nextDay(today) } }]
      },
      select: {
        id: true, subjectId: true, title: true, dueDate: true,
        scores: {
          where: { OR: [{ remark: { in: [...ATTENDANCE_MARKS, "DID_NOT_SUBMIT"] } }, { points: { gt: 0 } }] },
          select: { enrollmentId: true, remark: true, points: true }
        }
      }
    })
  ]);

  const sessionsBySubject = new Map<string, typeof attendanceSessions>();
  const scoresByEnrollment = new Map<string, Map<string, (typeof attendanceSessions)[number]["scores"][number]>>();
  for (const session of attendanceSessions) {
    const sessions = sessionsBySubject.get(session.subjectId) ?? [];
    sessions.push(session);
    sessionsBySubject.set(session.subjectId, sessions);
    for (const score of session.scores) {
      const scores = scoresByEnrollment.get(score.enrollmentId) ?? new Map();
      scores.set(session.id, score);
      scoresByEnrollment.set(score.enrollmentId, scores);
    }
  }

  const attendanceRisk = subjects.flatMap(subject => {
    const sessions = sessionsBySubject.get(subject.id) ?? [];
    const days = attendanceDays(sessions, manilaDate);
    return subject.enrollments.flatMap(enrollment => {
      const scores = scoresByEnrollment.get(enrollment.id);
      if (!scores) return [];
      const converted = consecutiveLateAbsences(days, id => scores.get(id)?.remark);
      const { absent, late, lateAbsences, counted, percent } = attendanceRiskSummary(sessions, scores, manilaDate, converted);
      if (percent === null || percent < HIGH_RISK_ABSENCE_PERCENT) return [];
      return [{
        enrollmentId: enrollment.id,
        studentName: enrollment.studentName,
        subjectId: subject.id,
        classId: subject.classId,
        code: subject.code,
        title: subject.title,
        academicYear: subject.academicYear,
        term: subject.term,
        absent,
        late,
        lateAbsences,
        counted,
        percent,
        absenceDates: absenceDates(days, id => scores.get(id), converted)
      }];
    });
  }).sort((a, b) => b.percent - a.percent || b.absent - a.absent || a.studentName.localeCompare(b.studentName));

  const students = new Set<string>();
  let activities = 0;
  let tests = 0;
  const attendanceByRemark = new Map(attendanceCounts.map(item => [item.remark, item._count._all]));
  const present = attendanceByRemark.get("PRESENT") ?? 0;
  const absent = attendanceByRemark.get("ABSENT") ?? 0;
  const late = attendanceByRemark.get("LATE") ?? 0;
  const excused = attendanceByRemark.get("EXCUSED") ?? 0;
  for (const subject of subjects) {
    for (const enrollment of subject.enrollments) {
      const key = enrollment.studentNumber?.trim().toLocaleLowerCase() || enrollment.studentUserId || enrollment.studentName.trim().replace(/\s+/g, " ").toLocaleLowerCase();
      if (key) students.add(key);
    }
    for (const assessment of subject.assessments) {
      const isAttendance = assessment.title.toLocaleLowerCase().startsWith("attendance ·");
      if (isAttendance) continue;
      activities++;
      if (/\b(test|exam)\b/i.test(`${assessment.title} ${assessment.category.name}`)) tests++;
    }
  }

  const submissions = {
    draft: subjects.filter(subject => subject.gradeStatus === "DRAFT").length,
    provisional: subjects.filter(subject => subject.gradeStatus === "SUBMITTED").length,
    final: subjects.filter(subject => subject.gradeStatus === "VERIFIED").length
  };
  const attendanceComplete = (markedCount: number, studentCount: number) =>
    studentCount > 0 && markedCount >= studentCount;
  const todayCompleted = new Set(todaysAttendance
    .filter(item => attendanceComplete(item._count.scores, item.subject._count.enrollments))
    .map(item => item.subjectId));
  const upcoming = (items: typeof upcomingAttendance, isAttendance = false) => items.map(item => ({
    id: item.id,
    title: isAttendance ? "Attendance day" : item.title,
    date: item.dueDate?.toISOString() ?? null,
    subjectId: item.subject.id,
    code: item.subject.code,
    subjectTitle: item.subject.title,
    attendanceType: item.attendanceType,
    scheduleOverrideReason: item.scheduleOverrideReason,
    markedCount: isAttendance ? item._count.scores : undefined,
    studentCount: isAttendance ? item.subject._count.enrollments : undefined
  }));
  const todayWeekday = today.getUTCDay();
  const todayClasses = subjects.flatMap(subject => {
    const sessions = scheduleForWeekday(subject.schedule, todayWeekday);
    return sessions.length ? [{
      id: subject.id,
      code: subject.code,
      title: subject.title,
      classId: subject.classId,
      schedule: sessions,
      canRecordAttendance: subject.gradeStatus !== "VERIFIED" && !todayCompleted.has(subject.id)
    }] : [];
  });

  const pendingAttendance = upcomingAttendance
    .filter(item => !attendanceComplete(item._count.scores, item.subject._count.enrollments))
    .slice(0, 8);
  const completedTodayCount = todayClasses.filter(item => todayCompleted.has(item.id)).length;
  return NextResponse.json({
    completedTodayCount,
    stats: {
      activeClasses: subjects.length,
      activeStudents: students.size,
      activities,
      tests,
      pendingReviews: submissions.provisional,
      attendanceLogs: present + absent + excused + late
    },
    attendance: { present, absent, excused, late },
    attendanceRisk,
    submissions,
    enrollment: subjects.map(subject => ({ id: subject.id, label: subject.classId || subject.code, title: subject.title, code: subject.code, count: subject.enrollments.length })),
    today: manilaDate,
    todayClasses,
    upcoming: { attendance: upcoming(pendingAttendance, true), assessments: upcoming(upcomingAssessments) }
  }, { headers: { "Cache-Control": "private, no-store" } });
}
