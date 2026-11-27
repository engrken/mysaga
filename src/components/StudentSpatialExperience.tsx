"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import styles from "./StudentSpatialExperience.module.css";

type StudentSchedule = { id: string; code: string; title: string; term: string; academicYear: string; schedule: string | null };
type ScheduleItem = { day?: string; startTime?: string; endTime?: string };
type StudentGrade = {
  id: string; code: string; title: string; teacher: string;
  status: "DRAFT" | "SUBMITTED" | "VERIFIED";
  percent: number | null; finalGrade: string | null;
  itemCount?: number; recordedCount?: number; term: string; academicYear: string;
};
type Settings = {
  theme: "light" | "dark" | "classic";
  wallpaper: "sunlit" | "cafe" | "silk" | "mesh" | "custom";
  customWallpaper: string;
  accent: "ocean" | "emerald" | "violet" | "amber" | "rose";
  modules: { insights: boolean; courses: boolean };
  layout: "snapped" | "freeform";
  minimized: boolean;
  offset: { x: number; y: number };
};
const DEFAULTS: Settings = {
  theme: "light", wallpaper: "mesh", customWallpaper: "",
  accent: "ocean", modules: { insights: true, courses: true },
  layout: "snapped", minimized: false, offset: { x: 0, y: 0 }
};
const STORAGE_KEY = "saga-student-spatial-v1";
const ACCENTS = {
  ocean: { label: "Ocean Blue", value: "#4f8df7" },
  emerald: { label: "Emerald", value: "#25b887" },
  violet: { label: "Violet", value: "#9875f5" },
  amber: { label: "Amber", value: "#e6a23c" },
  rose: { label: "Rose", value: "#ec7290" }
};
const WALLPAPERS = [
  { id: "sunlit", label: "Sunlit Study Room" },
  { id: "cafe", label: "Blurred Café" },
  { id: "silk", label: "Minimal Silk" },
  { id: "mesh", label: "Mesh Gradient" }
] as const;

function safeSettings(raw: string | null): Settings {
  if (!raw) return DEFAULTS;
  try {
    const value = JSON.parse(raw) as Partial<Settings>;
    const accent = value.accent && value.accent in ACCENTS ? value.accent : DEFAULTS.accent;
    const wallpaper = WALLPAPERS.some(item => item.id === value.wallpaper) || value.wallpaper === "custom" ? value.wallpaper! : DEFAULTS.wallpaper;
    const theme = value.theme === "dark" || value.theme === "classic" ? value.theme : "light";
    const custom = typeof value.customWallpaper === "string" && /^https:\/\//i.test(value.customWallpaper) ? value.customWallpaper : "";
    return {
      ...DEFAULTS, ...value, theme, wallpaper, accent, customWallpaper: custom,
      modules: { ...DEFAULTS.modules, ...(value.modules ?? {}) },
      offset: { x: Number(value.offset?.x) || 0, y: Number(value.offset?.y) || 0 }
    };
  } catch { return DEFAULTS; }
}
function Icon({ children }: { children: string }) {
  return <span className={styles.icon} aria-hidden="true">{children}</span>;
}
function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export default function StudentSpatialExperience({
  userId, fullName, grades, academicYear, term, pendingAssessments, attendanceAlerts, isDemo
}: {
  userId: string; fullName: string; grades: StudentGrade[]; academicYear: string; term: string;
  pendingAssessments: number; attendanceAlerts: number; isDemo?: boolean;
}) {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [ready, setReady] = useState(false);
  const [panelView, setPanelView] = useState<"checklist" | "customize">("checklist");
  const [toast, setToast] = useState("");
  const [schedule, setSchedule] = useState<StudentSchedule[]>([]);
  const [zIndex, setZIndex] = useState(30);
  const drag = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const stageRef = useRef<HTMLElement>(null);
  const average = useMemo(() => {
    const scored = grades.map(item => item.percent).filter((value): value is number => typeof value === "number");
    return scored.length ? scored.reduce((sum, value) => sum + value, 0) / scored.length : null;
  }, [grades]);
  const completion = useMemo(() => {
    const total = grades.reduce((sum, item) => sum + (item.itemCount ?? 0), 0);
    const done = grades.reduce((sum, item) => sum + Math.min(item.itemCount ?? 0, item.recordedCount ?? 0), 0);
    return total ? Math.round(done / total * 100) : 0;
  }, [grades]);
  const storage = useCallback(() => isDemo ? window.sessionStorage : window.localStorage, [isDemo]);
  const storageKey = `${STORAGE_KEY}:${userId}`;

  useEffect(() => {
    setSettings(safeSettings(storage().getItem(storageKey)));
    setReady(true);
  }, [storage, storageKey]);
  useEffect(() => {
    if (!ready) return;
    storage().setItem(storageKey, JSON.stringify(settings));
  }, [ready, settings, storage, storageKey]);
  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({ academicYear, term });
    fetch(`/api/student/classes?${params.toString()}`, { cache: "no-store" })
      .then(response => response.ok ? response.json() : null)
      .then(data => { if (active && Array.isArray(data?.classes)) setSchedule(data.classes as StudentSchedule[]); })
      .catch(() => { if (active) setSchedule([]); });
    return () => { active = false; };
  }, [academicYear, term]);

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => setSettings(current => ({ ...current, [key]: value }));
  const reset = () => {
    if (!window.confirm("Reset your Student Portal appearance and panel positions to the original defaults?")) return;
    storage().removeItem(storageKey);
    setSettings(DEFAULTS);
    setToast("Original layout restored");
    window.setTimeout(() => setToast(""), 2600);
  };
  const onDragStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (settings.layout !== "freeform" || window.matchMedia("(max-width: 767px)").matches) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: settings.offset.x, originY: settings.offset.y };
    setZIndex(value => value + 1);
  };
  const onDragMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const panel = event.currentTarget.closest("aside");
    const width = panel?.getBoundingClientRect().width ?? 320;
    const height = panel?.getBoundingClientRect().height ?? 480;
    const nextX = clamp(active.originX + event.clientX - active.startX, -window.innerWidth + width + 36, 12);
    const nextY = clamp(active.originY + event.clientY - active.startY, -128, window.innerHeight - height - 152);
    setSettings(current => ({ ...current, offset: { x: nextX, y: nextY } }));
  };
  const onDragEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId === event.pointerId) drag.current = null;
  };
  const themeStyle = {
    "--spatial-accent": ACCENTS[settings.accent].value,
    "--spatial-wallpaper": settings.wallpaper === "custom" && settings.customWallpaper
      ? `url("${settings.customWallpaper.replaceAll('"', "%22")}")`
      : "none"
  } as CSSProperties;

  return <section ref={stageRef} className={styles.stage} data-theme={settings.theme} data-wallpaper={settings.wallpaper} style={themeStyle}>
    <div className={styles.ambient} aria-hidden="true"/>
    <div className={styles.topline}>
      <div><span className={styles.kicker}>YOUR LEARNING SPACE</span><h2>Good day, {fullName.split(" ")[0]} <span aria-hidden="true">✦</span></h2><p>Your academic snapshot, organized around what matters today.</p></div>
      <button type="button" className={styles.customizeButton} onClick={() => { update("minimized", false); setPanelView("customize"); setZIndex(value => value + 1); }}> <Icon>⚙</Icon> Customize portal</button>
    </div>

    {isDemo && <div className={styles.demoBar}><span><i/> DEMO MODE · Changes stay in this browser session</span><div><button type="button" onClick={() => update("theme", "dark")}>Try Dark Glass</button><button type="button" onClick={reset}>Reset layout</button></div></div>}

    <div className={styles.kpis}>
      <article className={styles.glassCard}><span className={styles.pill}>ACADEMIC PERFORMANCE</span><div className={styles.kpiValue}>{average === null ? "—" : `${average.toFixed(1)}%`}</div><p>Average of visible class records</p><div className={styles.kpiTrack}><span style={{ width: `${Math.min(100, average ?? 0)}%` }}/></div></article>
      <article className={styles.glassCard}><span className={styles.pill} data-tone="green">ATTENDANCE WATCH</span><div className={styles.kpiValue}>{attendanceAlerts}</div><p>{attendanceAlerts ? "Class record(s) need your attention" : "No attendance alerts in your records"}</p><div className={styles.kpiFoot}><Icon>◷</Icon> Based on teacher-recorded attendance</div></article>
      <article className={styles.glassCard}><span className={styles.pill} data-tone="amber">PENDING ASSESSMENTS</span><div className={styles.kpiValue}>{pendingAssessments}</div><p>Items not yet recorded by your teachers</p><div className={styles.kpiFoot}><Icon>✓</Icon> Across your visible classes</div></article>
    </div>

    {settings.modules.insights && <div className={styles.insights}>
      <section className={styles.glassCard}>
        <div className={styles.sectionHead}><div><span className={styles.kicker}>CLASS INSIGHTS</span><h3>Course progress</h3></div><span className={styles.liveTag}><i/> LIVE RECORDS</span></div>
        {grades.length ? <div className={styles.courseRows}>{grades.slice(0, 5).map(grade => {
          const total = grade.itemCount ?? 0; const done = Math.min(total, grade.recordedCount ?? 0); const pct = total ? Math.round(done / total * 100) : 0;
          return <article key={grade.id} className={styles.courseRow}><div className={styles.courseMark}>{grade.code.slice(0, 2)}</div><div className={styles.courseInfo}><strong>{grade.code} · {grade.title}</strong><span>{grade.teacher || "Instructor not listed"}</span><div className={styles.progress}><i style={{ width: `${pct}%` }}/></div></div><div className={styles.courseStatus}><b>{pct}%</b><small>{grade.status === "VERIFIED" ? "Graded" : grade.status === "SUBMITTED" ? "Submitted" : "In progress"}</small></div></article>;
        })}</div> : <div className={styles.empty}>Your courses will appear here when your teachers share them.</div>}
      </section>
      <section className={styles.glassCard}>
        <div className={styles.sectionHead}><div><span className={styles.kicker}>PERFORMANCE ANALYTICS</span><h3>Your learning momentum</h3></div><span className={styles.chartBadge}>OVERVIEW</span></div>
        <div className={styles.chartArea}>
          <div className={styles.ring} style={{ "--ring-progress": `${completion}%` } as CSSProperties}><div><strong>{completion}%</strong><span>recorded</span></div></div>
          <div className={styles.chartLegend}><strong>{grades.length} active class{grades.length === 1 ? "" : "es"}</strong><p>Assessment records entered by your instructors.</p><div><i/> Recorded items <b>{grades.reduce((sum, grade) => sum + Math.min(grade.itemCount ?? 0, grade.recordedCount ?? 0), 0)}</b></div><div><i/> Not yet recorded <b>{pendingAssessments}</b></div></div>
        </div>
        <div className={styles.chartFoot}>Progress updates when your teachers save assessment records.</div>
      </section>
    </div>}

    {settings.modules.courses && <section className={styles.glassCard + " " + styles.activeCourses}>
      <div className={styles.sectionHead}><div><span className={styles.kicker}>YOUR WEEKLY WORKSPACE</span><h3>Weekly class schedule</h3><p>Your enrolled classes and the meeting times published by your instructors.</p></div><span className={styles.chartBadge}>{grades.length} ENROLLED</span></div>
      <div className={styles.activeCourseGrid}>{schedule.slice(0, 8).map(item => {
        let meetings: ScheduleItem[] = [];
        let legacySchedule = "";
        try {
          const parsed = item.schedule ? JSON.parse(item.schedule) : [];
          meetings = Array.isArray(parsed) ? parsed : [];
          if (typeof parsed === "string") legacySchedule = parsed;
        } catch { legacySchedule = item.schedule ?? ""; }
        return <article key={item.id}><span>{item.code}</span><strong>{item.title}</strong>
          {meetings.length ? meetings.map((meeting, index) => <small key={`${item.id}-${index}`}>{meeting.day || "Schedule"} · {meeting.startTime || "Time TBA"}{meeting.endTime ? `–${meeting.endTime}` : ""}</small>) : <small>{legacySchedule || "Meeting schedule not published"}</small>}
          <b>{item.term} · {item.academicYear}</b></article>;
      })}</div>
      {!schedule.length && <div className={styles.empty}>No active courses are available for this academic period.</div>}
    </section>}

    <aside className={styles.floatingPanel} onMouseDown={() => setZIndex(value => value + 1)} style={{ zIndex, transform: `translate3d(${settings.offset.x}px,${settings.offset.y}px,0)` }} hidden={settings.minimized}>
      <div className={styles.panelHandle} onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd} onPointerCancel={onDragEnd}>
        <span className={styles.grip}/><span>STUDENT COMPANION</span><button type="button" aria-label="Minimize companion panel" onPointerDown={event => event.stopPropagation()} onClick={() => update("minimized", true)}>−</button>
      </div>
      <div className={styles.panelTabs}><button type="button" className={panelView === "checklist" ? styles.selected : ""} onClick={() => setPanelView("checklist")}>Live class & tasks</button><button type="button" className={panelView === "customize" ? styles.selected : ""} onClick={() => setPanelView("customize")}>Customize</button></div>
      {panelView === "checklist" ? <div className={styles.panelBody}><span className={styles.kicker}>YOUR CHECKLIST</span>
        <div className={styles.task}><i className={styles.taskDot}/><div><strong>Review your latest class records</strong><small>{grades.length} visible course(s) available</small></div></div>
        <div className={styles.task}><i className={styles.taskDot} data-warn={pendingAssessments > 0}/><div><strong>Check pending assessment entries</strong><small>{pendingAssessments} item(s) not yet recorded</small></div></div>
        <div className={styles.task}><i className={styles.taskDot} data-warn={attendanceAlerts > 0}/><div><strong>Review attendance notices</strong><small>{attendanceAlerts ? `${attendanceAlerts} course alert(s) need review` : "No attendance alerts recorded"}</small></div></div>
        <div className={styles.panelNote}>Live class meeting status is shown when your instructor publishes a class session.</div>
      </div> : <div className={styles.panelBody}>
        <div className={styles.customGroup}><label>Glass appearance</label><div className={styles.choiceRow}><button type="button" aria-pressed={settings.theme === "light"} onClick={() => update("theme", "light")}>Light glass</button><button type="button" aria-pressed={settings.theme === "dark"} onClick={() => update("theme", "dark")}>Smoked dark</button><button type="button" aria-pressed={settings.theme === "classic"} onClick={() => update("theme", "classic")}>Classic</button></div></div>
        <div className={styles.customGroup}><label>Ambient wallpaper</label><select value={settings.wallpaper} onChange={event => update("wallpaper", event.target.value as Settings["wallpaper"])}>{WALLPAPERS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}<option value="custom">Custom image URL</option></select>
          {settings.wallpaper === "custom" && <input type="url" placeholder="https://example.com/wallpaper.jpg" value={settings.customWallpaper} onChange={event => { const value = event.target.value.trim(); update("customWallpaper", !value || /^https:\/\//i.test(value) ? value : ""); }} />}</div>
        <div className={styles.customGroup}><label>Accent palette</label><div className={styles.swatches}>{Object.entries(ACCENTS).map(([key, item]) => <button key={key} type="button" aria-label={item.label} title={item.label} aria-pressed={settings.accent === key} style={{ background: item.value }} onClick={() => update("accent", key as Settings["accent"])}/>)}</div></div>
        <div className={styles.customGroup}><label>Visible modules</label><label className={styles.check}><input type="checkbox" checked={settings.modules.insights} onChange={event => setSettings(current => ({ ...current, modules: { ...current.modules, insights: event.target.checked } }))}/> Class insights</label><label className={styles.check}><input type="checkbox" checked={settings.modules.courses} onChange={event => setSettings(current => ({ ...current, modules: { ...current.modules, courses: event.target.checked } }))}/> Active courses</label></div>
        <div className={styles.customGroup}><label>Window layout</label><div className={styles.choiceRow}><button type="button" aria-pressed={settings.layout === "snapped"} onClick={() => update("layout", "snapped")}>Snapped grid</button><button type="button" aria-pressed={settings.layout === "freeform"} onClick={() => update("layout", "freeform")}>Freeform drag</button></div></div>
        <button type="button" className={styles.reset} onClick={reset}>↺ Reset to Original</button>
      </div>}
    </aside>
    {settings.minimized && <button type="button" className={styles.dock} onClick={() => update("minimized", false)}><span>✦</span> Student companion <b>↗</b></button>}
    {toast && <div className={styles.toast} role="status">{toast}</div>}
  </section>;
}
