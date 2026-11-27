"use client";

import type { CSSProperties } from "react";

import {
  STUDENT_PORTAL_ACCENTS,
  type StudentPortalPreferences,
  type StudentGlassTheme,
  type StudentWallpaper,
  type StudentAccent,
  type StudentLayoutMode,
  safeStudentBackgroundUrl
} from "./types";

const wallpapers: Array<{ id: StudentWallpaper; label: string }> = [
  { id: "sunlit", label: "Sunlit Study Room" },
  { id: "cafe", label: "Blurred Café" },
  { id: "silk", label: "Minimal Silk" },
  { id: "mesh", label: "Mesh Gradient" }
];

export default function PortalCustomizer({
  preferences,
  onChange,
  onReset
}: {
  preferences: StudentPortalPreferences;
  onChange: (next: StudentPortalPreferences) => void;
  onReset: () => void;
}) {
  const update = (patch: Partial<StudentPortalPreferences>) => onChange({ ...preferences, ...patch });
  const updateModule = (name: keyof StudentPortalPreferences["modules"], checked: boolean) =>
    update({ modules: { ...preferences.modules, [name]: checked } });

  return <div className="student-portal-customizer">
    <section className="student-customizer-group">
      <div className="student-customizer-label">Theme &amp; glass mode</div>
      <div className="student-customizer-choice-list" role="group" aria-label="Portal theme">
        {([
          ["light-glass", "Default Light Glass"],
          ["dark-glass", "Smoked Dark Glass"],
          ["classic", "Classic Original Theme"]
        ] as Array<[StudentGlassTheme, string]>).map(([value, label]) =>
          <button key={value} type="button" className={preferences.theme === value ? "is-selected" : ""} aria-pressed={preferences.theme === value} onClick={() => update({ theme: value })}>{label}</button>
        )}
      </div>
    </section>
    <section className="student-customizer-group">
      <div className="student-customizer-label">Ambient wallpaper</div>
      <div className="student-wallpaper-grid">
        {wallpapers.map(item => <button key={item.id} type="button" className={`student-wallpaper-option wallpaper-${item.id}${preferences.wallpaper === item.id ? " is-selected" : ""}`} aria-pressed={preferences.wallpaper === item.id} onClick={() => update({ wallpaper: item.id, customBackgroundUrl: "" })}><span aria-hidden="true"/><b>{item.label}</b></button>)}
      </div>
      <label className="student-customizer-field">Custom image URL
        <input type="url" value={preferences.customBackgroundUrl} placeholder="https://example.com/background.jpg" onChange={event => {
          const raw = event.target.value;
          update({ customBackgroundUrl: raw, wallpaper: safeStudentBackgroundUrl(raw) ? "custom" : "mesh" });
        }}/>
      </label>
      <p className="student-customizer-help">Use a public HTTPS image. The image URL is saved only in this browser.</p>
      {preferences.wallpaper === "none" && <button type="button" className="student-customizer-text-button" onClick={() => update({ wallpaper: "mesh", customBackgroundUrl: "" })}>Use an ambient background</button>}
    </section>
    <section className="student-customizer-group">
      <div className="student-customizer-label">Accent color</div>
      <div className="student-accent-swatches" role="group" aria-label="Accent color palette">
        {(Object.entries(STUDENT_PORTAL_ACCENTS) as Array<[StudentAccent, { label: string; color: string }]>).map(([id, item]) =>
          <button key={id} type="button" className={preferences.accent === id ? "is-selected" : ""} style={{ "--swatch": item.color } as CSSProperties} onClick={() => update({ accent: id })} aria-pressed={preferences.accent === id} aria-label={item.label} title={item.label}><span/></button>
        )}
      </div>
      <div className="student-customizer-help">{STUDENT_PORTAL_ACCENTS[preferences.accent].label}</div>
    </section>
    <section className="student-customizer-group">
      <div className="student-customizer-label">Modules &amp; layout</div>
      <div className="student-customizer-toggles">
        <label><input type="checkbox" checked={preferences.modules.metrics} onChange={event => updateModule("metrics", event.target.checked)}/> KPI cards</label>
        <label><input type="checkbox" checked={preferences.modules.insights} onChange={event => updateModule("insights", event.target.checked)}/> Class insights</label>
        <label><input type="checkbox" checked={preferences.modules.courses} onChange={event => updateModule("courses", event.target.checked)}/> Active courses</label>
      </div>
      <div className="student-customizer-label student-layout-label">Layout mode</div>
      <div className="student-customizer-choice-list two" role="group" aria-label="Layout mode">
        {([["snapped", "Snapped grid"], ["freeform", "Freeform windows"]] as Array<[StudentLayoutMode, string]>).map(([value, label]) =>
          <button key={value} type="button" className={preferences.layout === value ? "is-selected" : ""} aria-pressed={preferences.layout === value} onClick={() => update({ layout: value })}>{label}</button>
        )}
      </div>
      <p className="student-customizer-help">In Freeform mode, drag the small handle above each overview module to reposition it. On smaller screens, modules return to the stacked layout.</p>
    </section>
    <button type="button" className="student-reset-original" onClick={onReset}>↺ Reset to Original</button>
    <p className="student-customizer-help reset-note">Restore the default light-glass theme, wallpaper, ocean accent, visible modules, and panel position.</p>
  </div>;
}
