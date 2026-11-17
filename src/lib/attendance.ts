export const ATTENDANCE_MARKS = ["PRESENT", "LATE", "ABSENT", "EXCUSED"] as const;
export const LATES_PER_ABSENCE = 3;

export const HIGH_RISK_ABSENCE_PERCENT = 20;

export function attendanceMark(score?: { remark: string | null; points: number | null }) {
  if (score?.remark === "LATE") return "late";
  if (score?.remark === "EXCUSED") return "excused";
  if (score?.remark === "ABSENT" || score?.remark === "DID_NOT_SUBMIT") return "absent";
  if (score?.remark === "PRESENT" || (score?.points != null && score.points > 0)) return "present";
  return null;
}

export const CONVERTED_LATE_LABEL = "Absent (three consecutive lates)";

export function attendanceTotals(absent: number, present: number, late: number, lateAbsences: number) {
  const effectiveAbsent = absent + lateAbsences;
  const counted = present + absent + late;
  return { lateAbsences, effectiveAbsent, counted, percent: counted ? effectiveAbsent / counted * 100 : null };
}

export function attendanceRiskSummary(
  assessments: ReadonlyArray<{ id: string; title: string; dueDate: Date | null }>,
  scores: ReadonlyMap<string, { remark: string | null; points: number | null }>,
  today: string,
  converted = consecutiveLateAbsences(attendanceDays(assessments, today), id => scores.get(id)?.remark)
) {
  const counts = { absent: 0, present: 0, late: 0, excused: 0 };
  for (const assessment of assessments) {
    if (!assessment.title.toLowerCase().startsWith("attendance ·")) continue;
    if (attendanceDate(assessment) > today) continue;
    const mark = attendanceMark(scores.get(assessment.id));
    if (mark) counts[mark]++;
  }
  const { lateAbsences, effectiveAbsent, counted, percent } = attendanceTotals(
    counts.absent, counts.present, counts.late, converted.size
  );
  return { ...counts, absent: effectiveAbsent, lateAbsences, counted, percent };
}

export const DROPPING_ABSENCE_THRESHOLD = 3;

export type AbsenceStreak = { days: number; startDate: string; endDate: string };

type AttendanceDateSource = { title?: string; dueDate?: Date | string | null };

export function attendanceDate(assessment: AttendanceDateSource) {
  return (typeof assessment.dueDate === "string" ? assessment.dueDate.slice(0, 10) : assessment.dueDate?.toISOString().slice(0, 10))
    || /^attendance ·\s*(\d{4}-\d{2}-\d{2})$/i.exec(assessment.title ?? "")?.[1] || "";
}

export function attendanceDays(
  assessments: ReadonlyArray<AttendanceDateSource & { id: string }>,
  today = "9999-12-31"
) {
  const days = new Map<string, string[]>();
  for (const assessment of assessments) {
    if (!assessment.title?.toLowerCase().startsWith("attendance ·")) continue;
    const date = attendanceDate(assessment);
    if (!date || date > today) continue;
    const ids = days.get(date) ?? [];
    ids.push(assessment.id);
    days.set(date, ids);
  }
  return [...days].sort(([a], [b]) => a.localeCompare(b));
}

export function consecutiveLateAbsences(
  days: ReturnType<typeof attendanceDays>,
  remarkFor: (assessmentId: string) => string | null | undefined
) {
  const converted = new Set<string>();
  let consecutive = 0;
  for (const [, ids] of days) {
    if (!ids.every(id => remarkFor(id) === "LATE")) {
      consecutive = 0;
      continue;
    }
    consecutive++;
    if (consecutive === LATES_PER_ABSENCE) {
      for (const id of ids) converted.add(id);
      consecutive = 0;
    }
  }
  return converted;
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
