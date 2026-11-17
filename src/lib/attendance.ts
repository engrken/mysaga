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
