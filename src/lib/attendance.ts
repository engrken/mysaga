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
