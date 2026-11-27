"use client";
import { Fragment, FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import ChangeEmailForm from "./ChangeEmailForm";
import RealDemoBanner from "./RealDemoBanner";
import AccountMenu, { type AccountTheme } from "./AccountMenu";
import { saveSagaTheme } from "./ThemeSync";
import GradeVisibilityManager from "./GradeVisibilityManager";
import GradeContributionPanel from "./GradeContributionPanel";
import ClassRosterEnrollmentTools from "./ClassRosterEnrollmentTools";
import GoogleChatControls from "./GoogleChatControls";
import { DemoGoogleChatControls } from "./DemoClassChats";
import StudentClassEnrollment from "./StudentClassEnrollment";
import OverviewDashboard from "./student-portal/OverviewDashboard";
import { STUDENT_PORTAL_ACCENTS, STUDENT_PORTAL_DEFAULTS, mergeStudentPortalPreferences, safeStudentBackgroundUrl, type StudentPortalPreferences, type StudentAttendanceSummary, type StudentAttendanceWarning } from "./student-portal/types";
// These large interactive tools are only downloaded when opened.
const GradeWhatIfSimulator = dynamic(() => import("./GradeWhatIfSimulator"));
const HelpCenter = dynamic(() => import("./PortalGuides").then(module => module.HelpCenter));
const OnboardingGuide = dynamic(() => import("./PortalGuides").then(module => module.OnboardingGuide));
const PhilippineHolidayCalendar = dynamic(() => import("./PhilippineHolidayCalendar").then(module => module.PhilippineHolidayCalendar));
const TeacherActivities = dynamic(() => import("./ClassActivities").then(module => module.TeacherActivities));
const RecentActivitySubmissions = dynamic(() => import("./ClassActivities").then(module => module.RecentActivitySubmissions));
const StudentActivities = dynamic(() => import("./ClassActivities").then(module => module.StudentActivities));
const ClassChatsHub = dynamic(() => import("./ClassChatsHub"));
const TeacherClassAnnouncements = dynamic(() => import("./SagaAnnouncements").then(module => module.TeacherClassAnnouncements));
const StudentAnnouncements = dynamic(() => import("./SagaAnnouncements").then(module => module.StudentAnnouncements));
import { calculateCategoryPercent, calculateFinal, calculateGradeBreakdown, convertRawPercent, remainingChildAllocation } from "@/lib/grades";
import { classWorkspaceHref, resolveClassRoute, parseClassWorkspaceQuery, type ClassSection } from "@/lib/class-navigation";
import { todayManila } from "@/lib/tenant-operations";
import { absenceDates, attendanceDays as orderedAttendanceDays, attendanceRiskSummary, consecutiveLateAbsences, CONVERTED_LATE_LABEL, droppingAbsenceStreak, DROPPING_ABSENCE_THRESHOLD, EARLY_ABSENCE_PERCENT, HIGH_RISK_ABSENCE_PERCENT, type AbsenceDate, type AbsenceStreak } from "@/lib/attendance";
import { scheduleWeekdays, weekdayFromDate } from "@/lib/schedule-days";
import { buildWorkbookPages, workbookWidths } from "@/lib/scorebook-layout";

type User = { id: string; role: string; fullName: string; positionTitle: string | null; notedByName: string | null; notedByPosition: string | null; email: string; isDemo?: boolean; isTenantManager?: boolean; isSchoolAdmin?: boolean; emailDeliveryEnabled?: boolean; profileImagePath: string | null; facultyId?: string | null; defaultGradeSheetComponents?: string | null; courseProgram?: string | null; yearLevel?: string | null; school: { id: string; slug: string; name: string; shortName: string; portalTitle: string; logoText: string; logoPath: string | null; departmentLogoPath: string | null; primaryColor: string; address: string | null; departmentName: string | null; isoHeaderConfig: string | null } };
type WorkbookChange = { subjectId: string; enrollmentId: string; assessmentId: string; points: number | null; remark: "EXCUSED" | "ABSENT" | "DID_NOT_SUBMIT" | null };
type AttendanceMark = { subjectId: string; enrollmentId: string; assessmentId: string; remark: "PRESENT" | "LATE" | "ABSENT" | "EXCUSED" | null };
type Subject = { id: string; classId: string | null; code: string; title: string; term: string; academicYear: string; schedule: string | null; courseYear: string | null; courseProgram?: string | null; yearLevel?: string | null; section?: string | null; gradeSheetComponents?: string | null; isPublished: boolean; gradeStatus: "DRAFT" | "SUBMITTED" | "VERIFIED"; submittedAt: string | null; verifiedAt: string | null; _count?: { enrollments: number } };
type Category = { id: string; parentId: string | null; name: string; weight: number; conversionBase: number; sortOrder: number };
type Assessment = { id: string; categoryId: string; title: string; maxScore: number; weight: number | null; sortOrder?: number; dueDate: string | null; scheduleOverrideReason?: string | null; attendanceType?: "FACE_TO_FACE" | "ONLINE" | null };
type Enrollment = { id: string; studentName: string; studentNumber: string | null; studentUserId: string | null; remarks: string | null; finalGradeOverride?: string | null; gradeChangeCount?: number; gradeChangeHistory?: Array<{ id:string; previousFinalGrade:string|null; previousRemarks:string|null; newFinalGrade:string|null; newRemarks:string|null; reason:string; createdAt:string; actor:{fullName:string} }>; scores: Array<{ assessmentId: string; points: number | null; remark: string | null }>; finalPercent: number | null };
type GradeBand = { id: string; minPercent: number; finalGrade: string; remarks: string };
type GradeSheetComponent = { name: string; percentage: number };
type IsoHeaderConfig = {
  organizationAddress: string;
  formName: string;
  formNo: string;
  effectivity: string;
  issuingOffice: string;
  revisionNo: string;
  eomsTitle: string;
  isoStandard: string;
  affiliationLine1: string;
  affiliationLine2: string;
};
const FCU_ISO_HEADER_DEFAULTS: IsoHeaderConfig = {
  organizationAddress: "Roxas Avenue, Roxas City, Capiz, Philippines",
  formName: "COLLEGIATE GRADING SHEET",
  formNo: "FCU-EOMS-RO-006-F",
  effectivity: "October 1, 2025",
  issuingOffice: "REGISTRAR’S OFFICE",
  revisionNo: "1",
  eomsTitle: "EDUCATIONAL ORGANIZATION MANAGEMENT SYSTEM",
  isoStandard: "ISO 21001:2025",
  affiliationLine1: "Member: Association of Christian Schools, Colleges and Universities-Accrediting Council, Inc. (ACSCU-ACI)",
  affiliationLine2: "Member: Association of Christian Schools, Colleges in Asia (ACUCA)"
};
function emptyIsoHeaderConfig(): IsoHeaderConfig {
  return { organizationAddress: "", formName: "", formNo: "", effectivity: "", issuingOffice: "", revisionNo: "", eomsTitle: "", isoStandard: "", affiliationLine1: "", affiliationLine2: "" };
}
function readIsoHeaderConfig(schoolName: string, schoolSlug: string, stored: string | null): IsoHeaderConfig {
  const defaults = /filamer christian university/i.test(schoolName) || schoolSlug.toLocaleLowerCase() === "fcu" ? FCU_ISO_HEADER_DEFAULTS : emptyIsoHeaderConfig();
  if (!stored) return { ...defaults };
  try {
    const parsed = JSON.parse(stored) as Partial<IsoHeaderConfig>;
    return Object.fromEntries(Object.keys(defaults).map(key => [key, typeof parsed[key as keyof IsoHeaderConfig] === "string" ? parsed[key as keyof IsoHeaderConfig] : defaults[key as keyof IsoHeaderConfig]])) as IsoHeaderConfig;
  } catch { return { ...defaults }; }
}
type Detail = Subject & { categories: Category[]; gradeBands: GradeBand[]; assessments: Assessment[]; enrollments: Enrollment[] };
type Grade = { id: string; classId?: string | null; schedule?: string | null; droppingWarning?: AbsenceStreak | null; attendanceSummary?: StudentAttendanceSummary; attendanceWarning?: StudentAttendanceWarning | null; itemCount?: number; recordedCount?: number; code: string; title: string; term: string; academicYear: string; teacher: string; status: "DRAFT" | "SUBMITTED" | "VERIFIED"; submittedAt: string | null; verifiedAt: string | null; percent: number | null; finalGrade: string | null; remarks: string; gradeBands: Array<{ minPercent: number; finalGrade: string; remarks: string }>; categories: Array<{ id: string; name: string; weight: number; conversionBase: number; assessments: Array<{id:string;title:string;points:number|null;remark:string|null;maxScore:number;weight:number|null;lateAsAbsent?:boolean;dueDate?:string|null}> }> };
type StudentSearchMatch = { enrollmentId: string; studentName: string; studentRemark: string | null; class: { id: string; classId: string | null; code: string; title: string; term: string; academicYear: string; status: "DRAFT" | "SUBMITTED" | "VERIFIED" }; finalPercent: number | null; finalGrade: string | null; finalRemark: string; records: Array<{id:string;title:string;category:string;points:number|null;remark:string|null;maxScore:number;dueDate:string|null}> };
type ScheduleRow = { label: string; day: string; startTime: string; endTime: string };
type OverviewItem = { id: string; title: string; date: string | null; subjectId: string; code: string; subjectTitle: string; attendanceType?: "FACE_TO_FACE" | "ONLINE" | null; scheduleOverrideReason?: string | null; markedCount?: number; studentCount?: number };
type TodayClass = { id: string; code: string; title: string; classId: string | null; schedule: string[]; canRecordAttendance: boolean };
type OverviewData = {
  stats: { activeClasses: number; activeStudents: number; activities: number; tests: number; pendingReviews: number; attendanceLogs: number };
  attendance: { present: number; absent: number; excused: number; late: number };
  attendanceRisk: Array<{
    enrollmentId: string; studentName: string;
    subjectId: string; classId: string | null; code: string; title: string; academicYear: string; term: string;
    absent: number; late: number; lateAbsences: number; counted: number; percent: number; absenceDates: AbsenceDate[];
  }>;
  submissions: { draft: number; provisional: number; final: number };
  enrollment: Array<{ id: string; label: string; title: string; code: string; count: number }>;
  today: string;
  todayClasses: TodayClass[];
  completedTodayCount: number;
  upcoming: { attendance: OverviewItem[]; assessments: OverviewItem[] };
};

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function newScheduleRow(): ScheduleRow {
  return { label: "Lecture", day: "Monday", startTime: "07:30 AM", endTime: "09:00 AM" };
}
function todayDateInput() { const now = new Date(); return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
function formatOverviewDate(value: string | null) { return value ? new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(value)) : "Date not set"; }
function AbsenceDateList({ dates }: { dates: AbsenceDate[] }) {
  if (!dates.length) return null;
  return <small className="d-block text-body-secondary">
    <b>Absence dates</b>{" "}
    {dates.map(({ date, fromLate }, index) => <Fragment key={date}>
      {index > 0 && ", "}
      <time dateTime={date}>{formatOverviewDate(date)}</time>
      {fromLate && " (three consecutive lates)"}
    </Fragment>)}
  </small>;
}
function DroppingWarning({ streak }: { streak: AbsenceStreak }) {
  return <div className="mt-1">
    <span className="badge text-bg-danger">Danger of dropping</span>
    <small className="d-block">{streak.days} consecutive missed class meetings</small>
    {streak.dates?.length > 0 && <small className="d-block">
      <b>Dates in this streak</b>{" "}
      {streak.dates.map((date, index) => <Fragment key={date}>
        {index > 0 && ", "}
        <time dateTime={date}>{formatOverviewDate(date)}</time>
      </Fragment>)}
    </small>}
  </div>;
}
function scoreSheetCategoryLabel(name: string) {
  const label = name.trim();
  if (/^laboratory\s+exam\b/i.test(label)) return "Lab Exam";
  if (/^laboratory\s+exercises?\b/i.test(label)) return "Lab Exercises";
  if (/^self[-\s]?evaluation\s+exercises?\b/i.test(label)) return "Self-Evaluation";
  if (/^major\s+examinations?\b/i.test(label)) return "Major Exams";
  return label.replace(/\blaboratory\b/gi, "Lab");
}
function shiftDateInput(value: string, days: number) { const date = new Date(`${value}T00:00:00`); date.setDate(date.getDate() + days); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
function pieGradient(values: number[], colors: string[]) {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!total) return "conic-gradient(#dbe3ef 0% 100%)";
  let edge = 0;
  const segments = values.map((value, index) => {
    const start = edge;
    edge += (value / total) * 100;
    return `${colors[index]} ${start}% ${edge}%`;
  });
  return `conic-gradient(${segments.join(",")})`;
}

async function api(url: string, options?: RequestInit) {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...(options?.headers || {}) } });
  const text = await response.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; }
  catch { throw new Error(text || `The server returned an unreadable response (HTTP ${response.status}).`); }
  if (!response.ok) throw new Error(data.error || `Request failed (HTTP ${response.status}).`);
  return data;
}
function initials(name: string) { return name.split(/\s+/).slice(0, 2).map(x => x[0]).join("").toUpperCase(); }
function syncHorizontalScrollProgress(source: HTMLElement, target: HTMLElement) {
  const sourceRange = Math.max(0, source.scrollWidth - source.clientWidth);
  const targetRange = Math.max(0, target.scrollWidth - target.clientWidth);
  const progress = sourceRange > 0 ? Math.min(1, Math.max(0, source.scrollLeft / sourceRange)) : 0;
  const targetScrollLeft = progress * targetRange;
  if (Math.abs(target.scrollLeft - targetScrollLeft) > 1) target.scrollLeft = targetScrollLeft;
}
function formatSchedule(raw: string | null) {
  if (!raw) return "";
  try {
    const rows = JSON.parse(raw) as ScheduleRow[];
    if (Array.isArray(rows)) return rows.map(row => `${row.label || "Class"} · ${row.day}, ${row.startTime}–${row.endTime}`).join("  /  ");
  } catch { /* Legacy free-text schedules are displayed unchanged. */ }
  return raw;
}
function updateTime(value: string, part: "hour" | "minute" | "period", next: string) {
  const match = /^(\d{2}):(\d{2})\s(AM|PM)$/.exec(value) || ["", "07", "30", "AM"];
  const hour = part === "hour" ? next : match[1];
  const minute = part === "minute" ? next : match[2];
  const period = part === "period" ? next : match[3];
  return `${hour}:${minute} ${period}`;
}
function TimeDropdown({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const match = /^(\d{2}):(\d{2})\s(AM|PM)$/.exec(value) || ["", "07", "30", "AM"];
  return <div className="schedule-time"><label className="form-label">{label}</label><div className="schedule-time-controls"><select className="form-select" aria-label={`${label} hour`} value={match[1]} onChange={e => onChange(updateTime(value, "hour", e.target.value))}>{Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0")).map(hour => <option key={hour}>{hour}</option>)}</select><span>:</span><select className="form-select" aria-label={`${label} minute`} value={match[2]} onChange={e => onChange(updateTime(value, "minute", e.target.value))}>{Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0")).map(minute => <option key={minute}>{minute}</option>)}</select><select className="form-select period-select" aria-label={`${label} AM or PM`} value={match[3]} onChange={e => onChange(updateTime(value, "period", e.target.value))}><option>AM</option><option>PM</option></select></div></div>;
}
function parseCsv(text: string) {
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false;
  const input = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '"' && quoted && input[i + 1] === '"') { cell += '"'; i++; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(cell); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) { if (char === "\r" && input[i + 1] === "\n") i++; row.push(cell); if (row.some(value => value.trim())) rows.push(row); row = []; cell = ""; }
    else cell += char;
  }
  row.push(cell); if (row.some(value => value.trim())) rows.push(row);
  if (rows.length < 2) throw new Error("The CSV has no student rows.");
  const headers = rows.shift()!.map(value => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim());
  const nameIndex = headers.findIndex(value => ["student name", "full name", "name"].includes(value));
  const numberIndex = headers.findIndex(value => ["student number", "student id", "id number"].includes(value));
  if (nameIndex < 0) throw new Error("CSV needs a Student Name column.");
  return rows.map(values => [values[nameIndex] || "", numberIndex < 0 ? "" : values[numberIndex] || ""].map(value => value.trim())).filter(values => values[0]).map(values => values.join("\t")).join("\n");
}
function parseCsvRows(text: string) {
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false; const input = text.replace(/^\uFEFF/, "");
  for (let i=0;i<input.length;i++) { const char=input[i]; if(char==='"'&&quoted&&input[i+1]==='"'){cell+='"';i++;}else if(char==='"')quoted=!quoted;else if(char===","&&!quoted){row.push(cell);cell="";}else if((char==="\n"||char==="\r")&&!quoted){if(char==="\r"&&input[i+1]==="\n")i++;row.push(cell);if(row.some(value=>value.trim()))rows.push(row);row=[];cell="";}else cell+=char; }
  row.push(cell);if(row.some(value=>value.trim()))rows.push(row);if(quoted)throw new Error("The CSV has an unfinished quoted field.");return rows;
}
function csvValue(value: unknown) { const text=String(value??""); return /[",\r\n]/.test(text) ? `"${text.replaceAll('"','""')}"` : text; }
function xmlEscape(value: unknown) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}
function excelColumn(index: number) {
  let value = index + 1;
  let column = "";
  while (value) { value--; column = String.fromCharCode(65 + value % 26) + column; value = Math.floor(value / 26); }
  return column;
}
function sortWorksheetRowCells(xmlCells: string) {
  const cells = xmlCells.match(/<c\b[^>]*>[\s\S]*?<\/c>/g) ?? [];
  const columnIndex = (cell: string) => {
    const letters = /\br="([A-Z]+)\d+"/.exec(cell)?.[1];
    if (!letters) throw new Error("A worksheet cell is missing a valid column reference.");
    let index = 0;
    for (const character of letters) index = index * 26 + character.charCodeAt(0) - 64;
    return index;
  };
  return cells.sort((left, right) => columnIndex(left) - columnIndex(right)).join("");
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function zipStored(files: Array<{ name: string; content: string | Uint8Array }>) {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  const ZIP_STORE = 0;
  const UTF8_FLAG = 0x0800;
  const write16 = (view: DataView, position: number, value: number) => view.setUint16(position, value, true);
  const write32 = (view: DataView, position: number, value: number) => view.setUint32(position, value, true);

  if (files.length > 0xffff) throw new Error("This workbook contains too many ZIP entries.");

  for (const file of files) {
    // ZIP entry names and all XML strings are encoded as UTF-8 bytes before
    // calculating lengths/CRC values or writing either ZIP directory record.
    const name = encoder.encode(file.name);
    const data = typeof file.content === "string"
      ? encoder.encode(file.content)
      : new Uint8Array(file.content.buffer, file.content.byteOffset, file.content.byteLength);
    if (name.length > 0xffff) throw new Error("A workbook ZIP entry name is too long.");
    if (data.length > 0xffffffff || offset > 0xffffffff) {
      throw new Error("This workbook exceeds the ZIP32 size limit.");
    }

    const crc = crc32(data);

    // Local file header (30 bytes + UTF-8 filename + raw, uncompressed data).
    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    write32(localView, 0, 0x04034b50);
    write16(localView, 4, 20); // version needed: ZIP 2.0
    write16(localView, 6, UTF8_FLAG);
    write16(localView, 8, ZIP_STORE); // compression method: STORE (no compression)
    write16(localView, 10, 0); // DOS modification time
    write16(localView, 12, 0); // DOS modification date
    write32(localView, 14, crc);
    write32(localView, 18, data.length); // compressed size = uncompressed size in STORE mode
    write32(localView, 22, data.length);
    write16(localView, 26, name.length);
    write16(localView, 28, 0); // no extra field
    local.set(name, 30);
    localParts.push(local, data);

    // Central directory file header (46 bytes + UTF-8 filename).
    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    write32(centralView, 0, 0x02014b50);
    write16(centralView, 4, 20); // version made by: ZIP 2.0
    write16(centralView, 6, 20); // version needed: ZIP 2.0
    write16(centralView, 8, UTF8_FLAG);
    write16(centralView, 10, ZIP_STORE);
    write16(centralView, 12, 0); // DOS modification time
    write16(centralView, 14, 0); // DOS modification date
    write32(centralView, 16, crc);
    write32(centralView, 20, data.length);
    write32(centralView, 24, data.length);
    write16(centralView, 28, name.length);
    write16(centralView, 30, 0); // no extra field
    write16(centralView, 32, 0); // no file comment
    write16(centralView, 34, 0); // disk number start
    write16(centralView, 36, 0); // internal file attributes
    write32(centralView, 38, 0); // external file attributes
    write32(centralView, 42, offset); // offset of the matching local file header
    central.set(name, 46);
    centralParts.push(central);

    offset += local.length + data.length;
    if (offset > 0xffffffff) throw new Error("This workbook exceeds the ZIP32 size limit.");
  }

  const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
  if (centralSize > 0xffffffff) throw new Error("This workbook ZIP directory is too large.");

  // End of central directory (single disk, no archive comment).
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  write32(endView, 0, 0x06054b50);
  write16(endView, 4, 0);
  write16(endView, 6, 0);
  write16(endView, 8, files.length);
  write16(endView, 10, files.length);
  write32(endView, 12, centralSize);
  write32(endView, 16, offset);
  write16(endView, 20, 0);

  const archive = new Uint8Array(offset + centralSize + end.length);
  let cursor = 0;
  for (const part of [...localParts, ...centralParts, end]) {
    archive.set(part, cursor);
    cursor += part.length;
  }
  return archive;
}

function downloadXlsx(filename: string, sheetName: string, headers: string[], rows: unknown[][], headerPng?: Uint8Array, headerAspectRatio = 0.25) {
  const columnCount = Math.max(headers.length, ...rows.map(row => row.length), 1);
  const lastColumn = excelColumn(columnCount - 1);
  const spacerRows = headerPng ? Array.from({ length: 10 }, () => [] as unknown[]) : [];
  const allRows = [...spacerRows, headers, ...rows];
  const worksheetRows = allRows.map((row, rowIndex) => {
    const cells = sortWorksheetRowCells(row.map((value, columnIndex) => {
      const reference = excelColumn(columnIndex) + (rowIndex + 1);
      if (typeof value === "number" && Number.isFinite(value)) return '<c r="' + reference + '"><v>' + value + '</v></c>';
      if (typeof value === "boolean") return '<c r="' + reference + '" t="b"><v>' + (value ? 1 : 0) + '</v></c>';
      const text = xmlEscape(value);
      return '<c r="' + reference + '" t="inlineStr"><is><t xml:space="preserve">' + text + '</t></is></c>';
    }).join(""));
    return '<row r="' + (rowIndex + 1) + '">' + cells + '</row>';
  }).join("");
  const safeSheetName = sheetName.replace(/[\\/?*\\[\\]:]/g, " ").slice(0, 31) || "Export";
  const imageWidth = 7040000;
  const imageHeight = Math.round(imageWidth * headerAspectRatio);
  const imageDrawing = headerPng ? '<drawing r:id="rId1"/>' : "";
  const mergeXml = headerPng ? '<mergeCells count="1"><mergeCell ref="A1:' + lastColumn + '9"/></mergeCells>' : "";
  const worksheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="18"/><sheetData>' + worksheetRows + '</sheetData>' +
    mergeXml + '<pageMargins left="0.25" right="0.25" top="0.35" bottom="0.35" header="0.15" footer="0.15"/>' + imageDrawing + '</worksheet>';
  const files: Array<{ name: string; content: string | Uint8Array }> = [
    { name: "[Content_Types].xml", content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' + (headerPng ? '<Default Extension="png" ContentType="image/png"/><Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' : '') + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>' },
    { name: "_rels/.rels", content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: "xl/workbook.xml", content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="' + xmlEscape(safeSheetName) + '" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { name: "xl/_rels/workbook.xml.rels", content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>' },
    { name: "xl/worksheets/sheet1.xml", content: worksheet }
  ];
  if (headerPng) {
    const drawing = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>' +
      '<xdr:ext cx="' + imageWidth + '" cy="' + imageHeight + '"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="1" name="Grading Sheet Header"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>' +
      '<xdr:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + imageWidth + '" cy="' + imageHeight + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>';
    files.push(
      { name: "xl/worksheets/_rels/sheet1.xml.rels", content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>' },
      { name: "xl/drawings/drawing1.xml", content: drawing },
      { name: "xl/drawings/_rels/drawing1.xml.rels", content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/header.png"/></Relationships>' },
      { name: "xl/media/header.png", content: headerPng }
    );
  }
  const url = URL.createObjectURL(new Blob([zipStored(files) as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const link = document.createElement("a"); link.href = url; link.download = filename; link.click();
  URL.revokeObjectURL(url);
}

function categoryDescendantIds(categoryId: string, categories: Category[]) {
  const ids = new Set([categoryId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const category of categories) {
      if (category.parentId && ids.has(category.parentId) && !ids.has(category.id)) {
        ids.add(category.id);
        changed = true;
      }
    }
  }
  return ids;
}
function gradeSheetAttendancePercent(detail: Detail, enrollment: Enrollment, categoryId?: string) {
  const categoryIds = categoryId ? categoryDescendantIds(categoryId, detail.categories) : null;
  const attendanceAssessments = detail.assessments.filter(item =>
    item.title.toLocaleLowerCase().startsWith("attendance ·") &&
    (!categoryIds || categoryIds.has(item.categoryId))
  );
  if (!attendanceAssessments.length) return null;
  return calculateCategoryPercent({
    conversionBase: 100,
    assessments: attendanceAssessments.map(item => ({
      id: item.id, title: item.title, dueDate: item.dueDate, maxScore: item.maxScore, weight: item.weight,
      scores: [enrollment.scores.find(score => score.assessmentId === item.id) || { points: null, remark: null }]
    }))
  });
}
function gradeSheetComponentPercent(detail: Detail, enrollment: Enrollment, component: GradeSheetComponent) {
  const root = detail.categories.find(category => categoryPath(category, detail.categories).trim().toLocaleLowerCase() === component.name.trim().toLocaleLowerCase());
  if (!root) return null;
  if (root.name.toLocaleLowerCase().includes("attendance")) return gradeSheetAttendancePercent(detail, enrollment, root.id);
  const leaves = detail.categories.filter(category => {
    let current: Category | undefined = category;
    const seen = new Set<string>();
    while (current && current.id !== root.id && current.parentId && !seen.has(current.id)) {
      seen.add(current.id);
      current = detail.categories.find(parent => parent.id === current?.parentId);
    }
    return current?.id === root.id && !detail.categories.some(child => child.parentId === category.id);
  });
  let weighted = 0;
  let totalWeight = 0;
  for (const category of leaves) {
    const items = detail.assessments.filter(item => item.categoryId === category.id && !item.title.toLocaleLowerCase().startsWith("attendance ·"));
    const percent = calculateCategoryPercent({
      conversionBase: root.conversionBase,
      assessments: items.map(item => ({
        id: item.id, title: item.title, dueDate: item.dueDate, maxScore: item.maxScore, weight: item.weight,
        scores: [enrollment.scores.find(score => score.assessmentId === item.id) || { points: null, remark: null }]
      }))
    });
    const weight = effectiveCategoryWeight(category, detail.categories);
    if (percent !== null && weight > 0) { weighted += percent * weight; totalWeight += weight; }
  }
  return totalWeight > 0 ? Number((weighted / totalWeight).toFixed(2)) : null;
}
function gradeSheetRootWeightedContribution(detail: Detail, enrollment: Enrollment, root: Category) {
  const grouped = new Map<string, Assessment[]>();
  for (const assessment of detail.assessments) {
    const items = grouped.get(assessment.categoryId) ?? [];
    items.push(assessment);
    grouped.set(assessment.categoryId, items);
  }
  const breakdown = calculateGradeBreakdown(detail.categories.map(category => ({
    id: category.id,
    parentId: category.parentId,
    weight: category.weight,
    conversionBase: category.conversionBase,
    assessments: (grouped.get(category.id) ?? []).map(assessment => {
      const score = enrollment.scores.find(item => item.assessmentId === assessment.id);
      return {
        title: assessment.title,
        dueDate: assessment.dueDate,
        maxScore: assessment.maxScore,
        weight: assessment.weight,
        scores: score ? [score] : []
      };
    })
  })));
  const branchIds = categoryDescendantIds(root.id, detail.categories);
  const contributions = breakdown.items.filter(item => branchIds.has(item.categoryId));
  if (!contributions.some(item => item.earnedCourse !== null)) return null;
  return Number(contributions.reduce((sum, item) => sum + (item.earnedCourse ?? 0), 0).toFixed(2));
}
function gradeSheetComponentContribution(detail: Detail, enrollment: Enrollment, component: GradeSheetComponent) {
  const root = detail.categories.find(category =>
    categoryPath(category, detail.categories).trim().toLocaleLowerCase() === component.name.trim().toLocaleLowerCase()
  );
  // Root Lecture/Laboratory columns must show the actual contribution to the course
  // total, exactly as calculated for TOTAL GRADE, rather than a raw group percentage.
  if (root && !root.parentId) return gradeSheetRootWeightedContribution(detail, enrollment, root);
  const componentPercent = gradeSheetComponentPercent(detail, enrollment, component);
  return componentPercent === null ? null : Number((componentPercent * component.percentage / 100).toFixed(2));
}

function downloadGradeSheetXlsx(
  filename: string, sheetName: string, detail: Detail,
  schoolName: string, schoolAddress: string, departmentName: string,
  teacherName: string, teacherPosition: string, notedByName: string, notedByPosition: string,
  components: GradeSheetComponent[] = [{ name: "EXAM", percentage: 50 }, { name: "ACT", percentage: 40 }, { name: "ARP", percentage: 10 }],
  assessmentOrder?: Assessment[]
) {
  type ExportCell = { value: unknown; style: number };
  type ScoreColumn = { kind: "assessment"; category: Category; item: Assessment } | { kind: "equivalent"; category: Category };
  type ExportCategoryNode = {
    category: Category; depth: number; items: Assessment[];
    children: ExportCategoryNode[]; startColumn: number; columnCount: number;
  };

  const academicAssessments = (assessmentOrder ?? detail.assessments.filter(item =>
    !item.title.toLocaleLowerCase().startsWith("attendance ·")
  )).filter(item => !item.title.toLocaleLowerCase().startsWith("attendance ·"));
  const assessmentTitle = (item: Assessment) => {
    let title = item.title.trim();
    if (title.includes("·")) title = title.split("·").pop()?.trim() ?? title;
    if (title.includes("/")) title = title.split("/").pop()?.trim() ?? title;
    return title.replace(/\s*\(Max\s+[^)]+\)\s*$/i, "").replace(/\s*\(\d+(?:\.\d+)?\)\s*$/, "").trim();
  };

  const buildCategoryNode = (category: Category, depth: number): ExportCategoryNode | null => {
    const items = academicAssessments.filter(item => item.categoryId === category.id);
    const children = detail.categories.filter(item => item.parentId === category.id)
      .slice().sort((a, b) => a.sortOrder - b.sortOrder)
      .map(child => buildCategoryNode(child, depth + 1))
      .filter((child): child is ExportCategoryNode => !!child);
    const columnCount = items.length + (items.length ? 1 : 0) + children.reduce((sum, child) => sum + child.columnCount, 0);
    return columnCount ? { category, depth, items, children, startColumn: 0, columnCount } : null;
  };
  const rootNodes = detail.categories.filter(category => !category.parentId)
    .slice().sort((a, b) => a.sortOrder - b.sortOrder)
    .map(category => buildCategoryNode(category, 0))
    .filter((node): node is ExportCategoryNode => !!node);

  const scoreColumns: ScoreColumn[] = [];
  let nextColumn = 3;
  const assignColumns = (node: ExportCategoryNode) => {
    node.startColumn = nextColumn;
    for (const item of node.items) { scoreColumns.push({ kind: "assessment", category: node.category, item }); nextColumn++; }
    if (node.items.length) { scoreColumns.push({ kind: "equivalent", category: node.category }); nextColumn++; }
    node.children.forEach(assignColumns);
    node.columnCount = nextColumn - node.startColumn;
  };
  rootNodes.forEach(assignColumns);

  const totalColumn = nextColumn;
  const finalColumn = totalColumn + 1;
  const remarksColumn = totalColumn + 2;
  const columnCount = remarksColumn + 1;
  const last = excelColumn(columnCount - 1);
  const rows: ExportCell[][] = [];
  const mergedRanges: string[] = [];
  const addRow = (values: Array<{ col: number; value: unknown; style?: number }>) => {
    const row = Array.from({ length: columnCount }, () => ({ value: "", style: 0 } as ExportCell));
    for (const value of values) row[value.col] = { value: value.value, style: value.style ?? 0 };
    rows.push(row);
  };
  const addMergedValue = (
    values: Array<{ col: number; value: unknown; style?: number }>,
    rowNumber: number, startColumn: number, endColumn: number, value: unknown, style: number
  ) => {
    for (let column = startColumn; column <= endColumn; column++) {
      values.push({ col: column, value: column === startColumn ? value : "", style });
    }
    if (endColumn > startColumn) {
      mergedRanges.push(excelColumn(startColumn) + rowNumber + ":" + excelColumn(endColumn) + rowNumber);
    }
  };

  const headerLastColumn = columnCount - 1;
  const fullWidthRow = (value: unknown, style: number) => {
    const values: Array<{ col: number; value: unknown; style?: number }> = [];
    addMergedValue(values, rows.length + 1, 0, headerLastColumn, value, style);
    addRow(values);
  };
  fullWidthRow(schoolName, 11);
  fullWidthRow(schoolAddress || "School address not set", 12);
  fullWidthRow((departmentName || schoolName).toLocaleUpperCase(), 3);
  addRow([]);

  const labelWidth = columnCount >= 8 ? 2 : 1;
  const firstValueWidth = columnCount >= 10 ? 4 : Math.max(1, Math.floor((columnCount - (labelWidth * 2)) / 2));
  const firstLabelStart = 0;
  const firstLabelEnd = labelWidth - 1;
  const firstValueStart = firstLabelEnd + 1;
  const firstValueEnd = Math.min(columnCount - 3, firstValueStart + firstValueWidth - 1);
  const secondLabelStart = firstValueEnd + 1;
  const secondLabelEnd = Math.min(columnCount - 2, secondLabelStart + labelWidth - 1);
  const secondValueStart = secondLabelEnd + 1;
  const pairedMetadataRow = (
    firstLabel: string, firstValue: unknown, secondLabel: string, secondValue: unknown
  ) => {
    const rowNumber = rows.length + 1;
    const values: Array<{ col: number; value: unknown; style?: number }> = [];
    addMergedValue(values, rowNumber, firstLabelStart, firstLabelEnd, firstLabel, 13);
    addMergedValue(values, rowNumber, firstValueStart, firstValueEnd, firstValue, 14);
    addMergedValue(values, rowNumber, secondLabelStart, secondLabelEnd, secondLabel, 13);
    addMergedValue(values, rowNumber, secondValueStart, headerLastColumn, secondValue, 14);
    addRow(values);
  };
  const fullWidthMetadataRow = (label: string, value: unknown) => {
    const rowNumber = rows.length + 1;
    const values: Array<{ col: number; value: unknown; style?: number }> = [];
    addMergedValue(values, rowNumber, 0, firstLabelEnd, label, 13);
    addMergedValue(values, rowNumber, firstValueStart, headerLastColumn, value, 14);
    addRow(values);
  };
  pairedMetadataRow("Course Number:", detail.code, "Descriptive Title:", detail.title);
  pairedMetadataRow("Class ID:", detail.classId || "—", "Semester:", detail.term);
  pairedMetadataRow("Academic Year:", detail.academicYear, "Course & Year:", detail.courseYear || "—");
  fullWidthMetadataRow("Schedule:", formatSchedule(detail.schedule) || "—");
  fullWidthMetadataRow("Display Components:", components.map(item => item.name + " " + item.percentage.toFixed(2) + "%").join(" · "));
  pairedMetadataRow("Students Enrolled:", detail.enrollments.length, "Assessment Items:", academicAssessments.length);
  addRow([]);
  addRow([]);
  addRow([]);

  const tableHeaderStartRow = 14;
  const itemHeaderRow = 16;
  const maxScoreRow = 17;
  const headerRows: Array<Array<{ col: number; value: unknown; style?: number }>> = [[], [], [], []];
  const addHeaderRectangle = (
    startColumn: number, endColumn: number, startRow: number, endRow: number, value: unknown, style: number
  ) => {
    for (let rowNumber = startRow; rowNumber <= endRow; rowNumber++) {
      const values = headerRows[rowNumber - tableHeaderStartRow];
      for (let column = startColumn; column <= endColumn; column++) {
        values.push({ col: column, value: rowNumber === startRow && column === startColumn ? value : "", style });
      }
    }
    if (startColumn !== endColumn || startRow !== endRow) {
      mergedRanges.push(
        excelColumn(startColumn) + startRow + ":" + excelColumn(endColumn) + endRow
      );
    }
  };

  const identityHeaders = [
    { col: 0, value: "NO." },
    { col: 1, value: "NAME OF STUDENTS" },
    { col: 2, value: "ATTENDANCE %" }
  ];
  for (let rowOffset = 0; rowOffset < headerRows.length; rowOffset++) {
    identityHeaders.forEach(item => headerRows[rowOffset].push({
      col: item.col, value: rowOffset === 0 ? item.value : "", style: 5
    }));
  }
  [0, 1, 2].forEach(column => {
    const cell = excelColumn(column);
    mergedRanges.push(cell + tableHeaderStartRow + ":" + cell + maxScoreRow);
  });

  const summaryHeaders = [
    { col: totalColumn, value: "TOTAL GRADE (%)" },
    { col: finalColumn, value: "FINAL GRADE" },
    { col: remarksColumn, value: "REMARKS" }
  ];
  for (let rowOffset = 0; rowOffset < headerRows.length; rowOffset++) {
    summaryHeaders.forEach(item => headerRows[rowOffset].push({
      col: item.col, value: rowOffset === 0 ? item.value : "", style: 16
    }));
  }
  [totalColumn, finalColumn, remarksColumn].forEach(column => {
    const cell = excelColumn(column);
    mergedRanges.push(cell + tableHeaderStartRow + ":" + cell + maxScoreRow);
  });

  for (const node of rootNodes) {
    const endColumn = node.startColumn + node.columnCount - 1;
    if (!node.children.length) {
      addHeaderRectangle(node.startColumn, endColumn, tableHeaderStartRow, tableHeaderStartRow + 1, node.category.name.toLocaleUpperCase(), 5);
    } else {
      addHeaderRectangle(node.startColumn, endColumn, tableHeaderStartRow, tableHeaderStartRow, node.category.name.toLocaleUpperCase(), 5);
    }
  }
  const addSubcategorySegments = (node: ExportCategoryNode, path: string[]) => {
    if (node.items.length && node.depth > 0) {
      const ownColumnCount = node.items.length + 1;
      const label = path.slice(1).join(" / ").toLocaleUpperCase();
      addHeaderRectangle(node.startColumn, node.startColumn + ownColumnCount - 1, tableHeaderStartRow + 1, tableHeaderStartRow + 1, label, 5);
    } else if (node.items.length && node.depth === 0 && node.children.length) {
      const ownColumnCount = node.items.length + 1;
      addHeaderRectangle(node.startColumn, node.startColumn + ownColumnCount - 1, tableHeaderStartRow + 1, tableHeaderStartRow + 1, "GENERAL ACTIVITIES", 5);
    }
    node.children.forEach(child => addSubcategorySegments(child, [...path, child.category.name]));
  };
  rootNodes.forEach(node => addSubcategorySegments(node, [node.category.name]));

  scoreColumns.forEach((column, index) => {
    const columnIndex = 3 + index;
    if (column.kind === "assessment") {
      headerRows[2].push({ col: columnIndex, value: assessmentTitle(column.item), style: 5 });
      headerRows[3].push({ col: columnIndex, value: "MAX: " + column.item.maxScore, style: 15 });
    } else {
      headerRows[2].push({ col: columnIndex, value: "EQUIVALENT", style: 5 });
      headerRows[3].push({ col: columnIndex, value: "(%)", style: 15 });
    }
  });
  headerRows.forEach(values => addRow(values));

  const gradeBands = detail.gradeBands.slice().sort((a, b) => b.minPercent - a.minPercent);
  for (const [index, enrollment] of detail.enrollments.entries()) {
    const specialRemark = ["INC", "NP", "DROPPED"].includes(enrollment.remarks || "");
    const band = gradeBands.find(item => enrollment.finalPercent !== null && enrollment.finalPercent >= item.minPercent);
    const attendancePercent = gradeSheetAttendancePercent(detail, enrollment);
    const groupedAssessments = new Map<string, Assessment[]>();
    for (const assessment of detail.assessments) {
      const list = groupedAssessments.get(assessment.categoryId) ?? [];
      list.push(assessment);
      groupedAssessments.set(assessment.categoryId, list);
    }
    const breakdown = calculateGradeBreakdown(detail.categories.map(category => ({
      id: category.id, parentId: category.parentId, weight: category.weight, conversionBase: category.conversionBase,
      assessments: (groupedAssessments.get(category.id) ?? []).map(assessment => {
        const score = enrollment.scores.find(item => item.assessmentId === assessment.id);
        return { title: assessment.title, dueDate: assessment.dueDate, maxScore: assessment.maxScore, weight: assessment.weight, scores: score ? [score] : [] };
      })
    })));
    const contributionByCategory = new Map(breakdown.items.map(item => [item.categoryId, item]));
    const values: Array<{ col: number; value: unknown; style?: number }> = [
      { col: 0, value: index + 1, style: 7 },
      { col: 1, value: enrollment.studentName, style: 6 },
      { col: 2, value: attendancePercent === null ? "—" : attendancePercent.toFixed(2) + "%", style: 7 }
    ];
    scoreColumns.forEach((column, columnIndex) => {
      if (column.kind === "assessment") {
        const score = enrollment.scores.find(item => item.assessmentId === column.item.id);
        const value = score?.remark ? score.remark : score?.points == null ? "" : score.points + " / " + column.item.maxScore;
        values.push({ col: 3 + columnIndex, value, style: 7 });
      } else {
        const contribution = contributionByCategory.get(column.category.id);
        const value = specialRemark || contribution?.earnedWithinRoot == null ? "—" : contribution.earnedWithinRoot.toFixed(2) + "%";
        values.push({ col: 3 + columnIndex, value, style: 7 });
      }
    });
    values.push(
      { col: totalColumn, value: enrollment.finalPercent === null ? "—" : enrollment.finalPercent.toFixed(2) + "%", style: 7 },
      { col: finalColumn, value: specialRemark ? enrollment.remarks : enrollment.finalGradeOverride || band?.finalGrade || "—", style: 7 },
      { col: remarksColumn, value: specialRemark ? enrollment.remarks : band?.remarks || "Not yet graded", style: 7 }
    );
    addRow(values);
  }

  addRow([]);
  const signatureLabelRow = rows.length + 1;
  const signatureNameRow = signatureLabelRow + 4;
  const signatureRoleRow = signatureLabelRow + 5;
  const leftEndColumn = Math.max(1, Math.floor(columnCount / 2));
  const rightStartColumn = leftEndColumn + 1;
  const leftEnd = excelColumn(leftEndColumn - 1);
  const rightStart = excelColumn(rightStartColumn - 1);
  addRow([
    { col: 0, value: "Submitted by:", style: 8 },
    { col: rightStartColumn - 1, value: "Noted:", style: 8 }
  ]);
  addRow([]);
  addRow([]);
  addRow([]);
  addRow([
    { col: 0, value: teacherName.trim().toLocaleUpperCase(), style: 17 },
    { col: rightStartColumn - 1, value: notedByName.trim().toLocaleUpperCase(), style: 17 }
  ]);
  addRow([
    { col: 0, value: teacherPosition.trim(), style: 17 },
    { col: rightStartColumn - 1, value: notedByPosition.trim(), style: 17 }
  ]);
  for (let rowNumber = signatureLabelRow; rowNumber <= signatureRoleRow; rowNumber++) {
    mergedRanges.push("A" + rowNumber + ":" + leftEnd + rowNumber, rightStart + rowNumber + ":" + last + rowNumber);
  }

  const xmlRows = rows.map((values, rowIndex) => {
    const rowNumber = rowIndex + 1;
    const xmlCells = sortWorksheetRowCells(values.map((cell, colIndex) => {
      const reference = excelColumn(colIndex) + rowNumber;
      if (typeof cell.value === "number" && Number.isFinite(cell.value)) return '<c r="' + reference + '" s="' + cell.style + '"><v>' + cell.value + '</v></c>';
      return '<c r="' + reference + '" s="' + cell.style + '" t="inlineStr"><is><t xml:space="preserve">' + xmlEscape(cell.value) + '</t></is></c>';
    }).join(""));
    const rowHeight = rowNumber === 1 ? 24 : rowNumber === 2 ? 20 : rowNumber === 3 ? 22
      : [4, 11, 12, 13].includes(rowNumber) ? 8
      : rowNumber === 14 || rowNumber === 15 ? 27
      : rowNumber === 16 ? 38
      : rowNumber === 17 ? 22
      : rowNumber > maxScoreRow && rowNumber <= maxScoreRow + detail.enrollments.length ? 22
      : rowNumber === signatureNameRow ? 28 : rowNumber === signatureRoleRow ? 24 : 20;
    return '<row r="' + rowNumber + '" ht="' + rowHeight + '" customHeight="1">' + xmlCells + '</row>';
  }).join("");

  const textByColumn = Array.from({ length: columnCount }, () => [] as string[]);
  for (const row of rows) row.forEach((cell, index) => textByColumn[index].push(String(cell.value ?? "")));
  scoreColumns.forEach((column, index) => textByColumn[3 + index].push(column.kind === "assessment" ? assessmentTitle(column.item) : "EQUIVALENT (%)"));
  const addGroupLabelWidths = (node: ExportCategoryNode) => {
    for (let column = node.startColumn; column < node.startColumn + node.columnCount; column++) textByColumn[column].push(node.category.name);
    node.children.forEach(addGroupLabelWidths);
  };
  rootNodes.forEach(addGroupLabelWidths);
  const widths = "<cols>" + textByColumn.map((texts, index) => {
    const maxLength = Math.max(0, ...texts.map(value => value.length));
    let width: number;
    if (index === 0) width = Math.max(7, Math.min(10, maxLength + 2));
    else if (index === 1) width = Math.max(24, Math.min(44, Math.ceil(maxLength * 0.9) + 2));
    else if (index === 2) width = Math.max(14, Math.min(18, Math.ceil(maxLength * 0.85) + 2));
    else if (index >= totalColumn) width = index === finalColumn ? 13 : index === remarksColumn ? 20 : 16;
    else if (scoreColumns[index - 3]?.kind === "equivalent") width = Math.max(14, Math.min(20, Math.ceil(maxLength * 0.85) + 2));
    else width = Math.max(14, Math.min(32, Math.ceil(maxLength * 0.82) + 2));
    return '<col min="' + (index + 1) + '" max="' + (index + 1) + '" width="' + width + '" customWidth="1"/>';
  }).join("") + "</cols>";

  const safeSheetName = sheetName.replace(/[\\/?*\\[\\]:]/g, " ").slice(0, 31) || "Grading Sheet";
  const firstDataRow = maxScoreRow + 1;
  const worksheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews><sheetView showGridLines="0" zoomScale="90" workbookViewId="0"><pane ySplit="' + (firstDataRow - 1) + '" topLeftCell="A' + firstDataRow + '" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A' + firstDataRow + '" sqref="A' + firstDataRow + '"/></sheetView></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="20"/>' + widths + '<sheetData>' + xmlRows + '</sheetData>' +
    '<mergeCells count="' + mergedRanges.length + '">' + mergedRanges.map(range => '<mergeCell ref="' + range + '"/>').join("") + '</mergeCells>' +
    '<printOptions horizontalCentered="1"/><pageMargins left="0.25" right="0.25" top="0.35" bottom="0.35" header="0.15" footer="0.15"/>' +
    '<pageSetup paperSize="256" orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>';
  const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="8"><font><sz val="9"/><name val="Arial"/></font><font><b/><sz val="14"/><name val="Arial"/></font><font><sz val="8.5"/><name val="Arial"/><color rgb="FF5B6573"/></font><font><b/><sz val="11"/><name val="Arial"/></font><font><b/><sz val="9"/><name val="Arial"/></font><font><b/><sz val="12"/><name val="Arial"/></font><font><i/><sz val="9"/><name val="Arial"/></font><font><b/><sz val="10"/><name val="Arial"/></font></fonts>' +
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF0F8"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD4DCE7"/></left><right style="thin"><color rgb="FFD4DCE7"/></right><top style="thin"><color rgb="FFD4DCE7"/></top><bottom style="thin"><color rgb="FFD4DCE7"/></bottom><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="18">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="4" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="6" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="2" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="7" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="7" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
    '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  const files = [
    { name: "[Content_Types].xml", content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
    { name: "_rels/.rels", content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: "xl/workbook.xml", content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="' + xmlEscape(safeSheetName) + '" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { name: "xl/_rels/workbook.xml.rels", content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { name: "xl/worksheets/sheet1.xml", content: worksheet },
    { name: "xl/styles.xml", content: styles }
  ];
  const url = URL.createObjectURL(new Blob([zipStored(files) as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function downloadFcuGradeXlsx(filename: string, sheetName: string, detail: Detail, categories: Category[], teacherName: string, teacherPosition: string, notedByName: string, notedByPosition: string, components: GradeSheetComponent[], headerPng: Uint8Array) {
  const componentCategoryPath = (category: Category) => {
    const names = [category.name];
    let parent = categories.find(item => item.id === category.parentId);
    const seen = new Set<string>([category.id]);
    while (parent && !seen.has(parent.id)) { names.unshift(parent.name); seen.add(parent.id); parent = categories.find(item => item.id === parent!.parentId); }
    return names.join(" / ");
  };
  const logoPng = headerPng;

  const componentColumns = components.map((component, index) => ({
    component,
    category: categories.find(category => componentCategoryPath(category).trim().toLocaleLowerCase() === component.name.trim().toLocaleLowerCase()),
    col: index + 2
  }));
  const totalCol = 2 + componentColumns.length;
  const columnCount = totalCol + 3;
  const last = excelColumn(columnCount - 1);
  const cells: Array<Array<{ value: unknown; style: number }>> = [];
  const row = (values: Array<{ col: number; value: unknown; style?: number }>) => {
    const result = Array.from({ length: columnCount }, () => ({ value: "", style: 0 } as { value: unknown; style: number }));
    for (const item of values) result[item.col] = { value: item.value, style: item.style ?? 1 };
    cells.push(result);
  };

  for (let i = 0; i < 9; i++) row([]);
  row([]);
  row([{ col: 0, value: { runs: [
    { text: "Course No.  " },
    { text: "  " + detail.code + "     ", underline: true },
    { text: "    Descriptive Title  " },
    { text: "   " + detail.title + "                                      ", underline: true }
  ] }, style: 2 }]);
  row([{ col: 0, value: "____________________________________________________________________________________________", style: 2 }]);
  row([{ col: 0, value: { runs: [
    { text: "Class I.D.  " },
    { text: "  " + (detail.classId || "—") + "    ", underline: true },
    { text: "          Semester  " },
    { text: "  " + detail.term + "    ", underline: true },
    { text: "          Academic Year  " },
    { text: "  " + detail.academicYear + "   ", underline: true }
  ] }, style: 2 }]);
  row([{ col: 0, value: "-----------------------------------------------------------------------------------------------------------------------------------------------", style: 6 }]);
  row([
    { col: 0, value: "", style: 4 },
    { col: 1, value: "NAME OF STUDENTS", style: 4 },
    ...componentColumns.map(item => ({
      col: item.col,
      value: item.component.name.toLocaleUpperCase() + ". " + (Number(item.component.percentage.toFixed(2))).toString() + "%",
      style: 4
    })),
    { col: totalCol, value: "TOTAL GRADE", style: 4 },
    { col: totalCol + 1, value: "FINAL GRADE", style: 4 },
    { col: totalCol + 2, value: "REMARKS", style: 4 }
  ]);
  row([{ col: 0, value: "-----------------------------------------------------------------------------------------------------------------------------------------------", style: 6 }]);

  for (const [index, enrollment] of detail.enrollments.entries()) {
    const band = detail.gradeBands.slice().sort((a, b) => b.minPercent - a.minPercent).find(item => enrollment.finalPercent !== null && enrollment.finalPercent >= item.minPercent);
    const special = ["INC", "NP", "DROPPED"].includes(enrollment.remarks || "");
    const componentValues = componentColumns.map(item => {
      const rawPercent = item.category
        ? item.category.name.toLocaleLowerCase().includes("attendance")
          ? gradeSheetAttendancePercent(detail, enrollment, item.category.id)
          : weightedCategoryPercent(enrollment, item.category, categories, detail.assessments)
        : null;
      const contribution = rawPercent === null ? null : rawPercent * item.component.percentage / 100;
      return {
        col: item.col,
        value: special || contribution === null ? "" : Number(contribution.toFixed(2)),
        style: 5
      };
    });
    const gradeString = special ? "" : enrollment.finalGradeOverride || band?.finalGrade || "";
    row([
      { col: 0, value: String(index + 1) + ".", style: 6 },
      { col: 1, value: enrollment.studentName.toLocaleUpperCase(), style: 7 },
      ...componentValues,
      { col: totalCol, value: special || enrollment.finalPercent === null ? "" : Number(enrollment.finalPercent.toFixed(2)), style: 5 },
      { col: totalCol + 1, value: gradeString, style: 6 },
      { col: totalCol + 2, value: enrollment.remarks || band?.remarks || "", style: 6 }
    ]);
  }

  row([]);
  const signatureRow = cells.length + 1;
  const signatureNameRow = signatureRow + 4;
  const signaturePositionRow = signatureRow + 5;
  const split = Math.max(1, Math.floor((columnCount - 1) / 2));
  row([{ col: 0, value: "Submitted by:", style: 2 }, { col: split + 1, value: "Noted:", style: 2 }]);
  row([]);
  row([]);
  row([]);
  row([
    { col: 0, value: teacherName.toLocaleUpperCase(), style: 8 },
    { col: split + 1, value: notedByName.toLocaleUpperCase(), style: 8 }
  ]);
  row([
    { col: 0, value: teacherPosition.trim(), style: 9 },
    { col: split + 1, value: notedByPosition.trim(), style: 9 }
  ]);

  const xmlRows = cells.map((values, rowIndex) => {
    const rowNumber = rowIndex + 1;
    const xmlCells = sortWorksheetRowCells(values.map((cell, colIndex) => {
      const reference = excelColumn(colIndex) + rowNumber;
      if (typeof cell.value === "number" && Number.isFinite(cell.value)) {
        return '<c r="' + reference + '" s="' + cell.style + '" t="n"><v>' + cell.value + '</v></c>';
      }
      if (cell.value && typeof cell.value === "object" && "runs" in cell.value) {
        const runs = (cell.value as { runs: Array<{ text: string; underline?: boolean }> }).runs;
        return '<c r="' + reference + '" s="' + cell.style + '" t="inlineStr"><is>' +
          runs.map(run => '<r><rPr><rFont val="Arial"/><sz val="9"/>' + (run.underline ? '<u/>' : '') + '</rPr><t xml:space="preserve">' + xmlEscape(run.text) + '</t></r>').join("") +
          '</is></c>';
      }
      return '<c r="' + reference + '" s="' + cell.style + '" t="inlineStr"><is><t xml:space="preserve">' + xmlEscape(cell.value) + '</t></is></c>';
    }).join(""));
    const height = rowIndex < 9 ? ' ht="15.5" customHeight="1"'
      : rowIndex === 14 ? ' ht="32" customHeight="1"'
      : rowIndex >= 16 && rowIndex < 16 + detail.enrollments.length ? ' ht="20" customHeight="1"'
      : rowIndex + 1 === signatureNameRow || rowIndex + 1 === signaturePositionRow ? ' ht="20" customHeight="1"'
      : ' ht="18" customHeight="1"';
    return '<row r="' + rowNumber + '"' + height + '>' + xmlCells + '</row>';
  }).join("");

  const signatureRanges = [
    "A" + signatureRow + ":" + excelColumn(split) + signatureRow,
    excelColumn(split + 1) + signatureRow + ":" + last + signatureRow,
    "A" + signatureNameRow + ":" + excelColumn(split) + signatureNameRow,
    excelColumn(split + 1) + signatureNameRow + ":" + last + signatureNameRow,
    "A" + signaturePositionRow + ":" + excelColumn(split) + signaturePositionRow,
    excelColumn(split + 1) + signaturePositionRow + ":" + last + signaturePositionRow
  ];
  const merges = ["A1:" + last + "9", "A11:" + last + "11", "A12:" + last + "12", "A13:" + last + "13", "A14:" + last + "14", ...signatureRanges];
  const mergeXml = merges.map(range => '<mergeCell ref="' + range + '"/>').join("");
  const widths = '<cols>' +
    '<col min="1" max="1" width="6" customWidth="1"/>' +
    '<col min="2" max="2" width="32" customWidth="1"/>' +
    (componentColumns.length ? '<col min="3" max="' + totalCol + '" width="13" customWidth="1"/>' : '') +
    '<col min="' + (totalCol + 1) + '" max="' + (totalCol + 1) + '" width="14" customWidth="1"/>' +
    '<col min="' + (totalCol + 2) + '" max="' + (totalCol + 2) + '" width="11" customWidth="1"/>' +
    '<col min="' + (totalCol + 3) + '" max="' + (totalCol + 3) + '" width="18" customWidth="1"/>' +
    '</cols>';
  const worksheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews><sheetView showGridLines="0" zoomScale="90" workbookViewId="0"><pane ySplit="16" topLeftCell="A17" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A17" sqref="A17"/></sheetView></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="18"/>' + widths + '<sheetData>' + xmlRows + '</sheetData>' +
    '<mergeCells count="' + merges.length + '">' + mergeXml + '</mergeCells>' +
    '<printOptions horizontalCentered="1"/><pageMargins left="0.275" right="0.20" top="0.39" bottom="0.24" header="0.20" footer="0.20"/>' +
    '<pageSetup paperSize="14" orientation="portrait" fitToWidth="1" fitToHeight="0"/>' +
    '<drawing r:id="rId1"/></worksheet>';
  const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="1"><numFmt numFmtId="164" formatCode="0.00&quot;%&quot;"/></numFmts>' +
    '<fonts count="5"><font><sz val="9"/><name val="Arial"/></font><font><b/><sz val="9"/><name val="Arial"/></font><font><sz val="8.5"/><name val="Arial"/><color rgb="FF5B6573"/></font><font><b/><sz val="14"/><name val="Arial"/></font><font><b/><sz val="9"/><name val="Arial"/></font></fonts>' +
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF0F8"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="dotted"/><right style="dotted"/><top/><bottom style="dotted"/><diagonal/></border><border><left/><right/><top style="dashed"/><bottom style="dashed"/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="10">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="0" fontId="4" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
    '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  const safeSheetName = sheetName.replace(/[\\/?*\[\]:]/g, " ").slice(0, 31) || "FCU Grades";
  const files = [
    { name: "[Content_Types].xml", content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
    { name: "_rels/.rels", content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: "xl/workbook.xml", content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="' + xmlEscape(safeSheetName) + '" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { name: "xl/_rels/workbook.xml.rels", content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { name: "xl/worksheets/sheet1.xml", content: worksheet },
    { name: "xl/styles.xml", content: styles },
    { name: "xl/worksheets/_rels/sheet1.xml.rels", content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>' },
    { name: "xl/drawings/drawing1.xml", content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="7040000" cy="1755000"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="1" name="Official FCU grading header"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>' },
    { name: "xl/drawings/_rels/drawing1.xml.rels", content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>' },
    { name: "xl/media/image1.png", content: logoPng }
  ];
  const url = URL.createObjectURL(new Blob([zipStored(files) as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function categoryPercent(enrollment: Enrollment, category: Category, assessments: Assessment[], categories: Category[]) {
  const items = assessments.filter(assessment => assessment.categoryId === category.id);
  if (!items.length) return null;
  const base = category.parentId ? categories.find(item => item.id === category.parentId)?.conversionBase : category.conversionBase;
  return calculateCategoryPercent({ conversionBase: base ?? 50, assessments: items.map(item => ({ title: item.title, dueDate: item.dueDate, maxScore: item.maxScore, weight: item.weight, scores: enrollment.scores.filter(score => score.assessmentId === item.id) })) });
}
function assessmentScoreDetails(enrollment: Enrollment, assessment: Assessment, category: Category, categories: Category[], assessments: Assessment[]) {
  const score = enrollment.scores.find(item => item.assessmentId === assessment.id);
  if ((!score || (score.points === null && !score.remark)) || score.remark === "EXCUSED") return { equivalent: null, contribution: null };
  const rawPoints = score.remark === "ABSENT" || score.remark === "DID_NOT_SUBMIT" ? 0 : score.points ?? 0;
  const base = category.parentId ? categories.find(item => item.id === category.parentId)?.conversionBase : category.conversionBase;
  const equivalent = convertRawPercent(rawPoints / assessment.maxScore * 100, base ?? 50);
  const categoryItems = assessments.filter(item => item.categoryId === category.id && !item.title.toLocaleLowerCase().startsWith("attendance ·"));
  const activeItems = categoryItems.filter(item => enrollment.scores.find(value => value.assessmentId === item.id)?.remark !== "EXCUSED");
  const hasExplicitWeights = categoryItems.some(item => item.weight !== null);
  const denominator = hasExplicitWeights ? activeItems.reduce((sum, item) => sum + (item.weight ?? 0), 0) : activeItems.reduce((sum, item) => sum + item.maxScore, 0);
  const itemWeight = hasExplicitWeights ? assessment.weight ?? 0 : assessment.maxScore;
  const share = denominator ? itemWeight / denominator : 0;
  return { equivalent, contribution: Math.round(equivalent * effectiveCategoryWeight(category, categories) / 100 * share * 100) / 100 };
}
function weightedCategoryPercent(enrollment: Enrollment, category: Category, categories: Category[], assessments: Assessment[]): number | null {
  const children = categories.filter(item => item.parentId === category.id);
  if (!children.length) return categoryPercent(enrollment, category, assessments, categories);
  if (!children.some(child => categoryHasScores(enrollment, child, categories, assessments))) return null;
  const totalWeight = children.reduce((sum, child) => sum + child.weight, 0);
  return totalWeight ? children.reduce((sum, child) => sum + (weightedCategoryPercent(enrollment, child, categories, assessments) ?? 0) * child.weight / totalWeight, 0) : null;
}
function categoryHasScores(enrollment: Enrollment, category: Category, categories: Category[], assessments: Assessment[]): boolean {
  const children = categories.filter(item => item.parentId === category.id);
  if (children.length) return children.some(child => categoryHasScores(enrollment, child, categories, assessments));
  return assessments.some(item => item.categoryId === category.id && enrollment.scores.some(score => score.assessmentId === item.id && (score.points !== null || (!!score.remark && score.remark !== "EXCUSED"))));
}
function attendanceSummary(enrollment: Enrollment, assessments: Assessment[], scoreLookup?: Map<string, Enrollment["scores"][number]>) {
  const sessions = assessments.filter(item => item.title.toLocaleLowerCase().startsWith("attendance ·"));
  const scores = scoreLookup ?? new Map(enrollment.scores.map(score => [score.assessmentId, score]));
  const today = todayManila();
  const days = orderedAttendanceDays(sessions, today);
  const converted = consecutiveLateAbsences(days, id => scores.get(id)?.remark);
  const { present, excused, late, recordedAbsent: absent, absent: effectiveAbsent, counted, lateAbsences, percent: absencePercent } =
    attendanceRiskSummary(sessions, scores, today, converted);
  return {
    present, excused, late, absent, counted, effectiveAbsent, lateAbsences, converted,
    absenceDates: absenceDates(days, id => scores.get(id), converted),
    droppingWarning: droppingAbsenceStreak(days, id => scores.get(id), converted),
    sessions: sessions.length,
    percent: absencePercent === null ? null : 100 - absencePercent,
    absencePercent,
    alertLevel: absencePercent === null ? "none" as const
      : absencePercent >= HIGH_RISK_ABSENCE_PERCENT ? "critical" as const
      : absencePercent >= EARLY_ABSENCE_PERCENT ? "early" as const : "none" as const,
    atRisk: absencePercent !== null && absencePercent > HIGH_RISK_ABSENCE_PERCENT
  };
}

function leafCategories(categories: Category[]) { return categories.filter(category => !categories.some(item => item.parentId === category.id)); }
function orderedCategoryTree(categories: Category[]) {
  const ordered: Category[] = [];
  const append = (parentId: string | null) => {
    categories.filter(category => (category.parentId ?? null) === parentId)
      .slice().sort((a, b) => a.sortOrder - b.sortOrder)
      .forEach(category => { ordered.push(category); append(category.id); });
  };
  append(null);
  return ordered;
}
function categoryPath(category: Category, categories: Category[]) {
  const names = [category.name]; let parent = categories.find(item => item.id === category.parentId);
  while (parent) { names.unshift(parent.name); parent = categories.find(item => item.id === parent?.parentId); }
  return names.join(" / ");
}
function categoryHasGradingAssessments(category: Category, categories: Category[], assessments: Assessment[], visited = new Set<string>()): boolean {
  if (visited.has(category.id)) return false;
  visited.add(category.id);
  if (category.name.toLocaleLowerCase().includes("attendance")) return true;
  if (assessments.some(item => item.categoryId === category.id && !item.title.toLocaleLowerCase().startsWith("attendance ·"))) return true;
  return categories
    .filter(child => child.parentId === category.id && !child.name.toLocaleLowerCase().includes("attendance"))
    .some(child => categoryHasGradingAssessments(child, categories, assessments, visited));
}
function rootCategory(category: Category, categories: Category[]) {
  let root = category;
  const visited = new Set([category.id]);
  while (root.parentId) {
    if (visited.has(root.parentId)) break;
    visited.add(root.parentId);
    const parent = categories.find(item => item.id === root.parentId);
    if (!parent) break;
    root = parent;
  }
  return root;
}
function localCategoryWeight(category: Category) {
  return category.weight;
}
function categoryWeightLabel(category: Category, categories: Category[]) {
  if (!category.parentId) return `${category.weight.toFixed(2)}% of course`;
  const parent = categories.find(item => item.id === category.parentId);
  return `${category.weight.toFixed(2)}% within ${parent?.name ?? "parent category"}`;
}
function effectiveCategoryWeight(category: Category, categories: Category[]) {
  let root = category;
  const visited = new Set([category.id]);
  while (root.parentId) {
    if (visited.has(root.parentId)) return 0;
    visited.add(root.parentId);
    const parent = categories.find(item => item.id === root.parentId);
    if (!parent) return 0;
    root = parent;
  }
  return category.id === root.id ? root.weight : root.weight * category.weight / 100;
}
export default function Portal({ user, initialPage = "overview", initialClassId = "", initialClassSection = "setup", initialClassStudent = "", initialAttendanceToday = false }: {
  user: User;
  initialPage?: "overview" | "classes" | "profile" | "simulator" | "chats" | "announcements";
  initialClassId?: string;
  initialClassSection?: ClassSection;
  initialClassStudent?: string;
  initialAttendanceToday?: boolean;
}) {
  const router = useRouter(); const teacher = user.role === "TEACHER"; const onboardingStorageKey = "saga-onboarding-complete:" + user.id;
  const [tab, setTab] = useState(initialPage); const [classSection, setClassSection] = useState<ClassSection>(initialClassSection); const [subjects, setSubjects] = useState<Subject[]>([]); const [activeId, setActiveId] = useState(initialClassId); const [detail, setDetail] = useState<Detail | null>(null); const [grades, setGrades] = useState<Grade[]>([]); const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(true); const [loadingDetail, setLoadingDetail] = useState(false); const [notice, setNotice] = useState(""); const [err, setErr] = useState("");
  const [createOpen, setCreateOpen] = useState(false); const [editOpen, setEditOpen] = useState(false); const [editDetails, setEditDetails] = useState({ classId: "", code: "", title: "", term: "1st Semester", academicYear: "", courseYear: "", courseProgram: "", yearLevel: "", section: "A" }); const [editScheduleRows, setEditScheduleRows] = useState<ScheduleRow[]>([]); const [rosterOpen, setRosterOpen] = useState(false); const [assessmentOpen, setAssessmentOpen] = useState(false); const [attendanceOpen, setAttendanceOpen] = useState(false); const [attendanceDate, setAttendanceDate] = useState(todayDateInput); const [attendanceType, setAttendanceType] = useState<"FACE_TO_FACE" | "ONLINE">("FACE_TO_FACE"); const [attendanceReason, setAttendanceReason] = useState(""); const [assessmentCategoryOverrides, setAssessmentCategoryOverrides] = useState<Record<string, boolean>>({});
  const [scheduleRows, setScheduleRows] = useState<ScheduleRow[]>([]); const [copyFromId, setCopyFromId] = useState(""); const [rosterText, setRosterText] = useState(""); const [rosterFileName, setRosterFileName] = useState(""); const [categoryName, setCategoryName] = useState(""); const [categoryParent, setCategoryParent] = useState(""); const [categoryWeight, setCategoryWeight] = useState("50"); const [categoryOpen, setCategoryOpen] = useState(false);
  const [lectureCourseWeight, setLectureCourseWeight] = useState("60"); const [laboratoryCourseWeight, setLaboratoryCourseWeight] = useState("40");
  const [gradingSetupType, setGradingSetupType] = useState<"SINGLE" | "COMBINED">("SINGLE"); const [singleGroupType, setSingleGroupType] = useState<"LECTURE" | "LABORATORY">("LECTURE");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [studentPortalPreferences, setStudentPortalPreferences] = useState<StudentPortalPreferences>(STUDENT_PORTAL_DEFAULTS);
  const [studentPortalPreferencesReady, setStudentPortalPreferencesReady] = useState(false);
  const [studentCustomizerRequested, setStudentCustomizerRequested] = useState(false);
  const [studentLayoutResetVersion, setStudentLayoutResetVersion] = useState(0);
  const studentPortalPreferencesKey = `saga-student-portal-preferences:v1:${user.id}`;
  useEffect(() => {
    if (teacher || user.isDemo) {
      setStudentPortalPreferences(STUDENT_PORTAL_DEFAULTS);
      setStudentPortalPreferencesReady(true);
      return;
    }
    try {
      const saved = window.localStorage.getItem(studentPortalPreferencesKey);
      setStudentPortalPreferences(saved ? mergeStudentPortalPreferences(JSON.parse(saved)) : STUDENT_PORTAL_DEFAULTS);
    } catch {
      setStudentPortalPreferences(STUDENT_PORTAL_DEFAULTS);
    } finally {
      setStudentPortalPreferencesReady(true);
    }
  }, [studentPortalPreferencesKey, teacher, user.isDemo]);
  useEffect(() => {
    if (!studentPortalPreferencesReady || teacher || user.isDemo) return;
    try { window.localStorage.setItem(studentPortalPreferencesKey, JSON.stringify(studentPortalPreferences)); }
    catch { /* Private browsing or storage limits must not block portal use. */ }
  }, [studentPortalPreferences, studentPortalPreferencesReady, studentPortalPreferencesKey, teacher, user.isDemo]);
  function resetStudentPortalPreferences() {
    setStudentPortalPreferences(STUDENT_PORTAL_DEFAULTS);
    setStudentCustomizerRequested(false);
    setStudentLayoutResetVersion(version => version + 1);
    setNotice("Student portal settings restored to the default layout.");
    if (!user.isDemo) {
      try { window.localStorage.removeItem(studentPortalPreferencesKey); }
      catch { /* The in-memory reset still applies if storage is unavailable. */ }
    }
  } const [academicYear, setAcademicYear] = useState("2026-2027"); const [calendarSystem, setCalendarSystem] = useState<"SEMESTER" | "TRIMESTER">("SEMESTER"); const [activeTerm, setActiveTerm] = useState("1st Semester"); const [academicPeriodReady, setAcademicPeriodReady] = useState(false); const academicYears = [...Array.from({length: 10}, (_, index) => 2016 + index), ...Array.from({length: 10}, (_, index) => 2026 + index)].map(start => `${start}-${start + 1}`).sort((a,b) => b.localeCompare(a)); const [classDirectoryQuery, setClassDirectoryQuery] = useState(""); const [rosterEdit, setRosterEdit] = useState<{ id: string; studentName: string; studentNumber: string } | null>(null); const [printMode, setPrintMode] = useState<"roster" | "grades" | "iso-grades" | null>(null); const [notedByName, setNotedByName] = useState(user.notedByName || ""); const [teacherPosition, setTeacherPosition] = useState(user.positionTitle || ""); const [notedByPosition, setNotedByPosition] = useState(user.notedByPosition || ""); const [gradeExcelExporting, setGradeExcelExporting] = useState<"generic" | "iso" | null>(null);
  const [schoolAddress, setSchoolAddress] = useState(user.school.address || "");
  const [departmentName, setDepartmentName] = useState(user.school.departmentName || "");
  const [isoHeaderConfig, setIsoHeaderConfig] = useState<IsoHeaderConfig>(() => readIsoHeaderConfig(user.school.name, user.school.slug, user.school.isoHeaderConfig));
  useEffect(() => { setSchoolAddress(user.school.address || ""); }, [user.school.address]);
  useEffect(() => { setDepartmentName(user.school.departmentName || ""); }, [user.school.departmentName]);
  useEffect(() => { setIsoHeaderConfig(readIsoHeaderConfig(user.school.name, user.school.slug, user.school.isoHeaderConfig)); }, [user.school.name, user.school.slug, user.school.isoHeaderConfig]);
  const defaultGradeSheetComponents = useMemo<GradeSheetComponent[]>(() => {
    const categories = detail?.categories || [];
    const assessments = detail?.assessments || [];
    const selectableCategories = orderedCategoryTree(categories).filter(category => categoryHasGradingAssessments(category, categories, assessments));
    const configured = selectableCategories.map(category => ({ name: categoryPath(category, categories), percentage: Number(localCategoryWeight(category).toFixed(2)) }));
    const defaultCategories = categories.filter(category => assessments.some(item => item.categoryId === category.id && !item.title.toLocaleLowerCase().startsWith("attendance ·"))).sort((a, b) => a.sortOrder - b.sortOrder);
    const defaultConfigured = defaultCategories.map(category => ({ name: categoryPath(category, categories), percentage: Number(localCategoryWeight(category).toFixed(2)) }));
    try {
      const saved = JSON.parse(user.defaultGradeSheetComponents || "");
      if (Array.isArray(saved) && saved.length) {
        const matched = saved.map((item: GradeSheetComponent) => configured.find(option => option.name.toLocaleLowerCase() === String(item.name).toLocaleLowerCase())).filter((item): item is GradeSheetComponent => Boolean(item));
        if (matched.length) return matched;
      }
    } catch {}
    return defaultConfigured.length ? defaultConfigured : configured.length ? configured : [{ name: "EXAM", percentage: 50 }, { name: "ACT", percentage: 40 }, { name: "ARP", percentage: 10 }];
  }, [user.defaultGradeSheetComponents, detail?.categories, detail?.assessments]);
  const [gradeSheetComponents, setGradeSheetComponents] = useState<GradeSheetComponent[]>(defaultGradeSheetComponents);
  const [componentDraft, setComponentDraft] = useState<GradeSheetComponent[]>(defaultGradeSheetComponents);
  const [componentEditorOpen, setComponentEditorOpen] = useState(false);
  const [classesMenuOpen, setClassesMenuOpen] = useState(false); const [onboardingOpen, setOnboardingOpen] = useState(false); const [helpOpen, setHelpOpen] = useState(false); const [helpInitialTab, setHelpInitialTab] = useState<"quick" | "faq" | "student" | "faculty">("quick"); const [subjectPage, setSubjectPage] = useState(1); const [classPage, setClassPage] = useState(1); const [rosterPage, setRosterPage] = useState(1);
  const [studentLookupQuery, setStudentLookupQuery] = useState(""); const [studentLookupMatches, setStudentLookupMatches] = useState<StudentSearchMatch[]>([]); const [studentLookupBusy, setStudentLookupBusy] = useState(false); const [classStudentFilter, setClassStudentFilter] = useState(initialClassStudent);
  const [studentGradeQuery, setStudentGradeQuery] = useState("");
  const [studentGradeDetails, setStudentGradeDetails] = useState<Record<string, Grade>>({});
  const studentGradeRequests = useRef<Map<string, Promise<Grade | null>>>(new Map());
  const studentGradeGenerationRef = useRef(0);
  const [studentGradeRevision, setStudentGradeRevision] = useState(0);
  const [studentGradeLoading, setStudentGradeLoading] = useState<Record<string, boolean>>({});
  const [studentGradeErrors, setStudentGradeErrors] = useState<Record<string, string>>({});
  const [studentRefreshing, setStudentRefreshing] = useState(false);
  const [studentLastUpdated, setStudentLastUpdated] = useState<Date | null>(null);
  const [profileFacultyId, setProfileFacultyId] = useState(user.facultyId || "");
  const [profileName, setProfileName] = useState(user.fullName); const [passwordCurrent, setPasswordCurrent] = useState(""); const [passwordNew, setPasswordNew] = useState(""); const [passwordConfirm, setPasswordConfirm] = useState(""); const [passwordOtp, setPasswordOtp] = useState(""); const [passwordOtpSent, setPasswordOtpSent] = useState(false);
  const [profileImagePath, setProfileImagePath] = useState(user.profileImagePath); const [schoolLogoPath, setSchoolLogoPath] = useState(user.school.logoPath); const [departmentLogoPath, setDepartmentLogoPath] = useState(user.school.departmentLogoPath);
  const [overviewData, setOverviewData] = useState<OverviewData | null>(null); const [overviewLoading, setOverviewLoading] = useState(false); const [overviewRefresh, setOverviewRefresh] = useState(0);
  const [recentActivity, setRecentActivity] = useState<{ subjectId: string; activityId: string } | null>(null);
  const [overviewTo, setOverviewTo] = useState(todayDateInput); const [overviewFrom, setOverviewFrom] = useState(() => shiftDateInput(todayDateInput(), -29));
  const [bulkScoresOpen, setBulkScoresOpen] = useState(false); const [bulkFileName, setBulkFileName] = useState(""); const [bulkOperations, setBulkOperations] = useState<Array<{enrollmentId:string;assessmentId:string;points:number|null;remark:"EXCUSED"|"ABSENT"|"DID_NOT_SUBMIT"|null}>>([]); const [bulkRowsPreview, setBulkRowsPreview] = useState<Array<{row:number;student:string;cells:number;errors:string[]}>>([]); const [bulkErrors, setBulkErrors] = useState<string[]>([]);
  const [gradeChangeEnrollmentId, setGradeChangeEnrollmentId] = useState(""); const [gradeChangeGrade, setGradeChangeGrade] = useState("AUTO"); const [gradeChangeRemark, setGradeChangeRemark] = useState("AUTO"); const [gradeChangeReason, setGradeChangeReason] = useState("");
  const [gradeHistory, setGradeHistory] = useState<NonNullable<Enrollment["gradeChangeHistory"]>>([]);
  const [gradeHistoryLoading, setGradeHistoryLoading] = useState(false);
  const [gradeHistoryError, setGradeHistoryError] = useState("");
  const [attendanceQuickOpenId, setAttendanceQuickOpenId] = useState(initialAttendanceToday && initialClassId ? initialClassId : "");
  // A lightweight attendance response is sufficient for attendance, while
  // the other class tabs require the complete academic record.
  const loadedClassRef = useRef<{ id: string; mode: "attendance" | "full" } | null>(null);
  const workbookPendingRef = useRef<Map<string, WorkbookChange>>(new Map());
  const workbookTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const workbookInflightRef = useRef<Promise<boolean> | null>(null);
  const workbookFailedRef = useRef(false);
  const [workbookSaveState, setWorkbookSaveState] = useState<"idle" | "queued" | "saving" | "saved" | "error">("idle");
  const attendancePendingRef = useRef<Map<string, AttendanceMark>>(new Map());
  const attendanceSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attendanceSavingRef = useRef(false);
  const attendanceFailedRef = useRef(false);
  const [attendanceSaveState, setAttendanceSaveState] = useState<"idle" | "pending" | "saving" | "saved" | "error">("idle");
  useEffect(() => {
    const onPageHide = () => {
      if (attendanceSaveTimerRef.current) clearTimeout(attendanceSaveTimerRef.current);
      void flushAttendanceMarks();
      void flushWorkbookScores();
    };
    window.addEventListener("pagehide", onPageHide);
    return () => { window.removeEventListener("pagehide", onPageHide); onPageHide(); };
  }, []);
  const [showWeightBreakdown, setShowWeightBreakdown] = useState(false);
  const [scorebookView, setScorebookView] = useState<"auto" | "all">("auto");
  const [scorebookPage, setScorebookPage] = useState(0);
  const [scorebookWidth, setScorebookWidth] = useState(1250);
  const scorebookRegionRef = useRef<HTMLElement>(null);
  const scorebookScrollRef = useRef<HTMLDivElement>(null);
  const scorebookFloatingScrollRef = useRef<HTMLDivElement>(null);
  const [scorebookFloatingScroll, setScorebookFloatingScroll] = useState({ visible: false, left: 0, width: 0, scrollWidth: 0 });
  useEffect(() => {
    if (classSection !== "record") return;
    const region = scorebookRegionRef.current;
    if (!region) return;
    const recalc = () => {
      const width = Math.max(760, Math.round(region.clientWidth - 32));
      setScorebookWidth(previous => previous === width ? previous : width);
    };
    recalc();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(recalc);
      observer.observe(region);
      return () => observer.disconnect();
    }
    window.addEventListener("resize", recalc);
    return () => window.removeEventListener("resize", recalc);
  }, [classSection, activeId, detail?.id]);
  useEffect(() => { setScorebookPage(0); setScorebookView("auto"); }, [activeId]);
  useEffect(() => { if (!detail) return; try { const usedCategories = orderedCategoryTree(detail.categories).filter(category => categoryHasGradingAssessments(category, detail.categories, detail.assessments)); const configured = usedCategories.map(category => ({ name: categoryPath(category, detail.categories), percentage: Number(localCategoryWeight(category).toFixed(2)) })); const saved = detail.gradeSheetComponents ? JSON.parse(detail.gradeSheetComponents) : null; const source = Array.isArray(saved) && saved.length ? saved : defaultGradeSheetComponents; const next = source.map((item: GradeSheetComponent) => configured.find(option => option.name.toLocaleLowerCase() === String(item.name).toLocaleLowerCase())).filter((item): item is GradeSheetComponent => Boolean(item)); const selected = next.length ? next : defaultGradeSheetComponents.length ? defaultGradeSheetComponents : configured; setGradeSheetComponents(selected); setComponentDraft(selected); } catch { setGradeSheetComponents(defaultGradeSheetComponents); setComponentDraft(defaultGradeSheetComponents); } }, [detail?.id, detail?.gradeSheetComponents, detail?.categories, detail?.assessments, defaultGradeSheetComponents]);
  const [visibilityManagerQuery, setVisibilityManagerQuery] = useState<string | null>(null);
  const [simulatingGradeId, setSimulatingGradeId] = useState<string | null>(null);
  useEffect(() => { if (!notice && !err) return; const timer = window.setTimeout(() => { setNotice(""); setErr(""); }, err ? 20000 : 5500); return () => window.clearTimeout(timer); }, [notice, err]);
  function closeOnboarding() { window.localStorage.setItem(onboardingStorageKey, "done"); setOnboardingOpen(false); }
  function openHelp(tab: "quick" | "faq" | "student" | "faculty" = "quick") { setHelpInitialTab(tab); setHelpOpen(true); }
  function openHelpFromTour() { closeOnboarding(); openHelp("quick"); }
  function navigatePage(page: "overview" | "classes" | "profile" | "simulator" | "chats" | "announcements") {
    if (page === "simulator" && teacher) return;
    if (page === "announcements" && teacher) return;
    if (page === "classes") {
      if (!teacher) return;
      // The Classes entry opens the directory first; a teacher explicitly
      // chooses which class workspace to enter.
      setActiveId("");
      setDetail(null);
      setClassSection("setup");
      setClassStudentFilter("");
      setAttendanceQuickOpenId("");
      setTab("classes");
      const href = classWorkspaceHref(user.school.slug);
      if (window.location.pathname + window.location.search !== href) router.push(href, { scroll: false });
      return;
    }
    setTab(page);
    const href = `/${encodeURIComponent(user.school.slug)}/${page}`;
    if (!teacher) {
      // Keep the student's grade summaries and simulation selection in memory
      // while moving between authorized pages, avoiding a full portal reload.
      if (window.location.pathname !== href) window.history.pushState(null, "", href);
    } else router.push(href);
  }
  function openClass(subjectId: string, section: ClassSection = "setup", options: { student?: string; attendanceToday?: boolean } = {}, replace = false) {
    const subject = subjects.find(item => item.id === subjectId);
    if (!subject) {
      navigatePage("classes");
      return;
    }
    setClassStudentFilter(options.student || "");
    setActiveId(subjectId);
    setClassSection(section);
    setAttendanceQuickOpenId(options.attendanceToday ? subjectId : "");
    setTab("classes");
    const href = classWorkspaceHref(user.school.slug, subjectId, section, options, subjects);
    // We already have the teacher-scoped class catalog and mounted portal.
    // Native history is supported by the Next.js App Router; avoid a second
    // server-component round-trip when opening a workspace from Overview.
    if (replace) window.history.replaceState(null, "", href);
    else if (window.location.pathname + window.location.search !== href) window.history.pushState(null, "", href);
  }
  function openClassSection(section: ClassSection) {
    setClassSection(section);
    if (activeId) window.history.replaceState(null, "",
      classWorkspaceHref(user.school.slug, activeId, section, classStudentFilter ? { student: classStudentFilter } : undefined, subjects));
  }
  useEffect(() => { setTab(initialPage); }, [initialPage]);
  useEffect(() => {
    if (!teacher || initialPage !== "classes") return;
    setActiveId(initialClassId);
    setClassSection(initialClassSection);
    setClassStudentFilter(initialClassStudent);
    if (initialAttendanceToday && initialClassId) setAttendanceQuickOpenId(initialClassId);
  }, [teacher, initialPage, initialClassId, initialClassSection, initialClassStudent, initialAttendanceToday]);
  // Restore a class or the Overview when navigating Back/Forward from
  // a fast client-side class shortcut. Deep links remain checked on the server.
  useEffect(() => {
    const syncFromHistory = () => {
      const root = `/${encodeURIComponent(user.school.slug)}`;
      const pathname = window.location.pathname;
      if (pathname === `${root}/overview`) { setTab("overview"); return; }
      if (pathname === `${root}/profile`) { setTab("profile"); return; }
      if (pathname === `${root}/chats`) { setTab("chats"); return; }
      if (!teacher && pathname === `${root}/announcements`) { setTab("announcements"); return; }
      if (!teacher && pathname === `${root}/simulator`) { setTab("simulator"); return; }
      if (!teacher) return;
      if (pathname === `${root}/classes`) {
        setActiveId("");
        setDetail(null);
        setClassSection("setup");
        setClassStudentFilter("");
        setTab("classes");
        return;
      }
      const classPrefix = `${root}/classes/`;
      if (pathname.startsWith(classPrefix)) {
        const slug = decodeURIComponent(pathname.slice(classPrefix.length));
        const selected = resolveClassRoute(slug, subjects);
        if (!selected) return;
        const params = new URLSearchParams(window.location.search);
        const route = parseClassWorkspaceQuery({
          section: params.get("section") || undefined,
          student: params.get("student") || undefined,
          attendanceToday: params.get("attendanceToday") || undefined
        });
        setActiveId(selected.id);
        setClassSection(route.section);
        setClassStudentFilter(route.student);
        setTab("classes");
      }
    };
    window.addEventListener("popstate", syncFromHistory);
    return () => window.removeEventListener("popstate", syncFromHistory);
  }, [teacher, subjects, user.school.slug]);
  async function loadSubjects() { const d = await api(`/api/teacher/subjects?academicYear=${encodeURIComponent(academicYear)}&term=${encodeURIComponent(activeTerm)}`); setSubjects(d.subjects); setOverviewRefresh(value => value + 1); }
  async function loadDetail(id = activeId) {
    if (!id) { setDetail(null); loadedClassRef.current = null; return; }
    setLoadingDetail(true);
    try {
      const d = await api(`/api/teacher/subjects/${id}`);
      loadedClassRef.current = { id, mode: "full" };
      setDetail(d.subject);
    } finally { setLoadingDetail(false); }
  }
  async function loadGrades() {
    const data = await api(`/api/student/grades?view=summary&academicYear=${encodeURIComponent(academicYear)}&term=${encodeURIComponent(activeTerm)}`);
    setGrades(data.grades as Grade[]);
    setStudentLastUpdated(new Date());
    studentGradeGenerationRef.current++;
    setStudentGradeRevision(value => value + 1);
    setStudentGradeDetails({});
    setStudentGradeLoading({});
    setStudentGradeErrors({});
    studentGradeRequests.current.clear();
  }
  async function refreshStudentGrades() {
    if (teacher || studentRefreshing) return;
    setStudentRefreshing(true);
    try {
      await loadGrades();
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Could not refresh your grades.");
    } finally {
      setStudentRefreshing(false);
    }
  }
  async function ensureStudentGradeDetail(id: string): Promise<Grade | null> {
    if (studentGradeDetails[id]) return studentGradeDetails[id];
    const pending = studentGradeRequests.current.get(id);
    if (pending) return pending;
    const generation = studentGradeGenerationRef.current;
    setStudentGradeErrors(current => ({ ...current, [id]: "" }));
    setStudentGradeLoading(current => ({ ...current, [id]: true }));
    const task = (async (): Promise<Grade | null> => {
      try {
        const data = await api(`/api/student/grades?enrollmentId=${encodeURIComponent(id)}&academicYear=${encodeURIComponent(academicYear)}&term=${encodeURIComponent(activeTerm)}`);
        const grade = data.grade as Grade;
        if (studentGradeGenerationRef.current === generation) {
          setStudentGradeDetails(current => ({ ...current, [id]: grade }));
        }
        return grade;
      } catch (error) {
        if (studentGradeGenerationRef.current === generation) {
          setStudentGradeErrors(current => ({
            ...current, [id]: error instanceof Error ? error.message : "Could not load assessment details."
          }));
        }
        return null;
      } finally {
        if (studentGradeGenerationRef.current === generation) {
          studentGradeRequests.current.delete(id);
          setStudentGradeLoading(current => ({ ...current, [id]: false }));
        }
      }
    })();
    studentGradeRequests.current.set(id, task);
    return task;
  }
  function startStudentSimulation(id: string) {
    setSimulatingGradeId(id);
    void ensureStudentGradeDetail(id);
    navigatePage("simulator");
  }
  useEffect(() => {
    if (!teacher || !gradeChangeEnrollmentId || !detail?.id) return;
    const controller = new AbortController();
    setGradeHistory([]);
    setGradeHistoryError("");
    setGradeHistoryLoading(true);
    api(`/api/teacher/subjects/${detail.id}/grade-history?enrollmentId=${encodeURIComponent(gradeChangeEnrollmentId)}`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setGradeHistory(result.history || []); })
      .catch(error => {
        if (!controller.signal.aborted) setGradeHistoryError(error instanceof Error ? error.message : "Could not load grade history.");
      })
      .finally(() => { if (!controller.signal.aborted) setGradeHistoryLoading(false); });
    return () => controller.abort();
  }, [teacher, gradeChangeEnrollmentId, detail?.id]);
  useEffect(() => { if (!academicPeriodReady) return; setLoading(true); (teacher ? loadSubjects() : loadGrades()).catch(e => setErr(e.message)).finally(() => setLoading(false)); }, [academicPeriodReady, academicYear, activeTerm, teacher]);
  useEffect(() => {
    if (!academicPeriodReady || !teacher || tab !== "overview" || !overviewFrom || !overviewTo || overviewFrom > overviewTo) return;
    const controller = new AbortController();
    setOverviewLoading(true);
    api(`/api/teacher/overview?from=${encodeURIComponent(overviewFrom)}&to=${encodeURIComponent(overviewTo)}&academicYear=${encodeURIComponent(academicYear)}&term=${encodeURIComponent(activeTerm)}`, { signal: controller.signal, cache: "no-store" })
      .then(data => { if (!controller.signal.aborted) setOverviewData(data as OverviewData); })
      .catch(error => { if (error?.name !== "AbortError") setErr(error instanceof Error ? error.message : "Could not load teaching analytics."); })
      .finally(() => { if (!controller.signal.aborted) setOverviewLoading(false); });
    return () => controller.abort();
  }, [academicPeriodReady, teacher, tab, overviewFrom, overviewTo, overviewRefresh, academicYear, activeTerm]);
  useEffect(() => {
    const query = studentLookupQuery.trim();
    if (!teacher || tab !== "overview" || query.length < 2) {
      setStudentLookupMatches([]);
      setStudentLookupBusy(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setStudentLookupBusy(true);
      const params = new URLSearchParams({ q: query });
      params.set("academicYear", academicYear);
      params.set("term", activeTerm);
      api(`/api/teacher/student-search?${params}`, { signal: controller.signal })
        .then(data => setStudentLookupMatches((data.matches || []) as StudentSearchMatch[]))
        .catch(error => { if (error?.name !== "AbortError") setErr(error instanceof Error ? error.message : "Could not search student records."); })
        .finally(() => { if (!controller.signal.aborted) setStudentLookupBusy(false); });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [teacher, tab, studentLookupQuery, academicYear, activeTerm]);
  useEffect(() => { const saved = window.localStorage.getItem("saga-portal-theme"); if (saved === "dark" || saved === "light") setTheme(saved); }, []);
  useEffect(() => { try { const saved = window.localStorage.getItem(`saga-academic-period:${user.id}`); if (saved) { const value = JSON.parse(saved); if (typeof value.academicYear === "string" && /^\d{4}-\d{4}$/.test(value.academicYear)) setAcademicYear(value.academicYear); if (value.calendarSystem === "SEMESTER" || value.calendarSystem === "TRIMESTER") setCalendarSystem(value.calendarSystem); if (typeof value.term === "string") setActiveTerm(value.term); } } catch { /* Ignore invalid local preferences and use the default period. */ } finally { setAcademicPeriodReady(true); } }, [user.id]);
  useEffect(() => { if (academicPeriodReady) window.localStorage.setItem(`saga-academic-period:${user.id}`, JSON.stringify({ academicYear, calendarSystem, term: activeTerm })); }, [academicPeriodReady, user.id, academicYear, calendarSystem, activeTerm]);
  useEffect(() => { if (window.localStorage.getItem(onboardingStorageKey) !== "done") setOnboardingOpen(true); }, [onboardingStorageKey]);

  const activeClassAvailable = subjects.some(subject => subject.id === activeId);
  useEffect(() => {
    // Do not load a full class record while the user is on Overview.
    if (!teacher || loading || tab !== "classes") return;
    if (!activeId || !activeClassAvailable) { setDetail(null); loadedClassRef.current = null; return; }
    const mode = classSection === "attendance" ? "attendance" : "full";
    const loaded = loadedClassRef.current;
    if (loaded?.id === activeId && (loaded.mode === "full" || mode === "attendance")) return;
    const controller = new AbortController();
    if (loaded?.id !== activeId || (mode === "full" && loaded.mode === "attendance")) setDetail(null);
    setLoadingDetail(true);
    const endpoint = mode === "attendance"
      ? `/api/teacher/subjects/${activeId}/attendance`
      : `/api/teacher/subjects/${activeId}`;
    api(endpoint, { signal: controller.signal })
      .then(result => {
        if (controller.signal.aborted) return;
        loadedClassRef.current = { id: activeId, mode };
        setDetail(result.subject);
      })
      .catch(error => {
        if (!controller.signal.aborted) setErr(error instanceof Error ? error.message : "Could not load class records.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoadingDetail(false); });
    return () => controller.abort();
  }, [teacher, loading, tab, activeId, classSection, activeClassAvailable]);
  useEffect(() => {
    if (!attendanceQuickOpenId || detail?.id !== attendanceQuickOpenId) return;
    const scheduledToday = overviewData?.today || todayDateInput();
    const todaySession = scheduledToday && detail.assessments.some(item => item.title.toLocaleLowerCase() === `attendance · ${scheduledToday}`.toLocaleLowerCase());
    setAttendanceQuickOpenId("");
    if (detail.gradeStatus !== "VERIFIED" && !todaySession) void addAttendanceSession(scheduledToday);
  }, [attendanceQuickOpenId, detail, overviewData?.today]);
  useEffect(() => { setCopyFromId(""); }, [activeId]);
  useEffect(() => {
    if (!teacher || loading || tab !== "classes" || !activeId) return;
    if (subjects.some(subject => subject.id === activeId)) return;
    // A period change returns to the active-period directory instead of
    // silently opening a different class.
    setActiveId("");
    setDetail(null);
    loadedClassRef.current = null;
    setClassSection("setup");
    setClassStudentFilter("");
    setAttendanceQuickOpenId("");
    router.replace(classWorkspaceHref(user.school.slug), { scroll: false });
  }, [teacher, loading, tab, subjects, activeId, router, user.school.slug]);
  useEffect(() => {
    if (!printMode) return;
    let cancelled = false;
    const afterPrint = () => setPrintMode(null);
    window.addEventListener("afterprint", afterPrint);
    async function openPrint() {
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (!cancelled) window.print();
    }
    void openPrint();
    return () => { cancelled = true; window.removeEventListener("afterprint", afterPrint); };
  }, [printMode]);
  async function logout() {
    const response = await fetch("/api/auth/logout", { method: "POST" });
    if (!response.ok) throw new Error("Could not sign out.");
    router.replace("/login");
    router.refresh();
  }
  function openStudentSearchMatch(match: StudentSearchMatch) {
    openClass(match.class.id, "record", { student: match.enrollmentId });
  }
  function notificationTarget(message: string) {
    const lower=message.toLocaleLowerCase();
    if(/weight|categor|grading path|allocation|parent/.test(lower)) return { label:"Grading setup", section:"setup" };
    if(/attendance|schedule|class date/.test(lower)) return { label:"Attendance", section:"attendance" };
    if(/assessment|perfect score|item weight/.test(lower)) return { label:"Assessment items", section:"items" };
    if(/score|student record|missing/.test(lower)) return { label:"Record scores", section:"record" };
    if(/student|roster/.test(lower)) return { label:"Class roster", section:"roster" };
    if(/grade band|equivalent|threshold/.test(lower)) return { label:"Final-grade equivalents", section:"setup" };
    return null;
  }
  function goToNotificationTarget() {
    if(!err||!detail)return; const target=notificationTarget(err); if(!target)return; openClassSection(target.section as ClassSection); window.setTimeout(()=>document.getElementById(`class-section-${target.section}`)?.scrollIntoView({behavior:"smooth",block:"start"}),100);
  }
  async function run(action: () => Promise<void>, success = "Saved.") { setBusy(true); setErr(""); setNotice(""); try { await action(); setNotice(success); } catch (e) { setErr(e instanceof Error ? e.message : "Something went wrong."); } finally { setBusy(false); } }
  async function createSubject(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const data = { ...Object.fromEntries(new FormData(e.currentTarget)), term: activeTerm, academicYear, schedule: scheduleRows.length ? JSON.stringify(scheduleRows) : undefined };
    await run(async () => { const d = await api("/api/teacher/subjects", { method: "POST", body: JSON.stringify(data) }); await loadSubjects(); setActiveId(d.subject.id); setClassSection("setup"); router.replace(classWorkspaceHref(user.school.slug, d.subject.id, "setup", undefined, [...subjects, d.subject]), { scroll: false }); setCreateOpen(false); setScheduleRows([]); }, "Subject created. Add your class roll and assessments next.");
  }
  function openSubjectEditor() {
    if (!detail) return;
    setEditDetails({ classId: detail.classId || "", code: detail.code, title: detail.title, term: detail.term, academicYear: detail.academicYear, courseYear: detail.courseYear || "", courseProgram: detail.courseProgram || "", yearLevel: detail.yearLevel || "", section: detail.section || "A" });
    try { const parsed = JSON.parse(detail.schedule || "[]"); setEditScheduleRows(Array.isArray(parsed) ? parsed : []); } catch { setEditScheduleRows(detail.schedule ? [{ ...newScheduleRow(), label: "Class", day: "Monday", startTime: "07:30 AM", endTime: "09:00 AM" }] : []); }
    setEditOpen(true);
  }
  async function saveSubjectDetails(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!detail) return;
    const updated = { ...editDetails, courseYear: editDetails.courseYear || null, courseProgram: editDetails.courseProgram || null, yearLevel: editDetails.yearLevel || null, section: editDetails.section || "A", schedule: editScheduleRows.length ? JSON.stringify(editScheduleRows) : null };
    await run(async () => { await api(`/api/teacher/subjects/${detail.id}`, { method: "PATCH", body: JSON.stringify({ updateSubject: updated }) }); setDetail(current => current ? { ...current, ...updated } : current); setSubjects(current => current.map(subject => subject.id === detail.id ? { ...subject, ...updated } : subject)); setEditOpen(false); }, "Class details updated.");
  }
  async function deleteSubject() {
    if (!detail || !window.confirm(`Delete ${detail.code} — ${detail.title}? This permanently removes its roster, assessments, scores, attendance, and grading setup. Only draft classes can be deleted.`)) return;
    await run(async () => { await api(`/api/teacher/subjects/${detail.id}`, { method: "PATCH", body: JSON.stringify({ deleteSubject: true }) }); setDetail(null); setActiveId(""); await loadSubjects(); router.replace(classWorkspaceHref(user.school.slug), { scroll: false }); }, "Class deleted.");
  }
  async function addRoster(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const form = e.currentTarget; const text = rosterText;
    const students = text.split("\n").map(line => line.trim()).filter(Boolean).map(line => { const [studentName, studentNumber] = line.split(/\t|\|/).map(x => x.trim()); return { studentName, studentNumber: studentNumber || undefined }; });
    await run(async () => { const result = await api(`/api/teacher/subjects/${activeId}`, { method: "POST", body: JSON.stringify({ students }) }); setDetail(current => current ? { ...current, enrollments: [...current.enrollments, ...result.enrollments.map((enrollment: { id: string; studentName: string; studentNumber: string | null; studentUserId: string | null }) => ({ ...enrollment, remarks: null, scores: [], finalPercent: null }))].sort((a,b) => a.studentName.localeCompare(b.studentName)) } : current); setSubjects(current => current.map(subject => subject.id === activeId ? { ...subject, _count: { enrollments: (subject._count?.enrollments || 0) + result.count } } : subject)); form.reset(); setRosterText(""); setRosterFileName(""); setRosterOpen(false); }, `${students.length} student record(s) added. Matching student accounts will see submitted grades automatically.`);
  }
  async function addAssessment(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const form = e.currentTarget; const f = new FormData(form); const body = { title: f.get("title"), categoryId: f.get("categoryId"), maxScore: Number(f.get("maxScore")), weight: f.get("weight") === "" ? null : Number(f.get("weight")), dueDate: f.get("dueDate") || undefined };
    await run(async () => { const result = await api(`/api/teacher/subjects/${activeId}`, { method: "POST", body: JSON.stringify(body) }); setDetail(current => current ? { ...current, assessments: [...current.assessments, result.assessment] } : current); form.reset(); setAssessmentOpen(false); }, "Assessment added.");
  }
  async function addAttendanceSession(date = todayDateInput()) {
    if (!detail) return;
    const category = leafCategories(detail.categories).find(item => item.name.toLocaleLowerCase().includes("attendance"));
    if (!category) { setErr("Add an Attendance category under Grading setup first, then create dated attendance sessions here."); return; }
    if (!scheduleWeekdays(detail.schedule).length) { setErr("Add valid class days to the subject schedule before taking attendance."); return; }
    setAttendanceDate(date); setAttendanceType("FACE_TO_FACE"); setAttendanceReason(""); setAttendanceOpen(true);
  }
  async function createAttendanceDay(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!detail) return;
    const weekday = weekdayFromDate(attendanceDate); const scheduledDays = scheduleWeekdays(detail.schedule);
    if (weekday === null) { setErr("Choose a valid class date."); return; }
    if (!scheduledDays.includes(weekday) && attendanceReason.trim().length < 4) { setErr("This date is outside the class schedule. Enter a reason such as “Make-up class”."); return; }
    await run(async () => { const result = await api(`/api/teacher/subjects/${detail.id}/attendance`, { method: "POST", body: JSON.stringify({ date: attendanceDate, categoryId: leafCategories(detail.categories).find(item => item.name.toLocaleLowerCase().includes("attendance"))?.id, reason: attendanceReason.trim() || undefined, attendanceType }) }); setDetail(current => current ? { ...current, assessments: [...current.assessments, result.assessment], enrollments: current.enrollments.map(enrollment => ({ ...enrollment, scores: [...enrollment.scores, { assessmentId: result.assessment.id, points: null, remark: "PRESENT" }] })) } : current); setAttendanceOpen(false); }, "Attendance day added. Record each student as present, absent, or excused.");
  }
  async function saveWeights() {
    if (!detail) return; await run(async () => { await api(`/api/teacher/subjects/${detail.id}`, { method: "PATCH", body: JSON.stringify({ categories: detail.categories }) }); }, "Grading weights saved.");
  }
  async function addCategory(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!detail) return;
    await run(async () => { const result = await api(`/api/teacher/subjects/${detail.id}`, { method: "POST", body: JSON.stringify({ category: { name: categoryName, parentId: categoryParent || null, weight: Number(categoryWeight) }, existingCategories: detail.categories }) }); setDetail(current => current ? { ...current, categories: [...current.categories, result.category] } : current); setCategoryName(""); setCategoryParent(""); setCategoryWeight("0"); setCategoryOpen(false); }, "Category added under its parent. Review the allocation, then save the grading path.");
  }
  async function removeCategory(categoryId: string) {
    if (!detail || !window.confirm("Remove this empty category?")) return;
    await run(async () => { await api(`/api/teacher/subjects/${detail.id}`, { method: "PATCH", body: JSON.stringify({ deleteCategoryId: categoryId }) }); setDetail(current => current ? { ...current, categories: current.categories.filter(category => category.id !== categoryId) } : current); }, "Empty grading category removed.");
  }
  async function moveAssessmentCategory(categoryId: string, direction: -1 | 1) {
    if (!detail || detail.gradeStatus === "VERIFIED") return;
    const category = detail.categories.find(item => item.id === categoryId);
    if (!category) return;
    const siblings = detail.categories.filter(item => (item.parentId ?? null) === (category.parentId ?? null)).slice().sort((a,b) => a.sortOrder-b.sortOrder);
    const from = siblings.findIndex(item => item.id === categoryId);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= siblings.length) return;
    const reordered = siblings.slice();
    [reordered[from], reordered[to]] = [reordered[to], reordered[from]];
    const orderById = new Map(reordered.map((item,index) => [item.id,index]));
    const nextCategories = orderedCategoryTree(detail.categories.map(item => orderById.has(item.id) ? { ...item, sortOrder: orderById.get(item.id)! } : item));
    await run(async () => {
      await api(`/api/teacher/subjects/${detail.id}`, {
        method: "PATCH",
        body: JSON.stringify({ categories: nextCategories.map(item => ({
          id: item.id, parentId: item.parentId, name: item.name, weight: item.weight,
          conversionBase: item.conversionBase, sortOrder: item.sortOrder
        })) })
      });
      setDetail(current => current ? { ...current, categories: nextCategories } : current);
    }, "Category order saved. Record Scores now follows this arrangement.");
  }
  async function moveAssessmentItem(categoryId: string, assessmentId: string, direction: -1 | 1) {
    if (!detail || detail.gradeStatus === "VERIFIED") return;
    const siblings = detail.assessments.filter(item => item.categoryId === categoryId).slice()
      .sort((a,b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const from = siblings.findIndex(item => item.id === assessmentId);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= siblings.length) return;
    const reordered = siblings.slice();
    [reordered[from], reordered[to]] = [reordered[to], reordered[from]];
    const orderById = new Map(reordered.map((item,index) => [item.id,index]));
    const nextAssessments = detail.assessments.map(item => orderById.has(item.id) ? { ...item, sortOrder: orderById.get(item.id)! } : item);
    await run(async () => {
      await api("/api/teacher/subjects/" + detail.id, {
        method: "PATCH",
        body: JSON.stringify({ assessmentItems: nextAssessments.map(item => ({
          id: item.id, categoryId: item.categoryId, title: item.title, maxScore: Number(item.maxScore),
          weight: item.weight == null ? null : Number(item.weight),
          dueDate: item.dueDate ? item.dueDate.slice(0,10) : null,
          scheduleOverrideReason: item.scheduleOverrideReason || null,
          attendanceType: item.attendanceType || null, sortOrder: item.sortOrder ?? 0
        })) })
      });
      setDetail(current => current ? { ...current, assessments: nextAssessments } : current);
    }, "Assessment order saved. Record Scores now follows this order.");
  }
  async function saveAssessmentItems() {
    if (!detail) return;
    await run(async () => { await api(`/api/teacher/subjects/${detail.id}`, { method: "PATCH", body: JSON.stringify({ assessmentItems: detail.assessments.map(item => ({ id: item.id, categoryId: item.categoryId, title: item.title, maxScore: Number(item.maxScore), weight: item.weight == null ? null : Number(item.weight), dueDate: item.dueDate ? item.dueDate.slice(0,10) : null, scheduleOverrideReason: item.scheduleOverrideReason || null, attendanceType: item.attendanceType || null, sortOrder: item.sortOrder ?? 0 })) }) }); }, "Assessment setup saved.");
  }
  async function removeAssessment(assessmentId: string) {
    if (!detail || !window.confirm("Remove this assessment item and delete its scores and item remarks for every student? This cannot be undone.")) return;
    await run(async () => { await api(`/api/teacher/subjects/${detail.id}`, { method: "PATCH", body: JSON.stringify({ deleteAssessmentId: assessmentId }) }); setDetail(current => current ? { ...current, assessments: current.assessments.filter(item => item.id !== assessmentId), enrollments: current.enrollments.map(enrollment => ({ ...enrollment, scores: enrollment.scores.filter(score => score.assessmentId !== assessmentId) })) } : current); }, "Assessment and its associated scores removed.");
  }
  async function copyGrading() {
    if (!detail || !copyFromId) return; await run(async () => { await api(`/api/teacher/subjects/${detail.id}`, { method: "PATCH", body: JSON.stringify({ copyGradingFromSubjectId: copyFromId }) }); await loadDetail(); }, "Grading categories and grade scale copied.");
  }
  async function applyGradingTemplate(mode: "LECTURE_ONLY" | "LABORATORY_ONLY" | "LECTURE_LAB") {
    if (!detail || detail.gradeStatus !== "DRAFT") return;
    const lectureWeight = mode === "LECTURE_ONLY" ? 100 : mode === "LABORATORY_ONLY" ? 0 : Number(lectureCourseWeight);
    const laboratoryWeight = mode === "LABORATORY_ONLY" ? 100 : mode === "LECTURE_ONLY" ? 0 : Number(laboratoryCourseWeight);
    if (mode === "LECTURE_LAB" && (!Number.isFinite(lectureWeight) || !Number.isFinite(laboratoryWeight) || lectureWeight < 1 || laboratoryWeight < 1 || Math.abs(lectureWeight + laboratoryWeight - 100) > 0.01)) {
      setErr("Lecture and Laboratory weights must both be at least 1% and total exactly 100%.");
      return;
    }
    const modeLabel = mode === "LECTURE_ONLY" ? "Lecture-only (100%)" : mode === "LABORATORY_ONLY" ? "Laboratory-only (100%)" : `Lecture ${lectureWeight}% / Laboratory ${laboratoryWeight}%`;
    if (!window.confirm(`Apply the ${modeLabel} grading structure? Existing assessment items will be reassigned when their names and current categories match. Student scores and the grade scale will be kept. Items that cannot be safely matched stop the change without modifying anything.`)) return;
    await run(async () => { await api(`/api/teacher/subjects/${detail.id}`, { method: "PATCH", body: JSON.stringify({ gradingTemplate: mode, lectureWeight, laboratoryWeight }) }); await loadDetail(); }, `${modeLabel} grading structure applied.`);
  }
  async function saveRemark(enrollmentId: string, remark: string) {
    const value = remark || null;
    await run(async () => { await api(`/api/teacher/subjects/${activeId}`, { method: "PATCH", body: JSON.stringify({ enrollmentId, remark: value }) }); setDetail(current => current ? { ...current, enrollments: current.enrollments.map(enrollment => enrollment.id === enrollmentId ? { ...enrollment, remarks: value } : enrollment) } : current); }, "Student remark saved.");
  }
  async function saveGradeBands() {
    if (!detail) return; await run(async () => { const result = await api(`/api/teacher/subjects/${detail.id}`, { method: "PATCH", body: JSON.stringify({ gradeBands: detail.gradeBands }) }); setDetail(current => current ? { ...current, gradeBands: result.gradeBands } : current); }, "Final-grade equivalents saved.");
  }
  async function saveGradeChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if(!detail||!gradeChangeEnrollmentId)return;
    await run(async()=>{await api(`/api/teacher/subjects/${detail.id}`,{method:"PATCH",body:JSON.stringify({gradeChange:{enrollmentId:gradeChangeEnrollmentId,finalGrade:gradeChangeGrade,remarks:gradeChangeRemark,reason:gradeChangeReason}})});await loadDetail();setGradeChangeEnrollmentId("");setGradeChangeReason("");},"Grade correction saved with its history.");
  }
  async function submitGrades() {
    if (!detail || !window.confirm("Submit this grade record to students? Visibility is controlled separately in Manage grade visibility. Submitting the grade record will not change who can see it.")) return;
    if (!await ensureWorkbookSaved()) { setErr("Save pending workbook changes before changing grade status."); return; }
    await run(async () => { await api(`/api/teacher/subjects/${detail.id}`, { method: "PATCH", body: JSON.stringify({ submitGrades: true }) }); await loadDetail(); await loadSubjects(); }, "Class grade record submitted. Student visibility is unchanged. Mark Verified to Registrar only after the official school-record submission.");
  }
  async function verifyGrades() {
    if (!detail || detail.gradeStatus !== "SUBMITTED" || !window.confirm("Confirm that you have officially submitted this class's grades on the school's official records and to the Registrar? This will mark student results as final.")) return;
    if (!await ensureWorkbookSaved()) { setErr("Save pending workbook changes before changing grade status."); return; }
    await run(async () => { await api(`/api/teacher/subjects/${detail.id}`, { method: "PATCH", body: JSON.stringify({ verifyGrades: true }) }); await loadDetail(); await loadSubjects(); }, "Verified. Students now see the result as final and confirmed submitted to the Registrar.");
  }
  async function recallSubmittedGrades() {
    if (!detail || detail.gradeStatus === "DRAFT" || !window.confirm("Recall this grade record? Students will no longer see these grades, and the class record will return to draft for editing.")) return;
    if (!await ensureWorkbookSaved()) { setErr("Save pending workbook changes before changing grade status."); return; }
    await run(async () => { await api(`/api/teacher/subjects/${detail.id}`, { method: "PATCH", body: JSON.stringify({ recallGrades: true }) }); await loadDetail(); await loadSubjects(); }, "Submission recalled. The class record is back in draft and hidden from students.");
  }
  function updateScoreLocally(enrollmentId: string, assessmentId: string, points: number | null, remark: string | null) {
    setDetail(current => {
      if (!current) return current;
      const enrollments = current.enrollments.map(enrollment => {
        if (enrollment.id !== enrollmentId) return enrollment;
        const scores = enrollment.scores.some(score => score.assessmentId === assessmentId)
          ? enrollment.scores.map(score => score.assessmentId === assessmentId ? { ...score, points, remark: remark } : score)
          : [...enrollment.scores, { assessmentId, points, remark: remark }];
        const updated = { ...enrollment, scores };
        const scoreLookup = new Map(scores.map(score => [score.assessmentId, score]));
        const assessmentGroups = new Map<string, Assessment[]>();
        for (const item of current.assessments) {
          const group = assessmentGroups.get(item.categoryId) ?? [];
          group.push(item);
          assessmentGroups.set(item.categoryId, group);
        }
        updated.finalPercent = calculateFinal(current.categories.map(category => ({
          id: category.id, parentId: category.parentId, weight: category.weight,
          conversionBase: category.conversionBase,
          assessments: (assessmentGroups.get(category.id) ?? []).map(item => ({
            title: item.title, dueDate: item.dueDate, maxScore: item.maxScore, weight: item.weight,
            scores: scoreLookup.has(item.id) ? [scoreLookup.get(item.id)!] : []
          }))
        })));
        return updated;
      });
      return { ...current, enrollments };
    });
  }

  // Coalesce rapid attendance changes in small atomic requests.
  async function flushAttendanceMarks() {
    if (attendanceSavingRef.current || !attendancePendingRef.current.size || attendanceFailedRef.current) return;
    if (attendanceSaveTimerRef.current) clearTimeout(attendanceSaveTimerRef.current);
    attendanceSaveTimerRef.current = null;
    const entries = [...attendancePendingRef.current.entries()];
    const subjectId = entries[0][1].subjectId;
    const batch = entries.filter(([, mark]) => mark.subjectId === subjectId).slice(0, 50);
    for (const [key] of batch) attendancePendingRef.current.delete(key);
    attendanceSavingRef.current = true;
    setAttendanceSaveState("saving");
    try {
      await api(`/api/teacher/subjects/${subjectId}/attendance`, {
        method: "PUT", keepalive: true,
        body: JSON.stringify({ changes: batch.map(([, mark]) => ({
          enrollmentId: mark.enrollmentId, assessmentId: mark.assessmentId, remark: mark.remark
        })) })
      });
      if (!attendancePendingRef.current.size) {
        setOverviewData(null);
        setOverviewRefresh(value => value + 1);
      }
      setAttendanceSaveState(attendancePendingRef.current.size ? "pending" : "saved");
    } catch (error) {
      for (const [key, mark] of batch) {
        if (!attendancePendingRef.current.has(key)) attendancePendingRef.current.set(key, mark);
      }
      attendanceFailedRef.current = true;
      setAttendanceSaveState("error");
      setErr(error instanceof Error ? `Attendance not saved: ${error.message}` : "Attendance not saved. Retry the pending marks.");
    } finally {
      attendanceSavingRef.current = false;
      if (attendancePendingRef.current.size && !attendanceFailedRef.current) {
        attendanceSaveTimerRef.current = setTimeout(() => { void flushAttendanceMarks(); }, 80);
      }
    }
  }

  function saveAttendanceMark(enrollmentId: string, assessmentId: string, remark: AttendanceMark["remark"]) {
    if (!detail || detail.gradeStatus === "VERIFIED") return;
    updateScoreLocally(enrollmentId, assessmentId, null, remark);
    const subjectId = detail.id;
    attendancePendingRef.current.set(`${subjectId}:${enrollmentId}:${assessmentId}`, { subjectId, enrollmentId, assessmentId, remark });
    attendanceFailedRef.current = false;
    setAttendanceSaveState("pending");
    if (attendanceSaveTimerRef.current) clearTimeout(attendanceSaveTimerRef.current);
    attendanceSaveTimerRef.current = setTimeout(() => { void flushAttendanceMarks(); }, 300);
  }

  async function flushWorkbookScores(): Promise<boolean> {
    if (workbookInflightRef.current) return workbookInflightRef.current;
    if (workbookFailedRef.current) return false;
    if (workbookTimerRef.current) clearTimeout(workbookTimerRef.current);
    workbookTimerRef.current = null;
    if (!workbookPendingRef.current.size) return true;
    const entries = [...workbookPendingRef.current.entries()];
    const subjectId = entries[0][1].subjectId;
    const batch = entries.filter(([, score]) => score.subjectId === subjectId).slice(0, 50);
    for (const [key] of batch) workbookPendingRef.current.delete(key);
    setWorkbookSaveState("saving");
    const task = (async () => {
      try {
        await api(`/api/teacher/subjects/${subjectId}/bulk-scores`, {
          method: "POST", keepalive: true,
          body: JSON.stringify({ source: "workbook", scores: batch.map(([, {enrollmentId, assessmentId, points, remark}]) =>
            ({ enrollmentId, assessmentId, points, remark })) })
        });
        setWorkbookSaveState(workbookPendingRef.current.size ? "queued" : "saved");
        return true;
      } catch (error) {
        for (const [key, change] of batch) {
          if (!workbookPendingRef.current.has(key)) workbookPendingRef.current.set(key, change);
        }
        workbookFailedRef.current = true;
        setWorkbookSaveState("error");
        setErr(error instanceof Error ? `Workbook not saved: ${error.message}` : "Workbook not saved. Retry pending changes.");
        return false;
      } finally {
        workbookInflightRef.current = null;
        if (workbookPendingRef.current.size && !workbookFailedRef.current) {
          workbookTimerRef.current = setTimeout(() => { void flushWorkbookScores(); }, 80);
        }
      }
    })();
    workbookInflightRef.current = task;
    return task;
  }
  async function ensureWorkbookSaved(): Promise<boolean> {
    if (workbookTimerRef.current) clearTimeout(workbookTimerRef.current);
    while (workbookInflightRef.current || workbookPendingRef.current.size) {
      if (!await flushWorkbookScores()) return false;
    }
    return true;
  }
  function saveScore(enrollmentId: string, assessmentId: string, value: string, remark: string | null = null) {
    if (!detail || detail.gradeStatus === "VERIFIED") return;
    const item = detail.assessments.find(item => item.id === assessmentId);
    if (!item || item.title.toLocaleLowerCase().startsWith("attendance ·")) return;
    const points = remark ? null : value.trim() === "" ? null : Number(value);
    if (points !== null && (!Number.isFinite(points) || points < 0 || points > item.maxScore)) {
      setErr(`Enter a valid score between 0 and ${item.maxScore} for ${item.title}.`);
      return;
    }
    const scoreRemark = (remark || null) as WorkbookChange["remark"];
    setErr("");
    updateScoreLocally(enrollmentId, assessmentId, points, scoreRemark);
    const subjectId = detail.id;
    workbookPendingRef.current.set(`${subjectId}:${enrollmentId}:${assessmentId}`,
      { subjectId, enrollmentId, assessmentId, points, remark: scoreRemark });
    workbookFailedRef.current = false;
    setWorkbookSaveState("queued");
    if (workbookTimerRef.current) clearTimeout(workbookTimerRef.current);
    workbookTimerRef.current = setTimeout(() => { void flushWorkbookScores(); }, 300);
  }
  async function emailVerifiedGrades() {
    if (!detail || detail.gradeStatus !== "VERIFIED" || !window.confirm("Send each student's final grade summary to the email address on their student record? Emails will be sent individually.")) return;
    let summary = "";
    await run(async () => { const result = await api(`/api/teacher/subjects/${detail.id}/email-verified`, { method: "POST" }); summary = `Sent to ${result.sent} student(s); skipped ${result.skipped}, failed ${result.failed}.`; }, "");
    if (summary) setNotice(summary);
  }
  function setAppearance(next: AccountTheme) {
    setTheme(next);
    saveSagaTheme(next);
  }
  async function saveRosterStudent(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!detail || !rosterEdit) return;
    await run(async () => { const result = await api(`/api/teacher/subjects/${detail.id}`, { method: "PATCH", body: JSON.stringify({ updateEnrollment: { enrollmentId: rosterEdit.id, studentName: rosterEdit.studentName, studentNumber: rosterEdit.studentNumber || null } }) }); setDetail(current => current ? { ...current, enrollments: current.enrollments.map(enrollment => enrollment.id === rosterEdit.id ? { ...enrollment, studentName: rosterEdit.studentName.trim(), studentNumber: rosterEdit.studentNumber.trim().toUpperCase() || null, studentUserId: result.studentUserId ?? null } : enrollment) } : current); setRosterEdit(null); }, "Roster details saved. Matching portal access updates automatically from the student number.");
  }
  async function deleteRosterStudent(enrollment: Enrollment) {
    if (!detail || !window.confirm(`Remove ${enrollment.studentName} from this class roster and delete this class's score records for them? Their portal account will not be deleted.`)) return;
    await run(async () => { await api(`/api/teacher/subjects/${detail.id}`, { method: "PATCH", body: JSON.stringify({ deleteEnrollmentId: enrollment.id }) }); setDetail(current => current ? { ...current, enrollments: current.enrollments.filter(item => item.id !== enrollment.id) } : current); setSubjects(current => current.map(subject => subject.id === detail.id ? { ...subject, _count: { enrollments: Math.max(0, (subject._count?.enrollments || 0) - 1) } } : subject)); }, "Student removed from the class roster.");
  }
  async function saveComponentsForClass() {
    if (!detail) return;
    if (!componentDraft.length || componentDraft.some(item => !item.name.trim())) { setErr("Select at least one valid Grading Setup category."); return; }
    await run(async () => {
      await api(`/api/teacher/subjects/${detail.id}`, { method: "PATCH", body: JSON.stringify({ saveGradeSheetComponents: componentDraft }) });
      setGradeSheetComponents(componentDraft);
      setDetail(current => current ? { ...current, gradeSheetComponents: JSON.stringify(componentDraft) } : current);
      setComponentEditorOpen(false);
    }, "Grading sheet components saved for this class. Grade calculations were not changed.");
  }
  async function saveComponentsAsDefault() {
    if (!componentDraft.length || componentDraft.some(item => !item.name.trim())) { setErr("Select at least one valid Grading Setup category."); return; }
    await run(async () => {
      await api("/api/profile", { method: "PATCH", body: JSON.stringify({ fullName: profileName, facultyId: profileFacultyId, schoolAddress, departmentName, defaultGradeSheetComponents: componentDraft }) });
      setGradeSheetComponents(componentDraft);
      router.refresh();
    }, "Saved as your default grading sheet components.");
  }
  function printClass(mode: "roster" | "grades") { setPrintMode(mode); }
  function ensureSignatoriesConfigured() {
    const missing = [
      !user.fullName.trim() ? "your profile name" : "",
      !teacherPosition.trim() ? "Submitted by position / title" : "",
      !notedByName.trim() ? "Noted by name" : "",
      !notedByPosition.trim() ? "Noted by position / title" : ""
    ].filter(Boolean);
    if (missing.length) {
      setErr("Complete the required grading-sheet signatory details in Profile Information before exporting: " + missing.join(", ") + ".");
      setNotice("");
      setTab("profile");
      return false;
    }
    const unsavedChanges = [
      profileName.trim() !== user.fullName.trim(),
      teacherPosition.trim() !== (user.positionTitle || "").trim(),
      notedByName.trim() !== (user.notedByName || "").trim(),
      notedByPosition.trim() !== (user.notedByPosition || "").trim()
    ].some(Boolean);
    if (unsavedChanges) {
      setErr("Save your Profile Information changes before exporting so every grading-sheet format uses your saved signatories.");
      setNotice("");
      setTab("profile");
      return false;
    }
    return true;
  }
  function ensureGenericHeaderConfigured() {
    if (departmentName.trim()) return true;
    setErr("Your generic grading-sheet header is incomplete. Add your College / Department name under Profile information, save your profile, then try the export again.");
    setNotice("");
    setTab("profile");
    return false;
  }
  function ensureIsoHeaderConfigured() {
    const requiredFields: Array<keyof IsoHeaderConfig> = ["organizationAddress", "formName", "formNo", "effectivity", "issuingOffice", "revisionNo", "eomsTitle", "isoStandard", "affiliationLine1", "affiliationLine2"];
    const missingFields = requiredFields.filter(field => !isoHeaderConfig[field].trim());
    if (!missingFields.length) return true;
    setErr("ISO grading-sheet export is unavailable until the ISO document header is completed. Please fill in all ISO document details in Profile information and save your changes. You will then be able to export as PDF or Excel.");
    setNotice("");
    setTab("profile");
    return false;
  }
  function printFinalGradesPdf(format: "generic" | "iso" = "generic") {
    if (!ensureSignatoriesConfigured()) return;
    if (format === "generic" && !ensureGenericHeaderConfigured()) return;
    if (format === "iso" && !ensureIsoHeaderConfigured()) return;
    setErr("");
    setPrintMode(format === "iso" ? "iso-grades" : "grades");
  }
  async function saveProfile(e: FormEvent<HTMLFormElement>) { e.preventDefault(); await run(async () => { await api("/api/profile", { method: "PATCH", body: JSON.stringify({ fullName: profileName, ...(teacher ? { facultyId: profileFacultyId, positionTitle: teacherPosition, schoolAddress, departmentName, notedByName, notedByPosition, isoHeaderConfig } : {}) }) }); router.refresh(); }, "Profile updated."); }
  async function requestPasswordOtp() { await run(async () => { const result = await api("/api/profile/security-otp", { method: "POST", body: JSON.stringify({ purpose: "PASSWORD_CHANGE", currentPassword: passwordCurrent }) }); setPasswordOtpSent(true); setPasswordOtp(""); setNotice(result.message); }, ""); }
  async function changePassword(e: FormEvent<HTMLFormElement>) { e.preventDefault(); if (passwordNew !== passwordConfirm) { setErr("The new passwords do not match."); return; } await run(async () => { await api("/api/profile/password", { method: "POST", body: JSON.stringify({ currentPassword: passwordCurrent, newPassword: passwordNew, code: passwordOtp }) }); setPasswordCurrent(""); setPasswordNew(""); setPasswordConfirm(""); setPasswordOtp(""); setPasswordOtpSent(false); window.setTimeout(() => { void logout(); }, 1200); }, "Password changed. Signing you out; sign in again with your new password."); }
  async function uploadProfileImage(kind: "profile" | "school-logo" | "department-logo", file?: File) {
    if (!file) return;
    await run(async () => { const form = new FormData(); form.set("kind", kind); form.set("file", file); const response = await fetch("/api/profile/media", { method: "POST", body: form }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Image upload failed."); if (kind === "profile") setProfileImagePath(data.pathname); else if (kind === "school-logo") setSchoolLogoPath(data.pathname); else setDepartmentLogoPath(data.pathname); router.refresh(); }, kind === "profile" ? "Profile picture uploaded." : kind === "school-logo" ? "School logo uploaded." : "College / department logo uploaded.");
  }
  function exportRoster() {
    if (!detail) return;
    downloadXlsx(`${detail.code.replace(/[^a-z0-9-_]+/gi, "-")}-class-roster.xlsx`, "Class Roster", ["Student Name", "Student Number"], detail.enrollments.map(enrollment => [enrollment.studentName, enrollment.studentNumber || ""]));
  }
  async function loadGradeHeaderLogo(path: string | null | undefined): Promise<HTMLImageElement | null> {
    if (!path) return null;
    return new Promise(resolve => {
      const image = new window.Image();
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = "/api/media?pathname=" + encodeURIComponent(path);
    });
  }
  function gradeHeaderCanvasBytes(canvas: HTMLCanvasElement): Uint8Array {
    const base64 = canvas.toDataURL("image/png").split(",")[1] || "";
    const binary = window.atob(base64);
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  }
  function drawGradeHeaderLogo(ctx: CanvasRenderingContext2D, image: HTMLImageElement | null, x: number, y: number, width: number, height: number, round = false) {
    if (image) {
      const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
      const drawWidth = image.naturalWidth * scale;
      const drawHeight = image.naturalHeight * scale;
      ctx.save();
      if (round) {
        ctx.beginPath();
        ctx.arc(x + width / 2, y + height / 2, Math.min(width, height) / 2, 0, Math.PI * 2);
        ctx.clip();
      }
      ctx.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
      ctx.restore();
    } else {
      ctx.save();
      ctx.strokeStyle = "#777";
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 5]);
      if (round) {
        ctx.beginPath();
        ctx.arc(x + width / 2, y + height / 2, Math.min(width, height) / 2 - 3, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.strokeRect(x + 4, y + 4, width - 8, height - 8);
      }
      ctx.restore();
    }
  }
  async function renderGenericGradeHeaderPng(currentDetail: Detail): Promise<Uint8Array> {
    const [schoolLogo, departmentLogo] = await Promise.all([
      loadGradeHeaderLogo(schoolLogoPath),
      loadGradeHeaderLogo(departmentLogoPath)
    ]);
    const canvas = document.createElement("canvas");
    canvas.width = 1600;
    canvas.height = 400;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not prepare the grading-sheet header.");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawGradeHeaderLogo(ctx, schoolLogo, 45, 95, 150, 210, true);
    drawGradeHeaderLogo(ctx, departmentLogo, 1405, 95, 150, 210, false);
    ctx.fillStyle = "#000";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 36px Arial";
    ctx.fillText(user.school.name.toLocaleUpperCase(), 800, 105, 1160);
    ctx.font = "bold 27px Arial";
    ctx.fillText(departmentName.trim(), 800, 165, 1160);
    ctx.font = "600 23px Arial";
    ctx.fillText(schoolAddress.trim() || "School address not set", 800, 215, 1160);
    ctx.font = "bold 31px Arial";
    ctx.fillText("COLLEGIATE GRADE SHEET", 800, 285, 1160);
    ctx.font = "bold 22px Arial";
    ctx.fillText(currentDetail.term.toLocaleUpperCase() + " A.Y. " + currentDetail.academicYear, 800, 340, 1160);
    return gradeHeaderCanvasBytes(canvas);
  }
  async function renderIsoGradeHeaderPng(): Promise<Uint8Array> {
    const schoolLogo = await loadGradeHeaderLogo(schoolLogoPath);
    const canvas = document.createElement("canvas");
    canvas.width = 1600;
    canvas.height = 400;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not prepare the ISO grading-sheet header.");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const x = [0, 256, 576, 1280, 1600];
    const rowY = [0, 76, 152, 228, 304];
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, 1598, 302);
    ctx.beginPath();
    ctx.moveTo(x[1], 0); ctx.lineTo(x[1], rowY[4]);
    ctx.moveTo(x[2], rowY[1]); ctx.lineTo(x[2], rowY[4]);
    ctx.moveTo(x[3], rowY[1]); ctx.lineTo(x[3], rowY[4]);
    for (const y of rowY.slice(1)) { ctx.moveTo(x[1], y); ctx.lineTo(x[4], y); }
    ctx.stroke();
    drawGradeHeaderLogo(ctx, schoolLogo, 42, 82, 172, 138, true);
    ctx.fillStyle = "#000";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 30px Arial";
    ctx.fillText(user.school.name.toLocaleUpperCase(), (x[1] + x[4]) / 2, 27, 1280);
    ctx.font = "bold 22px Arial";
    ctx.fillText(isoHeaderConfig.organizationAddress, (x[1] + x[4]) / 2, 55, 1280);
    const control = (label: string, value: string, left: number, right: number, y: number, valueSize = 18) => {
      ctx.textAlign = "left";
      ctx.font = "17px Arial";
      ctx.fillText(label, left + 12, y + 23, right - left - 24);
      ctx.textAlign = "center";
      ctx.font = "bold " + valueSize + "px Arial";
      ctx.fillText(value, (left + right) / 2, y + 53, right - left - 22);
    };
    control("Form Name:", isoHeaderConfig.formName, x[1], x[2], rowY[1], 17);
    control("Effectivity:", isoHeaderConfig.effectivity, x[3], x[4], rowY[1], 17);
    control("Form No:", isoHeaderConfig.formNo, x[1], x[2], rowY[2], 17);
    control("Issuing Office:", isoHeaderConfig.issuingOffice, x[3], x[4], rowY[2], 17);
    control("Revision No.", isoHeaderConfig.revisionNo, x[1], x[2], rowY[3], 17);
    ctx.textAlign = "center";
    ctx.font = "bold 18px Arial";
    ctx.fillText(isoHeaderConfig.eomsTitle, (x[2] + x[3]) / 2, rowY[3] + 27, x[3] - x[2] - 18);
    ctx.font = "bold 17px Arial";
    ctx.fillText(isoHeaderConfig.isoStandard, (x[2] + x[3]) / 2, rowY[3] + 54, x[3] - x[2] - 18);
    ctx.beginPath();
    ctx.moveTo(x[4] - 70, rowY[3]);
    ctx.lineTo(x[4] - 70, rowY[4]);
    ctx.stroke();
    ctx.font = "17px Arial";
    ctx.fillText("Page No.", (x[3] + x[4] - 70) / 2, rowY[3] + 39, x[4] - x[3] - 86);
    ctx.font = "bold 18px Arial";
    ctx.fillText("1", x[4] - 35, rowY[3] + 39, 55);
    ctx.font = "bold 17px Arial";
    ctx.fillText(isoHeaderConfig.affiliationLine1, 800, 333, 1560);
    ctx.fillText(isoHeaderConfig.affiliationLine2, 800, 371, 1560);
    return gradeHeaderCanvasBytes(canvas);
  }
  async function renderIsoExcelSealPng(): Promise<Uint8Array> {
    const schoolLogo = await loadGradeHeaderLogo(schoolLogoPath);
    if (!schoolLogo) throw new Error("Upload the main school / university logo in Profile information before exporting.");
    const canvas = document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 160;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not prepare the circular ISO seal.");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (schoolLogo) {
      const sourceWidth = schoolLogo.naturalWidth;
      const sourceHeight = schoolLogo.naturalHeight;
      const portrait = sourceHeight > sourceWidth * 1.12;
      // Vertical logo uploads commonly place the seal above school-name/address
      // text. Use a top-aligned square crop to exclude that footer text.
      const cropSize = portrait
        ? Math.min(sourceWidth * 0.72, sourceHeight)
        : Math.min(sourceWidth, sourceHeight);
      const sourceX = (sourceWidth - cropSize) / 2;
      const sourceY = portrait ? 0 : (sourceHeight - cropSize) / 2;
      ctx.save();
      ctx.beginPath();
      ctx.arc(80, 80, 76, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(schoolLogo, sourceX, sourceY, cropSize, cropSize, 4, 4, 152, 152);
      ctx.restore();
    }
    return gradeHeaderCanvasBytes(canvas);
  }
  async function exportIsoGradesExcel() {
    if (!detail || gradeExcelExporting || !ensureSignatoriesConfigured() || !ensureIsoHeaderConfigured()) return;
    setGradeExcelExporting("iso");
    setErr("");
    try {
      await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));
      const sealPng = await renderIsoExcelSealPng();
      const binary = Array.from(sealPng, byte => String.fromCharCode(byte)).join("");
      const logoPngBase64 = window.btoa(binary);
      const response = await fetch("/api/teacher/subjects/" + encodeURIComponent(detail.id) + "/iso-export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          componentNames: gradeSheetComponents.map(item => item.name),
          logoPngBase64
        })
      });
      if (!response.ok) {
        const message = await response.text();
        let errorMessage = "Unable to prepare the ISO Excel sheet (HTTP " + response.status + ").";
        try {
          const parsed = JSON.parse(message);
          if (typeof parsed.error === "string") errorMessage = parsed.error;
        } catch {
          // Keep HTML or deployment-protection responses out of the user-facing error.
        }
        throw new Error(errorMessage);
      }
      const workbookBlob = await response.blob();
      const downloadUrl = URL.createObjectURL(workbookBlob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = detail.code.replace(/[^a-z0-9-_]+/gi, "-") + "-iso-grading-sheet.xlsx";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      setErr("");
    } catch (error) {
      console.error("ISO Excel export failed:", error);
      setErr(error instanceof Error ? error.message : "Unable to prepare the ISO Excel sheet. Please try again.");
    } finally {
      setGradeExcelExporting(null);
    }
  }
  async function exportGrades() {
    if (!detail || gradeExcelExporting || !ensureSignatoriesConfigured() || !ensureGenericHeaderConfigured()) return;
    setGradeExcelExporting("generic");
    setErr("");
    try {
      await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));
      const headerPng = await renderGenericGradeHeaderPng(detail);
      await downloadFcuGradeXlsx(
        detail.code.replace(/[^a-z0-9-_]+/gi, "-") + "-final-grades.xlsx",
        "Final Grades",
        detail,
        detail.categories,
        user.fullName,
        teacherPosition.trim(),
        notedByName.trim(),
        notedByPosition.trim(),
        gradeSheetComponents,
        headerPng
      );
      setErr("");
    } catch (error) {
      console.error("Generic Excel export failed:", error);
      setErr(error instanceof Error ? error.message : "Unable to prepare the generic Excel sheet. Please try again.");
    } finally {
      setGradeExcelExporting(null);
    }
  }
  function exportRecordScoresExcel() {
    if (!detail || !ensureSignatoriesConfigured()) return;
    downloadGradeSheetXlsx(
      `${detail.code.replace(/[^a-z0-9-_]+/gi, "-")}-record-scores.xlsx`,
      "Record Scores",
      detail,
      user.school.name,
      user.school.address || "",
      user.school.departmentName || user.school.name,
      user.fullName,
      teacherPosition.trim(),
      notedByName.trim(),
      notedByPosition.trim(),
      gradeSheetComponents,
      scorebookAssessments
    );
  }
  function downloadScoreCsv(blank=false) {
    if(!detail)return;
    const items=scorebookAssessments;
    const headers=["Student ID","Student Name",...items.map(item=>`Score:${item.id} - ${item.title} (max ${item.maxScore})`)];
    const rows=detail.enrollments.map(en=>[en.studentNumber||"",en.studentName,...items.map(item=>{if(blank)return "";const score=en.scores.find(value=>value.assessmentId===item.id);return score?.remark ?? score?.points ?? "";})]);
    const csv=[headers,...rows].map(row=>row.map(csvValue).join(",")).join("\r\n");
    const url=URL.createObjectURL(new Blob(["\uFEFF",csv],{type:"text/csv;charset=utf-8"}));const anchor=document.createElement("a");anchor.href=url;anchor.download=`${detail.code.replace(/[^a-z0-9-_]+/gi,"-")}-${blank?"score-template":"scores"}.csv`;anchor.click();URL.revokeObjectURL(url);
  }
  async function previewBulkScores(file: File) {
    if(!detail)return; setBulkFileName(file.name);setBulkOperations([]);setBulkRowsPreview([]);setBulkErrors([]);
    const errors:string[]=[];if(file.size>5*1024*1024){setBulkErrors(["File exceeds the 5 MB limit."]);return;}
    try {
      const rows=parseCsvRows(await file.text());if(rows.length<2)throw new Error("The CSV must include a header and at least one student row.");
      const headers=rows[0].map(value=>value.trim());const idIndex=headers.findIndex(value=>/^student id$/i.test(value));const nameIndex=headers.findIndex(value=>/^student name$/i.test(value));
      if(idIndex<0||nameIndex<0)throw new Error("Include Student ID and Student Name columns. Download a fresh score template for the required format.");
      const scoreColumns=headers.map((header,index)=>({header,index,assessmentId:/^Score:(.+?)\s+-\s+/i.exec(header)?.[1]})).filter(item=>item.assessmentId);
      if(!scoreColumns.length)throw new Error("No score columns found. Keep the Score:<assessment ID> headers from the downloaded template.");
      const knownAssessments=new Map(scorebookAssessments.map(item=>[item.id,item]));const headerIds=scoreColumns.map(item=>item.assessmentId||"");if(new Set(headerIds).size!==headerIds.length)throw new Error("The CSV repeats an assessment column. Keep one column per assessment.");const invalidHeaders=headerIds.filter(id=>!knownAssessments.has(id));if(invalidHeaders.length)throw new Error("The CSV has score columns from a different class or an outdated template. Download a fresh template.");const byNumber=new Map(detail.enrollments.filter(en=>en.studentNumber).map(en=>[en.studentNumber!.trim().toLocaleLowerCase(),en]));const byName=new Map<string,Enrollment[]>();for(const en of detail.enrollments){const key=en.studentName.trim().toLocaleLowerCase();byName.set(key,[...(byName.get(key)||[]),en]);}
      const operations:Array<{enrollmentId:string;assessmentId:string;points:number|null;remark:"EXCUSED"|"ABSENT"|"DID_NOT_SUBMIT"|null}>=[];const preview:Array<{row:number;student:string;cells:number;errors:string[]}>=[];const seenStudents=new Set<string>();
      for(let r=1;r<rows.length;r++){const values=rows[r];const lineErrors:string[]=[];const studentNumber=(values[idIndex]||"").trim();const studentName=(values[nameIndex]||"").trim();let enrollment=studentNumber?byNumber.get(studentNumber.toLocaleLowerCase()):undefined;
        if(!enrollment&&studentName){const matches=byName.get(studentName.toLocaleLowerCase())||[];if(matches.length===1)enrollment=matches[0];else if(matches.length>1)lineErrors.push("Name matches multiple students; include the student ID.");}
        if(!studentName&&!studentNumber)lineErrors.push("Student name and ID are both blank.");else if(!enrollment)lineErrors.push("Student is not enrolled in this class.");
        if(enrollment&&studentName&&studentName.toLocaleLowerCase()!==enrollment.studentName.toLocaleLowerCase())lineErrors.push("Student ID and name do not match the class roster.");
        if(enrollment&&seenStudents.has(enrollment.id))lineErrors.push("Duplicate student row.");if(enrollment)seenStudents.add(enrollment.id);
        let cellCount=0;
        for(const col of scoreColumns){const value=(values[col.index]||"").trim();if(!value)continue;const assessment=knownAssessments.get(col.assessmentId||"");if(!assessment){lineErrors.push(`Unknown score column: ${col.header}`);continue;}if(!enrollment)continue;let points:number|null=null;let remark:"EXCUSED"|"ABSENT"|"DID_NOT_SUBMIT"|null=null;const normalized=value.toLocaleUpperCase();if(normalized==="EXCUSED"||normalized==="EX"){remark="EXCUSED";}else if(normalized==="ABSENT"||normalized==="AB"){remark="ABSENT";}else if(normalized==="DID_NOT_SUBMIT"||normalized==="DNS"){remark="DID_NOT_SUBMIT";}else {points=Number(value);if(!Number.isFinite(points)||points<0)lineErrors.push(`${assessment.title}: enter a non-negative score or EXCUSED, ABSENT, or DNS.`);else if(points>assessment.maxScore)lineErrors.push(`${assessment.title}: ${points} exceeds the maximum ${assessment.maxScore}.`);}
          if(!lineErrors.some(message=>message.startsWith(`${assessment.title}:`))){operations.push({enrollmentId:enrollment.id,assessmentId:assessment.id,points,remark});cellCount++;}
        }
        preview.push({row:r+1,student:studentName||enrollment?.studentName||"—",cells:cellCount,errors:lineErrors});
      }
      if(operations.length>5000)errors.push("This file contains more than 5,000 score cells. Import smaller batches.");
      errors.push(...preview.flatMap(item=>item.errors.map(message=>`Row ${item.row}: ${message}`)));
      if(!operations.length&&!errors.length)errors.push("No non-blank score cells were found. Blank cells are left unchanged.");
      setBulkOperations(operations);setBulkRowsPreview(preview);setBulkErrors(errors);
    }catch(error){setBulkErrors([error instanceof Error?error.message:"Could not read this CSV file."]);}
  }
  async function applyBulkScores() {
    if(!detail||bulkErrors.length||!bulkOperations.length)return;
    if (!await ensureWorkbookSaved()) { setErr("Retry pending workbook changes before importing scores."); return; }
    await run(async()=>{await api(`/api/teacher/subjects/${detail.id}/bulk-scores`,{method:"POST",body:JSON.stringify({scores:bulkOperations})});await loadDetail();setBulkScoresOpen(false);setBulkFileName("");setBulkOperations([]);setBulkRowsPreview([]);setBulkErrors([]);},`${bulkOperations.length} score cell(s) imported.`);
  }
  function downloadRosterTemplate() {
    downloadXlsx("class-roster-sample-format.xlsx", "Roster Sample", ["Student Name", "Student Number", "Portal Account"], [["Santos, Juan D.", "2026-0001", ""], ["Reyes, Maria C.", "2026-0002", ""]]);
  }
  const selectedTitle = useMemo(() => subjects.find(s => s.id === activeId)?.code || "My classes", [subjects, activeId]);
  const visibleSubjects = subjects;
  const classDirectorySubjects = useMemo(() => {
    const query = classDirectoryQuery.trim().toLocaleLowerCase();
    return visibleSubjects.filter(subject => !query || (subject.classId + " " + subject.code + " " + subject.title + " " + (subject.courseYear || "")).toLocaleLowerCase().includes(query));
  }, [visibleSubjects, classDirectoryQuery]);
  const classDirectoryStats = useMemo(() => ({
    classes: visibleSubjects.length,
    enrollments: visibleSubjects.reduce((total, subject) => total + (subject._count?.enrollments ?? 0), 0),
    visible: visibleSubjects.filter(subject => subject.isPublished).length,
    needsReview: visibleSubjects.filter(subject => subject.gradeStatus !== "VERIFIED").length
  }), [visibleSubjects]);
  const visibleClassCount = subjects.filter(subject => subject.isPublished).length;
  const filteredEnrollments = useMemo(() => (detail?.enrollments || []).filter(enrollment => {
    const query = classStudentFilter.trim().toLocaleLowerCase();
    return !query || enrollment.id.toLocaleLowerCase() === query || enrollment.studentName.toLocaleLowerCase().includes(query) || (enrollment.studentNumber || "").toLocaleLowerCase().includes(query);
  }), [detail, classStudentFilter]);
  // Index score cells once per class change rather than scanning an entire
  // enrollment's score list for each visible workbook and attendance cell.
  const scoresByEnrollment = useMemo(() => {
    const lookups = new Map<string, Map<string, Enrollment["scores"][number]>>();
    for (const enrollment of detail?.enrollments ?? []) {
      lookups.set(enrollment.id, new Map(enrollment.scores.map(score => [score.assessmentId, score])));
    }
    return lookups;
  }, [detail?.enrollments]);
  const attendanceDays = useMemo(() =>
    (detail?.assessments ?? [])
      .filter(item => item.title.toLocaleLowerCase().startsWith("attendance ·"))
      .sort((a, b) => (b.dueDate || "").localeCompare(a.dueDate || "")),
    [detail?.assessments]
  );
  const attendanceStatsByEnrollment = useMemo(() => {
    const stats = new Map<string, ReturnType<typeof attendanceSummary>>();
    for (const enrollment of detail?.enrollments ?? []) {
      stats.set(enrollment.id, attendanceSummary(enrollment, attendanceDays, scoresByEnrollment.get(enrollment.id)));
    }
    return stats;
  }, [detail?.enrollments, attendanceDays, scoresByEnrollment]);
  const recordContributionsByEnrollment = useMemo(() => {
    type Contribution = ReturnType<typeof calculateGradeBreakdown>["items"][number];
    const result = new Map<string, Map<string, Contribution>>();
    if (!detail || classSection !== "record") return result;
    const grouped = new Map<string, Assessment[]>();
    for (const item of detail.assessments) {
      const list = grouped.get(item.categoryId) ?? [];
      list.push(item);
      grouped.set(item.categoryId, list);
    }
    for (const enrollment of detail.enrollments) {
      const lookup = scoresByEnrollment.get(enrollment.id);
      const breakdown = calculateGradeBreakdown(detail.categories.map(category => ({
        id: category.id, parentId: category.parentId, weight: category.weight,
        conversionBase: category.conversionBase,
        assessments: (grouped.get(category.id) ?? []).map(item => ({
          title: item.title, dueDate: item.dueDate, maxScore: item.maxScore, weight: item.weight,
          scores: lookup?.has(item.id) ? [lookup.get(item.id)!] : []
        }))
      })));
      result.set(enrollment.id, new Map(breakdown.items.map(item => [item.categoryId, item])));
    }
    return result;
  }, [detail?.categories, detail?.assessments, detail?.enrollments, classSection, scoresByEnrollment]);
  const studentGradeStats = useMemo(() => ({
    visible: grades.length,
    verified: grades.filter(grade => grade.status === "VERIFIED").length,
    inProgress: grades.filter(grade => grade.status !== "VERIFIED").length,
    pendingAssessments: grades.reduce((count, grade) =>
      count + Math.max(0, (grade.itemCount ?? 0) - (grade.recordedCount ?? 0)), 0)
  }), [grades]);
  const studentAttendanceWarnings = useMemo(() => grades
    .filter(grade => grade.attendanceWarning || grade.droppingWarning)
    .sort((a, b) => Number(!!b.droppingWarning) - Number(!!a.droppingWarning)
      || (b.attendanceWarning?.percent ?? 0) - (a.attendanceWarning?.percent ?? 0)), [grades]);
  const visibleGrades = useMemo(() => grades.filter(grade =>
    !studentGradeQuery.trim() || `${grade.code} ${grade.title} ${grade.teacher}`.toLocaleLowerCase().includes(studentGradeQuery.trim().toLocaleLowerCase())
  ), [grades, studentGradeQuery]);
  const subjectsPerPage = 9;
  const subjectPageCount = Math.max(1, Math.ceil(classDirectorySubjects.length / subjectsPerPage));
  const pageSubjects = classDirectorySubjects.slice((subjectPage - 1) * subjectsPerPage, subjectPage * subjectsPerPage);
  const classesPerPage = 20;
  const classPageCount = Math.max(1, Math.ceil(visibleSubjects.length / classesPerPage));
  const pageClassOptions = visibleSubjects.slice((classPage - 1) * classesPerPage, classPage * classesPerPage);
  const rosterPerPage = 25;
  const rosterPageCount = Math.max(1, Math.ceil(filteredEnrollments.length / rosterPerPage));
  const pageEnrollments = filteredEnrollments.slice((rosterPage - 1) * rosterPerPage, rosterPage * rosterPerPage);
  useEffect(() => { setSubjectPage(1); }, [academicYear, activeTerm, classDirectoryQuery]);
  useEffect(() => { setClassPage(1); }, [academicYear, activeTerm]);
  useEffect(() => { const index = visibleSubjects.findIndex(subject => subject.id === activeId); if (index >= 0) setClassPage(Math.floor(index / classesPerPage) + 1); }, [activeId, visibleSubjects]);
  useEffect(() => { setRosterPage(1); }, [activeId, classStudentFilter]);
  useEffect(() => { setAssessmentCategoryOverrides({}); }, [activeId]);
  useEffect(() => { if (rosterPage > rosterPageCount) setRosterPage(rosterPageCount); }, [rosterPage, rosterPageCount]);
  const recordCategories = useMemo(() => detail ? leafCategories(orderedCategoryTree(detail.categories)) : [], [detail?.categories]);
  const assessmentCategoryOrderRows = useMemo(() => {
    if (!detail) return [] as Array<{ category: Category; depth: number; index: number; count: number }>;
    const rows: Array<{ category: Category; depth: number; index: number; count: number }> = [];
    const append = (parentId: string | null, depth: number) => {
      const siblings = detail.categories.filter(category => (category.parentId ?? null) === parentId).slice().sort((a,b) => a.sortOrder-b.sortOrder);
      siblings.forEach((category,index) => { rows.push({ category, depth, index, count: siblings.length }); append(category.id, depth + 1); });
    };
    append(null,0);
    return rows;
  }, [detail?.categories]);
  const assessmentItemGroups = useMemo(() => {
    if (!detail) return [] as Array<{ category: Category; items: Assessment[] }>;
    return recordCategories.map(category => ({
      category,
      items: detail.assessments.filter(item => item.categoryId === category.id).slice().sort((a,b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    })).filter(group => group.items.length > 0);
  }, [detail, recordCategories]);
  const scorebookItems = useMemo(() => detail?.assessments.filter(item => !item.title.toLocaleLowerCase().startsWith("attendance ·")).slice().sort((a,b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)) ?? [], [detail]);
  const scorebookCategories = useMemo(() => recordCategories.filter(category => scorebookItems.some(item => item.categoryId === category.id)), [recordCategories, scorebookItems]);
  const scorebookGroups = useMemo(() => {
    if (!detail) return [] as Array<{ parent: Category; subcategories: Category[]; items: Assessment[] }>;
    const includedLeaves = new Set(scorebookCategories.map(category => category.id));
    const descendants = (categoryId: string): Category[] => {
      const children = detail.categories.filter(category => category.parentId === categoryId);
      if (!children.length) return includedLeaves.has(categoryId) ? detail.categories.filter(category => category.id === categoryId) : [];
      return children.slice().sort((a, b) => a.sortOrder - b.sortOrder).flatMap(child => descendants(child.id));
    };
    return detail.categories.filter(category => !category.parentId).slice().sort((a, b) => a.sortOrder - b.sortOrder).map(parent => {
      const subcategories = descendants(parent.id).filter(category => scorebookItems.some(item => item.categoryId === category.id && includedLeaves.has(item.categoryId)));
      const items = subcategories.flatMap(category => scorebookItems.filter(item => item.categoryId === category.id));
      return { parent, subcategories, items };
    }).filter(group => group.items.length > 0);
  }, [detail, scorebookCategories, scorebookItems]);
  // Keep all assessment data loaded. Auto-fit only changes which columns render,
  // never which recorded scores contribute to final grades or exports.
  const scorebookAssessments = useMemo(() => scorebookGroups.flatMap(group => group.items), [scorebookGroups]);
  const scorebookPages = useMemo(() => buildWorkbookPages(
    scorebookGroups.flatMap(group => group.subcategories.map(category => ({
      id: category.id,
      label: category.name,
      assessmentIds: group.items.filter(item => item.categoryId === category.id).map(item => item.id)
    }))),
    scorebookWidth
  ), [scorebookGroups, scorebookWidth]);
  const currentScorebookPage = Math.min(scorebookPage, Math.max(0, scorebookPages.length - 1));
  const scorebookDisplayGroups = useMemo(() => {
    if (scorebookView === "all") return scorebookGroups;
    const page = scorebookPages[currentScorebookPage];
    if (!page) return [] as typeof scorebookGroups;
    const shown = new Set(page.segments.flatMap(segment => segment.assessmentIds));
    return scorebookGroups.map(group => {
      const items = group.items.filter(item => shown.has(item.id));
      const subcategories = group.subcategories.filter(category => items.some(item => item.categoryId === category.id));
      return { parent: group.parent, items, subcategories };
    }).filter(group => group.items.length > 0);
  }, [scorebookGroups, scorebookPages, currentScorebookPage, scorebookView]);
  const scorebookVisibleAssessments = useMemo(() => scorebookDisplayGroups.flatMap(group => group.items), [scorebookDisplayGroups]);
  const scorebookVisibleCategories = useMemo(() => scorebookDisplayGroups.flatMap(group => group.subcategories), [scorebookDisplayGroups]);
  const scorebookDisplayColumns = useMemo(() => scorebookDisplayGroups.flatMap(group =>
    group.subcategories.flatMap(category => [
      ...group.items.filter(item => item.categoryId === category.id).map(item => ({ kind: "assessment" as const, category, item })),
      { kind: "equivalent" as const, category }
    ])
  ), [scorebookDisplayGroups]);
  const scorebookColumnWidths = workbookWidths(scorebookWidth);
  const scorebookTableMinWidth = scorebookColumnWidths.student + scorebookColumnWidths.attendance +
    scorebookColumnWidths.total + scorebookColumnWidths.final + scorebookColumnWidths.remark +
    scorebookDisplayColumns.reduce((total, column) =>
      total + (column.kind === "assessment" ? scorebookColumnWidths.assessment : scorebookColumnWidths.equivalent), 0);
  useEffect(() => {
    const sheet = scorebookScrollRef.current;
    const region = scorebookRegionRef.current;
    if (classSection !== "record" || scorebookView !== "all" || !sheet || !region) {
      setScorebookFloatingScroll(current => current.visible ? { ...current, visible: false } : current);
      return;
    }

    const updateFloatingScrollbar = () => {
      const bounds = sheet.getBoundingClientRect();
      const hasHorizontalOverflow = sheet.clientWidth > 0 && sheet.scrollWidth > sheet.clientWidth + 2;
      const intersectsViewport = bounds.bottom > 56 && bounds.top < window.innerHeight - 56;
      const visible = hasHorizontalOverflow && intersectsViewport;
      const next = {
        visible,
        left: Math.round(bounds.left),
        width: Math.round(bounds.width),
        scrollWidth: Math.max(sheet.clientWidth, sheet.scrollWidth)
      };

      setScorebookFloatingScroll(current =>
        current.visible === next.visible &&
        current.left === next.left &&
        current.width === next.width &&
        current.scrollWidth === next.scrollWidth
          ? current
          : next
      );

    };

    updateFloatingScrollbar();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateFloatingScrollbar) : null;
    observer?.observe(region);
    observer?.observe(sheet);
    const table = sheet.querySelector("table");
    if (table) observer?.observe(table);

    window.addEventListener("scroll", updateFloatingScrollbar, { passive: true });
    window.addEventListener("resize", updateFloatingScrollbar);
    document.addEventListener("scroll", updateFloatingScrollbar, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener("scroll", updateFloatingScrollbar);
      window.removeEventListener("resize", updateFloatingScrollbar);
      document.removeEventListener("scroll", updateFloatingScrollbar, true);
    };
  }, [classSection, scorebookView, activeId, detail?.id, scorebookTableMinWidth, filteredEnrollments.length]);
  // Make the proxy scrollbar's scroll range exactly match the real workbook.
  // Its spacer is based on the floating viewport width plus the workbook's
  // overflow range, avoiding thumb-size and scroll-position drift.
  useLayoutEffect(() => {
    if (!scorebookFloatingScroll.visible || scorebookView !== "all") return;
    const sheet = scorebookScrollRef.current;
    const floating = scorebookFloatingScrollRef.current;
    const track = floating?.firstElementChild as HTMLElement | null;
    if (!sheet || !floating || !track) return;

    const workbookRange = Math.max(0, sheet.scrollWidth - sheet.clientWidth);
    track.style.width = `${floating.clientWidth + workbookRange}px`;
    syncHorizontalScrollProgress(sheet, floating);
  }, [scorebookFloatingScroll.visible, scorebookFloatingScroll.left, scorebookFloatingScroll.width, scorebookFloatingScroll.scrollWidth, scorebookView]);
  const scorebookHeaderRows = useMemo(() => {
    if (!detail || !scorebookVisibleAssessments.length) return { rows: [] as Array<Array<{ category: Category; colSpan: number; rowSpan: number }>>, rowSpan: 1 };
    const itemCounts = new Map<string, number>();
    const depthById = new Map<string, number>();
    const countItems = (category: Category, depth: number): number => {
      depthById.set(category.id, depth);
      const own = scorebookVisibleAssessments.filter(item => item.categoryId === category.id).length +
        (scorebookVisibleCategories.some(leaf => leaf.id === category.id) ? 1 : 0);
      const children = detail.categories.filter(item => item.parentId === category.id).slice().sort((a,b)=>a.sortOrder-b.sortOrder);
      const count = own + children.reduce((sum, child) => sum + countItems(child, depth + 1), 0);
      itemCounts.set(category.id, count);
      return count;
    };
    for (const group of scorebookDisplayGroups) countItems(group.parent, 0);
    const maxDepth = Math.max(0, ...scorebookVisibleAssessments.map(item => depthById.get(item.categoryId) ?? 0));
    const rows = Array.from({ length: maxDepth + 1 }, () => [] as Array<{ category: Category; colSpan: number; rowSpan: number }>);
    const append = (category: Category, depth: number) => {
      const colSpan = itemCounts.get(category.id) ?? 0;
      if (!colSpan) return;
      const children = detail.categories.filter(item => item.parentId === category.id && (itemCounts.get(item.id) ?? 0) > 0).slice().sort((a,b)=>a.sortOrder-b.sortOrder);
      rows[depth].push({ category, colSpan, rowSpan: children.length ? 1 : maxDepth - depth + 1 });
      children.forEach(child => append(child, depth + 1));
    };
    scorebookDisplayGroups.forEach(group => append(group.parent, 0));
    return { rows, rowSpan: maxDepth + 2 };
  }, [detail, scorebookDisplayGroups, scorebookVisibleAssessments, scorebookVisibleCategories]);
  // Include intermediate nodes such as Major Examinations in the workbook header.
  const printCategories = useMemo(() => detail ? leafCategories(detail.categories) : [], [detail]);
  const weightGroups = useMemo(() => {
    if (!detail) return [];
    const parentKeys = [...new Set(detail.categories.map(category => category.parentId ?? "root"))];
    return parentKeys.map(key => {
      const siblings = detail.categories.filter(category => (category.parentId ?? "root") === key);
      const parent = key === "root" ? null : detail.categories.find(category => category.id === key);
      const expected = !parent || !parent.parentId ? 100 : parent.weight;
      return { label: parent ? `${parent.name} subcategories` : "Overall course components", total: siblings.reduce((sum, category) => sum + category.weight, 0), expected };
    });
  }, [detail]);
  const submissionProblems = useMemo(() => {
    if (!detail) return [];
    const problems: string[] = [];
    if (weightGroups.some(group => Math.abs(group.total - group.expected) > 0.01)) problems.push("Top-level groups and first-level categories must total 100%. Deeper subcategories must add up to their parent’s allocation.");
    const leaves = leafCategories(detail.categories);
    const emptyCategories = leaves.filter(category => category.weight > 0 && !detail.assessments.some(item => item.categoryId === category.id));
    if (emptyCategories.length) problems.push(`${emptyCategories.length} weighted category/categories have no assessment items.`);
    const badItemWeights = leaves.filter(category => {
      const items = detail.assessments.filter(item => item.categoryId === category.id);
      return items.some(item => item.weight !== null) && (items.some(item => item.weight == null) || Math.abs(items.reduce((sum, item) => sum + (item.weight ?? 0), 0) - 100) > 0.01);
    });
    if (badItemWeights.length) problems.push(`Assessment weights must total 100% in ${badItemWeights.length} category/categories.`);
    const missingScoreRows = detail.enrollments.filter(enrollment => !enrollment.remarks && detail.assessments.some(item => !enrollment.scores.some(score => score.assessmentId === item.id && (score.points !== null || !!score.remark)))).length;
    if (missingScoreRows) problems.push(`${missingScoreRows} student record(s) have missing scores. Enter every assessment score or set an appropriate class remark.`);
    return problems;
  }, [detail, weightGroups]);

  const analytics = useMemo(() => {
    if (!detail) return { graded: [] as Enrollment[], average: null as number | null, passing: 0, atRisk: 0, failing: 0, attendanceDanger: 0, leader: null as Enrollment | null, bands: [] as Array<{ label: string; count: number }> };
    const graded = detail.enrollments.filter(enrollment => enrollment.finalPercent !== null && !["INC", "NP", "DROPPED"].includes(enrollment.remarks || ""));
    const average = graded.length ? graded.reduce((sum, item) => sum + (item.finalPercent ?? 0), 0) / graded.length : null;
    const bands = [{ label: "90–100%", count: 0 }, { label: "75–89%", count: 0 }, { label: "60–74%", count: 0 }, { label: "Below 60%", count: 0 }];
    for (const item of graded) { const score = item.finalPercent ?? 0; bands[score >= 90 ? 0 : score >= 75 ? 1 : score >= 60 ? 2 : 3].count++; }
    return { graded, average, passing: graded.filter(item => (item.finalPercent ?? 0) >= 75).length, atRisk: graded.filter(item => (item.finalPercent ?? 0) >= 60 && (item.finalPercent ?? 0) < 75).length, failing: graded.filter(item => (item.finalPercent ?? 0) < 60).length, attendanceDanger: detail.enrollments.filter(item => attendanceStatsByEnrollment.get(item.id)?.atRisk).length, leader: [...graded].sort((a, b) => (b.finalPercent ?? 0) - (a.finalPercent ?? 0))[0] || null, bands };
  }, [detail, attendanceStatsByEnrollment]);

  const remainingWeight = (parentId: string | null, exceptId?: string) =>
    detail ? remainingChildAllocation(parentId, detail.categories, exceptId) : 0;
  const renderCategoryForm = (parent: Category | null): ReactNode => <form className="category-create-form category-path-form" onSubmit={addCategory}>
    <div><label className="form-label">{parent ? "Subcategory name" : "Course group name"}</label><input className="form-control" value={categoryName} onChange={e=>setCategoryName(e.target.value)} placeholder={parent ? "e.g. Midterm Exam, Final Exam" : "e.g. Lecture, Laboratory"} required maxLength={80}/></div>
    <div><label className="form-label">Parent category</label><div className="form-control bg-body-secondary">{parent ? categoryPath(parent, detail?.categories || []) : "Top level · course allocation"}</div></div>
    <div><label className="form-label">{parent ? `Weight within ${rootCategory(parent, detail?.categories || []).name} (%)` : "Weight of course (%)"}</label><div className="input-group"><input className="form-control" type="number" min="0" max={remainingWeight(parent?.id || null)} step="0.5" value={categoryWeight} onChange={e=>setCategoryWeight(e.target.value)} required/><span className="input-group-text">%</span></div><small className="muted">{remainingWeight(parent?.id || null).toFixed(2)}% remains in this allocation. First-level categories total 100%; deeper subcategories total their parent’s weight. Adding saves any unsaved edits to existing grading categories.</small></div>
    <div className="category-path-actions"><button type="button" className="btn btn-outline-secondary btn-sm" onClick={()=>setCategoryOpen(false)}>Cancel</button><button className="btn btn-primary btn-sm" disabled={busy||remainingWeight(parent?.id||null)<=0||Number(categoryWeight)>remainingWeight(parent?.id||null)}>Add to parent</button></div>
  </form>;
  const renderCategoryBranch = (category: Category, depth = 0): ReactNode => {
    if (!detail) return null;
    const children = detail.categories.filter(item => item.parentId === category.id);
    const hasItems = detail.assessments.some(item => item.categoryId === category.id);
    return <div className={`grading-node depth-${Math.min(depth, 3)}`} key={category.id}>
      <div className="grading-node-row">
        <div className="grading-node-title"><span className="grading-node-icon">{depth === 0 ? "1" : "↳"}</span><div><input className="form-control form-control-sm grading-category-name" aria-label="Category name" value={category.name} onChange={e=>setDetail({ ...detail, categories: detail.categories.map(item => item.id === category.id ? { ...item, name: e.target.value } : item) })}/><small>{depth === 0 ? "Parent category · % of course" : `Subcategory · allocated under ${detail.categories.find(item => item.id === category.parentId)?.name || "parent"}`}</small></div></div>
        <label className="grading-weight-field">{depth === 0 ? "Weight (% of course)" : `Weight within ${rootCategory(category, detail.categories).name} (%)`}<div className="input-group"><input className="form-control" type="number" min="0" max={Math.max(category.weight, remainingWeight(category.parentId, category.id))} step="0.5" value={category.weight} onChange={e => setDetail({ ...detail, categories: detail.categories.map(item => item.id === category.id ? { ...item, weight: Number(e.target.value) } : item) })}/><span className="input-group-text">%</span></div></label>
        {children.length === 0 && category.parentId ? <div className="grading-conversion-inherited"><small>Inherited equivalent base</small><b>{detail.categories.find(item => item.id === category.parentId)?.conversionBase ?? 50}%</b></div> : <label className="grading-conversion-field">{depth === 0 ? "Equivalent base (%)" : "Child equivalent base (%)"}<div className="input-group"><input className="form-control" type="number" min="1" max="100" step="1" value={category.conversionBase} onChange={e => setDetail({ ...detail, categories: detail.categories.map(item => item.id === category.id ? { ...item, conversionBase: Number(e.target.value) } : item) })}/><span className="input-group-text">%</span></div><small>Formula: raw% × base% + (100% − base)</small></label>}
        <div className="grading-effective-weight"><small>{category.parentId ? `Weight within ${rootCategory(category, detail.categories).name}` : "Weight of course"}</small><b>{category.weight.toFixed(2)}%</b>{children.length>0&&<small>Direct subcategories total {category.parentId ? `${detail.categories.find(item=>item.id===category.parentId)?.parentId ? category.weight : 100}%` : "100%"}</small>}</div>
        <div className="grading-node-actions"><button type="button" className="btn btn-sm btn-outline-primary" onClick={() => { setCategoryParent(category.id); setCategoryWeight(String(remainingWeight(category.id))); setCategoryOpen(true); }} disabled={hasItems}>＋ Subcategory</button><button type="button" className="btn btn-sm btn-outline-danger" onClick={() => removeCategory(category.id)} disabled={busy || hasItems || children.length > 0}>Remove</button></div>
      </div>
      <small className="grading-path">Path: {categoryPath(category, detail.categories)}</small>
      {categoryOpen && categoryParent===category.id && <div className="grading-children">{renderCategoryForm(category)}</div>}
      {children.length > 0 && <div className="grading-children">{children.map(child => renderCategoryBranch(child, depth + 1))}</div>}
    </div>;
  };

  return <div className="portal-layout" data-bs-theme={theme} data-saga-role={teacher ? "teacher" : "student"} data-student-glass-theme={!teacher ? studentPortalPreferences.theme : undefined} data-student-wallpaper={!teacher ? studentPortalPreferences.wallpaper : undefined} data-student-layout={!teacher ? studentPortalPreferences.layout : undefined} style={{"--school-primary": user.school.primaryColor, "--student-accent": !teacher ? STUDENT_PORTAL_ACCENTS[studentPortalPreferences.accent].color : undefined, "--student-wallpaper-image": !teacher && studentPortalPreferences.wallpaper === "custom" && safeStudentBackgroundUrl(studentPortalPreferences.customBackgroundUrl) ? `url("${safeStudentBackgroundUrl(studentPortalPreferences.customBackgroundUrl)}")` : "none"} as import("react").CSSProperties}><main className="main-area"><header className="portal-top-nav"><div className="portal-top-nav-inner"><a className="portal-top-brand" href={`/${encodeURIComponent(user.school.slug)}/overview`} aria-label={`${user.school.shortName} SAGA Portal overview`}><img className="sidebar-app-mark" src="/favicon.svg" alt="" width="38" height="38"/><span><strong>{user.school.shortName}</strong><small>SAGA PORTAL</small></span></a><nav className="portal-top-links" aria-label="Primary navigation"><button type="button" className={`portal-top-link ${tab === "overview" ? "selected" : ""}`} aria-current={tab === "overview" ? "page" : undefined} onClick={() => { setClassesMenuOpen(false); navigatePage("overview"); }}><span aria-hidden="true">▦</span>Overview</button>{teacher && tab === "classes" && activeId && <a className="portal-top-link" href={`/${encodeURIComponent(user.school.slug)}/academic-assistant?class=${encodeURIComponent(activeId)}`}><span aria-hidden="true">✦</span>Virtual Assistant</a>}{teacher && <a className="portal-top-link" href={`/${encodeURIComponent(user.school.slug)}/teacher-summary`}><span aria-hidden="true">▤</span>Teacher Summary</a>}{!teacher && <button type="button" className={`portal-top-link ${tab === "announcements" ? "selected" : ""}`} aria-current={tab === "announcements" ? "page" : undefined} onClick={() => { setClassesMenuOpen(false); navigatePage("announcements"); }}><span aria-hidden="true">▤</span>Announcements</button>}<button type="button" className={`portal-top-link ${tab === "chats" ? "selected" : ""}`} aria-current={tab === "chats" ? "page" : undefined} onClick={() => { setClassesMenuOpen(false); navigatePage("chats"); }}><span aria-hidden="true">▣</span>Class chats</button>{teacher && <div className={`portal-nav-class-menu ${classesMenuOpen ? "is-open" : ""}`}><button type="button" className={`portal-top-link portal-top-class-toggle ${tab === "classes" ? "selected" : ""}`} aria-haspopup="true" aria-expanded={classesMenuOpen} aria-controls="portal-active-classes" onClick={() => setClassesMenuOpen(open => !open)}><span aria-hidden="true">▤</span>My classes<span className="portal-top-caret" aria-hidden="true">⌄</span></button><div className="sidebar-class-list portal-top-class-list" id="portal-active-classes" role="group" aria-label={`Classes for ${activeTerm}, ${academicYear}`}><div className="sidebar-class-period"><span>ACTIVE PERIOD</span><strong>{activeTerm} · {academicYear}</strong></div>{subjects.length ? subjects.map(subject => <button key={subject.id} type="button" className={`sidebar-class-link ${activeId === subject.id ? "selected" : ""}`} onClick={() => { setClassesMenuOpen(false); openClass(subject.id); }} aria-current={activeId === subject.id ? "page" : undefined}><span className="sidebar-class-link-copy"><b>{subject.code}</b><small>{subject.title}</small></span><em>{subject.classId || subject.courseYear || "Open class"}</em></button>) : <div className="sidebar-class-empty">No classes for this active period.</div>}</div></div>}{teacher && (user.isTenantManager || user.isSchoolAdmin) && <a className="portal-top-link" href="/manage"><span aria-hidden="true">⚙</span>{user.isTenantManager ? "Tenant management" : "School administration"}</a>}{!teacher && <button type="button" className={`portal-top-link ${tab === "simulator" ? "selected" : ""}`} aria-current={tab === "simulator" ? "page" : undefined} onClick={() => { setClassesMenuOpen(false); navigatePage("simulator"); }}><span aria-hidden="true">▤</span>Grade Simulator</button>}<button type="button" className="portal-top-link" title="FAQs, onboarding tour, and manuals" onClick={() => { setClassesMenuOpen(false); openHelp("quick"); }}><span aria-hidden="true">?</span>Help &amp; guides</button>{!teacher && <button type="button" className="portal-top-link student-customize-trigger" onClick={() => { setClassesMenuOpen(false); setStudentCustomizerRequested(true); navigatePage("overview"); }}><span aria-hidden="true">✧</span>Customize</button>}</nav><div className="portal-top-actions"><AccountMenu fullName={user.fullName} email={user.email} role={teacher ? "Teacher" : "Student"} profileImagePath={profileImagePath} theme={theme} onThemeChange={setAppearance} onEditProfile={() => navigatePage("profile")} onLogout={logout} onHelp={() => openHelp("quick")} onTenantDashboard={teacher && (user.isTenantManager || user.isSchoolAdmin) ? () => router.push("/manage") : undefined}/></div></div></header>{user.isDemo && <RealDemoBanner />}<header className="topbar"><div><div className="crumb">{teacher ? "TEACHER SPACE" : "STUDENT SPACE"}<span>/</span>{tab === "profile" ? "PROFILE" : tab === "classes" ? selectedTitle.toUpperCase() : tab === "simulator" ? "GRADE SIMULATOR" : tab === "chats" ? "CLASS CHATS" : tab === "announcements" ? "ANNOUNCEMENTS" : "OVERVIEW"}</div><h1>{tab === "profile" ? "Account settings" : tab === "classes" && teacher ? selectedTitle : tab === "simulator" ? "Grade Simulator" : tab === "chats" ? "Class Chats" : tab === "announcements" ? "Announcements" : teacher ? "Teaching overview" : "Academic overview"}</h1></div><div className="topbar-right"><span className="term-pill">Academic records <i>·</i> Private</span></div></header>
      <div className="content-wrap">{(err||notice)&&!(teacher && tab === "classes" && classSection === "record" && detail)&&<div className="portal-toast-stack" aria-live="polite" aria-atomic="false">{err&&<div className="portal-toast error" role="alert"><div><b>Needs attention</b><p>{err}</p>{notificationTarget(err)&&<button className="toast-location" onClick={goToNotificationTarget}>Check {notificationTarget(err)?.label} ↗</button>}</div><button className="toast-dismiss" aria-label="Dismiss error" onClick={()=>setErr("")}>×</button></div>}{notice&&<div className="portal-toast success" role="status"><div><b>Saved</b><p>{notice}</p></div><button className="toast-dismiss" aria-label="Dismiss notification" onClick={()=>setNotice("")}>×</button></div>}</div>}
      {tab === "profile" ? <section className="surface profile-surface"><div className="section-heading"><div><span className="eyebrow">PERSONAL DETAILS</span><h2>Profile information</h2><p className="muted">Manage your personal details and the school letterhead used on grading sheets.</p></div><span className="profile-avatar">{profileImagePath ? <img src={`/api/media?pathname=${encodeURIComponent(profileImagePath)}`} alt="Profile"/> : initials(user.fullName)}</span></div><div className="profile-media-grid"><div className="profile-media-card"><label className="form-label">Profile picture</label><p className="muted small">Private to your account. JPG, PNG, or WebP up to 3 MB.</p><input className="form-control" type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>{void uploadProfileImage("profile",e.currentTarget.files?.[0]);e.currentTarget.value=""}}/></div>{teacher && <div className="profile-media-card"><label className="form-label">School / Institution logo</label><p className="muted small">Official institution mark, displayed at the left of the portrait grading-sheet header.</p>{schoolLogoPath && <img className="school-logo-preview" src={`/api/media?pathname=${encodeURIComponent(schoolLogoPath)}`} alt="Current school logo"/>}<input className="form-control mb-3" type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>{void uploadProfileImage("school-logo",e.currentTarget.files?.[0]);e.currentTarget.value=""}}/><label className="form-label">College / Department logo</label><p className="muted small">Separate college or department mark, displayed at the right of the institution header.</p>{departmentLogoPath && <img className="school-logo-preview" src={`/api/media?pathname=${encodeURIComponent(departmentLogoPath)}`} alt="Current college or department logo"/>}<input className="form-control" type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>{void uploadProfileImage("department-logo",e.currentTarget.files?.[0]);e.currentTarget.value=""}}/></div>}</div><form className="profile-form mt-4" onSubmit={saveProfile}><label className="form-label">Full name</label><input className="form-control" value={profileName} onChange={e => setProfileName(e.target.value)} required maxLength={120}/><label className="form-label mt-3">Sign-in email</label><input className="form-control" value={user.email} readOnly/><label className="form-label mt-3">Role</label><input className="form-control" readOnly value={teacher ? "Teacher" : "Student"}/>
        {teacher && <>
          <label className="form-label mt-3" htmlFor="profileFacultyId">Faculty ID</label>
          <input className="form-control" id="profileFacultyId" value={profileFacultyId}
            onChange={event => setProfileFacultyId(event.target.value)} minLength={3} maxLength={40}
            pattern="[A-Za-z0-9][A-Za-z0-9._/-]{2,39}" autoComplete="off" required/>
          <div className="form-text">This ID is unique within your school. You can replace your assigned Faculty ID with your official school-issued ID.</div>
          <h3 className="mt-4">School / Department letterhead</h3>
          <p className="muted small">These details are shared by teacher accounts in your school and are used automatically in grading-sheet exports.</p>
          <label className="form-label mt-3" htmlFor="profileSchoolAddress">School address</label>
          <textarea className="form-control" id="profileSchoolAddress" value={schoolAddress} onChange={event => setSchoolAddress(event.target.value)} maxLength={300} rows={2} placeholder="Complete school or campus address"/>
          <label className="form-label mt-3" htmlFor="profileDepartmentName">College / Department name</label>
          <input className="form-control" id="profileDepartmentName" value={departmentName} onChange={event => setDepartmentName(event.target.value)} maxLength={160} placeholder="College or department name"/>
          <h3 className="mt-4">Grading sheet signatories</h3>
          <p className="muted small">All signatory details are personal to your teacher profile. Set your own Noted by name and position to the superior who reviews your grading sheets.</p>
          <label className="form-label mt-3" htmlFor="profileTeacherPosition">Submitted by position / title</label>
          <input className="form-control" id="profileTeacherPosition" value={teacherPosition} onChange={event => setTeacherPosition(event.target.value)} maxLength={120} placeholder="Instructor" required/>
          <label className="form-label mt-3" htmlFor="profileNotedByName">Noted by name</label>
          <input className="form-control" id="profileNotedByName" value={notedByName} onChange={event => setNotedByName(event.target.value)} maxLength={120} placeholder="Dean or approving superior’s full name" required/>
          <label className="form-label mt-3" htmlFor="profileNotedByPosition">Noted by position / title</label>
          <input className="form-control" id="profileNotedByPosition" value={notedByPosition} onChange={event => setNotedByPosition(event.target.value)} maxLength={120} placeholder="Dean or VP Academic Affairs" required/>
          <h3 className="mt-4">ISO document header</h3>
          <p className="muted small">These ISO document-control details are shared by this school only. FCU is prefilled with its supplied form details; other schools can enter their own header information here.</p>
          <div className="row g-3">
            <div className="col-md-6"><label className="form-label" htmlFor="isoOrganizationAddress">Organization address</label><input className="form-control" id="isoOrganizationAddress" value={isoHeaderConfig.organizationAddress} onChange={event => setIsoHeaderConfig(current => ({...current, organizationAddress:event.target.value}))} maxLength={300}/></div>
            <div className="col-md-6"><label className="form-label" htmlFor="isoFormName">Form name</label><input className="form-control" id="isoFormName" value={isoHeaderConfig.formName} onChange={event => setIsoHeaderConfig(current => ({...current, formName:event.target.value}))} maxLength={120}/></div>
            <div className="col-md-6"><label className="form-label" htmlFor="isoFormNo">Form number</label><input className="form-control" id="isoFormNo" value={isoHeaderConfig.formNo} onChange={event => setIsoHeaderConfig(current => ({...current, formNo:event.target.value}))} maxLength={80}/></div>
            <div className="col-md-6"><label className="form-label" htmlFor="isoEffectivity">Effectivity date</label><input className="form-control" id="isoEffectivity" value={isoHeaderConfig.effectivity} onChange={event => setIsoHeaderConfig(current => ({...current, effectivity:event.target.value}))} maxLength={80}/></div>
            <div className="col-md-6"><label className="form-label" htmlFor="isoIssuingOffice">Issuing office</label><input className="form-control" id="isoIssuingOffice" value={isoHeaderConfig.issuingOffice} onChange={event => setIsoHeaderConfig(current => ({...current, issuingOffice:event.target.value}))} maxLength={120}/></div>
            <div className="col-md-6"><label className="form-label" htmlFor="isoRevisionNo">Revision number</label><input className="form-control" id="isoRevisionNo" value={isoHeaderConfig.revisionNo} onChange={event => setIsoHeaderConfig(current => ({...current, revisionNo:event.target.value}))} maxLength={40}/></div>
            <div className="col-md-6"><label className="form-label" htmlFor="isoEomsTitle">Management system title</label><input className="form-control" id="isoEomsTitle" value={isoHeaderConfig.eomsTitle} onChange={event => setIsoHeaderConfig(current => ({...current, eomsTitle:event.target.value}))} maxLength={160}/></div>
            <div className="col-md-6"><label className="form-label" htmlFor="isoStandard">ISO standard</label><input className="form-control" id="isoStandard" value={isoHeaderConfig.isoStandard} onChange={event => setIsoHeaderConfig(current => ({...current, isoStandard:event.target.value}))} maxLength={80}/></div>
            <div className="col-12"><label className="form-label" htmlFor="isoAffiliation1">Affiliation line 1</label><input className="form-control" id="isoAffiliation1" value={isoHeaderConfig.affiliationLine1} onChange={event => setIsoHeaderConfig(current => ({...current, affiliationLine1:event.target.value}))} maxLength={240}/></div>
            <div className="col-12"><label className="form-label" htmlFor="isoAffiliation2">Affiliation line 2</label><input className="form-control" id="isoAffiliation2" value={isoHeaderConfig.affiliationLine2} onChange={event => setIsoHeaderConfig(current => ({...current, affiliationLine2:event.target.value}))} maxLength={240}/></div>
          </div>
        </>}{!teacher && <>{user.courseProgram && <><label className="form-label mt-3">Course / Program</label><input className="form-control" readOnly value={user.courseProgram}/></>}{user.yearLevel && <><label className="form-label mt-3">Year level</label><input className="form-control" readOnly value={user.yearLevel}/></>}</>}<button className="btn btn-primary mt-4" disabled={busy}>Save profile</button></form><ChangeEmailForm schoolId={user.school.id} emailDeliveryEnabled={user.emailDeliveryEnabled}/><div className="account-security-section"><h3>Change password</h3><p className="muted">Use at least 12 characters. A verification code will be sent to your current sign-in email. Changing your password signs out existing sessions.</p><form className="profile-form" onSubmit={changePassword}><label className="form-label">Current password</label><input className="form-control" type="password" autoComplete="current-password" value={passwordCurrent} onChange={e=>setPasswordCurrent(e.target.value)} required maxLength={100}/><label className="form-label mt-3">New password</label><input className="form-control" type="password" autoComplete="new-password" value={passwordNew} onChange={e=>setPasswordNew(e.target.value)} required minLength={12} maxLength={100}/><label className="form-label mt-3">Confirm new password</label><input className="form-control" type="password" autoComplete="new-password" value={passwordConfirm} onChange={e=>setPasswordConfirm(e.target.value)} required minLength={12} maxLength={100}/>{passwordOtpSent && <><label className="form-label mt-3">Six-digit code</label><input className="form-control" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" value={passwordOtp} onChange={e=>setPasswordOtp(e.target.value.replace(/\D/g, "").slice(0,6))} required/></>}<button type={passwordOtpSent ? "submit" : "button"} className="btn btn-primary mt-3" disabled={busy} onClick={!passwordOtpSent ? ()=>void requestPasswordOtp() : undefined}>{passwordOtpSent ? "Verify code and update password" : "Send verification code"}</button></form></div></section> : teacher ? <>{tab === "overview" && <><section className="overview-hero" aria-label="Teacher dashboard">
  <div className="overview-hero-main">
    <div className="overview-hero-copy">
      <span className="eyebrow">SAGA · TEACHER WORKSPACE</span>
      <h1>Good day, {user.fullName.split(" ")[0]}.</h1>
      <p>Your classes, attendance, and student progress at a glance.</p>
    </div>
    <button type="button" className="btn btn-primary overview-create-button" onClick={() => setCreateOpen(true)}><span aria-hidden="true">＋</span> Create a class</button>
  </div>
  <div className="overview-period-bar" aria-label="Academic period selection">
    <div className="overview-period-summary"><span>ACADEMIC PERIOD</span><strong>{academicYear} <i>·</i> {activeTerm}</strong><small>Dashboard metrics follow this selection.</small></div>
    <div className="overview-period-controls">
      <label>Calendar<select className="form-select form-select-sm" value={calendarSystem} onChange={event=>{setCalendarSystem(event.target.value as "SEMESTER"|"TRIMESTER");setActiveTerm(event.target.value==="TRIMESTER"?"1st Trimester":"1st Semester");}}><option value="SEMESTER">Semester</option><option value="TRIMESTER">Trimester</option></select></label>
      <label>School year<select className="form-select form-select-sm" value={academicYear} onChange={event=>setAcademicYear(event.target.value)}>{academicYears.map(year=><option key={year} value={year}>{year}</option>)}</select></label>
      <label>Term<select className="form-select form-select-sm" value={activeTerm} onChange={event=>setActiveTerm(event.target.value)}>{(calendarSystem==="TRIMESTER"?["1st Trimester","2nd Trimester","3rd Trimester"]:["1st Semester","2nd Semester","Summer"]).map(term=><option key={term}>{term}</option>)}</select></label>
    </div>
  </div>
</section>
<details className="overview-quick-lookup">
  <summary><span className="overview-lookup-mark" aria-hidden="true">⌕</span><span className="overview-lookup-copy"><strong>Student lookup</strong><small>Find a student and review their recorded class results</small></span><span className="overview-lookup-action">Search records <span aria-hidden="true">⌄</span></span></summary>
  <section className="surface student-smart-search"><div className="section-heading"><div><span className="eyebrow">QUICK LOOKUP</span><h2>Smart student search</h2><p className="muted">Search by student name or ID to see their recorded class results for the active academic period.</p></div></div><div className="student-search-controls student-active-period-search"><label className="student-search-input"><span>Student name or ID</span><input className="form-control" type="search" value={studentLookupQuery} onChange={event=>setStudentLookupQuery(event.target.value)} placeholder="Start typing a name or student ID…" autoComplete="off"/></label><div className="student-search-period-note"><span>ACTIVE PERIOD</span><strong>{activeTerm} · {academicYear}</strong></div></div>{studentLookupQuery.trim().length < 2 ? <div className="student-search-hint">Enter at least 2 characters to search your class rosters.</div> : studentLookupBusy ? <div className="student-search-hint" role="status">Searching student records…</div> : studentLookupMatches.length ? <div className="student-search-results"><div className="student-search-count">{studentLookupMatches.length} matching class record{studentLookupMatches.length === 1 ? "" : "s"}{studentLookupMatches.length === 50 ? " · showing first 50" : ""}</div>{studentLookupMatches.map(match=><article className="student-search-result" key={match.enrollmentId}><div className="student-search-result-header"><div><b>{match.studentName}</b><span>{match.class.classId ? `${match.class.classId} · ` : ""}{match.class.code} — {match.class.title}</span><small>{match.class.term} · {match.class.academicYear} · {match.class.status === "VERIFIED" ? "Final" : match.class.status === "SUBMITTED" ? "Provisional" : "Draft"}</small></div><div className="student-search-grade"><strong>{match.finalPercent === null ? "—" : `${match.finalPercent.toFixed(2)}%`}</strong><small>{match.finalGrade || match.finalRemark}</small></div><button type="button" className="btn btn-sm btn-outline-primary" onClick={()=>openStudentSearchMatch(match)}>Open scorebook</button></div>{match.records.length ? <div className="student-search-records">{match.records.map(record=><div className="student-search-record" key={record.id}><span><b>{record.title}</b><small>{record.category || "Uncategorized"}</small></span><strong>{record.remark || (record.points === null ? "Not entered" : `${record.points} / ${record.maxScore}`)}</strong></div>)}</div> : <div className="student-search-hint">No assessment items have been added to this class.</div>}</article>)}</div> : <div className="student-search-hint">No matching students found for these filters.</div>}</section>
</details><div className="overview-report-heading"><div><span className="eyebrow">TEACHER DASHBOARD</span><h2>Performance snapshot</h2><p className="muted">A clear picture of your classes and activity in the selected date range.</p></div><div className="overview-date-controls"><label>From<input className="form-control form-control-sm" type="date" value={overviewFrom} max={overviewTo || undefined} onChange={event=>setOverviewFrom(event.target.value)}/></label><label>To<input className="form-control form-control-sm" type="date" value={overviewTo} min={overviewFrom || undefined} onChange={event=>setOverviewTo(event.target.value)}/></label><button type="button" className="btn btn-outline-primary btn-sm" onClick={()=>{setOverviewTo(todayDateInput());setOverviewFrom(shiftDateInput(todayDateInput(),-29))}}>Last 30 days</button></div></div>
{overviewFrom > overviewTo ? <div className="inline-empty">The start date must be on or before the end date.</div> : overviewLoading && !overviewData ? <div className="overview-loading" role="status"><span className="spinner-border spinner-border-sm"/> Loading learning activity…</div> : overviewData && <>
<div className="overview-stat-grid">
  <article className="surface overview-stat-card accent-violet"><small>ACTIVE CLASSES</small><strong>{overviewData.stats.activeClasses}</strong><span>Classes assigned to you</span></article>
  <article className="surface overview-stat-card accent-cyan"><small>ENROLLED STUDENTS</small><strong>{overviewData.stats.activeStudents}</strong><span>Unique students across your classes</span></article>
  <article className="surface overview-stat-card accent-blue"><small>ON-TIME ATTENDANCE</small><strong>{overviewData.attendance.present + overviewData.attendance.absent + (overviewData.attendance.late ?? 0) > 0 ? `${Math.round(overviewData.attendance.present / (overviewData.attendance.present + overviewData.attendance.absent + (overviewData.attendance.late ?? 0)) * 100)}%` : "—"}</strong><span>{overviewData.attendance.present} present · {overviewData.stats.attendanceLogs} marks recorded</span></article>
  <article className="surface overview-stat-card accent-violet"><small>LEARNING ACTIVITIES</small><strong>{overviewData.stats.activities + overviewData.stats.tests}</strong><span>{overviewData.stats.activities} activities · {overviewData.stats.tests} tests</span></article>
  <article className="surface overview-stat-card accent-cyan"><small>PENDING REVIEWS</small><strong>{overviewData.stats.pendingReviews}</strong><span>Class records awaiting confirmation</span></article>
</div>
<section className="surface overview-attendance-risk" aria-labelledby="overview-attendance-risk-title">
  <div className="overview-watchlist-heading">
    <div><span className="eyebrow">EARLY INTERVENTION</span><h2 id="overview-attendance-risk-title">Attendance watchlist</h2><p className="muted">Students at or above the {HIGH_RISK_ABSENCE_PERCENT}% absence threshold. Highest-risk cases appear first.</p></div>
    <span className="overview-watchlist-count">{overviewData.attendanceRisk.filter(item => item.percent >= HIGH_RISK_ABSENCE_PERCENT).length} flagged</span>
  </div>
  {overviewData.attendanceRisk.filter(item => item.percent >= HIGH_RISK_ABSENCE_PERCENT).length ? <ul className="overview-attendance-risk-list">
    {overviewData.attendanceRisk.filter(item => item.percent >= HIGH_RISK_ABSENCE_PERCENT).sort((a,b)=>b.percent-a.percent).slice(0,5).map(item => <li key={item.enrollmentId}>
      <div className="overview-attendance-risk-student"><strong>{item.studentName}</strong><small>{[item.classId, item.code].filter(Boolean).join(" · ")}</small></div>
      <div className="overview-attendance-risk-subject"><strong>{item.title}</strong><small>{[item.term, item.academicYear].filter(Boolean).join(" · ")}</small></div>
      <div className="overview-risk-rate"><strong>{item.percent.toFixed(1)}%</strong><div className="overview-risk-track"><span style={{width:`${Math.min(100,item.percent)}%`}}/></div><small>{item.absent} of {item.counted} counted days absent</small></div>
      <button type="button" className="btn btn-sm btn-outline-primary" aria-label={`Review attendance for ${item.code}${item.classId ? ` (${item.classId})` : ""}`} onClick={() => openClass(item.subjectId, "attendance")}>Review</button>
    </li>)}
  </ul> : <div className="overview-watchlist-empty"><span aria-hidden="true">✓</span><div><strong>No attendance alerts</strong><small>There are no students currently at the high-risk absence threshold.</small></div></div>}
  {overviewData.attendanceRisk.filter(item => item.percent >= HIGH_RISK_ABSENCE_PERCENT).length > 5 && <p className="overview-watchlist-footnote">Showing the 5 highest-risk students. Open a class attendance record to review the full roster.</p>}
</section>

<div className="overview-section-heading"><div><span className="eyebrow">REPORTS</span><h2>Activity &amp; grade insights</h2></div><span>Based on {new Date(`${overviewFrom}T00:00:00`).toLocaleDateString()} – {new Date(`${overviewTo}T00:00:00`).toLocaleDateString()}</span></div>
<div className="overview-chart-grid">
  <article className="surface overview-chart-card"><h3>Attendance breakdown</h3><p>Recorded attendance marks by status.</p><div className="overview-pie-wrap"><div className="overview-pie-chart" role="img" aria-label={`Attendance: ${overviewData.attendance.present} present, ${overviewData.attendance.absent} absent, ${overviewData.attendance.excused} excused, ${overviewData.attendance.late} late`} style={{background:pieGradient([overviewData.attendance.present,overviewData.attendance.absent,overviewData.attendance.excused, overviewData.attendance.late ?? 0],["#10a477","#e5252a","#5144dc","#b36b00"])}}/></div><div className="overview-chart-legend"><span><i className="legend-present"/>Present <b>{overviewData.attendance.present}</b></span><span><i className="legend-absent"/>Absent <b>{overviewData.attendance.absent}</b></span><span><i className="legend-excused"/>Excused <b>{overviewData.attendance.excused}</b></span><span><i style={{background:"#b36b00"}}/>Late <b>{overviewData.attendance.late ?? 0}</b></span></div></article>
  <article className="surface overview-chart-card"><h3>Gradebook status</h3><p>Current class record statuses.</p><div className="overview-pie-wrap"><div className="overview-pie-chart" role="img" aria-label={`Grade records: ${overviewData.submissions.draft} draft, ${overviewData.submissions.provisional} provisional, ${overviewData.submissions.final} final`} style={{background:pieGradient([overviewData.submissions.draft,overviewData.submissions.provisional,overviewData.submissions.final],["#3782f6","#12b981","#f04448"])}}/></div><div className="overview-chart-legend"><span><i className="legend-submitted"/>Draft <b>{overviewData.submissions.draft}</b></span><span><i className="legend-graded"/>Provisional <b>{overviewData.submissions.provisional}</b></span><span><i className="legend-retake"/>Final <b>{overviewData.submissions.final}</b></span></div></article>
  <article className="surface overview-chart-card overview-enrollment-card"><h3>Enrollment by class</h3><p>Largest class rosters in the selected academic period.</p>{overviewData.enrollment.length ? <div className="overview-enrollment-list" aria-label="Student enrollment by class">{[...overviewData.enrollment].sort((a,b)=>b.count-a.count).slice(0,6).map(item=>{const highest=Math.max(1,...overviewData.enrollment.map(row=>row.count));return <div className="overview-enrollment-item" key={item.id} title={`${item.label} · ${item.code} — ${item.title}: ${item.count} students`}><div><strong>{item.label} · {item.code}</strong><small>{item.count} students</small></div><span className="overview-enrollment-track"><i style={{width:`${item.count/highest*100}%`}}/></span></div>})}</div> : <div className="overview-chart-empty">Add students to your class rosters to see enrollment.</div>}</article>
</div>
<div className="overview-section-heading upcoming-heading"><div><span className="eyebrow">COMING UP</span><h2>What needs your attention next</h2></div><span>Scheduled from today onward</span></div>
<div className="overview-upcoming-grid">
  <article className={`surface overview-upcoming-card${overviewData.upcoming.attendance.length || overviewData.todayClasses.some(item=>item.canRecordAttendance) ? "" : " overview-upcoming-card-complete"}`}>
    <h3>Upcoming attendance</h3><p>Scheduled meetings, attendance type, and recording progress.</p>
    <div className="today-attendance-shortcuts"><div className="today-attendance-heading"><b>Classes scheduled today</b><small>{overviewData.todayClasses.length ? new Date(`${overviewData.today}T00:00:00`).toLocaleDateString(undefined,{weekday:"long",month:"short",day:"numeric"}) : "Quick access for today’s class meetings"}</small></div>
      {overviewData.todayClasses.some(item=>item.canRecordAttendance) ? <div className="today-attendance-list">{overviewData.todayClasses.filter(item=>item.canRecordAttendance).map(item=><button type="button" className="today-attendance-button" key={item.id} onClick={()=>openClass(item.id, "attendance", { attendanceToday: true })}><span><b>{item.classId || item.code} · {item.title}</b><small>{item.schedule.join(" · ")}</small></span><strong>Record attendance <span aria-hidden="true">→</span></strong></button>)}</div> : overviewData.todayClasses.length ? <div className="today-attendance-empty">{overviewData.completedTodayCount === overviewData.todayClasses.length ? "✓ Today's attendance is already recorded." : "No outstanding attendance entries for today's editable classes."}</div> : <div className="today-attendance-empty">No classes match a saved schedule for today.</div>}
    </div>
    {overviewData.upcoming.attendance.length ? <ul className="overview-work-list">{overviewData.upcoming.attendance.map(item=><li key={item.id}><button type="button" className="overview-work-item attendance" onClick={()=>openClass(item.subjectId, "attendance")}><span className="overview-work-copy"><b>{item.title}</b><small>{item.code} · {item.subjectTitle}</small><span className="overview-work-meta"><i>{item.attendanceType==="ONLINE"?"Online":item.attendanceType==="FACE_TO_FACE"?"Face-to-Face":"Type not set"}</i>{item.scheduleOverrideReason&&<i className="makeup">Make-up · {item.scheduleOverrideReason}</i>}{(()=>{const marked=item.markedCount||0;const total=item.studentCount||0;const complete=total>0&&marked>=total;return <i className={marked===0?"status pending":complete?"status complete":"status progress"}>{marked===0?"Not recorded":complete?"Recorded":`${marked}/${total} marked`}</i>})()}</span></span><time>{formatOverviewDate(item.date)}</time></button></li>)}</ul> : <div className="overview-upcoming-compact">No pending attendance. Completed sessions remain available under My Classes → Attendance.</div>}
  </article>
  <article className={`surface overview-upcoming-card${overviewData.upcoming.assessments.length ? "" : " overview-upcoming-card-complete"}`}><h3>Upcoming assessments</h3><p>Dated activities and tests in your classes.</p>{overviewData.upcoming.assessments.length ? <ul className="overview-work-list">{overviewData.upcoming.assessments.map(item=><li key={item.id}><button type="button" className="overview-work-item" onClick={()=>openClass(item.subjectId, "items")}><span className="overview-work-copy"><b>{item.title}</b><small>{item.code} · {item.subjectTitle}</small></span><time>{formatOverviewDate(item.date)}</time></button></li>)}</ul> : <div className="overview-upcoming-compact">No assessments scheduled from today onward.</div>}</article>
</div>
{overviewLoading && <div className="overview-refresh-note" role="status">Updating report…</div>}
</>}
<div className="overview-recent-wrap"><RecentActivitySubmissions onOpen={(subjectId, activityId) => {
  setRecentActivity({ subjectId, activityId });
  openClass(subjectId, "activities");
}}/></div>
</>}
      {tab === "classes" && <>
        {!activeId ? <>
          <section className="class-directory">
            <div className="class-directory-hero">
              <div><span className="eyebrow">ACADEMIC WORKSPACE</span><h2>My classes</h2><p>Classes are listed according to the active academic period selected on Overview.</p><div className="class-active-period-pill"><span>ACTIVE PERIOD</span><strong>{activeTerm}</strong><i>{academicYear}</i></div></div>
              <div className="class-directory-hero-actions"><button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>＋ Create a class</button><button type="button" className="btn btn-outline-primary grade-visibility-launch" disabled={!subjects.length} onClick={() => setVisibilityManagerQuery("")}><span>Grade visibility</span><small>{visibleClassCount} / {subjects.length} visible</small></button></div>
            </div>
            <div className="class-directory-stats">
              <article className="class-directory-stat"><span className="class-directory-stat-icon blue" aria-hidden="true">▤</span><div><small>CLASSES THIS PERIOD</small><strong>{classDirectoryStats.classes}</strong><span>{activeTerm} · {academicYear}</span></div></article>
              <article className="class-directory-stat"><span className="class-directory-stat-icon violet" aria-hidden="true">♙</span><div><small>ENROLLMENT RECORDS</small><strong>{classDirectoryStats.enrollments.toLocaleString()}</strong><span>Across active classes</span></div></article>
              <article className="class-directory-stat"><span className="class-directory-stat-icon green" aria-hidden="true">✓</span><div><small>VISIBLE TO STUDENTS</small><strong>{classDirectoryStats.visible}</strong><span>Classes with shared grades</span></div></article>
              <article className="class-directory-stat"><span className="class-directory-stat-icon amber" aria-hidden="true">◷</span><div><small>NEEDS REVIEW</small><strong>{classDirectoryStats.needsReview}</strong><span>Draft or submitted records</span></div></article>
            </div>
            <section className="class-directory-filters surface" aria-label="Search active-period classes">
              <label className="class-directory-search"><span>Find a class</span><input className="form-control" type="search" value={classDirectoryQuery} onChange={event => setClassDirectoryQuery(event.target.value)} placeholder="Search class ID, course code, title, or year level" autoComplete="off"/></label>
              <div className="class-directory-filter-foot"><span>{classDirectorySubjects.length} {classDirectorySubjects.length === 1 ? "class" : "classes"} in {activeTerm} · {academicYear}</span>{classDirectoryQuery && <button type="button" className="btn btn-link btn-sm" onClick={() => setClassDirectoryQuery("")}>Clear search</button>}</div>
            </section>
            {loading ? <div className="class-directory-loading" role="status"><span className="spinner-border spinner-border-sm" aria-hidden="true"/> Loading your classes…</div> : classDirectorySubjects.length ? <>
              <div className="class-directory-grid">
                {pageSubjects.map((subject, index) => <button type="button" key={subject.id} className="class-directory-card" aria-label={"Open " + subject.code + ": " + subject.title} onClick={() => openClass(subject.id)}>
                  <span className={"class-directory-card-band band-" + (((subjectPage - 1) * subjectsPerPage + index) % 4)}>
                    <span className="class-directory-card-band-top"><b>{subject.classId || subject.code}</b><i className={subject.isPublished ? "visible" : ""}>{subject.isPublished ? "Student-visible" : "Hidden"}</i></span>
                    <span className="class-directory-card-watermark">{String((subjectPage - 1) * subjectsPerPage + index + 1).padStart(2, "0")}</span>
                    <span className="class-directory-card-code">{subject.code}</span>
                  </span>
                  <span className="class-directory-card-body">
                    <span className="class-directory-card-title">{subject.title}</span>
                    <span className="class-directory-card-meta">{subject.courseYear || "Class"} <i>·</i> {subject.term} <i>·</i> {subject.academicYear}</span>
                    <span className="class-directory-card-bottom"><span><b>{subject._count?.enrollments ?? 0}</b> enrolled</span><i className={"class-directory-grade-pill " + (subject.gradeStatus === "VERIFIED" ? "final" : subject.gradeStatus === "SUBMITTED" ? "submitted" : "draft")}>{subject.gradeStatus === "VERIFIED" ? "Verified" : subject.gradeStatus === "SUBMITTED" ? "Submitted" : "Draft"}</i></span>
                    <span className="class-directory-card-schedule">{formatSchedule(subject.schedule) || "Schedule not set"}</span>
                  </span>
                  <span className="class-directory-card-open">Open workspace <b aria-hidden="true">→</b></span>
                </button>)}
              </div>
              {classDirectorySubjects.length > subjectsPerPage && <div className="class-directory-pagination"><span>Showing {(subjectPage - 1) * subjectsPerPage + 1}–{Math.min(subjectPage * subjectsPerPage, classDirectorySubjects.length)} of {classDirectorySubjects.length} classes</span><div><button type="button" className="btn btn-outline-secondary btn-sm" disabled={subjectPage <= 1} onClick={() => setSubjectPage(page => page - 1)}>Previous</button><small>Page {subjectPage} of {subjectPageCount}</small><button type="button" className="btn btn-outline-secondary btn-sm" disabled={subjectPage >= subjectPageCount} onClick={() => setSubjectPage(page => page + 1)}>Next</button></div></div>}
            </> : <div className="class-directory-empty surface"><span aria-hidden="true">▤</span><h3>{subjects.length ? "No classes match your search" : "No classes for this period"}</h3><p>{subjects.length ? "Try another course code or clear your search." : "There are no assigned classes for " + activeTerm + " of " + academicYear + ". Choose a different academic period on Overview to view another term or year."}</p>{subjects.length ? <button type="button" className="btn btn-outline-primary btn-sm" onClick={() => setClassDirectoryQuery("")}>Clear search</button> : <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreateOpen(true)}>＋ Create a class</button>}</div>}
          </section>
        </> : <>
          <div className="class-workspace-toolbar-top"><button type="button" className="btn btn-link btn-sm" onClick={() => navigatePage("classes")}>← All classes</button><span>Active period · {activeTerm} · {academicYear}</span></div>
          <div className="class-toolbar">
            <div className="class-active-period-context"><small>ACTIVE ACADEMIC PERIOD</small><strong>{activeTerm} · {academicYear}</strong></div>
            <label className="class-student-filter"><span>Find student in this class</span><input className="form-control" type="search" value={detail?.enrollments.find(item => item.id === classStudentFilter)?.studentName ?? classStudentFilter} onChange={event=>setClassStudentFilter(event.target.value)} placeholder="Name or student ID" autoComplete="off"/></label>
            <div className="class-select-wrap"><label className="form-label" htmlFor="my-classes-select">Switch class</label><select id="my-classes-select" className="form-select" value={activeId} disabled={!visibleSubjects.length} onChange={e => { if (e.target.value) openClass(e.target.value, "setup", {}, true); }}><option value="">Choose a class…</option>{pageClassOptions.map(s => <option key={s.id} value={s.id}>{s.classId ? (s.classId + " · ") : ""}{s.code} — {s.title}</option>)}</select>{classPageCount > 1 && <div className="class-select-pages"><button type="button" className="btn btn-link btn-sm" disabled={classPage <= 1} onClick={() => setClassPage(page => page - 1)}>Previous</button><small>Page {classPage} of {classPageCount}</small><button type="button" className="btn btn-link btn-sm" disabled={classPage >= classPageCount} onClick={() => setClassPage(page => page + 1)}>Next</button></div>}</div>
            <div className="toolbar-actions"><button type="button" className="btn btn-outline-primary grade-visibility-launch" disabled={!subjects.length} onClick={() => setVisibilityManagerQuery("")}><span>Manage grade visibility</span><small>{visibleClassCount} / {subjects.length} shown</small></button><button className="btn btn-outline-primary" onClick={exportRoster} disabled={!detail}>↓ Export roster (Excel)</button><button className="btn btn-outline-primary" onClick={() => setRosterOpen(true)} disabled={!detail}>＋ Add students</button></div>
          </div>
          {detail === null && loadingDetail && <div className="class-workspace-loading" role="status"><span className="spinner-border spinner-border-sm" aria-hidden="true"/> Loading class workspace…</div>}
        </>}
        {detail && <>
          <section className="surface class-summary"><div><span className="eyebrow">{detail.courseYear || "CLASS RECORD"} · {detail.term} {detail.academicYear}</span><h2>{detail.code}: {detail.title}</h2><p className="muted mb-0">Class ID: <b>{detail.classId || "Not set"}</b> · {formatSchedule(detail.schedule) || "Schedule not set"} · {detail.enrollments.length} rostered students</p></div><div className="class-final-actions"><button type="button" className="btn btn-outline-primary grade-visibility-current" onClick={() => setVisibilityManagerQuery(detail.classId || detail.code)}>{detail.isPublished ? "Visible to students" : "Hidden from students"} · Manage</button><span className={`grade-status-pill ${detail.gradeStatus === "VERIFIED" ? "final" : detail.gradeStatus === "SUBMITTED" ? "provisional" : "draft"}`}>{detail.gradeStatus === "VERIFIED" ? "Verified to Registrar · Final" : detail.gradeStatus === "SUBMITTED" ? "Awaiting teacher confirmation to Registrar" : "Draft · Not submitted"}</span><button className="btn btn-outline-primary" onClick={()=>openClassSection("final")}>Final grades</button><button className="btn btn-outline-primary" onClick={openSubjectEditor} disabled={detail.gradeStatus!=="DRAFT"}>Edit class</button><button className="btn btn-outline-danger" onClick={deleteSubject} disabled={busy||detail.gradeStatus!=="DRAFT"}>Delete class</button></div></section>
          <nav className="class-section-tabs" aria-label="Class workspace">
            <button className={classSection === "setup" ? "active" : ""} onClick={() => openClassSection("setup")}>Grading setup</button><button className={classSection === "roster" ? "active" : ""} onClick={() => openClassSection("roster")}>Class roster</button><button className={classSection === "items" ? "active" : ""} onClick={() => openClassSection("items")}>Assessment items</button><button className={classSection === "record" ? "active" : ""} onClick={() => openClassSection("record")}>Record scores</button>
            <button className={classSection === "activities" ? "active" : ""} onClick={() => { setRecentActivity(null); openClassSection("activities"); }}>Activities</button><button className={classSection === "announcements" ? "active" : ""} onClick={() => openClassSection("announcements")}>Announcements</button>
            <button className={classSection === "attendance" ? "active" : ""} onClick={() => openClassSection("attendance")}>Attendance</button>
            <button className={classSection === "analytics" ? "active" : ""} onClick={() => openClassSection("analytics")}>Class analytics</button>
            <button className={classSection === "final" ? "active" : ""} onClick={() => openClassSection("final")}>Final grades &amp; submit</button>
          </nav>
          {classSection === "activities" && <TeacherActivities
            key={detail.id + (recentActivity?.subjectId === detail.id ? recentActivity.activityId : "")}
            subjectId={detail.id}
            categories={leafCategories(detail.categories).map(category => ({ id: category.id, label: categoryPath(category, detail.categories) }))}
            locked={detail.gradeStatus !== "DRAFT"}
            readOnly={user.isDemo}
            initialActivityId={recentActivity?.subjectId === detail.id ? recentActivity.activityId : undefined}
            onRecordChange={() => loadDetail(detail.id)}
          />}
          {classSection === "announcements" && <TeacherClassAnnouncements key={detail.id} subjectId={detail.id} readOnly={user.isDemo} />}
          {classSection === "setup" && <>
            <section id="class-section-setup" className="surface grading-card">
              <div className="section-heading grading-setup-heading">
                <div><span className="eyebrow">GRADING PATH</span><h2>Build your grading categories</h2><p className="muted">Choose whether the subject is Lecture only or combines Lecture and Laboratory. Every group’s assessments are weighted within that group.</p></div>
                <div className="grading-actions"><select className="form-select form-select-sm" aria-label="Copy grading setup from class" aria-describedby="copy-setup-help" value={copyFromId} onChange={e=>setCopyFromId(e.target.value)} disabled={detail.assessments.length>0}><option value="">Choose a class to copy grading setup from…</option>{subjects.filter(s=>s.id!==detail.id).map(s=><option key={s.id} value={s.id}>{s.classId ? `${s.classId} · ` : ""}{s.code} — {s.title}</option>)}</select><button className="btn btn-outline-primary btn-sm" onClick={copyGrading} disabled={busy||!copyFromId||detail.assessments.length>0}>Copy setup</button><button className="btn btn-primary btn-sm" onClick={()=>{setCategoryParent("");setCategoryWeight(String(remainingWeight(null)));setCategoryOpen(true);}}>＋ Parent category</button><button className="btn btn-success btn-sm" onClick={saveWeights} disabled={busy}>Save grading path</button><small className="copy-setup-help" id="copy-setup-help">Choose another class from the list, then click Copy setup. This replaces the current categories and grade scale; assessment items and scores are not copied.{detail.assessments.length>0 ? " Copy setup is disabled because this class already has assessment items. Use a grading template to safely remap recognized items while preserving scores." : " Copying is available before assessment items are added."}</small></div>
              </div>
              <div className="grading-template-picker"><label className="grading-type-select"><b>Class grading setup</b><select className="form-select" value={gradingSetupType} onChange={e=>setGradingSetupType(e.target.value as "SINGLE" | "COMBINED")}><option value="SINGLE">Lecture or Laboratory</option><option value="COMBINED">Lecture and Laboratory</option></select><small>Choose one structure for this class.</small></label>{gradingSetupType==="SINGLE"?<div className="grading-split-inputs single-group-select"><label>100% group<select className="form-select form-select-sm" value={singleGroupType} onChange={e=>setSingleGroupType(e.target.value as "LECTURE" | "LABORATORY")}><option value="LECTURE">Lecture</option><option value="LABORATORY">Laboratory</option></select></label><button type="button" className="btn btn-outline-primary btn-sm" onClick={()=>applyGradingTemplate(singleGroupType==="LECTURE"?"LECTURE_ONLY":"LABORATORY_ONLY")} disabled={busy||detail.gradeStatus!=="DRAFT"}>Apply 100% setup</button></div>:<div className="grading-split-inputs"><label>Lecture<input className="form-control form-control-sm" type="number" min="1" max="99" step="0.5" value={lectureCourseWeight} onChange={e=>setLectureCourseWeight(e.target.value)} aria-label="Lecture course weight percentage"/>%</label><label>Laboratory<input className="form-control form-control-sm" type="number" min="1" max="99" step="0.5" value={laboratoryCourseWeight} onChange={e=>setLaboratoryCourseWeight(e.target.value)} aria-label="Laboratory course weight percentage"/>%</label><span className={Math.abs(Number(lectureCourseWeight)+Number(laboratoryCourseWeight)-100)>0.01?"invalid":"valid"}>Total: {(Number(lectureCourseWeight)+Number(laboratoryCourseWeight)).toFixed(2)}%</span><button type="button" className="btn btn-outline-success btn-sm" onClick={()=>applyGradingTemplate("LECTURE_LAB")} disabled={busy||detail.gradeStatus!=="DRAFT"||Math.abs(Number(lectureCourseWeight)+Number(laboratoryCourseWeight)-100)>0.01}>Apply setup</button></div>}</div>
              <div className="grading-howto"><b>Example:</b> Lecture only uses Lecture 100%, with Major Examinations 50%, Self-Evaluation Exercises 25%, Quizzes/Assignments 15%, and Attendance/Class Participation 10%. Major Examinations 50% divides into Prelim 10%, Midterm 15%, and Finals 25% (these allocations total the parent’s 50%). For classes with a Laboratory, set the Lecture and Laboratory shares to a total of 100% (for example, 60% + 40%); each group’s assessments are then divided within its own 100%.</div>
              {categoryOpen && !categoryParent && renderCategoryForm(null)}
              {detail.categories.filter(category=>!category.parentId).length ? <div className="grading-tree">{detail.categories.filter(category=>!category.parentId).map(category=>renderCategoryBranch(category))}</div> : <div className="inline-empty">Choose Lecture only (100%) or Lecture + Laboratory above to create the course groups. Then divide each group into its assessment categories.</div>}
              <div className="weight-group-checks">{weightGroups.map(group=><span key={group.label} className={Math.abs(group.total-group.expected)>0.01?"invalid":"valid"}>{group.label}: <b>{group.total.toFixed(2)}% / {group.expected.toFixed(2)}%</b>{Math.abs(group.total-group.expected)>0.01?" · allocation incomplete":" · complete"}</span>)}</div>
              <div className="grading-next-step"><b>Next:</b> Save the grading path, then open <button type="button" onClick={()=>setClassSection("items")}>Assessment items</button> to add items under the matching category, then enter each perfect score. Score entry uses this path automatically.</div>
            </section>
            <section className="surface grading-card scale-card"><div className="section-heading"><div><h2>Final-grade equivalents</h2><p className="muted">Set this class’s percentage thresholds and grade equivalents to match the school grading scale.</p></div><div className="grading-actions"><button className="btn btn-outline-primary btn-sm" onClick={()=>setDetail({...detail,gradeBands:[...detail.gradeBands,{id:`draft-${Date.now()}-${Math.random()}`,minPercent:0,finalGrade:"",remarks:""}]})}>＋ Add grade equivalent</button><button className="btn btn-primary btn-sm" onClick={saveGradeBands} disabled={busy}>Save grade scale</button></div></div><div className="scale-table"><div className="scale-header"><span>MINIMUM %</span><span>FINAL GRADE</span><span>REMARKS</span></div>{detail.gradeBands.slice().sort((a,b)=>b.minPercent-a.minPercent).map(band=><div className="scale-row" key={band.id}><div className="input-group"><input className="form-control" type="number" min="0" max="100" step="0.01" value={band.minPercent} onChange={e=>setDetail({...detail,gradeBands:detail.gradeBands.map(x=>x.id===band.id?{...x,minPercent:Number(e.target.value)}:x)})}/><span className="input-group-text">%</span></div><input className="form-control" value={band.finalGrade} onChange={e=>setDetail({...detail,gradeBands:detail.gradeBands.map(x=>x.id===band.id?{...x,finalGrade:e.target.value}:x)})}/><input className="form-control" value={band.remarks} onChange={e=>setDetail({...detail,gradeBands:detail.gradeBands.map(x=>x.id===band.id?{...x,remarks:e.target.value}:x)})}/><button type="button" className="btn btn-outline-danger btn-sm" aria-label="Remove grade equivalent" onClick={()=>setDetail({...detail,gradeBands:detail.gradeBands.filter(x=>x.id!==band.id)})}>×</button></div>)}</div><div className="privacy-note text-start mt-3">This scale applies to this class. Adjust the equivalent values to match your school’s grading policy. Exactly one band must start at 0%.</div></section>
          </>}
          {classSection === "roster" && <section id="class-section-roster" className="surface gradebook-card roster-management"><div className="section-heading"><div><span className="eyebrow">CLASS MANAGEMENT</span><h2>Class roster</h2><p className="muted">Update student names and IDs, or remove class records.</p></div><div className="roster-toolbar-actions"><button className="btn btn-outline-primary" onClick={()=>printClass("roster")} disabled={!detail.enrollments.length}>Print roster</button><button className="btn btn-primary" onClick={()=>setRosterOpen(true)}>＋ Add students</button></div></div><ClassRosterEnrollmentTools key={detail.id} subjectId={detail.id} status={detail.gradeStatus} onRosterChanged={async () => { const result = await api("/api/teacher/subjects/" + encodeURIComponent(detail.id)); const updated = result.subject as Detail; setDetail(updated); setSubjects(current => current.map(subject => subject.id === updated.id ? { ...subject, _count: { enrollments: updated.enrollments.length } } : subject)); }}/>{user.isDemo
  ? <DemoGoogleChatControls classCode={detail.code} classTitle={detail.title} rosterCount={detail.enrollments.length}/>
  : <GoogleChatControls subjectId={detail.id}/>}<div className="table-scroll"><table className="table grade-table"><thead><tr><th>#</th><th>STUDENT NAME</th><th>STUDENT ID</th><th>ACTIONS</th></tr></thead><tbody>{pageEnrollments.map((en,index)=><tr key={en.id}><td>{(rosterPage - 1) * rosterPerPage + index + 1}</td><td><b>{en.studentName}</b></td><td>{en.studentNumber||"—"}</td><td><div className="roster-row-actions"><button className="btn btn-outline-primary btn-sm" disabled={busy||detail.gradeStatus==="VERIFIED"} onClick={()=>setRosterEdit({id:en.id,studentName:en.studentName,studentNumber:en.studentNumber||""})}>Edit</button><button className="btn btn-outline-danger btn-sm" disabled={busy||detail.gradeStatus==="VERIFIED"} onClick={()=>deleteRosterStudent(en)}>Remove</button></div></td></tr>)}</tbody></table></div>{rosterPageCount > 1 && <div className="list-pagination"><span>Showing {(rosterPage - 1) * rosterPerPage + 1}–{Math.min(rosterPage * rosterPerPage, filteredEnrollments.length)} of {filteredEnrollments.length} students</span><div><button className="btn btn-outline-secondary btn-sm" disabled={rosterPage <= 1} onClick={() => setRosterPage(page => page - 1)}>Previous</button><span>Page {rosterPage} of {rosterPageCount}</span><button className="btn btn-outline-secondary btn-sm" disabled={rosterPage >= rosterPageCount} onClick={() => setRosterPage(page => page + 1)}>Next</button></div></div>}{detail.enrollments.length === 0 ? <div className="inline-empty">No students are in this class yet. Use Add students to build the roster.</div> : filteredEnrollments.length === 0 ? <div className="inline-empty">No students match this name or ID filter.</div> : null}<div className="privacy-note text-start mt-3">Students are matched to their portal account by student ID. The student account itself is never deleted by roster removal.</div></section>}
          {classSection === "items" && <section className="surface gradebook-card">
            <div className="section-heading"><div><h2>Assessment items</h2><p className="muted">Items are grouped by category. Use the up/down arrows to arrange assessments within each subcategory; Record Scores and its Excel export follow this saved order. Large groups start collapsed so long attendance histories stay quick to scan. Attendance is tracked as Present, Absent, or Excused—not points.</p></div><div className="grading-actions"><button className="btn btn-outline-primary btn-sm" onClick={saveAssessmentItems} disabled={busy||!detail.assessments.length}>Save items</button><button className="btn btn-outline-primary" onClick={()=>void addAttendanceSession()} disabled={busy}>＋ Attendance day</button><button className="btn btn-primary" onClick={() => setAssessmentOpen(true)}>＋ Add assessment</button></div></div>
            {assessmentCategoryOrderRows.length > 0 && <div className="assessment-order-panel border rounded p-3 mb-3">
              <div className="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-2"><div><b>Category order in Record Scores</b><div className="small muted">Move parent categories or subcategories up and down. This order is saved for the class and controls the Record Scores workbook columns.</div></div><span className="small muted">{detail.gradeStatus === "VERIFIED" ? "Finalized class · ordering locked" : "Changes save when an arrow is selected"}</span></div>
              {assessmentCategoryOrderRows.map(item => <div key={item.category.id} className="d-flex align-items-center gap-2 py-1 border-top" style={{paddingLeft: (item.depth * 22) + "px"}}><span className="small muted" style={{minWidth: item.depth === 0 ? "104px" : "104px"}}>{item.depth === 0 ? "Parent category" : "Subcategory"}</span><span className="flex-grow-1">{item.category.name}</span><button type="button" className="btn btn-outline-secondary btn-sm py-0" aria-label={"Move " + item.category.name + " up"} title="Move up" disabled={busy || detail.gradeStatus === "VERIFIED" || item.index === 0} onClick={() => void moveAssessmentCategory(item.category.id,-1)}>↑</button><button type="button" className="btn btn-outline-secondary btn-sm py-0" aria-label={"Move " + item.category.name + " down"} title="Move down" disabled={busy || detail.gradeStatus === "VERIFIED" || item.index === item.count - 1} onClick={() => void moveAssessmentCategory(item.category.id,1)}>↓</button></div>)}
            </div>}
            {detail.assessments.length ? <div className="assessment-category-groups">{assessmentItemGroups.map(({category,items})=>{const expanded=assessmentCategoryOverrides[category.id]??items.length<=12;return <section className="assessment-category-group" key={category.id}>
              <button type="button" className="assessment-category-toggle" aria-expanded={expanded} onClick={()=>setAssessmentCategoryOverrides(current=>({...current,[category.id]:!expanded}))}><span className="assessment-category-name">{categoryPath(category,detail.categories)}</span><span className="assessment-category-count">{items.length} {items.length===1?"item":"items"}</span><span className="assessment-category-action">{expanded?"Hide items":"Show items"}</span></button>
              {expanded&&<div className="assessment-list">{items.map((item,itemIndex)=>{const attendanceItem=item.title.toLocaleLowerCase().startsWith("attendance ·");return <article className="assessment-list-row" key={item.id}>
                <div><input className="form-control" aria-label="Assessment title" value={item.title} onChange={e=>setDetail(current=>current?{...current,assessments:current.assessments.map(value=>value.id===item.id?{...value,title:e.target.value}:value)}:current)} onBlur={saveAssessmentItems}/><label className="item-category-label">Category<select className="form-select form-select-sm item-category-select" value={item.categoryId} onChange={e=>setDetail(current=>current?{...current,assessments:current.assessments.map(value=>value.id===item.id?{...value,categoryId:e.target.value,sortOrder:Math.max(-1,...current.assessments.filter(other=>other.categoryId===e.target.value&&other.id!==item.id).map(other=>other.sortOrder??0))+1}:value)}:current)} onBlur={saveAssessmentItems}>{recordCategories.map(value=><option key={value.id} value={value.id}>{categoryPath(value,detail.categories)}</option>)}</select></label></div>
                {attendanceItem ? <><div className="attendance-day-note"><b>Class day · not point-based</b><small>{item.scheduleOverrideReason ? `Schedule override: ${item.scheduleOverrideReason}` : "Matches the saved class schedule"}</small></div><label>Date<input className="form-control" aria-label="Attendance class date" type="date" value={item.dueDate?.slice(0,10) ?? ""} onChange={e=>setDetail(current=>current?{...current,assessments:current.assessments.map(value=>value.id===item.id?{...value,dueDate:e.target.value||null}:value)}:current)} onBlur={saveAssessmentItems}/></label><label>Off-schedule reason (if needed)<input className="form-control" aria-label="Attendance schedule override reason" placeholder="e.g. Make-up class" value={item.scheduleOverrideReason ?? ""} onChange={e=>setDetail(current=>current?{...current,assessments:current.assessments.map(value=>value.id===item.id?{...value,scheduleOverrideReason:e.target.value}:value)}:current)} onBlur={saveAssessmentItems}/></label></> : <><label>Perfect score<input className="form-control" aria-label="Maximum points" type="number" min="0.01" step="0.01" value={item.maxScore} onChange={e=>setDetail(current=>current?{...current,assessments:current.assessments.map(value=>value.id===item.id?{...value,maxScore:Number(e.target.value)}:value)}:current)} onBlur={saveAssessmentItems}/></label><label>Item weight (%)<input className="form-control" aria-label="Item weight percentage" type="number" min="0" max="100" step="0.5" placeholder="Auto by points" value={item.weight ?? ""} onChange={e=>setDetail(current=>current?{...current,assessments:current.assessments.map(value=>value.id===item.id?{...value,weight:e.target.value===""?null:Number(e.target.value)}:value)}:current)} onBlur={saveAssessmentItems}/></label><label>Date<input className="form-control" aria-label="Assessment date" type="date" value={item.dueDate?.slice(0,10) ?? ""} onChange={e=>setDetail(current=>current?{...current,assessments:current.assessments.map(value=>value.id===item.id?{...value,dueDate:e.target.value||null}:value)}:current)} onBlur={saveAssessmentItems}/></label></>}
                <div className="d-flex align-items-center gap-1"><button type="button" className="btn btn-outline-secondary btn-sm py-0" aria-label={"Move " + item.title + " up"} title="Move up" disabled={busy || detail.gradeStatus === "VERIFIED" || itemIndex === 0} onClick={()=>void moveAssessmentItem(category.id,item.id,-1)}>↑</button><button type="button" className="btn btn-outline-secondary btn-sm py-0" aria-label={"Move " + item.title + " down"} title="Move down" disabled={busy || detail.gradeStatus === "VERIFIED" || itemIndex === items.length-1} onClick={()=>void moveAssessmentItem(category.id,item.id,1)}>↓</button><button className="btn btn-link btn-sm text-danger" onClick={()=>removeAssessment(item.id)}>Remove</button></div></article>})}</div>}
            </section>})}</div> : <div className="inline-empty">No assessment items yet. Add a Quiz 1, Assignment 1, Lab Exercise 1, or exam.</div>}
          </section>}
          {classSection === "attendance" && <section id="class-section-attendance" className="surface gradebook-card attendance-workspace">
            <div className="section-heading"><div><span className="eyebrow">CLASS MEETINGS</span><h2>Attendance</h2><p className="muted">Attendance is counted by scheduled class day. Present, absent, and excused totals update per student; excused days are excluded from the absence rate.</p></div><button className="btn btn-primary" onClick={()=>void addAttendanceSession()} disabled={busy||detail.gradeStatus==="VERIFIED"}>＋ Add attendance day</button></div>
            {attendanceSaveState !== "idle" && <div className={`small mb-2 ${attendanceSaveState === "error" ? "text-danger" : "text-secondary"}`} role="status" aria-live="polite">
              {attendanceSaveState === "pending" ? "Attendance changes queued…" : attendanceSaveState === "saving" ? "Saving attendance…" : attendanceSaveState === "saved" ? "✓ Attendance saved" : "Attendance changes could not be saved."}
              {attendanceSaveState === "error" && <button type="button" className="btn btn-link btn-sm" onClick={() => { attendanceFailedRef.current = false; void flushAttendanceMarks(); }}>Retry saving</button>}
            </div>}
            <div className="privacy-note text-start mb-3">Scheduled days: {scheduleWeekdays(detail.schedule).map(day=>["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][day]).join(", ") || "No class days set"}. An off-schedule meeting requires a make-up class reason.</div>
            {(()=>{const alerted=filteredEnrollments.map(enrollment=>({enrollment,summary:attendanceSummary(enrollment,detail.assessments)})).filter(item=>item.summary.alertLevel!=="none" || item.summary.droppingWarning);const critical=alerted.filter(item=>item.summary.alertLevel==="critical").length;const early=alerted.filter(item=>item.summary.alertLevel==="early").length;return <section className="attendance-alert-panel" aria-label="Attendance monitoring overview"><div className="attendance-alert-header"><div><span className="attendance-alert-eyebrow">ATTENDANCE OVERVIEW</span><b>Monitoring alerts</b><small>Early warning starts at {EARLY_ABSENCE_PERCENT}% absent. High risk starts at {HIGH_RISK_ABSENCE_PERCENT}%. Excused days are excluded.</small></div><div className="attendance-alert-summary"><span className="attendance-alert-total"><b>{alerted.length}</b><small>{alerted.length===1?"student flagged":"students flagged"}</small></span><span className="attendance-alert-count early"><i></i>{early} early</span><span className="attendance-alert-count critical"><i></i>{critical} high risk</span></div></div>{alerted.length?<div className="attendance-alert-list">{alerted.map(({enrollment,summary})=><article key={enrollment.id} className={`attendance-alert-item ${summary.alertLevel}`}><div className="attendance-alert-person"><b>{enrollment.studentName}</b>{summary.alertLevel !== "none" && <span className={`attendance-alert-badge ${summary.alertLevel}`}>{summary.alertLevel==="critical"?"High risk":"Early warning"}</span>}</div><div className="attendance-alert-detail"><span>{summary.effectiveAbsent} absences of {summary.counted} counted days</span><b>{summary.absencePercent?.toFixed(1)}%</b></div><AbsenceDateList dates={summary.absenceDates}/>{summary.droppingWarning && <DroppingWarning streak={summary.droppingWarning}/>}<div className="attendance-alert-meter" role="presentation"><span style={{width:`${Math.min(100,summary.absencePercent??0)}%`}} /></div></article>)}</div>:<div className="attendance-alert-clear"><span aria-hidden="true">✓</span><div><b>No attendance alerts</b><small>No students in the current roster filter meet an attendance alert threshold.</small></div></div>}</section>})()}{attendanceDays.length ? <div className="table-scroll"><table className="table grade-table ecr-table attendance-table"><thead><tr><th>STUDENT</th><th>SUMMARY</th>{attendanceDays.map(item=><th key={item.id}>{item.dueDate ? new Date(item.dueDate).toLocaleDateString() : item.title}<small>{item.attendanceType === "ONLINE" ? "Online" : item.attendanceType === "FACE_TO_FACE" ? "Face-to-Face" : "Type not set"} · {item.scheduleOverrideReason ? `Make-up class: ${item.scheduleOverrideReason}` : "Scheduled class day"}</small></th>)}</tr></thead><tbody>{filteredEnrollments.map(enrollment=>{const summary=attendanceSummary(enrollment,detail.assessments);return <tr key={enrollment.id}><td><b>{enrollment.studentName}</b></td><td className="attendance-summary"><b>Attendance · {summary.percent===null?"—":summary.percent.toFixed(1)+"%"}</b><small>P {summary.present} · A {summary.effectiveAbsent} · L {summary.late - summary.lateAbsences} · E {summary.excused}</small>{summary.lateAbsences > 0 && <small>{summary.lateAbsences} equivalent absence(s) from late marks</small>}{summary.atRisk&&<span className="absence-risk-badge">DANGER OF FAILING · {summary.absencePercent?.toFixed(1)}% ABSENT</span>}</td>{attendanceDays.map(item=>{const score=scoresByEnrollment.get(enrollment.id)?.get(item.id);const converted=summary.converted.has(item.id);const value=score?.remark==="LATE"?(converted?"LATE_AS_ABSENT":"LATE"):score?.remark==="EXCUSED"?"EXCUSED":score?.remark==="ABSENT"?"ABSENT":score?.remark==="PRESENT"||score?.points!=null?"PRESENT":"";return <td key={item.id}><select className="form-select form-select-sm attendance-mark" aria-label={`${enrollment.studentName} ${item.title}`} value={value} onChange={event=>saveAttendanceMark(enrollment.id,item.id,(event.target.value||null) as AttendanceMark["remark"])} disabled={detail.gradeStatus==="VERIFIED"}><option value="">Not marked</option><option value="PRESENT">Present</option>{converted && <option value="LATE_AS_ABSENT" disabled>{CONVERTED_LATE_LABEL}</option>}<option value="LATE">Late</option><option value="ABSENT">Absent</option><option value="EXCUSED">Excused</option></select>{converted && <small className="d-block text-danger">Three consecutive lates</small>}</td>})}</tr>})}</tbody></table></div> : <div className="inline-empty">No attendance sessions yet. Add a day that matches this class schedule to start recording attendance.</div>}
            <div className="scorebook-legend"><span><b>Danger indicator</b> appears when absences exceed 20% of non-excused class days.</span><span>Every third consecutive Late is counted as Absent.</span><span>To change a class schedule, edit the subject details before recording sessions.</span></div>
          </section>}
          {classSection === "record" && <section id="class-section-record" className="surface gradebook-card scorebook-section" ref={scorebookRegionRef}><div className="section-heading"><div><span className="eyebrow">ELECTRONIC CLASS RECORD</span><h2>Record scores</h2><p className="muted">Enter scores by student and assessment. Each category includes an Equivalent (%) column showing the earned share of its parent Lecture or Laboratory allocation (for example, 93% × 25% = 23.25%). The final course grade also applies the top-level Lecture/Laboratory weights. Changes save when you leave a field. Pending work is not treated as zero.</p></div><div className="scorebook-toolbar"><span className="gradebook-count">{filteredEnrollments.length} of {detail.enrollments.length} students · {detail.assessments.length} items</span><label className="scorebook-contribution-toggle"><input type="checkbox" className="form-check-input" checked={showWeightBreakdown} onChange={event=>setShowWeightBreakdown(event.target.checked)} />Detailed breakdown row</label><button className="btn btn-outline-primary btn-sm" onClick={()=>downloadScoreCsv(true)} disabled={!scorebookAssessments.length}>Download template</button><button className="btn btn-outline-primary btn-sm" onClick={()=>{setBulkScoresOpen(true);setBulkErrors([]);setBulkRowsPreview([]);setBulkOperations([])}} disabled={!scorebookAssessments.length||detail.gradeStatus==="VERIFIED"}>Import scores</button><button className="btn btn-outline-primary btn-sm" onClick={exportRecordScoresExcel} disabled={!scorebookAssessments.length}>Export Excel</button><button className="btn btn-outline-secondary btn-sm" onClick={()=>downloadScoreCsv(false)} disabled={!scorebookAssessments.length}>Export CSV</button></div></div>
            {workbookSaveState !== "idle" && <div className={`small mb-2 ${workbookSaveState === "error" ? "text-danger" : "text-secondary"}`} role="status" aria-live="polite">
              {workbookSaveState === "queued" ? "Workbook changes queued…" : workbookSaveState === "saving" ? "Saving workbook…" : workbookSaveState === "saved" ? "✓ Workbook saved" : "Workbook not saved."}
              {workbookSaveState === "error" && <button type="button" className="btn btn-link btn-sm" onClick={() => { workbookFailedRef.current = false; void flushWorkbookScores(); }}>Retry saving</button>}
            </div>}
            {(err||notice)&&<div className="portal-toast-stack" aria-live="polite" aria-atomic="false">{err&&<div className="portal-toast error" role="alert"><div><b>Needs attention</b><p>{err}</p>{notificationTarget(err)&&<button className="toast-location" onClick={goToNotificationTarget}>Check {notificationTarget(err)?.label} ↗</button>}</div><button className="toast-dismiss" aria-label="Dismiss error" onClick={()=>setErr("")}>×</button></div>}{notice&&<div className="portal-toast success" role="status"><div><b>Saved</b><p>{notice}</p></div><button className="toast-dismiss" aria-label="Dismiss notification" onClick={()=>setNotice("")}>×</button></div>}</div>}
            {scorebookAssessments.length > 0 && <div className="scorebook-fitbar" aria-label="Workbook column layout controls">
              <div className="scorebook-fitbar-summary">
                <b>{scorebookView === "auto" ? "Auto-fit workbook" : "Full workbook"}</b>
                <small>{scorebookView === "auto"
                  ? `Showing ${scorebookVisibleAssessments.length} of ${scorebookAssessments.length} assessments · all students and final grades stay visible`
                  : `All ${scorebookAssessments.length} assessments · scroll inside the workbook for additional columns`}</small>
              </div>
              <div className="scorebook-fitbar-tools">
                <label className="scorebook-fit-selector">Layout
                  <select className="form-select form-select-sm" value={scorebookView} aria-label="Workbook column layout"
                    onChange={event => { setScorebookView(event.target.value as "auto" | "all"); setScorebookPage(0); }}>
                    <option value="auto">Auto-fit (recommended)</option>
                    <option value="all">Show all (scroll)</option>
                  </select>
                </label>
                {scorebookView === "auto" && scorebookPages.length > 1 && <div className="scorebook-fit-pages" aria-label="Assessment category navigation">
                  <button type="button" className="btn btn-outline-secondary btn-sm" aria-label="Previous assessment columns"
                    disabled={currentScorebookPage === 0} onClick={() => setScorebookPage(Math.max(0, currentScorebookPage - 1))}>‹</button>
                  <select className="form-select form-select-sm" aria-label="Assessment column group"
                    value={currentScorebookPage} onChange={event => setScorebookPage(Number(event.target.value))}>
                    {scorebookPages.map((page, index) => <option value={index} key={index}>{index + 1}/{scorebookPages.length} · {page.label}</option>)}
                  </select>
                  <button type="button" className="btn btn-outline-secondary btn-sm" aria-label="Next assessment columns"
                    disabled={currentScorebookPage >= scorebookPages.length - 1} onClick={() => setScorebookPage(Math.min(scorebookPages.length - 1, currentScorebookPage + 1))}>›</button>
                </div>}
              </div>
            </div>}
            {scorebookAssessments.length === 0 && <div className="inline-empty">The full class roster is shown below. Add assessment items to enable score entry.</div>}
            {filteredEnrollments.length > 0 && <div id="score-sheet-scroll-viewport" ref={scorebookScrollRef} aria-label="Full class record workbook" onScroll={event => { const floating = scorebookFloatingScrollRef.current; if (floating) syncHorizontalScrollProgress(event.currentTarget, floating); }} className={`score-sheet-wrap ${scorebookView === "all" ? "score-sheet-wrap-full" : "score-sheet-wrap-auto"}`}><table className="score-sheet" style={{minWidth: scorebookView === "all" ? `${scorebookTableMinWidth}px` : undefined}}><colgroup>
  <col style={{width: `${scorebookColumnWidths.student}px`}} />
  <col style={{width: `${scorebookColumnWidths.attendance}px`}} />
  {scorebookDisplayColumns.map((column,i) => <col
    key={`${column.category.id}-${column.kind}-${column.kind === "assessment" ? column.item.id : i}`}
    style={{width: `${column.kind === "assessment" ? scorebookColumnWidths.assessment :
      scorebookColumnWidths.equivalent}px`}} />)}
  <col style={{width: `${scorebookColumnWidths.total}px`}} />
  <col style={{width: `${scorebookColumnWidths.final}px`}} />
  <col style={{width: `${scorebookColumnWidths.remark}px`}} /></colgroup><thead>
  <tr>
    <th className="score-sheet-student" rowSpan={scorebookHeaderRows.rowSpan}>STUDENT</th>
    <th className="score-sheet-summary-head score-sheet-attendance-summary" rowSpan={scorebookHeaderRows.rowSpan}>ATTENDANCE %<small>Present / P + A</small></th>
    {scorebookHeaderRows.rows[0]?.map(({category,colSpan,rowSpan})=><th className="score-sheet-category score-sheet-parent" key={category.id} colSpan={colSpan} rowSpan={rowSpan}><span title={category.name}>{scoreSheetCategoryLabel(category.name)}</span><small>{categoryWeightLabel(category,detail.categories)}</small></th>)}
    <th className="score-sheet-summary-head score-sheet-course-total" rowSpan={scorebookHeaderRows.rowSpan}>TOTAL GRADE<small>100%</small></th>
    <th className="score-sheet-summary-head score-sheet-final-grade" rowSpan={scorebookHeaderRows.rowSpan}>FINAL GRADE</th>
    <th className="score-sheet-summary-head" rowSpan={scorebookHeaderRows.rowSpan}>CLASS REMARK</th>
  </tr>
  {scorebookHeaderRows.rows.slice(1).map((row,index)=><tr key={`category-level-${index+1}`}>{row.map(({category,colSpan,rowSpan})=><th className="score-sheet-subcategory" key={category.id} colSpan={colSpan} rowSpan={rowSpan}><span title={category.name}>{scoreSheetCategoryLabel(category.name)}</span><small>{categoryWeightLabel(category,detail.categories)}</small></th>)}</tr>)}
  <tr>{scorebookDisplayColumns.map(column => column.kind === "assessment"
    ? <th className="score-sheet-assessment" key={column.item.id} title={`${column.item.title} · Perfect score ${column.item.maxScore}${column.item.dueDate ? " · " + new Date(column.item.dueDate).toLocaleDateString() : ""}`}><span>{column.item.title}</span><small>Max {column.item.maxScore}</small></th>
    : <th className="score-sheet-category-subtotal score-sheet-equiv-head" key={`${column.category.id}-equivalent`} title={`${column.category.name} · Weighted equivalent: ${categoryWeightLabel(column.category,detail.categories)} maximum`}>
        Equivalent<small>{column.category.weight.toFixed(2)}% max</small>
      </th>
  )}</tr>
</thead><tbody>{filteredEnrollments.map((enrollment,index)=>{
              const band=detail.gradeBands.slice().sort((a,b)=>b.minPercent-a.minPercent).find(item=>enrollment.finalPercent!==null&&enrollment.finalPercent>=item.minPercent);
              const hasSpecialRemark = ["INC", "NP", "DROPPED"].includes(enrollment.remarks || "");
              const attendance = attendanceStatsByEnrollment.get(enrollment.id)!;
              const courseWeights = recordContributionsByEnrollment.get(enrollment.id)!;
              return <Fragment key={enrollment.id}><tr><td className="score-sheet-student"><div><b>{index+1}. {enrollment.studentName}</b></div></td><td className="score-sheet-attendance-summary" title={`Present ${attendance.present} · Absent ${attendance.absent} · Excused ${attendance.excused}`}>{attendance.percent===null?"—":`${attendance.percent.toFixed(2)}%`}</td>{scorebookDisplayColumns.map(column=>{if(column.kind !== "assessment"){ const contribution=courseWeights.get(column.category.id);return <td className="score-sheet-category-equivalent" key={`${column.category.id}-equivalent`} title={hasSpecialRemark || contribution?.earnedWithinRoot == null ? "No weighted equivalent available" : `${contribution.percent?.toFixed(2)}% raw equivalent × ${contribution.withinRootWeight.toFixed(2)}% within ${rootCategory(column.category, detail.categories).name} = ${contribution.earnedWithinRoot.toFixed(2)}%`}>{hasSpecialRemark || contribution?.earnedWithinRoot == null ? "—" : `${contribution.earnedWithinRoot.toFixed(2)}%`}</td>; } const item=column.item; const score=scoresByEnrollment.get(enrollment.id)?.get(item.id);return <td className="score-sheet-score" key={item.id}><div className="score-sheet-entry"><input key={`${item.id}-${enrollment.id}-${score?.points??""}`} className="score-sheet-input" aria-label={`${enrollment.studentName} — ${item.title} score`} type="number" min="0" max={item.maxScore} step="0.01" defaultValue={score?.points??""} disabled={detail.gradeStatus==="VERIFIED"} onBlur={event=>{if(String(score?.points??"")!==event.target.value)saveScore(enrollment.id,item.id,event.target.value,score?.remark??null)}}/><select className="score-sheet-status" aria-label={`${enrollment.studentName} — ${item.title} status`} title={`${enrollment.studentName}: ${item.title} status`} value={score?.remark??""} onChange={event=>saveScore(enrollment.id,item.id,score?.points==null?"":String(score.points),event.target.value||null)} disabled={busy||detail.gradeStatus==="VERIFIED"}><option value="">—</option><option value="EXCUSED">EX</option><option value="ABSENT">AB</option><option value="DID_NOT_SUBMIT">DNS</option></select></div></td>})}<td className="score-sheet-total">{enrollment.finalPercent===null?"—":`${enrollment.finalPercent.toFixed(2)}%`}</td><td className="score-sheet-total">{hasSpecialRemark?enrollment.remarks:enrollment.finalGradeOverride||band?.finalGrade||"—"}</td><td className="score-sheet-remark"><select className="score-sheet-remark-select" aria-label={`${enrollment.studentName} class remark`} title="Automatically follows the final-grade scale unless a special remark is selected" value={hasSpecialRemark?enrollment.remarks||"": "__AUTO__"} onChange={event=>saveRemark(enrollment.id,event.target.value==="__AUTO__"?"":event.target.value)} disabled={busy||detail.gradeStatus==="VERIFIED"}><option value="__AUTO__">{band?.remarks||"Not yet graded"}</option><option value="INC">INC</option><option value="NP">NP</option><option value="DROPPED">DROPPED</option></select></td></tr>{showWeightBreakdown && <tr className="score-sheet-breakdown-row"><td colSpan={scorebookDisplayColumns.length+5}><GradeContributionPanel categories={detail.categories} assessments={detail.assessments} scores={enrollment.scores} remark={enrollment.remarks} /></td></tr>}</Fragment>})}</tbody></table></div>}
            {scorebookFloatingScroll.visible && scorebookView === "all" && typeof document !== "undefined" && createPortal(<div
              ref={scorebookFloatingScrollRef}
              className="score-sheet-floating-scroll"
              data-bs-theme={theme}
              style={{ left: `${scorebookFloatingScroll.left}px`, width: `${scorebookFloatingScroll.width}px` }}
              role="region"
              aria-label="Floating horizontal scrollbar for the full workbook"
              aria-controls="score-sheet-scroll-viewport"
              tabIndex={0}
              onScroll={event => { const sheet = scorebookScrollRef.current; if (sheet) syncHorizontalScrollProgress(event.currentTarget, sheet); }}
            ><div className="score-sheet-floating-scroll-track" aria-hidden="true" style={{ width: `${scorebookFloatingScroll.scrollWidth}px` }}/></div>, document.body)}
            {detail.enrollments.length > 0 && <div className="mobile-scorebook">{filteredEnrollments.map((enrollment,index)=>{const band=detail.gradeBands.slice().sort((a,b)=>b.minPercent-a.minPercent).find(item=>enrollment.finalPercent!==null&&enrollment.finalPercent>=item.minPercent);const special=["INC","NP","DROPPED"].includes(enrollment.remarks||"");const attendance=attendanceStatsByEnrollment.get(enrollment.id)!;return <article className="mobile-score-student" key={enrollment.id}><header><div><b>{index+1}. {enrollment.studentName}</b></div><strong>{enrollment.finalPercent===null?"—":`${enrollment.finalPercent.toFixed(2)}%`}</strong></header><div className="mobile-score-summary"><span>Attendance <b>{attendance.percent===null?"—":`${attendance.percent.toFixed(1)}%`}</b></span><span>Final grade <b>{special?enrollment.remarks:enrollment.finalGradeOverride||band?.finalGrade||"—"}</b></span></div>{showWeightBreakdown && <GradeContributionPanel categories={detail.categories} assessments={detail.assessments} scores={enrollment.scores} remark={enrollment.remarks} />}{scorebookGroups.map(group=><section className="mobile-score-category" key={group.parent.id}><h4>{group.parent.name}</h4>{group.subcategories.map(category=><div className="mobile-score-subcategory" key={category.id}><b>{category.id===group.parent.id?"":categoryPath(category,detail.categories).split(" / ").slice(1).join(" / ")}</b>{group.items.filter(item=>item.categoryId===category.id).map(item=>{const score=scoresByEnrollment.get(enrollment.id)?.get(item.id);return <div className="mobile-score-assessment" key={item.id}><div><b>{item.title}</b><small>Maximum score: {item.maxScore}</small></div><div className="mobile-score-fields"><label>Score<input className="form-control form-control-sm" aria-label={`${enrollment.studentName} — ${item.title} score`} type="number" min="0" max={item.maxScore} step="0.01" defaultValue={score?.points??""} disabled={detail.gradeStatus==="VERIFIED"} onBlur={event=>{if(String(score?.points??"")!==event.target.value)saveScore(enrollment.id,item.id,event.target.value,score?.remark??null)}}/></label><label>Status<select className="form-select form-select-sm" aria-label={`${enrollment.studentName} — ${item.title} status`} value={score?.remark??""} onChange={event=>saveScore(enrollment.id,item.id,score?.points==null?"":String(score.points),event.target.value||null)} disabled={busy||detail.gradeStatus==="VERIFIED"}><option value="">—</option><option value="EXCUSED">Excused</option><option value="ABSENT">Absent</option><option value="DID_NOT_SUBMIT">Did not submit</option></select></label></div></div>})}</div>)}</section>)}<label className="mobile-score-remark">Class remark<select className="form-select form-select-sm" aria-label={`${enrollment.studentName} class remark`} value={special?enrollment.remarks||"":"__AUTO__"} onChange={event=>saveRemark(enrollment.id,event.target.value==="__AUTO__"?"":event.target.value)} disabled={busy||detail.gradeStatus==="VERIFIED"}><option value="__AUTO__">{band?.remarks||"Not yet graded"}</option><option value="INC">INC</option><option value="NP">NP</option><option value="DROPPED">DROPPED</option></select></label></article>})}</div>}
            {detail.enrollments.length === 0 ? <div className="inline-empty">No students are enrolled in this class. Add students from the Class roster tab.</div> : filteredEnrollments.length === 0 ? <div className="inline-empty">No students match this name or ID filter.</div> : null}
            <div className="scorebook-legend"><span><b>Excused</b> removes an item from its category denominator.</span><span><b>Absent / Did not submit</b> records zero raw points (the configured transmutation base still applies to academic assessments).</span><span><b>Blank</b> is pending, not zero. Equivalent columns show weighted percentages within the parent Lecture/Laboratory component; the final grade also applies its course weight.</span><span>Attendance sessions are recorded in the Attendance tab, not as assessment scores.</span></div>
          </section>}
          {classSection === "analytics" && <section className="class-analytics"><div className="surface analytics-heading"><span className="eyebrow">CLASS INSIGHTS</span><h2>{detail.code} performance</h2><p className="muted">{detail.title} · {detail.term} {detail.academicYear}. INC, NP, and DROPPED records are excluded from numeric averages.</p></div><div className="analytics-stat-grid"><article className="surface analytics-stat"><small>CLASS AVERAGE</small><strong>{analytics.average == null ? "—" : analytics.average.toFixed(2)+"%"}</strong><span>{analytics.graded.length} scored students</span></article><article className="surface analytics-stat"><small>PASSING</small><strong>{analytics.passing}</strong><span>75% and above</span></article><article className="surface analytics-stat analytics-warning"><small>AT RISK</small><strong>{analytics.atRisk}</strong><span>60%–74.99%</span></article><article className="surface analytics-stat analytics-danger"><small>BELOW 60%</small><strong>{analytics.failing}</strong><span>Needs follow-up</span></article><article className="surface analytics-stat analytics-danger"><small>ATTENDANCE DANGER OF FAILING</small><strong>{analytics.attendanceDanger}</strong><span>More than 20% absent days</span></article></div><div className="analytics-panels"><section className="surface analytics-panel"><h3>Grade distribution</h3><p className="muted">Current computed course percentages.</p>{analytics.bands.map(band=><div className="distribution-row" key={band.label}><span>{band.label}</span><div className="progress"><div className="progress-bar" style={{width:analytics.graded.length ? (band.count/analytics.graded.length*100)+"%" : "0%"}}/></div><b>{band.count}</b></div>)}</section><section className="surface analytics-panel"><h3>Leading students</h3><p className="muted">Highest computed percentages.</p>{analytics.graded.length ? [...analytics.graded].sort((a,b)=>(b.finalPercent??0)-(a.finalPercent??0)).slice(0,5).map((student,index)=><div className="leader-row" key={student.id}><span>{index+1}</span><b>{student.studentName}</b><strong>{student.finalPercent?.toFixed(2)}%</strong></div>) : <div className="inline-empty">Scores will appear here after they are entered.</div>}</section><section className="surface analytics-panel analytics-risk-list"><h3>Students to review</h3><p className="muted">Students below the 75% passing threshold.</p>{analytics.graded.filter(student=>(student.finalPercent??0)<75).sort((a,b)=>(a.finalPercent??0)-(b.finalPercent??0)).map(student=><div className="leader-row" key={student.id}><span className="risk-dot">!</span><b>{student.studentName}</b><strong>{student.finalPercent?.toFixed(2)}%</strong></div>)}{!analytics.graded.some(student=>(student.finalPercent??0)<75)&&<div className="inline-empty">No scored students are currently below 75%.</div>}</section></div></section>}
          {classSection === "final" && <section id="class-section-final" className="surface final-grades-page"><span className="print-only">{detail.code}: {detail.title} · {detail.term} {detail.academicYear}</span><div className="section-heading"><div><span className="eyebrow">GRADE SUBMISSION</span><h2>Final grades</h2><p className="muted">Review and submit provisional results. After official school-record submission, confirm the Registrar status.</p></div><div className="final-grade-tools"><button className="btn btn-outline-secondary" onClick={()=>{setComponentDraft(gradeSheetComponents.map(item=>({...item})));setComponentEditorOpen(true);}}>Edit Components</button><details className="iso-export-menu generic-export-menu"><summary className="btn btn-outline-primary" onClick={event => { if (!ensureGenericHeaderConfigured()) event.preventDefault(); }}>Export / Save Generic Grading Sheet <span aria-hidden="true">▾</span></summary><div className="iso-export-options" role="group" aria-label="Generic grading sheet export formats"><button type="button" className="iso-export-option" onClick={event => { printFinalGradesPdf("generic"); event.currentTarget.closest("details")?.removeAttribute("open"); }}><span className="iso-export-option-icon pdf" aria-hidden="true">PDF</span><span><strong>Save / Print Generic PDF</strong><small>Print-ready grading sheet</small></span></button><button type="button" className="iso-export-option" onClick={() => { void exportGrades(); }} disabled={gradeExcelExporting !== null} aria-busy={gradeExcelExporting === "generic"}><span className="iso-export-option-icon xlsx" aria-hidden="true">XLSX</span><span><strong>{gradeExcelExporting === "generic" ? <><span className="spinner-border spinner-border-sm me-2" aria-hidden="true"/>Generating Excel file…</> : "Download Generic Excel Sheet"}</strong><small>{gradeExcelExporting === "generic" ? "Building workbook and preparing download" : "Editable spreadsheet"}</small></span></button></div></details><details className="iso-export-menu"><summary className="btn btn-outline-primary" onClick={event => { if (!ensureIsoHeaderConfigured()) event.preventDefault(); }}>Export / Save ISO Grading Sheet <span aria-hidden="true">▾</span></summary><div className="iso-export-options" role="group" aria-label="ISO grading sheet export formats"><button type="button" className="iso-export-option" onClick={event => { printFinalGradesPdf("iso"); event.currentTarget.closest("details")?.removeAttribute("open"); }}><span className="iso-export-option-icon pdf" aria-hidden="true">PDF</span><span><strong>Save / Print ISO PDF</strong><small>Print-ready official record</small></span></button><button type="button" className="iso-export-option" onClick={() => { void exportIsoGradesExcel(); }} disabled={gradeExcelExporting !== null} aria-busy={gradeExcelExporting === "iso"}><span className="iso-export-option-icon xlsx" aria-hidden="true">XLSX</span><span><strong>{gradeExcelExporting === "iso" ? <><span className="spinner-border spinner-border-sm me-2" aria-hidden="true"/>Preparing download…</> : "Download ISO Excel Sheet"}</strong><small>{gradeExcelExporting === "iso" ? "Generating workbook and preparing download" : "Editable spreadsheet"}</small></span></button></div></details>{detail.gradeStatus !== "DRAFT" && <button className="btn btn-outline-danger" onClick={recallSubmittedGrades} disabled={busy}>Recall grades</button>}{detail.gradeStatus === "VERIFIED" && <button className="btn btn-primary" onClick={emailVerifiedGrades} disabled={busy}>✉ Email verified grades</button>}</div></div>{componentEditorOpen && <div className="modal-backdrop-custom" onMouseDown={event=>{if(event.target===event.currentTarget)setComponentEditorOpen(false);}}><div className="modal-card component-editor-modal"><button className="modal-x" onClick={()=>setComponentEditorOpen(false)}>×</button><span className="eyebrow">GRADING SHEET LAYOUT</span><h2>Edit Components</h2><p className="muted">Choose one or more categories or subcategories from this class Grading Setup. Each component summarizes that category’s Assessment items; its weight is read from Grading Setup and is display-only. These selections never change computed grades.</p>{componentDraft.map((item,index)=><div className="row g-2 align-items-center mb-2" key={item.name}><div className="col"><label className="form-label">Component {index+1}</label><input className="form-control" value={item.name} readOnly/></div><div className="col-4"><label className="form-label">Grading Setup weight</label><div className="form-control bg-light">{item.percentage.toFixed(2)}%</div></div><div className="col-auto"><button type="button" className="btn btn-outline-danger btn-sm" onClick={()=>setComponentDraft(current=>current.filter(value=>value.name!==item.name))} aria-label={"Remove "+item.name}>Remove</button></div></div>)}<div className="d-flex flex-wrap gap-2 align-items-end border-top mt-3 pt-3"><label className="form-label flex-grow-1">Add category or subcategory from Grading Setup<select className="form-select" value="" onChange={event=>{const category=detail?.categories.find(value=>value.id===event.target.value);if(category){const component={name:categoryPath(category,detail?.categories||[]),percentage:Number(localCategoryWeight(category).toFixed(2))};setComponentDraft(current=>current.some(item=>item.name.toLocaleLowerCase()===component.name.toLocaleLowerCase())?current:[...current,component]);}}}><option value="">Choose a category or subcategory…</option>{orderedCategoryTree(detail.categories).filter(category=>categoryHasGradingAssessments(category,detail.categories,detail.assessments)&&!componentDraft.some(item=>item.name.toLocaleLowerCase()===categoryPath(category,detail.categories).toLocaleLowerCase())).map(category=><option key={category.id} value={category.id}>{categoryPath(category,detail.categories)} · {localCategoryWeight(category).toFixed(2)}%</option>)}</select></label><b>Selected weight: {componentDraft.reduce((sum,item)=>sum+Number(item.percentage||0),0).toFixed(2)}%</b></div><div className="d-flex flex-wrap justify-content-end gap-2 mt-3"><button className="btn btn-outline-secondary" onClick={()=>setComponentEditorOpen(false)}>Cancel</button><button className="btn btn-outline-primary" onClick={saveComponentsAsDefault} disabled={busy}>Save as My Default</button><button className="btn btn-primary" onClick={saveComponentsForClass} disabled={busy || !detail || componentDraft.length===0}>Save for This Class</button></div></div></div>}<div className={`grade-notice ${detail.gradeStatus === "VERIFIED" ? "final" : detail.gradeStatus === "SUBMITTED" ? "provisional" : "draft"}`}>{detail.gradeStatus === "VERIFIED" ? "The teacher confirmed official submission to the Registrar. This record is final and locked until recalled for correction." : detail.gradeStatus === "SUBMITTED" ? `Submitted ${detail.submittedAt ? new Date(detail.submittedAt).toLocaleString() : ""}. Student visibility is controlled separately; visible grades remain provisional until the teacher confirms submission to the Registrar.` : detail.isPublished ? "This grade record is a draft but student viewing is enabled. Grades have not been submitted or verified to the Registrar and may change." : "This class record is still a draft and is hidden from students."}</div>{submissionProblems.length>0 && detail.gradeStatus!=="VERIFIED" && <div className="alert alert-warning py-2"><b>Before submission:</b><ul className="mb-0 mt-1">{submissionProblems.map(problem=><li key={problem}>{problem}</li>)}</ul></div>}<div className="final-grades-summary"><span>Overall weights <b>{detail.categories.filter(c=>!c.parentId).reduce((sum,c)=>sum+c.weight,0).toFixed(2)}%</b></span><span>Students <b>{detail.enrollments.length}</b></span><span>Assessment items <b>{detail.assessments.length}</b></span></div><div className="table-scroll"><table className="table grade-table"><thead><tr><th>STUDENT NAME</th><th>TOTAL GRADE</th><th>FINAL GRADE</th><th>REMARKS</th>{detail.gradeStatus === "VERIFIED" && <th>GRADE HISTORY</th>}</tr></thead><tbody>{filteredEnrollments.map(en=>{const band=detail.gradeBands.slice().sort((a,b)=>b.minPercent-a.minPercent).find(item=>en.finalPercent!==null&&en.finalPercent>=item.minPercent);return <tr key={en.id}><td>{en.studentName}</td><td>{en.finalPercent===null?"—":`${en.finalPercent.toFixed(2)}%`}</td><td>{en.finalGradeOverride||band?.finalGrade||"—"}{en.finalGradeOverride&&<small className="d-block text-primary">Manually changed</small>}</td><td>{en.remarks||band?.remarks||"Not yet graded"}</td>{detail.gradeStatus === "VERIFIED" && <td><button className="btn btn-outline-primary btn-sm" onClick={()=>{setGradeChangeEnrollmentId(en.id);setGradeChangeGrade(en.finalGradeOverride||"AUTO");setGradeChangeRemark(en.remarks||"AUTO");setGradeChangeReason("")}}>Change / history ({en.gradeChangeCount ?? 0})</button></td>}</tr>})}</tbody></table></div>{detail.gradeStatus === "DRAFT" && <button className="btn btn-success mt-3" onClick={submitGrades} disabled={busy||submissionProblems.length>0}>Submit grades to students</button>}{detail.gradeStatus === "SUBMITTED" && <button className="btn btn-primary mt-3" onClick={verifyGrades} disabled={busy}>Verified to Registrar</button>}{detail.gradeStatus === "VERIFIED" && <div className="grade-notice final mt-3">Verified to Registrar · {detail.verifiedAt ? new Date(detail.verifiedAt).toLocaleString() : "Confirmed"}</div>}<p className="privacy-note text-start mt-3">Student visibility is separate from submission: open Manage grade visibility to show or hide results, including drafts. Submitting locks the class record but does not change visibility. Teacher verification records a confirmation of Registrar submission; final and official grades are published by the school’s official student portal. Recall reopens the record and hides it until you make it visible again.</p></section>}
        </>}
      </>}</> : <>{tab === "overview" && <>
        <section className="overview-hero student-overview-hero">
          <div className="overview-hero-main">
            <div className="overview-hero-copy"><span className="eyebrow">SAGA · STUDENT WORKSPACE</span>
              <h1>Welcome back, {user.fullName.split(" ")[0]}.</h1>
              <p>Your classes, assessment progress, and grade updates at a glance.</p>
            </div>
            <button type="button" className="btn btn-primary overview-create-button student-simulator-hero-button" onClick={() => navigatePage("simulator")}><span aria-hidden="true">✳</span> Try the grade simulator</button>
          </div>
          <div className="overview-period-bar" aria-label="Academic period selection">
            <div className="overview-period-summary"><span>ACADEMIC PERIOD</span><strong>{academicYear} <i>·</i> {activeTerm}</strong><small>Your grades, classes, and activities follow this selection.</small></div>
            <div className="overview-period-controls">
              <label>Calendar<select className="form-select form-select-sm" value={calendarSystem} onChange={event=>{setCalendarSystem(event.target.value as "SEMESTER"|"TRIMESTER");setActiveTerm(event.target.value==="TRIMESTER"?"1st Trimester":"1st Semester");}}><option value="SEMESTER">Semester</option><option value="TRIMESTER">Trimester</option></select></label>
              <label>School year<select className="form-select form-select-sm" value={academicYear} onChange={event=>setAcademicYear(event.target.value)}>{academicYears.map(year=><option key={year} value={year}>{year}</option>)}</select></label>
              <label>Term<select className="form-select form-select-sm" value={activeTerm} onChange={event=>setActiveTerm(event.target.value)}>{(calendarSystem==="TRIMESTER"?["1st Trimester","2nd Trimester","3rd Trimester"]:["1st Semester","2nd Semester","Summer"]).map(term=><option key={term}>{term}</option>)}</select></label>
            </div>
          </div>
        </section>
        <OverviewDashboard
          key={`student-layout-${studentLayoutResetVersion}`}
          fullName={user.fullName}
          grades={grades}
          attendanceWarnings={studentAttendanceWarnings}
          preferences={studentPortalPreferences}
          onPreferencesChange={setStudentPortalPreferences}
          onReset={resetStudentPortalPreferences}
          storageReady={studentPortalPreferencesReady}
          customizerRequested={studentCustomizerRequested}
          onCustomizerOpened={() => setStudentCustomizerRequested(false)}
          demoMode={user.isDemo}
        />
        <StudentActivities readOnly={user.isDemo} academicYear={academicYear} term={activeTerm}/>
        {studentAttendanceWarnings.length > 0 && (
          <section className="student-attendance-watch surface" aria-labelledby="student-attendance-warning-heading" aria-live="polite">
            <div className="student-attendance-watch-heading">
              <div><span className="eyebrow">ATTENDANCE MONITORING</span><h2 id="student-attendance-warning-heading">Attendance needs attention</h2><p>Alerts are based on recorded class days in this academic period. {DROPPING_ABSENCE_THRESHOLD} consecutive recorded absences trigger a danger-of-dropping warning.</p></div>
              <span className="student-attendance-watch-count">{studentAttendanceWarnings.length} flagged</span>
            </div>
            <div className="student-attendance-watch-list">
              {studentAttendanceWarnings.map(grade => (
                <article className="student-attendance-watch-item" key={grade.id}>
                  <div><strong>{grade.code} · {grade.title}</strong><small>{[grade.classId, grade.term, grade.academicYear].filter(Boolean).join(" · ")}</small></div>
                  <div className="student-attendance-watch-status">
                    {grade.attendanceWarning && <span className="student-attendance-high-risk">{grade.attendanceWarning.percent.toFixed(1)}% absent · {grade.attendanceWarning.absent}/{grade.attendanceWarning.counted} days</span>}
                    {grade.attendanceWarning?.lateAbsences ? <small>Includes {grade.attendanceWarning.lateAbsences} absence(s) from consecutive late marks</small> : null}
                    {grade.droppingWarning && <DroppingWarning streak={grade.droppingWarning}/>}
                  </div>
                </article>
              ))}
            </div>
            <p className="student-attendance-watch-note">Review your recorded attendance details and contact your instructor about any discrepancy.</p>
          </section>
        )}
        <StudentClassEnrollment academicYear={academicYear} term={activeTerm} onJoined={() => { void refreshStudentGrades(); }}/>
        <section className="section-block student-grade-section">
          <div className="section-heading student-grade-section-heading"><div><span className="eyebrow">COURSE RECORDS</span><h2>My classes &amp; grades</h2>
            <p className="muted">Course results and recorded assessments for {activeTerm} · {academicYear}.</p>
          </div><div className="student-grade-header-actions"><span className="private-pill">Private student view</span>
            <button type="button" className="btn btn-outline-primary btn-sm" onClick={() => void refreshStudentGrades()} disabled={studentRefreshing || loading}>
              {studentRefreshing ? "Refreshing…" : "↻ Refresh grades"}
            </button>
          </div></div>
          <div className="student-official-notice" role="note"><strong>For reference only.</strong> SAGA results may change until officially confirmed. Your school’s official student portal is the source for final and official grades.</div>
          {studentLastUpdated && <p className="student-grade-updated">Last checked {studentLastUpdated.toLocaleTimeString(undefined, {hour:"numeric",minute:"2-digit"})} · {grades.length} visible class{grades.length===1?"":"es"}</p>}
          {loading ? <div className="student-grade-loading" role="status"><span className="spinner-border spinner-border-sm" aria-hidden="true"/> Loading your grade summary…</div> : <>
          {grades.length > 0 && <div className="student-grade-filters student-active-period-search">
            <label><span>Find class or instructor</span><input className="form-control" type="search" value={studentGradeQuery} onChange={event=>setStudentGradeQuery(event.target.value)} placeholder="Search course code, title, or teacher" autoComplete="off"/></label>
          </div>}
          {grades.length > 0 && <div className="student-results-toolbar"><span>Showing <strong>{visibleGrades.length}</strong> of {grades.length} classes for the active period</span>
            {studentGradeQuery && <button type="button" className="btn btn-link btn-sm" onClick={() => setStudentGradeQuery("")}>Clear search</button>}
          </div>}
          {grades.length ? visibleGrades.length ?
            <div className="student-grade-list">{visibleGrades.map(g => {
              const details = studentGradeDetails[g.id];
              const total = g.itemCount ?? 0;
              const recorded = Math.min(total, g.recordedCount ?? 0);
              const completion = total ? Math.round(recorded / total * 100) : 0;
              return <article id={`student-grade-${g.id}`} className="student-grade-card student-grade-card-expanded student-grade-card-modern" key={g.id}>
                <div className="grade-course-icon" aria-hidden="true">{g.code.slice(0, 2)}</div>
                <div className="grade-course-details"><small>{g.code} <span>·</span> {g.term} {g.academicYear}</small>
                  <h3>{g.title}</h3><p>Instructor: {g.teacher}</p>
                  <span className={`grade-status-pill ${g.status === "VERIFIED" ? "final" : g.status === "DRAFT" ? "draft" : "provisional"}`}>
                    {g.status === "VERIFIED" ? "Teacher-verified" : g.status === "SUBMITTED" ? "Submitted · Provisional" : "Draft · Subject to change"}
                  </span>
                  <div className="student-assessment-progress">
                    <div><span>Assessments recorded</span><b>{recorded}/{total}</b></div>
                    <div className="student-assessment-track" role="progressbar" aria-label={`${g.code} assessments recorded`} aria-valuenow={recorded} aria-valuemin={0} aria-valuemax={total || 1}>
                      <span style={{width:`${completion}%`}}/>
                    </div>
                  </div>
                </div>
                <div className="grade-result"><small>{g.status === "VERIFIED" ? "TEACHER-VERIFIED" : "UNOFFICIAL GRADE"}</small>
                  <strong>{g.finalGrade ?? "—"}</strong><span>{g.remarks || "Not yet graded"}</span>
                  <b className="grade-percent">{g.percent === null ? "No score yet" : `${g.percent.toFixed(2)}% course`}</b>
                </div>
                <div className="student-grade-actions"><button type="button" className="btn btn-outline-primary btn-sm" onClick={() => startStudentSimulation(g.id)}>Try What-If</button></div>
                <details key={`${g.id}-${studentGradeRevision}`} className="student-itemized student-itemized-on-demand" onToggle={event => {
                  if (event.currentTarget.open) void ensureStudentGradeDetail(g.id);
                }}>
                  <summary><span>View itemized scores</span><small>{total} assessment{total === 1 ? "" : "s"} · {Math.max(0, total - recorded)} unrecorded</small></summary>
                  {studentGradeLoading[g.id] ? <div className="student-detail-feedback" role="status"><span className="spinner-border spinner-border-sm" aria-hidden="true"/> Loading your assessment records…</div> :
                    studentGradeErrors[g.id] ? <div className="student-detail-feedback student-detail-error" role="alert">{studentGradeErrors[g.id]}
                      <button type="button" className="btn btn-link btn-sm" onClick={() => void ensureStudentGradeDetail(g.id)}>Retry</button></div> :
                    details ? <div className="student-details-content">
                      <div className={`grade-notice ${g.status === "VERIFIED" ? "final" : "provisional"}`}>
                        {g.status === "VERIFIED" ? "Your teacher marked this record verified to the Registrar. Check your school's official student portal for final and official grades." :
                          g.status === "SUBMITTED" ? "Your teacher submitted this record in SAGA. It remains provisional until verified." :
                          "This is a draft record. Scores may be incomplete or updated by your teacher."}
                      </div>
                      {details.categories.map(category => <section className="student-score-category" key={category.id}>
                        <div className="quick-category-heading"><strong>{category.name}</strong><span>{category.weight.toFixed(2)}% of course</span></div>
                        {category.assessments.length ? category.assessments.map(item => <div className="quick-item" key={item.id}>
                          <span>{item.title}</span><b>{item.lateAsAbsent ? CONVERTED_LATE_LABEL : item.points == null ?
                            (item.remark === "PRESENT" ? "Present" : item.remark === "LATE" ? "Late" : item.remark === "ABSENT" ? "Absent" : item.remark === "EXCUSED" ? "Excused" : item.remark === "DID_NOT_SUBMIT" ? "Did not submit" : "Not recorded") :
                            `${item.points} / ${item.maxScore}`}</b>
                        </div>) : <p className="muted small mt-2">No assessment items yet.</p>}
                      </section>)}
                      {!details.categories.length && <p className="muted small mt-2">No assessment categories have been configured yet.</p>}
                    </div> : <div className="student-detail-feedback">Open to load itemized scores.</div>}
                </details>
              </article>;
            })}</div> :
            <div className="empty-state student-empty"><div className="empty-icon">◎</div><h3>No classes match your search</h3><p>Try a different search or clear your search.</p><button type="button" className="btn btn-outline-primary btn-sm" onClick={()=>setStudentGradeQuery("")}>Show all classes</button></div> :
            <div className="empty-state student-empty"><div className="empty-icon">◎</div><h3>No visible grades yet</h3><p>Your teacher may still be entering scores, may have hidden the class, or your student number may need to be linked.</p><div className="empty-hint">If you expect to see a class, confirm your student number with your teacher.</div></div>}
          </>}
        </section>
      </>}</>}
      {tab === "chats" && <ClassChatsHub role={teacher ? "TEACHER" : "STUDENT"} isDemo={user.isDemo} academicYear={academicYear} term={activeTerm} periodReady={academicPeriodReady} />}
      {tab === "announcements" && !teacher && <StudentAnnouncements readOnly={user.isDemo} />}
      {tab === "simulator" && <section className="section-block student-simulator-page">
        <div className="student-simulator-intro">
          <span className="eyebrow">PRACTICE · PRIVATE TO YOUR ACCOUNT</span>
          <h2>What-If Grade Simulator</h2>
          <p>Experiment with your assessment scores and explore possible outcomes without changing your recorded grades. Final and official grades are published by the school's official student portal.</p>
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => navigatePage("overview")}>← Back to My Grades</button>
        </div>
        {loading ? <div className="inline-empty" role="status">Loading visible classes…</div> : !grades.length ? <div className="empty-state student-empty"><div className="empty-icon">◎</div><h3>No classes available for simulation</h3><p>Ask your teacher to make your class grades visible in SAGA. Your actual grades are not affected.</p></div> : <>
          <div className="student-simulator-choose"><div><h3>Choose a class to simulate</h3><p className="muted">Only classes visible in your Student Portal are listed here.</p></div><span className="student-simulator-count">{grades.length} class{grades.length === 1 ? "" : "es"}</span></div>
          <div className="student-simulator-course-list">
            {grades.map(grade => <button type="button" key={grade.id} className={`student-simulator-course ${simulatingGradeId === grade.id ? "active" : ""}`} aria-pressed={simulatingGradeId === grade.id} onClick={() => { setSimulatingGradeId(grade.id); void ensureStudentGradeDetail(grade.id); }}>
              <span><strong>{grade.code} — {grade.title}</strong><small>{grade.term} {grade.academicYear} · {grade.teacher}</small></span>
              <span className="student-simulator-course-result">{grade.percent === null ? "Not graded" : `${grade.percent.toFixed(2)}% recorded`}</span>
            </button>)}
          </div>
          {simulatingGradeId && grades.some(grade => grade.id === simulatingGradeId) ?
            studentGradeErrors[simulatingGradeId] ? <div className="student-detail-feedback student-detail-error" role="alert">
              {studentGradeErrors[simulatingGradeId]} <button type="button" className="btn btn-outline-primary btn-sm" onClick={() => void ensureStudentGradeDetail(simulatingGradeId)}>Retry loading</button>
            </div> :
            studentGradeDetails[simulatingGradeId] ?
              <GradeWhatIfSimulator key={simulatingGradeId} grade={studentGradeDetails[simulatingGradeId]} inline onClose={() => setSimulatingGradeId(null)} /> :
              <div className="student-grade-loading" role="status"><span className="spinner-border spinner-border-sm" aria-hidden="true"/> Loading assessment data for the simulator…</div> :
            <div className="student-simulator-placeholder"><b>Select any class above to begin.</b><span>You'll be able to try scores and compare projected results against your teacher's records.</span></div>}
        </>}
      </section>}
      </div></main>
          {(printMode === "grades" || printMode === "iso-grades") && <style media="print">{`@page { size: 8.5in 13in; margin: .35in; }
        @media print {
          .generic-print-sheet { display:block!important; width:100%!important; color:#000!important; background:#fff!important; font-family:Arial,Helvetica,sans-serif!important; }
          .generic-print-sheet { font-size:9pt; }
          .generic-print-sheet>header { display:flex; flex-direction:column; align-items:stretch; gap:2px; width:100%; max-width:100%; box-sizing:border-box; text-align:center; border:0; padding:0 4px 8px; margin:0 auto 8px; }
          .generic-print-header-layout { display:grid; grid-template-columns:58px minmax(0,max-content) 58px; grid-template-rows:auto auto auto 1.2em auto auto; align-items:center; justify-content:center; column-gap:10px; row-gap:2px; width:fit-content; max-width:100%; margin:0 auto; text-align:center; }
          .generic-print-logo-slot { display:flex; align-items:center; justify-content:center; align-self:stretch; min-width:58px; width:58px; }
          .generic-print-logo-slot img { display:block; max-width:58px; max-height:104px; width:auto; height:auto; object-fit:contain; margin:0 auto; }
          .generic-print-logo-placeholder { display:block; width:54px; height:54px; box-sizing:border-box; border:1px dashed #777; }
          .generic-print-school-placeholder { border-radius:50%; }
          .generic-print-department-placeholder { border-radius:5px; }
          .generic-print-school-logo { grid-column:1; grid-row:1 / span 6; justify-self:center; }
          .generic-print-department-logo { grid-column:3; grid-row:1 / span 6; justify-self:center; }
          .generic-print-school-name { grid-column:2; grid-row:1; min-width:0; margin:0; font-size:14pt; font-weight:700; line-height:1.15; text-align:center; text-transform:uppercase; }
          .generic-print-department { grid-column:2; grid-row:2; min-width:0; min-height:1.2em; margin:0; font-size:9pt; font-weight:700; line-height:1.2; text-align:center; text-transform:uppercase; overflow-wrap:anywhere; }
          .generic-print-address { grid-column:2; grid-row:3; min-width:0; min-height:1.2em; margin:0; font-size:8.5pt; line-height:1.2; text-align:center; }
          .generic-print-header-blank { grid-column:2; grid-row:4; display:block; min-height:1.2em; }
          .generic-print-title { grid-column:2; grid-row:5; display:block; margin:0; font-size:12pt; font-weight:700; line-height:1.2; letter-spacing:.04em; text-align:center; }
          .generic-print-term-year { grid-column:2; grid-row:6; display:block; margin:0; font-size:9pt; font-weight:600; line-height:1.2; text-align:center; text-transform:uppercase; }
          .generic-print-course-details { display:flex; flex-direction:column; gap:7px; margin:8px 0 12px; padding:0; font-size:8.5pt; border:0; }
          .generic-print-course-details-row { display:grid; align-items:baseline; gap:18px; min-width:0; }
          .generic-print-course-details-row-primary { grid-template-columns:minmax(0,1fr) minmax(0,2.2fr); }
          .generic-print-course-details-row-secondary { grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(0,1.25fr); }
          .generic-print-course-details-row>div { display:flex; align-items:baseline; gap:6px; min-width:0; border:0; padding:0; }
          .generic-print-course-details b { white-space:nowrap; font-weight:700; }
          .generic-print-course-details span { display:block; flex:1; min-width:0; min-height:13px; padding:0 3px 1px; border-bottom:1px solid #222; overflow-wrap:anywhere; }
          .generic-print-grade-table { width:100%; border-collapse:collapse; table-layout:fixed; font-size:8pt; line-height:1.15; }
          .generic-print-grade-table thead { display:table-header-group; }
          .generic-print-grade-table th,.generic-print-grade-table td { border:1px solid #333!important; padding:5px 4px!important; vertical-align:middle; }
          .generic-print-grade-table th { background:#fff!important; font-size:7.5pt; text-align:center; overflow-wrap:anywhere; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
          .generic-print-grade-table th:nth-child(1),.generic-print-grade-table td:nth-child(1) { width:6%; text-align:center; }
          .generic-print-grade-table th:nth-child(2),.generic-print-grade-table td:nth-child(2) { width:32%; text-align:left; }
          .generic-print-grade-table td:not(:nth-child(2)) { text-align:center; }
          .generic-print-grade-table tbody tr { break-inside:avoid; page-break-inside:avoid; }
          .generic-print-grade-table small { display:block; font-weight:400; font-size:6.5pt; }
          .generic-print-sheet .print-signatures { display:grid; grid-template-columns:1fr 1fr; gap:50px; margin-top:24px; break-inside:avoid; page-break-inside:avoid; font-size:8pt; }
          .generic-print-sheet .print-signatures>div { min-height:60px; }
          .generic-print-sheet .print-signatures p { margin:0; text-align:center; }
          .generic-print-sheet .print-signatures .signature-space { height:56px; }
          .generic-print-sheet .print-signatures .signature-name { display:block; font-weight:700; }
          .generic-print-sheet .print-signatures .signature-position { display:block; margin-top:3px; font-size:7pt; }
          .iso-print-header-table { width:100%; border:1px solid black!important; border-collapse:collapse!important; table-layout:fixed; font-size:7.4pt; line-height:1.15; }
          .iso-print-header-table td { border:1px solid black!important; padding:5px 6px!important; vertical-align:middle; }
          .iso-print-seal-cell { text-align:center; vertical-align:middle!important; }
          .iso-print-seal-cell img { display:block; width:70px; height:70px; max-width:100%; object-fit:contain; border-radius:50%; margin:0 auto; }
          .iso-print-seal-placeholder { display:block; width:66px; height:66px; max-width:100%; box-sizing:border-box; border:1px dashed #000; border-radius:50%; margin:0 auto; }
          .iso-print-organization-cell { text-align:center; padding:6px!important; }
          .iso-print-organization-name { display:block; font-size:10pt; font-weight:700; text-transform:uppercase; line-height:1.2; }
          .iso-print-organization-address { display:block; margin-top:2px; font-size:8pt; font-weight:600; line-height:1.2; }
          .iso-print-control-cell { font-size:7pt; line-height:1.2; }
          .iso-print-control-label { display:block; font-weight:400; }
          .iso-print-control-value { display:block; margin-top:2px; font-weight:600; overflow-wrap:anywhere; }
          .iso-print-control-center { text-align:center; }
          .iso-print-eoms-title { display:block; font-size:7.6pt; font-weight:700; line-height:1.25; }
          .iso-print-iso-standard { display:block; margin-top:2px; font-weight:700; }
          .iso-print-page-cell { display:grid; grid-template-columns:minmax(0,1fr) 24px; align-items:stretch; text-align:center; font-size:7pt; }
          .iso-print-page-cell b { display:flex; align-items:center; justify-content:center; border-left:1px solid #000; font-weight:700; }
          .iso-print-affiliations { margin:4px 0 0; text-align:center; font-size:6.9pt; font-weight:700; line-height:1.25; }
          .iso-print-affiliations span { display:block; }
        }`}</style>}
      {(printMode === "grades" || printMode === "iso-grades") && detail && <article className="print-grade-sheet generic-print-sheet">
        <header>
          {printMode === "iso-grades" ? <div className="iso-print-header-layout">
            <table className="iso-print-header-table" aria-label="ISO document control header">
              <colgroup><col style={{width:"16%"}}/><col style={{width:"20%"}}/><col style={{width:"44%"}}/><col style={{width:"20%"}}/></colgroup>
              <tbody>
                <tr>
                  <td rowSpan={4} className="iso-print-seal-cell">{schoolLogoPath ? <img src={"/api/media?pathname=" + encodeURIComponent(schoolLogoPath)} alt="Official school seal"/> : <span className="iso-print-seal-placeholder" aria-hidden="true"/>}</td>
                  <td colSpan={3} className="iso-print-organization-cell"><strong className="iso-print-organization-name">{user.school.name}</strong><span className="iso-print-organization-address">{isoHeaderConfig.organizationAddress}</span></td>
                </tr>
                <tr>
                  <td className="iso-print-control-cell"><span className="iso-print-control-label">Form Name:</span></td>
                  <td className="iso-print-control-cell iso-print-control-center"><strong className="iso-print-control-value">{isoHeaderConfig.formName}</strong></td>
                  <td className="iso-print-control-cell"><span className="iso-print-control-label">Effectivity:</span><strong className="iso-print-control-value">{isoHeaderConfig.effectivity}</strong></td>
                </tr>
                <tr>
                  <td className="iso-print-control-cell"><span className="iso-print-control-label">Form No:</span><strong className="iso-print-control-value">{isoHeaderConfig.formNo}</strong></td>
                  <td className="iso-print-control-cell iso-print-control-center"><strong className="iso-print-eoms-title">{isoHeaderConfig.eomsTitle}</strong><strong className="iso-print-iso-standard">{isoHeaderConfig.isoStandard}</strong></td>
                  <td className="iso-print-control-cell"><span className="iso-print-control-label">Issuing Office:</span><strong className="iso-print-control-value">{isoHeaderConfig.issuingOffice}</strong></td>
                </tr>
                <tr>
                  <td className="iso-print-control-cell"><strong className="iso-print-control-value">Revision No. {isoHeaderConfig.revisionNo}</strong></td>
                  <td></td>
                  <td className="iso-print-control-cell"><div className="iso-print-page-cell"><span>Page No.</span><b>1</b></div></td>
                </tr>
              </tbody>
            </table>
            <div className="iso-print-affiliations"><span>{isoHeaderConfig.affiliationLine1}</span><span>{isoHeaderConfig.affiliationLine2}</span></div>
          </div> : <div className="generic-print-header-layout">
            <div className="generic-print-logo-slot generic-print-school-logo">
              {schoolLogoPath ? <img src={"/api/media?pathname=" + encodeURIComponent(schoolLogoPath)} alt="Primary institutional seal — Filamer Christian University, Inc."/> : <span className="generic-print-logo-placeholder generic-print-school-placeholder" aria-hidden="true"/>}
            </div>
            <h1 className="generic-print-school-name">{user.school.name}</h1>
            <p className="generic-print-department">{departmentName.trim()}</p>
            <p className="generic-print-address">{schoolAddress.trim() || "School address not set"}</p>
            <span className="generic-print-header-blank" aria-hidden="true"/>
            <strong className="generic-print-title">COLLEGIATE GRADE SHEET</strong>
            <p className="generic-print-term-year">{detail.term.toLocaleUpperCase()} A.Y. {detail.academicYear}</p>
            <div className="generic-print-logo-slot generic-print-department-logo">
              {departmentLogoPath ? <img src={"/api/media?pathname=" + encodeURIComponent(departmentLogoPath)} alt="College of Engineering / department logo"/> : <span className="generic-print-logo-placeholder generic-print-department-placeholder" aria-hidden="true"/>}
            </div>
          </div>}
        </header>
        <div className="generic-print-course-details">
          <div className="generic-print-course-details-row generic-print-course-details-row-primary">
            <div><b>Course No.:</b><span>{detail.code}</span></div>
            <div><b>Descriptive Title:</b><span>{detail.title}</span></div>
          </div>
          <div className="generic-print-course-details-row generic-print-course-details-row-secondary">
            <div><b>Class ID:</b><span>{detail.classId || "—"}</span></div>
            <div><b>Semester:</b><span>{detail.term}</span></div>
            <div><b>Academic Year:</b><span>{detail.academicYear}</span></div>
          </div>
        </div>
        <table className="print-grade-table generic-print-grade-table">
          <thead><tr><th aria-label="Sequence number"></th><th>NAME OF STUDENTS</th>{gradeSheetComponents.map((component,index)=><th key={index}>{component.name.toLocaleUpperCase()}<small>{component.percentage.toFixed(2)}%</small></th>)}<th>TOTAL GRADE</th><th>FINAL GRADE</th><th>REMARKS</th></tr></thead>
          <tbody>{detail.enrollments.map((enrollment,index)=>{
            const band = detail.gradeBands.slice().sort((a,b)=>b.minPercent-a.minPercent).find(item=>enrollment.finalPercent!==null&&enrollment.finalPercent>=item.minPercent);
            const special = ["INC","NP","DROPPED"].includes(enrollment.remarks || "");
            return <tr key={enrollment.id}><td>{index+1}.</td><td>{enrollment.studentName.toLocaleUpperCase()}</td>{gradeSheetComponents.map((component,componentIndex)=>{const contribution=gradeSheetComponentContribution(detail,enrollment,component);return <td key={componentIndex}>{contribution===null?"":contribution.toFixed(2)}</td>;})}<td>{special||enrollment.finalPercent===null?"":enrollment.finalPercent.toFixed(2)+"%"}</td><td>{special?"":enrollment.finalGradeOverride||band?.finalGrade||""}</td><td>{enrollment.remarks||band?.remarks||""}</td></tr>;
          })}</tbody>
        </table>
        <div className="print-signatures">
          <div>Submitted by:<div className="signature-space" aria-hidden="true"/><p><strong className="signature-name">{user.fullName}</strong><small className="signature-position">{teacherPosition.trim()}</small></p></div>
          <div>Noted:<div className="signature-space" aria-hidden="true"/><p><strong className="signature-name">{notedByName.trim()}</strong><small className="signature-position">{notedByPosition.trim()}</small></p></div>
        </div>
      </article>}
      {teacher && visibilityManagerQuery !== null && <GradeVisibilityManager subjects={subjects} initialQuery={visibilityManagerQuery} onClose={() => setVisibilityManagerQuery(null)} onChanged={(subjectIds, visible) => { const ids = new Set(subjectIds); setSubjects(current => current.map(subject => ids.has(subject.id) ? { ...subject, isPublished: visible } : subject)); setDetail(current => current && ids.has(current.id) ? { ...current, isPublished: visible } : current); }} />}
       {rosterEdit && detail && <div className="modal-backdrop-custom" onMouseDown={e=>{if(e.target===e.currentTarget)setRosterEdit(null)}}><div className="modal-card"><button className="modal-x" onClick={()=>setRosterEdit(null)}>×</button><span className="eyebrow">CLASS ROSTER</span><h2>Edit student details</h2><p className="muted">Update the name or class student ID. Changing the ID unlinks the previous portal account.</p><form onSubmit={saveRosterStudent}><label className="form-label">Student name</label><input className="form-control mb-3" value={rosterEdit.studentName} onChange={e=>setRosterEdit({...rosterEdit,studentName:e.target.value})} required maxLength={120}/><label className="form-label">Student ID</label><input className="form-control mb-3" value={rosterEdit.studentNumber} onChange={e=>setRosterEdit({...rosterEdit,studentNumber:e.target.value})} maxLength={40}/><button className="btn btn-primary w-100" disabled={busy}>Save student details</button></form></div></div>}
      {bulkScoresOpen&&detail&&<div className="modal-backdrop-custom" onMouseDown={e=>{if(e.target===e.currentTarget)setBulkScoresOpen(false)}}><div className="modal-card bulk-scores-modal"><button className="modal-x" onClick={()=>setBulkScoresOpen(false)}>×</button><span className="eyebrow">SCOREBOOK · BULK IMPORT</span><h2>Import scores</h2><p className="muted">Download the CSV template, edit scores, then preview and validate before saving. Blank cells stay unchanged. This import does not edit attendance.</p><button type="button" className="btn btn-outline-primary btn-sm mb-3" onClick={()=>downloadScoreCsv(true)}>↓ Download score template</button><label className="form-label" htmlFor="bulk-score-file">Choose completed CSV</label><input id="bulk-score-file" className="form-control" type="file" accept=".csv,text/csv" onChange={event=>{const file=event.currentTarget.files?.[0];if(file)void previewBulkScores(file)}}/>{bulkFileName&&<div className="small muted mt-2">Previewing {bulkFileName}</div>}{bulkErrors.length>0&&<div className="bulk-validation-errors" role="alert"><b>Fix these issues before saving:</b><ul>{bulkErrors.slice(0,30).map((error,index)=><li key={`${index}-${error}`}>{error}</li>)}</ul>{bulkErrors.length>30&&<small>And {bulkErrors.length-30} more validation errors.</small>}</div>}{bulkRowsPreview.length>0&&<><div className={`bulk-validation-summary ${bulkErrors.length?"invalid":"valid"}`}>{bulkErrors.length?`${bulkErrors.length} validation issue(s)`: `${bulkRowsPreview.length} students checked · ${bulkOperations.length} score cells ready to save`}</div><div className="bulk-preview-scroll"><table className="table table-sm"><thead><tr><th>CSV ROW</th><th>STUDENT</th><th>CELLS</th><th>RESULT</th></tr></thead><tbody>{bulkRowsPreview.slice(0,50).map(row=><tr key={row.row}><td>{row.row}</td><td>{row.student}</td><td>{row.cells}</td><td>{row.errors.length?<span className="text-danger">{row.errors.join("; ")}</span>:<span className="text-success">Valid</span>}</td></tr>)}</tbody></table>{bulkRowsPreview.length>50&&<small className="muted">Showing first 50 of {bulkRowsPreview.length} rows.</small>}</div></>}<button className="btn btn-primary w-100 mt-3" onClick={applyBulkScores} disabled={busy||bulkErrors.length>0||bulkOperations.length===0}>Validate and save {bulkOperations.length?`(${bulkOperations.length} cells)`:""}</button></div></div>}
      {gradeChangeEnrollmentId&&detail&&(()=>{const enrollment=detail.enrollments.find(item=>item.id===gradeChangeEnrollmentId);if(!enrollment)return null;return <div className="modal-backdrop-custom" onMouseDown={e=>{if(e.target===e.currentTarget)setGradeChangeEnrollmentId("")}}><div className="modal-card grade-change-modal"><button className="modal-x" onClick={()=>setGradeChangeEnrollmentId("")}>×</button><span className="eyebrow">AUDITABLE GRADE CORRECTION</span><h2>{enrollment.studentName}</h2><p className="muted">The current score calculations remain intact. A manual final grade and reason are recorded in the history below.</p><form onSubmit={saveGradeChange}><label className="form-label">Final grade</label><select className="form-select mb-3" value={gradeChangeGrade} onChange={e=>setGradeChangeGrade(e.target.value)}><option value="AUTO">Use calculated grade</option>{detail.gradeBands.map(band=><option key={band.id} value={band.finalGrade}>{band.finalGrade} · {band.remarks}</option>)}</select><label className="form-label">Remark</label><select className="form-select mb-3" value={gradeChangeRemark} onChange={e=>setGradeChangeRemark(e.target.value)}><option value="AUTO">Use calculated remark</option><option>Passed</option><option>Failed</option><option>INC</option><option>NP</option><option>DROPPED</option></select><label className="form-label">Reason for change</label><textarea className="form-control mb-3" minLength={10} maxLength={500} required value={gradeChangeReason} onChange={e=>setGradeChangeReason(e.target.value)} placeholder="For example: INC requirements completed and verified on …"/><button className="btn btn-primary w-100" disabled={busy}>Save correction</button></form><hr/><h3 className="h6">Grade change history</h3>{gradeHistoryLoading ? <p className="muted small" role="status">Loading grade history…</p> : gradeHistoryError ? <p role="alert" className="text-danger small">{gradeHistoryError}</p> : gradeHistory.length ? <div className="grade-history-list">{gradeHistory.map(item=><article key={item.id}><b>{item.previousFinalGrade||"—"} → {item.newFinalGrade||"—"} · {item.previousRemarks||"No remark"} → {item.newRemarks||"No remark"}</b><p>{item.reason}</p><small>{new Date(item.createdAt).toLocaleString()} · {item.actor.fullName}</small></article>)}</div>:<p className="muted small">No grade changes have been recorded for this student.</p>}</div></div>})()}
      {attendanceOpen && detail && <div className="modal-backdrop-custom" onMouseDown={e=>{if(e.target===e.currentTarget)setAttendanceOpen(false)}}><div className="modal-card"><button className="modal-x" onClick={()=>setAttendanceOpen(false)}>×</button><span className="eyebrow">CLASS ATTENDANCE</span><h2>Add attendance day</h2><p className="muted">Choose a date from the class schedule. For a different date, enter a reason such as Make-up class.</p><div className="privacy-note text-start mb-3">Scheduled days: {scheduleWeekdays(detail.schedule).map(day=>["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][day]).join(", ") || "No valid days found"}</div><form onSubmit={createAttendanceDay}><label className="form-label">Class date</label><input className="form-control mb-2" type="date" value={attendanceDate} onChange={e=>setAttendanceDate(e.target.value)} required/><PhilippineHolidayCalendar selectedDate={attendanceDate} onSelect={setAttendanceDate}/><label className="form-label mt-3">Attendance Type</label><select className="form-select mb-3" value={attendanceType} onChange={e=>setAttendanceType(e.target.value as "FACE_TO_FACE" | "ONLINE")} required><option value="FACE_TO_FACE">Face-to-Face</option><option value="ONLINE">Online</option></select><label className="form-label">Reason for a non-scheduled date <span className="muted">(optional on scheduled days)</span></label><input className="form-control mb-3" value={attendanceReason} onChange={e=>setAttendanceReason(e.target.value)} placeholder="e.g. Make-up class"/><button className="btn btn-primary w-100" disabled={busy}>Add attendance day</button></form></div></div>}
      {editOpen && detail && <div className="modal-backdrop-custom" onMouseDown={e=>{if(e.target===e.currentTarget)setEditOpen(false)}}><div className="modal-card class-edit-modal"><button className="modal-x" onClick={()=>setEditOpen(false)}>×</button><span className="eyebrow">CLASS MANAGEMENT</span><h2>Edit class details</h2><p className="muted">Update the class identifier, subject details, term, school year, or meeting schedule.</p><form onSubmit={saveSubjectDetails}><label className="form-label">Class ID (optional)</label><input className="form-control mb-3" value={editDetails.classId} onChange={e=>setEditDetails({...editDetails,classId:e.target.value})} maxLength={40}/><label className="form-label">Course code</label><input className="form-control mb-3" value={editDetails.code} onChange={e=>setEditDetails({...editDetails,code:e.target.value})} required maxLength={30}/><label className="form-label">Descriptive title</label><input className="form-control mb-3" value={editDetails.title} onChange={e=>setEditDetails({...editDetails,title:e.target.value})} required maxLength={160}/><div className="row"><div className="col-6"><label className="form-label">Term</label><select className="form-select mb-3" value={editDetails.term} onChange={e=>setEditDetails({...editDetails,term:e.target.value})}><option>1st Semester</option><option>2nd Semester</option><option>3rd Semester</option><option>Summer</option></select></div><div className="col-6"><label className="form-label">Academic year</label><input className="form-control mb-3" value={editDetails.academicYear} onChange={e=>setEditDetails({...editDetails,academicYear:e.target.value})} required maxLength={20}/></div></div><div className="row"><div className="col-md-5"><label className="form-label">Course / Program</label><input className="form-control mb-3" list="saga-program-list" value={editDetails.courseProgram} onChange={e=>setEditDetails({...editDetails,courseProgram:e.target.value})} maxLength={120} placeholder="e.g. BSECE"/></div><div className="col-md-4"><label className="form-label">Year level</label><input className="form-control mb-3" list="saga-year-list" value={editDetails.yearLevel} onChange={e=>setEditDetails({...editDetails,yearLevel:e.target.value})} maxLength={40} placeholder="e.g. 1st Year"/></div><div className="col-md-3"><label className="form-label">Section</label><input className="form-control mb-3" list="saga-section-list" value={editDetails.section} onChange={e=>setEditDetails({...editDetails,section:e.target.value})} maxLength={40} placeholder="A"/></div></div><div className="schedule-builder"><div className="schedule-builder-heading"><div><label className="form-label mb-0">Class schedule</label><small className="muted d-block">Add or remove lecture, laboratory, or other meeting times.</small></div><button type="button" className="btn btn-sm btn-outline-primary" onClick={()=>setEditScheduleRows([...editScheduleRows,newScheduleRow()])}>＋ Add schedule</button></div>{editScheduleRows.map((row,index)=><div className="schedule-row" key={index}><div className="schedule-label-field"><label className="form-label">Class type</label><input className="form-control" value={row.label} onChange={e=>setEditScheduleRows(editScheduleRows.map((r,i)=>i===index?{...r,label:e.target.value}:r))}/></div><div><label className="form-label">Day</label><select className="form-select" value={row.day} onChange={e=>setEditScheduleRows(editScheduleRows.map((r,i)=>i===index?{...r,day:e.target.value}:r))}>{DAYS.map(day=><option key={day}>{day}</option>)}</select></div><TimeDropdown label="Starts" value={row.startTime} onChange={value=>setEditScheduleRows(editScheduleRows.map((r,i)=>i===index?{...r,startTime:value}:r))}/><TimeDropdown label="Ends" value={row.endTime} onChange={value=>setEditScheduleRows(editScheduleRows.map((r,i)=>i===index?{...r,endTime:value}:r))}/><button type="button" className="schedule-remove" aria-label="Remove schedule" onClick={()=>setEditScheduleRows(editScheduleRows.filter((_,i)=>i!==index))}>×</button></div>)}</div><div className="privacy-note text-start mt-3">Class details can only be changed while grades are in draft. Recall a submitted or verified record before editing its official class details.</div><button className="btn btn-primary w-100 mt-3" disabled={busy}>Save class details</button></form></div></div>}
      {createOpen && <div className="modal-backdrop-custom" onMouseDown={e=>{if(e.target===e.currentTarget)setCreateOpen(false)}}><div className="modal-card"><button className="modal-x" onClick={()=>setCreateOpen(false)}>×</button><span className="eyebrow">NEW CLASS</span><h2>Create a subject</h2><p className="muted">Set up course details. You can edit the default grading weights afterward.</p><form onSubmit={createSubject}><label className="form-label">Class ID (optional)</label><input className="form-control mb-3" name="classId" placeholder="e.g. 012345" maxLength={40}/><label className="form-label">Course code</label><input className="form-control mb-3" name="code" placeholder="e.g. ECE 16" required/><label className="form-label">Descriptive title</label><input className="form-control mb-3" name="title" required/><div className="row"><div className="col-6"><label className="form-label">Term</label><select className="form-select mb-3" name="term" value={activeTerm} disabled required aria-label="Term locked to active academic period">{(calendarSystem === "TRIMESTER" ? ["1st Trimester", "2nd Trimester", "3rd Trimester"] : ["1st Semester", "2nd Semester", "Summer"]).map(term => <option key={term}>{term}</option>)}</select></div><div className="col-6"><label className="form-label">Academic year</label><input className="form-control mb-3" name="academicYear" value={academicYear} disabled required aria-label="Academic year locked to active academic period"/></div></div><div className="row"><div className="col-md-5"><label className="form-label">Course / Program</label><input className="form-control mb-3" name="courseProgram" list="saga-program-list" placeholder="e.g. BSECE" maxLength={120}/></div><div className="col-md-4"><label className="form-label">Year level</label><input className="form-control mb-3" name="yearLevel" list="saga-year-list" placeholder="e.g. 1st Year" maxLength={40}/></div><div className="col-md-3"><label className="form-label">Section</label><input className="form-control mb-3" name="section" list="saga-section-list" placeholder="A" defaultValue="A" maxLength={40}/></div></div><datalist id="saga-program-list"><option value="BSECE"/><option value="BSIT"/><option value="BSCS"/><option value="BSME"/><option value="BSIE"/></datalist><datalist id="saga-year-list"><option value="1st Year"/><option value="2nd Year"/><option value="3rd Year"/><option value="4th Year"/><option value="5th Year"/></datalist><datalist id="saga-section-list"><option value="A"/><option value="B"/><option value="C"/><option value="D"/><option value="E"/></datalist><div className="schedule-builder"><div className="schedule-builder-heading"><div><label className="form-label mb-0">Class schedule</label><small className="muted d-block">Add lecture, laboratory, or other meeting times.</small></div><button type="button" className="btn btn-sm btn-outline-primary" onClick={()=>setScheduleRows([...scheduleRows,newScheduleRow()])}>＋ Add schedule</button></div>{scheduleRows.map((row,index)=><div className="schedule-row" key={index}><div className="schedule-label-field"><label className="form-label">Class type</label><input className="form-control" value={row.label} placeholder="Lecture / Laboratory" onChange={e=>setScheduleRows(scheduleRows.map((r,i)=>i===index?{...r,label:e.target.value}:r))}/></div><div><label className="form-label">Day</label><select className="form-select" value={row.day} onChange={e=>setScheduleRows(scheduleRows.map((r,i)=>i===index?{...r,day:e.target.value}:r))}>{DAYS.map(day=><option key={day}>{day}</option>)}</select></div><TimeDropdown label="Starts" value={row.startTime} onChange={value=>setScheduleRows(scheduleRows.map((r,i)=>i===index?{...r,startTime:value}:r))}/><TimeDropdown label="Ends" value={row.endTime} onChange={value=>setScheduleRows(scheduleRows.map((r,i)=>i===index?{...r,endTime:value}:r))}/>{scheduleRows.length>1 && <button type="button" className="schedule-remove" aria-label="Remove schedule" onClick={()=>setScheduleRows(scheduleRows.filter((_,i)=>i!==index))}>×</button>}</div>)}</div><button className="btn btn-primary w-100" disabled={busy}>Create subject</button></form></div></div>}
      {rosterOpen && <div className="modal-backdrop-custom" onMouseDown={e=>{if(e.target===e.currentTarget)setRosterOpen(false)}}><div className="modal-card"><button className="modal-x" onClick={()=>setRosterOpen(false)}>×</button><span className="eyebrow">CLASS ROSTER</span><h2>Add students</h2><p className="muted">Paste one student per line as <b>Full Name, then a tab, then Student Number</b>. Keep commas that belong to the name. Students with a registered portal account are matched automatically by student number.</p><button type="button" className="btn btn-outline-primary btn-sm mb-3" onClick={downloadRosterTemplate}>↓ Download sample roster (Excel)</button><form onSubmit={addRoster}><label className="form-label" htmlFor="roster-csv">Import roster CSV</label><input id="roster-csv" className="form-control mb-2" type="file" accept=".csv,text/csv" onChange={async e=>{const file=e.currentTarget.files?.[0];if(!file)return;try{setRosterText(parseCsv(await file.text()));setRosterFileName(file.name);setErr("");}catch(error){setErr(error instanceof Error?error.message:"Could not read this CSV.");}}}/>{rosterFileName && <div className="muted small mb-2">Loaded {rosterFileName}. Review the rows before adding them.</div>}<label className="form-label" htmlFor="roster-students">Or paste student rows</label><textarea id="roster-students" className="form-control roster-textarea" name="students" value={rosterText} onChange={e=>setRosterText(e.target.value)} placeholder={'Santos, Juan D.\t2026-0001\nReyes, Maria C.\t2026-0002'} required/><div className="privacy-note text-start">Only add students officially enrolled in this subject. Their portal account will match automatically when the student number matches.</div><button className="btn btn-primary w-100 mt-3" disabled={busy}>Add roster records</button></form></div></div>}
      {((teacher && (loading || loadingDetail)) || busy) && <div className="portal-waiting" role="status" aria-live="polite"><span className="spinner-border" aria-hidden="true"></span><strong>{busy?"Saving your changes…":loadingDetail?"Loading class records…":"Loading your portal…"}</strong></div>}
      {assessmentOpen && detail && <div className="modal-backdrop-custom" onMouseDown={e=>{if(e.target===e.currentTarget)setAssessmentOpen(false)}}><div className="modal-card"><button className="modal-x" onClick={()=>setAssessmentOpen(false)}>×</button><span className="eyebrow">GRADEBOOK</span><h2>Add assessment</h2><p className="muted">Scores are normalized within this category and multiplied by its course weight. Leave item weights blank to calculate from total points earned ÷ total possible. For custom shares, weight every item in that category so the item weights total 100%.</p><form onSubmit={addAssessment}><label className="form-label">Assessment name</label><input className="form-control mb-3" name="title" placeholder="Quiz 1" required/><label className="form-label">Grading category</label><select className="form-select mb-3" name="categoryId" required>{recordCategories.map(c=><option key={c.id} value={c.id}>{categoryPath(c,detail.categories)} ({categoryWeightLabel(c,detail.categories)})</option>)}</select><label className="form-label">Maximum points</label><input className="form-control mb-3" type="number" name="maxScore" min="0.01" step="0.01" required/><label className="form-label">Custom item weight within category (%)</label><input className="form-control mb-3" type="number" name="weight" min="0" max="100" step="0.5" placeholder="Automatic by points"/><label className="form-label">Due date (optional)</label><input className="form-control mb-4" type="date" name="dueDate"/><button className="btn btn-primary w-100" disabled={busy}>Add assessment</button></form></div></div>}
      <OnboardingGuide role={teacher ? "TEACHER" : "STUDENT"} open={onboardingOpen} onClose={closeOnboarding} onOpenHelp={openHelpFromTour}/>
      <HelpCenter role={teacher ? "TEACHER" : "STUDENT"} open={helpOpen} initialTab={helpInitialTab} pageContext={tab === "classes" ? selectedTitle + " · " + classSection : tab === "simulator" ? "Student grade simulation" : tab === "profile" ? "Profile and account settings" : tab === "chats" ? "Class chats" : teacher ? "Teaching overview" : "Academic overview"} onClose={()=>setHelpOpen(false)} onStartTour={()=>{setHelpOpen(false);setOnboardingOpen(true);}}/>
    </div>;
}
