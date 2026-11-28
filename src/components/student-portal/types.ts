export type StudentGlassTheme = "light-glass" | "dark-glass" | "classic";
export type StudentWallpaper = "sunlit" | "cafe" | "silk" | "mesh" | "none" | "custom";
export type StudentAccent = "ocean" | "emerald" | "violet" | "amber" | "rose";
export type StudentLayoutMode = "snapped" | "freeform";
export type StudentModuleKey = "metrics" | "insights" | "courses";
export type StudentModulePosition = { x: number; y: number };

export type StudentPortalPreferences = {
  theme: StudentGlassTheme;
  wallpaper: StudentWallpaper;
  customBackgroundUrl: string;
  accent: StudentAccent;
  layout: StudentLayoutMode;
  modules: { metrics: boolean; insights: boolean; courses: boolean };
  panelPosition: { x: number; y: number };
  modulePositions: Record<StudentModuleKey, StudentModulePosition>;
};

export const STUDENT_PORTAL_DEFAULTS: StudentPortalPreferences = {
  theme: "light-glass",
  wallpaper: "mesh",
  customBackgroundUrl: "",
  accent: "ocean",
  layout: "snapped",
  modules: { metrics: true, insights: true, courses: true },
  panelPosition: { x: 0, y: 0 },
  modulePositions: { metrics: { x: 0, y: 0 }, insights: { x: 0, y: 0 }, courses: { x: 0, y: 0 } }
};

export const STUDENT_PORTAL_ACCENTS: Record<StudentAccent, { label: string; color: string }> = {
  ocean: { label: "Ocean Blue", color: "#3985e8" },
  emerald: { label: "Emerald", color: "#18a879" },
  violet: { label: "Violet", color: "#8a6be8" },
  amber: { label: "Amber", color: "#d89532" },
  rose: { label: "Rose", color: "#e16f91" }
};

export type StudentAttendanceSummary = {
  absent: number;
  present: number;
  late: number;
  excused: number;
  counted: number;
  percent: number | null;
  lateAbsences?: number;
};
export type StudentAttendanceWarning = Omit<StudentAttendanceSummary, "percent"> & {
  percent: number;
  lateAbsences: number;
};

export type StudentGradeSummary = {
  id: string;
  code: string;
  title: string;
  teacher: string;
  term: string;
  academicYear: string;
  classId?: string | null;
  schedule?: string | null;
  status: "DRAFT" | "SUBMITTED" | "VERIFIED";
  percent: number | null;
  finalGrade: string | null;
  itemCount?: number;
  recordedCount?: number;
  attendanceSummary?: StudentAttendanceSummary;
  attendanceWarning?: StudentAttendanceWarning | null;
  droppingWarning?: { days: number; startDate: string; endDate: string; dates: string[] } | null;
};

export function safeStudentBackgroundUrl(value: string) {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

export function mergeStudentPortalPreferences(value: unknown): StudentPortalPreferences {
  if (!value || typeof value !== "object") return STUDENT_PORTAL_DEFAULTS;
  const input = value as Partial<StudentPortalPreferences>;
  const isOneOf = <T extends string>(candidate: unknown, values: readonly T[]): candidate is T =>
    typeof candidate === "string" && values.includes(candidate as T);
  const modules: Partial<StudentPortalPreferences["modules"]> = input.modules && typeof input.modules === "object" ? input.modules : {};
  const point: Partial<StudentPortalPreferences["panelPosition"]> = input.panelPosition && typeof input.panelPosition === "object" ? input.panelPosition : {};
  const modulePositions: Partial<StudentPortalPreferences["modulePositions"]> = input.modulePositions && typeof input.modulePositions === "object" ? input.modulePositions : {};
  const coordinate = (raw: unknown, fallback: number) =>
    typeof raw === "number" && Number.isFinite(raw) ? Math.max(-1200, Math.min(6000, raw)) : fallback;
  const modulePoint = (name: StudentModuleKey): StudentModulePosition => {
    const raw = modulePositions[name] && typeof modulePositions[name] === "object" ? modulePositions[name] : {};
    return {
      x: coordinate((raw as Partial<StudentModulePosition>).x, 0),
      y: coordinate((raw as Partial<StudentModulePosition>).y, 0)
    };
  };
  return {
    theme: isOneOf(input.theme, ["light-glass", "dark-glass", "classic"]) ? input.theme : STUDENT_PORTAL_DEFAULTS.theme,
    wallpaper: isOneOf(input.wallpaper, ["sunlit", "cafe", "silk", "mesh", "none", "custom"]) ? input.wallpaper : STUDENT_PORTAL_DEFAULTS.wallpaper,
    customBackgroundUrl: typeof input.customBackgroundUrl === "string" ? safeStudentBackgroundUrl(input.customBackgroundUrl) : "",
    accent: isOneOf(input.accent, ["ocean", "emerald", "violet", "amber", "rose"]) ? input.accent : STUDENT_PORTAL_DEFAULTS.accent,
    layout: isOneOf(input.layout, ["snapped", "freeform"]) ? input.layout : STUDENT_PORTAL_DEFAULTS.layout,
    modules: {
      metrics: typeof modules.metrics === "boolean" ? modules.metrics : true,
      insights: typeof modules.insights === "boolean" ? modules.insights : true,
      courses: typeof modules.courses === "boolean" ? modules.courses : true
    },
    panelPosition: {
      x: coordinate(point.x, STUDENT_PORTAL_DEFAULTS.panelPosition.x),
      y: point.y === 116 ? 0 : coordinate(point.y, STUDENT_PORTAL_DEFAULTS.panelPosition.y)
    },
    modulePositions: {
      metrics: modulePoint("metrics"),
      insights: modulePoint("insights"),
      courses: modulePoint("courses")
    }
  };
}
