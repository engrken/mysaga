"use client";

import type { CSSProperties } from "react";

import type { StudentGradeSummary } from "./types";

function statusLabel(status: StudentGradeSummary["status"]) {
  if (status === "VERIFIED") return "Graded";
  if (status === "SUBMITTED") return "Submitted";
  return "In progress";
}

function scheduleLabel(value?: string | null) {
  if (!value) return "Schedule not posted";
  try {
    const parsed = JSON.parse(value) as Array<{ label?: string; day?: string; startTime?: string; endTime?: string }>;
    if (Array.isArray(parsed)) {
      const first = parsed.slice(0, 2).map(row => [row.label || "Class", row.day, [row.startTime, row.endTime].filter(Boolean).join("–")].filter(Boolean).join(" · "));
      return first.join(" / ") || "Schedule not posted";
    }
  } catch { /* Legacy free-text schedules are shown as entered. */ }
  return value;
}

export default function ClassInsightsPanel({
  grades,
  attendanceRate,
  average
}: {
  grades: StudentGradeSummary[];
  attendanceRate: number | null;
  average: number | null;
}) {
  const courseRows = grades.slice(0, 5);
  return <section className="student-glass-insights" aria-label="Class insights and performance">
    <div className="student-glass-insight-list">
      <div className="student-glass-module-heading"><div><span>YOUR CLASSES</span><h2>Class insights</h2></div><span className="student-glass-count">{grades.length} active</span></div>
      {courseRows.length ? <div className="student-glass-course-rows">{courseRows.map(grade => {
        const total = grade.itemCount ?? 0;
        const recorded = Math.min(total, grade.recordedCount ?? 0);
        const progress = total ? Math.round(recorded / total * 100) : 0;
        return <a className="student-glass-course-row" key={grade.id} href={`#student-grade-${encodeURIComponent(grade.id)}`}>
          <span className="student-glass-course-mark">{grade.code.slice(0, 2)}</span>
          <span className="student-glass-course-copy">
            <b>{grade.code} · {grade.title}</b>
            <small>{grade.teacher} · {recorded}/{total} assessments recorded</small>
            <span className="student-glass-progress"><i style={{ width: `${progress}%` }}/></span>
          </span>
          <span className={`student-glass-status status-${grade.status.toLowerCase()}`}>{statusLabel(grade.status)}</span>
        </a>;
      })}</div> : <div className="student-glass-empty">Your enrolled classes will appear here when a teacher shares a record.</div>}
      {grades.length > 5 && <p className="student-glass-subtle">Showing 5 of {grades.length} classes. See Active courses below for the complete list.</p>}
    </div>
    <div className="student-glass-analytics">
      <div className="student-glass-module-heading"><div><span>ACADEMIC SIGNALS</span><h2>Performance snapshot</h2></div><span className="student-glass-live-dot">Live data</span></div>
      <div className="student-glass-radials">
        <div className="student-glass-radial" style={{ "--progress": `${Math.max(0, Math.min(100, attendanceRate ?? 0)) * 3.6}deg` } as CSSProperties} aria-label={attendanceRate === null ? "Attendance data unavailable" : `Attendance rate ${attendanceRate.toFixed(1)} percent`}>
          <div><strong>{attendanceRate === null ? "—" : `${Math.round(attendanceRate)}%`}</strong><small>Attendance</small></div>
        </div>
        <div className="student-glass-radial accent" style={{ "--progress": `${Math.max(0, Math.min(100, average ?? 0)) * 3.6}deg` } as React.CSSProperties} aria-label={average === null ? "Course average unavailable" : `Course average ${average.toFixed(1)} percent`}>
          <div><strong>{average === null ? "—" : `${average.toFixed(1)}%`}</strong><small>Course average</small></div>
        </div>
      </div>
      <div className="student-glass-metric-key"><span><i className="attendance-key"/> Attendance across recorded roll calls</span><span><i className="average-key"/> Average of visible course percentages</span></div>
      <p className="student-glass-subtle">Attendance excludes excused roll calls. Course average is a simple mean of visible SAGA class percentages, not a registrar GPA.</p>
    </div>
  </section>;
}

export { scheduleLabel };
