"use client";

import { useEffect, useMemo, useState } from "react";
import type { StudentGradeSummary, StudentPortalPreferences } from "./types";
import { STUDENT_PORTAL_ACCENTS } from "./types";
import DraggableGlassWindow from "./DraggableGlassWindow";
import PortalCustomizer from "./PortalCustomizer";
import ClassInsightsPanel, { scheduleLabel } from "./ClassInsightsPanel";

type ChecklistItem = { title: string; detail: string; state: "done" | "pending" | "attention" };

export default function OverviewDashboard({
  fullName,
  grades,
  attendanceWarnings,
  preferences,
  onPreferencesChange,
  onReset,
  storageReady,
  customizerRequested,
  onCustomizerOpened,
  demoMode = false
}: {
  fullName: string;
  grades: StudentGradeSummary[];
  attendanceWarnings: StudentGradeSummary[];
  preferences: StudentPortalPreferences;
  onPreferencesChange: (next: StudentPortalPreferences) => void;
  onReset: () => void;
  storageReady: boolean;
  customizerRequested: boolean;
  onCustomizerOpened: () => void;
  demoMode?: boolean;
}) {
  const [panelMinimized, setPanelMinimized] = useState(false);
  const [panelTab, setPanelTab] = useState<"checklist" | "customizer">("checklist");
  const [panelFront, setPanelFront] = useState(false);

  useEffect(() => {
    if (customizerRequested) {
      setPanelTab("customizer");
      setPanelMinimized(false);
      onCustomizerOpened();
    }
  }, [customizerRequested, onCustomizerOpened]);

  const metrics = useMemo(() => {
    const visiblePercents = grades.map(grade => grade.percent).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    const average = visiblePercents.length ? visiblePercents.reduce((sum, value) => sum + value, 0) / visiblePercents.length : null;
    const attendance = grades.reduce((result, grade) => {
      const source = grade.attendanceSummary;
      if (!source || !source.counted) return result;
      return { absent: result.absent + source.absent, counted: result.counted + source.counted };
    }, { absent: 0, counted: 0 });
    const attendanceRate = attendance.counted ? Math.max(0, 100 * (attendance.counted - attendance.absent) / attendance.counted) : null;
    const pending = grades.reduce((sum, grade) => sum + Math.max(0, (grade.itemCount ?? 0) - (grade.recordedCount ?? 0)), 0);
    return { average, attendanceRate, pending, visible: grades.length };
  }, [grades]);

  const checklist = useMemo<ChecklistItem[]>(() => {
    if (demoMode) return [
      { title: "ECE 18 · Wireless Communications", detail: "In Session · Sample online room", state: "attention" },
      { title: "ECE 23 · Microprocessor Systems", detail: "Due Today · Lab worksheet", state: "pending" },
      { title: "Review shared grade updates", detail: "1 teacher-verified course record", state: "done" }
    ];
    const items: ChecklistItem[] = [];
    if (metrics.pending > 0) items.push({ title: "Review unrecorded assessment items", detail: `${metrics.pending} item(s) are not yet recorded in your visible class records`, state: "pending" });
    if (attendanceWarnings.length) items.push({ title: "Check attendance alerts", detail: `${attendanceWarnings.length} class record(s) need attention`, state: "attention" });
    if (grades.some(grade => grade.status === "VERIFIED")) items.push({ title: "Review verified grade updates", detail: `${grades.filter(grade => grade.status === "VERIFIED").length} teacher-verified record(s)`, state: "done" });
    if (!items.length) items.push({ title: "You're up to date", detail: "No pending assessment or attendance alerts are available for this period", state: "done" });
    return items;
  }, [attendanceWarnings.length, demoMode, grades, metrics.pending]);

  const updatePosition = (panelPosition: { x: number; y: number }) =>
    onPreferencesChange({ ...preferences, panelPosition });

  const accentColor = STUDENT_PORTAL_ACCENTS[preferences.accent].color;
  const averageValue = metrics.average === null ? "—" : `${metrics.average.toFixed(1)}%`;
  const attendanceValue = metrics.attendanceRate === null ? "—" : `${Math.round(metrics.attendanceRate)}%`;

  return <div className="student-spatial-dashboard" data-student-glass-theme={preferences.theme} data-student-wallpaper={preferences.wallpaper} data-student-layout={preferences.layout} style={{ "--student-accent": accentColor, "--student-panel-z": panelFront ? 125 : 96 } as React.CSSProperties}>
    <div className="student-spatial-heading">
      <div><span className="student-spatial-eyebrow">YOUR LEARNING SPACE</span><h2>Good day, {fullName.split(" ")[0]}.</h2><p>Your academic overview, course progress, and class updates in one place.</p></div>
      <span className="student-spatial-period">{grades[0]?.term || "Current term"} · {grades[0]?.academicYear || "Academic records"}</span>
    </div>

    {preferences.modules.metrics && <section className="student-glass-kpi-row" aria-label="Academic key indicators">
      <article className="student-glass-kpi-card"><span className="student-kpi-pill">ACADEMIC AVERAGE</span><strong>{averageValue}</strong><small>Simple mean of visible course percentages</small></article>
      <article className="student-glass-kpi-card"><span className="student-kpi-pill">ATTENDANCE RATE</span><strong>{attendanceValue}</strong><small>{metrics.attendanceRate === null ? "No recorded roll calls for this period" : "Based on recorded attendance marks"}</small></article>
      <article className="student-glass-kpi-card"><span className="student-kpi-pill">PENDING ITEMS</span><strong>{metrics.pending}</strong><small>Unrecorded assessment items across {metrics.visible} visible class(es)</small></article>
    </section>}

    {preferences.modules.insights && <ClassInsightsPanel grades={grades} attendanceRate={metrics.attendanceRate} average={metrics.average}/>}

    {preferences.modules.courses && <section className="student-glass-active-courses" aria-label="Active courses and weekly schedules">
      <div className="student-glass-module-heading"><div><span>THIS ACADEMIC PERIOD</span><h2>Active courses &amp; weekly schedule</h2></div><span className="student-glass-count">{grades.length} course(s)</span></div>
      {grades.length ? <div className="student-glass-schedule-grid">{grades.map(grade => <a className="student-glass-schedule-card" key={grade.id} href={`#student-grade-${encodeURIComponent(grade.id)}`}>
        <span className="student-glass-course-mark">{grade.code.slice(0, 2)}</span><span><b>{grade.code} — {grade.title}</b><small>{grade.teacher}</small><small>{scheduleLabel(grade.schedule)}</small></span><strong>{grade.percent === null ? "—" : `${grade.percent.toFixed(1)}%`}</strong>
      </a>)}</div> : <div className="student-glass-empty">No course records are visible yet. Your teachers' shared classes will appear here.</div>}
    </section>}

    <DraggableGlassWindow
      title="Student quick panel"
      minimized={panelMinimized}
      onMinimize={() => setPanelMinimized(true)}
      onExpand={() => { setPanelMinimized(false); setPanelFront(true); }}
      position={preferences.panelPosition}
      onPositionChange={updatePosition}
    >
      <div className="student-floating-tabs" role="tablist" aria-label="Quick panel views">
        <button type="button" role="tab" aria-selected={panelTab === "checklist"} className={panelTab === "checklist" ? "active" : ""} onClick={() => setPanelTab("checklist")}>Live class &amp; tasks</button>
        <button type="button" role="tab" aria-selected={panelTab === "customizer"} className={panelTab === "customizer" ? "active" : ""} onClick={() => setPanelTab("customizer")}>Customize</button>
      </div>
      {panelTab === "checklist" ? <div className="student-glass-checklist">
        {checklist.map((item, index) => <article key={item.title} className={`student-glass-checklist-item state-${item.state}`}>
          <span aria-hidden="true">{item.state === "done" ? "✓" : item.state === "attention" ? "!" : "◷"}</span><div><b>{item.title}</b><small>{item.detail}</small></div>
        </article>)}
        {demoMode && <p className="student-glass-demo-note">Sample activity statuses are fictional and included to demonstrate the interface.</p>}
        {!demoMode && <p className="student-glass-demo-note">SAGA shows recorded class and assessment information here. It does not infer a live meeting from a timetable.</p>}
      </div> : <PortalCustomizer preferences={preferences} onChange={onPreferencesChange} onReset={onReset}/>}
    </DraggableGlassWindow>
    <div className="student-glass-dashboard-footer"><span>{storageReady && !demoMode ? "Preferences saved in this browser" : "Changes stay in this session"}</span><button type="button" onClick={() => { setPanelTab("customizer"); setPanelMinimized(false); }}>Customize portal</button></div>
  </div>;
}
