export const HIGH_RISK_ABSENCE_PERCENT = 20;

export function attendanceMark(score?: { remark: string | null; points: number | null }) {
  if (score?.remark === "EXCUSED") return "excused";
  if (score?.remark === "ABSENT" || score?.remark === "DID_NOT_SUBMIT") return "absent";
  if (score?.remark === "PRESENT" || (score?.points != null && score.points > 0)) return "present";
  return null;
}

export function absencePercent(absent: number, present: number) {
  const counted = present + absent;
  return counted ? absent / counted * 100 : null;
}

export function highRiskAttendance(
  assessments: ReadonlyArray<{ id: string; title: string; dueDate: Date | null }>,
  scores: ReadonlyMap<string, { remark: string | null; points: number | null }>,
  today: string
) {
  let absent = 0;
  let present = 0;
  for (const assessment of assessments) {
    if (!assessment.title.toLowerCase().startsWith("attendance ·")) continue;
    if (assessment.dueDate && assessment.dueDate.toISOString().slice(0, 10) > today) continue;
    const mark = attendanceMark(scores.get(assessment.id));
    if (mark === "absent") absent++;
    if (mark === "present") present++;
  }
  const percent = absencePercent(absent, present);
  return percent !== null && percent >= HIGH_RISK_ABSENCE_PERCENT
    ? { absent, counted: absent + present, percent }
    : null;
}

export const DROPPING_ABSENCE_THRESHOLD = 3;

export type AbsenceStreak = { days: number; startDate: string; endDate: string };

export function attendanceDays(
  assessments: ReadonlyArray<{ id: string; title: string; dueDate: Date | null }>,
  today: string
) {
  const days = new Map<string, string[]>();
  for (const assessment of assessments) {
    if (!assessment.title.toLowerCase().startsWith("attendance ·")) continue;
    const date = assessment.dueDate?.toISOString().slice(0, 10)
      ?? /^attendance ·\s*(\d{4}-\d{2}-\d{2})$/i.exec(assessment.title)?.[1];
    if (!date || date > today) continue;
    const ids = days.get(date) ?? [];
    ids.push(assessment.id);
    days.set(date, ids);
  }
  return [...days].sort(([a], [b]) => a.localeCompare(b));
}

export function droppingAbsenceStreak(
  days: ReturnType<typeof attendanceDays>,
  isAbsent: (assessmentId: string) => boolean
): AbsenceStreak | null {
  let warning: AbsenceStreak | null = null;
  let count = 0;
  let startDate = "";
  for (const [date, ids] of days) {
    // A day confirms an absence only when every attendance entry for it is marked absent.
    if (!ids.every(isAbsent)) {
      count = 0;
      continue;
    }
    if (count === 0) startDate = date;
    count++;
    if (count >= DROPPING_ABSENCE_THRESHOLD) warning = { days: count, startDate, endDate: date };
  }
  return warning;
}
