const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const source = fs.readFileSync("src/components/Portal.tsx", "utf8");
const start = source.indexOf("async function downloadFcuGradeXlsx(");
const end = source.indexOf("function categoryPercent(", start);
assert.ok(start > 0 && end > start, "FCU exporter is present");
const compiled = ts.transpileModule(source.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
}).outputText;

const columns = index => {
  let n = index + 1, value = "";
  while (n) { n--; value = String.fromCharCode(65 + n % 26) + value; n = Math.floor(n / 26); }
  return value;
};
const escape = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");

async function generate(categories, enrollments, components) {
  let saved;
  const context = {
    Uint8Array, Number, String, Math, Set, console, Blob, TextEncoder,
    URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} },
    document: { createElement: () => ({ click() {} }) },
    setTimeout() {},
    fetch: async path => {
      assert.equal(path, "/fcu-grading-header.png");
      return { ok: true, arrayBuffer: async () => Uint8Array.from([137, 80, 78, 71]).buffer };
    },
    zipStored: files => { saved = files; return Uint8Array.from([80, 75]); },
    excelColumn: columns,
    xmlEscape: escape,
    weightedCategoryPercent: (enrollment, category) => enrollment.equivalents[category.id] ?? null
  };
  vm.runInNewContext(compiled + "\nthis.generateGradeFile = downloadFcuGradeXlsx;", context);
  const detail = {
    code: "ECE 16", title: "Design 1/Capstone Project 1",
    classId: "BSECE 4", term: "First Semester", academicYear: "2026-2027",
    categories, enrollments,
    assessments: [],
    gradeBands: [{ minPercent: 75, finalGrade: "2.00", remarks: "PASSED" }]
  };
  await context.generateGradeFile("demo.xlsx", "FCU Grading Sheet", detail, categories, "Faculty Example", "Dean Example", components);
  assert.ok(saved, "xlsx files created");
  return Object.fromEntries(saved.map(file => [file.name, file.content]));
}
const student = (name, equivalents, finalPercent = 95, remarks = "", studentNumber = "2023-0001") => ({
  studentName: name, studentNumber, equivalents, finalPercent, finalGradeOverride: null, remarks
});
test("FCU final-grade export uses the exact configured components and their weights", async () => {
  const components = [
    { name: "EXAM", percentage: 50 },
    { name: "ACT", percentage: 40 },
    { name: "ARP", percentage: 10 }
  ];
  const cats = components.map(item => ({ id: item.name, name: item.name, weight: item.percentage }));
  const files = await generate(cats, [
    student("Example Student", { EXAM: 80, ACT: 90, ARP: 100 }, 86),
    student("Incomplete Student", { EXAM: null, ACT: null, ARP: null }, null, "INC", "2023-0002")
  ], components);
  const sheet = files["xl/worksheets/sheet1.xml"];
  const styles = files["xl/styles.xml"];
  assert.match(sheet, /<mergeCell ref="A1:H9"/);
  assert.match(sheet, /<pageSetup paperSize="14" orientation="portrait" fitToWidth="1"/);
  assert.match(sheet, /showGridLines="0" zoomScale="90"/);
  assert.match(sheet, /<selection pane="bottomLeft" activeCell="A17"/);
  assert.match(sheet, /<c r="A15"[^>]*><is><t xml:space="preserve"><\/t><\/is><\/c>/);
  assert.match(sheet, /<c r="B15"[^>]*>.*?NAME OF STUDENTS/s);
  assert.match(sheet, /<c r="C15"[^>]*>.*?EXAM\. 50%/s);
  assert.match(sheet, /<c r="D15"[^>]*>.*?ACT\. 40%/s);
  assert.match(sheet, /<c r="E15"[^>]*>.*?ARP\. 10%/s);
  assert.match(sheet, /<c r="F15"[^>]*>.*?TOTAL GRADE/s);
  assert.match(sheet, /<c r="G15"[^>]*>.*?FINAL GRADE/s);
  assert.match(sheet, /<c r="H15"[^>]*>.*?REMARKS/s);
  assert.match(sheet, /<c r="A17"[^>]*>.*?1\./s);
  assert.match(sheet, /<c r="B17"[^>]*>.*?EXAMPLE STUDENT/s);
  assert.match(sheet, /<c r="C17"[^>]*><v>40<\/v>/);
  assert.match(sheet, /<c r="D17"[^>]*><v>36<\/v>/);
  assert.match(sheet, /<c r="E17"[^>]*><v>10<\/v>/);
  assert.match(sheet, /<c r="F17"[^>]*><v>86<\/v>/);
  assert.match(sheet, /<c r="G17"[^>]*>.*?2\.00/s);
  assert.match(sheet, /<c r="H18"[^>]*>.*?INC/s);
  assert.doesNotMatch(sheet, /<c r="C18"[^>]*><v>/);
  assert.match(styles, /numFmtId="164"/);
  assert.match(styles, /<sz val="9"\/>/);
  assert.ok(files["xl/drawings/drawing1.xml"]);
  assert.ok(files["xl/media/image1.png"]);
  assert.doesNotMatch(sheet, /2023-0001|2023-0002/);
  assert.match(sheet, /<c r="A18"[^>]*>.*?2\./s);
  assert.match(sheet, /<col min="1" max="1" width="6"/);
  assert.match(sheet, /<col min="2" max="2" width="32"/);
  assert.match(sheet, /<col min="3" max="5" width="13"/);
  assert.match(sheet, /<col min="6" max="6" width="14"/);
  assert.match(sheet, /<col min="7" max="7" width="11"/);
  assert.match(sheet, /<col min="8" max="8" width="18"/);
});

test("FCU final-grade export supports a variable number of components", async () => {
  const components = [
    { name: "QUIZZES", percentage: 30 },
    { name: "LABORATORY", percentage: 50 },
    { name: "PROJECT", percentage: 20 },
    { name: "ORAL", percentage: 0 }
  ];
  const cats = components.map(item => ({ id: item.name, name: item.name, weight: item.percentage }));
  const files = await generate(cats, [student("Student Name", { QUIZZES: 100, LABORATORY: 80, PROJECT: 90, ORAL: 75 }, 85.5)], components);
  const sheet = files["xl/worksheets/sheet1.xml"];
  assert.match(sheet, /<mergeCell ref="A1:I9"/);
  assert.match(sheet, /<c r="C15"[^>]*>.*?QUIZZES\. 30%/s);
  assert.match(sheet, /<c r="D15"[^>]*>.*?LABORATORY\. 50%/s);
  assert.match(sheet, /<c r="E15"[^>]*>.*?PROJECT\. 20%/s);
  assert.match(sheet, /<c r="F15"[^>]*>.*?ORAL\. 0%/s);
  assert.match(sheet, /<c r="G15"[^>]*>.*?TOTAL GRADE/s);
  assert.match(sheet, /<c r="H15"[^>]*>.*?FINAL GRADE/s);
  assert.match(sheet, /<c r="I15"[^>]*>.*?REMARKS/s);
});

test("generic grading sheet export uses class records, actual assessment scores, and editable Dean name", () => {
  const start = source.indexOf("function gradeSheetAttendancePercent(");
  const end = source.indexOf("async function downloadFcuGradeXlsx(", start);
  assert.ok(start > 0 && end > start, "generic grading-sheet exporter is present");
  const compiledGeneric = ts.transpileModule(source.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
  }).outputText;
  let saved;
  const context = {
    Uint8Array, Number, String, Math, Blob, TextEncoder,
    URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} },
    document: { createElement: () => ({ click() {} }) },
    setTimeout() {},
    zipStored: files => { saved = files; return Uint8Array.from([80, 75]); },
    excelColumn: columns,
    xmlEscape: escape,
    categoryPath: category => category.name,
    formatSchedule: raw => { try { return JSON.parse(raw).map(row => `${row.label || "Class"} · ${row.day}, ${row.startTime}–${row.endTime}`).join(" / "); } catch { return raw || ""; } },
    effectiveCategoryWeight: (category, categories) => {
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
    },
    calculateCategoryPercent: category => { const active = category.assessments.filter(item => item.scores[0]?.remark !== "EXCUSED" && (item.scores[0]?.remark || item.scores[0]?.points != null)); if (!active.length) return null; const earned = active.filter(item => ["PRESENT", "LATE"].includes(item.scores[0]?.remark) || (item.scores[0]?.points ?? 0) > 0).length; return Math.round(earned / active.length * 10000) / 100; }
  };
  vm.runInNewContext(compiledGeneric + "\nthis.generateGeneric = downloadGradeSheetXlsx;", context);
  const detail = {
    code: "ECE 16", title: "Design Project", classId: "BSECE-4A",
    term: "1st Semester", academicYear: "2026-2027", schedule: JSON.stringify([{ label: "Lecture", day: "Monday", startTime: "04:00 PM", endTime: "05:30 PM" }]),
    categories: [{ id: "QUIZ", name: "Quizzes", weight: 30 }, { id: "EXAM", name: "Major Exam", weight: 50 }, { id: "ATT", name: "Attendance", weight: 20 }],
    assessments: [
      { id: "Q1", categoryId: "QUIZ", title: "Quiz 1", maxScore: 10 },
      { id: "M1", categoryId: "EXAM", title: "Midterm", maxScore: 50, dueDate: null, weight: null },
      { id: "A1", categoryId: "ATT", title: "Attendance · 2026-11-02", maxScore: 1, dueDate: "2026-11-02", weight: null },
      { id: "A2", categoryId: "ATT", title: "Attendance · 2026-11-03", maxScore: 1, dueDate: "2026-11-03", weight: null },
      { id: "A3", categoryId: "ATT", title: "Attendance · 2026-11-04", maxScore: 1, dueDate: "2026-11-04", weight: null }
    ],
    enrollments: [
      { studentName: "Ana Reyes", scores: [{ assessmentId: "Q1", points: 8, remark: null }, { assessmentId: "M1", points: 42, remark: null }, { assessmentId: "A1", points: null, remark: "PRESENT" }, { assessmentId: "A2", points: null, remark: "ABSENT" }, { assessmentId: "A3", points: null, remark: "EXCUSED" }], finalPercent: 90, finalGradeOverride: null, remarks: null },
      { studentName: "Ben Cruz", scores: [{ assessmentId: "Q1", points: null, remark: "EXCUSED" }, { assessmentId: "M1", points: 35, remark: null }, { assessmentId: "A1", points: null, remark: "PRESENT" }, { assessmentId: "A2", points: null, remark: "PRESENT" }, { assessmentId: "A3", points: null, remark: "PRESENT" }], finalPercent: 80, finalGradeOverride: "2.00", remarks: "PASSED" }
    ],
    gradeBands: [{ minPercent: 75, finalGrade: "2.25", remarks: "PASSED" }]
  };
  context.generateGeneric("record-scores.xlsx", "Record Scores", detail, "Example University", "123 College Road", "Teacher One", "Dean Two", [{ name: "Quizzes", percentage: 30 }, { name: "Major Exam", percentage: 50 }]);
  const files = Object.fromEntries(saved.map(file => [file.name, file.content]));
  const sheet = files["xl/worksheets/sheet1.xml"];
  assert.match(sheet, /Example University/);
  assert.match(sheet, /School Address: 123 College Road/);
  assert.match(sheet, /RECORD SCORES/);
  assert.match(sheet, /Course Number: ECE 16/);
  assert.match(sheet, /Descriptive Title: Design Project/);
  assert.match(sheet, /Class ID: BSECE-4A/);
  assert.match(sheet, /Semester: 1st Semester/);
  assert.match(sheet, /Academic Year: 2026-2027/);
  assert.match(sheet, /Schedule: Lecture · Monday, 04:00 PM–05:30 PM/);
  assert.match(sheet, /Dean: Dean Two/);
  assert.match(sheet, /Display Components: Quizzes 30\.00% · Major Exam 50\.00%/);
  assert.doesNotMatch(sheet, /\[\{"label":"Lecture"/);
  assert.match(sheet, /NO\./);
  assert.match(sheet, /NAME OF STUDENTS/);
  assert.match(sheet, /<c r="A17"[^>]*>.*?1<\/t>/s);
  assert.match(sheet, /<c r="B17"[^>]*>.*?Ana Reyes/s);
  assert.match(sheet, /QUIZZES \(30\.00%\)/);
  assert.match(sheet, /MAJOR EXAM \(50\.00%\)/);
  assert.equal((sheet.match(/ATTENDANCE \(%\)/g) || []).length, 1, "attendance remains one calculated percentage column");
  assert.match(files["xl/styles.xml"], /<fonts count="5">.*?<sz val="9"\/>/s);
  assert.match(sheet, /Quizzes · Quiz 1 \(Max 10 · Item wt Points-based · Course wt 30\.00%\)/);
  assert.match(sheet, /8 \/ 10/);
  assert.match(sheet, /EXCUSED/);
  assert.match(sheet, /42 \/ 50/);
  assert.match(sheet, /90\.00%/);
  assert.match(sheet, /2\.00/);
  assert.match(sheet, /Teacher One/);
  assert.match(sheet, /Dean Two/);
  assert.match(sheet, /Teacher&apos;s Signature over Printed Name/);
  assert.match(sheet, /Dean&apos;s Signature over Printed Name/);
  assert.match(sheet, /orientation="landscape" fitToWidth="1"/);
  assert.match(sheet, /ATTENDANCE \(%\)/);
  assert.match(sheet, /50\.00%/);
  assert.doesNotMatch(sheet, /Attendance · 2026-11-02|Attendance · 2026-11-03|Attendance · 2026-11-04/);
  assert.match(sheet, /paperSize="256" orientation="landscape"/);
  assert.match(source, /@page \{ size: 8\.5in 13in/);
  assert.doesNotMatch(sheet, /Class Summary|Certification/);
  assert.ok(files["xl/styles.xml"]);
});

test("generic grading sheet supports a class with no assessment items without invalid Excel column ranges", () => {
  const start = source.indexOf("function gradeSheetAttendancePercent(");
  const end = source.indexOf("async function downloadFcuGradeXlsx(", start);
  const compiledGeneric = ts.transpileModule(source.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
  }).outputText;
  let saved;
  const context = {
    Uint8Array, Number, String, Math, Blob, TextEncoder,
    URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} },
    document: { createElement: () => ({ click() {} }) },
    setTimeout() {},
    zipStored: files => { saved = files; return Uint8Array.from([80, 75]); },
    excelColumn: columns, xmlEscape: escape, categoryPath: category => category.name,
    formatSchedule: raw => { try { return JSON.parse(raw).map(row => `${row.label || "Class"} · ${row.day}, ${row.startTime}–${row.endTime}`).join(" / "); } catch { return raw || ""; } }
  };
  vm.runInNewContext(compiledGeneric + "\nthis.generateGeneric = downloadGradeSheetXlsx;", context);
  const detail = { code:"X",title:"No Assessments",classId:"A",term:"1st",academicYear:"2026",categories:[],assessments:[],enrollments:[],gradeBands:[] };
  context.generateGeneric("empty.xlsx","Grading Sheet",detail,"School","Address","Teacher","");
  const sheet = saved.find(file => file.name === "xl/worksheets/sheet1.xml").content;
  assert.match(sheet, /<col min="2" max="2"/);
  assert.match(sheet, /orientation="landscape"/);
});

test("category ordering is hierarchical, persistent, and exposed from Assessment Items", () => {
  const orderStart = source.indexOf("function orderedCategoryTree(");
  const orderEnd = source.indexOf("function categoryPath(", orderStart);
  assert.ok(orderStart > 0 && orderEnd > orderStart, "category ordering helper is present");
  const orderedSource = ts.transpileModule(source.slice(orderStart, orderEnd), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
  }).outputText;
  const context = {};
  vm.runInNewContext(orderedSource + "\nthis.orderCategories = orderedCategoryTree;", context);
  const categories = [
    { id: "sub-b", parentId: "root-a", sortOrder: 1 },
    { id: "root-b", parentId: null, sortOrder: 0 },
    { id: "sub-a", parentId: "root-a", sortOrder: 0 },
    { id: "root-a", parentId: null, sortOrder: 1 },
    { id: "root-a-leaf", parentId: "sub-a", sortOrder: 0 }
  ];
  assert.deepEqual(
    Array.from(context.orderCategories(categories), item => item.id),
    ["root-b", "root-a", "sub-a", "root-a-leaf", "sub-b"]
  );
  assert.match(source, /async function moveAssessmentCategory/);
  assert.match(source, /Category order in Record Scores/);
  assert.match(source, /onClick=\{\(\) => void moveAssessmentCategory/);
  assert.match(source, /Export Excel<\/button>/);
  const subjectRoute = fs.readFileSync("src/app/api/teacher/subjects/[subjectId]/route.ts", "utf8");
  assert.match(subjectRoute, /sortOrder: z\.number\(\)\.int\(\)\.min\(0\)\.max\(1000\)\.optional\(\)/);
  assert.match(subjectRoute, /sortOrder: category\.sortOrder \?\? existing\.sortOrder/);
});

test("PDF component values are weighted by the configured course allocation", () => {
  const start = source.indexOf("function gradeSheetComponentContribution(");
  const end = source.indexOf("\nfunction downloadGradeSheetXlsx(", start);
  assert.ok(start > 0 && end > start, "weighted component helper is present");
  const compiledContribution = ts.transpileModule(source.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
  }).outputText;
  const context = { gradeSheetComponentPercent: () => 90 };
  vm.runInNewContext(compiledContribution + "\nthis.contribution = gradeSheetComponentContribution;", context);
  assert.equal(context.contribution({}, {}, { percentage: 70 }), 63);
  assert.equal(context.contribution({}, {}, { percentage: 40 }), 36);
  assert.match(source, /gradeSheetComponentContribution\(detail,enrollment,component\)/);
  const printHeader = source.slice(source.indexOf('<article className="print-grade-sheet'), source.indexOf('<div className="generic-print-course-details">'));
  assert.match(source, /<thead><tr><th aria-label="Sequence number"><\/th><th>NAME OF STUDENTS<\/th>/);
  assert.match(source, /<td>\{index\+1\}\.<\/td><td>\{enrollment\.studentName\.toLocaleUpperCase\(\)\}<\/td>/);
  assert.ok(printHeader.includes('className="generic-print-header-layout"'));
  assert.ok(printHeader.includes('className="generic-print-logo-slot generic-print-school-logo"'));
  assert.ok(printHeader.includes('alt="Primary institutional seal — Filamer Christian University, Inc."'));
  assert.ok(printHeader.includes('className="generic-print-school-name">{user.school.name}'));
  assert.ok(printHeader.includes('className="generic-print-department">{departmentName.trim()}'));
  assert.ok(printHeader.includes('className="generic-print-address">{schoolAddress.trim()'));
  assert.ok(!printHeader.includes("user.school.departmentName"), "PDF reads the current department-name field state");
  assert.ok(printHeader.includes('<strong className="generic-print-title">COLLEGIATE GRADE SHEET</strong>'));
  assert.ok(printHeader.includes('className="generic-print-term-year">{detail.term.toLocaleUpperCase()} A.Y. {detail.academicYear}'));
  assert.ok(printHeader.includes('className="generic-print-header-blank"'));
  assert.ok(printHeader.includes('className="generic-print-logo-slot generic-print-department-logo"'));
  assert.ok(printHeader.includes('alt="College of Engineering / department logo"'));
  assert.equal(printHeader.split('alt="Primary institutional seal — Filamer Christian University, Inc."').length - 1, 1, "institutional seal appears once");
  assert.equal(printHeader.split('alt="College of Engineering / department logo"').length - 1, 1, "department logo appears once");
  const schoolNamePosition = printHeader.indexOf('className="generic-print-school-name"');
  const departmentPosition = printHeader.indexOf('className="generic-print-department"');
  const addressPosition = printHeader.indexOf('className="generic-print-address"');
  const blankPosition = printHeader.indexOf('className="generic-print-header-blank"');
  const titlePosition = printHeader.indexOf('className="generic-print-title"');
  const termPosition = printHeader.indexOf('className="generic-print-term-year"');
  assert.ok(schoolNamePosition < departmentPosition && departmentPosition < addressPosition && addressPosition < blankPosition && blankPosition < titlePosition && titlePosition < termPosition, "center header follows the required school, college, address, blank, title, term/year order");
  assert.ok(source.includes("grid-template-columns:58px minmax(0,max-content) 58px"));
  assert.ok(source.includes("grid-template-rows:auto auto auto 1.2em auto auto"));
  assert.ok(source.includes("justify-content:center; column-gap:10px; row-gap:2px; width:fit-content; max-width:100%; margin:0 auto; text-align:center"), "the logo and text columns form one compact centered header unit");
  assert.ok(source.includes("generic-print-school-logo { grid-column:1; grid-row:1 / span 6; justify-self:center"));
  assert.ok(source.includes("generic-print-department-logo { grid-column:3; grid-row:1 / span 6; justify-self:center"));
  assert.ok(source.includes("generic-print-logo-slot { display:flex; align-items:center; justify-content:center; align-self:stretch; min-width:58px; width:58px;"));
  assert.ok(source.includes("generic-print-department { grid-column:2; grid-row:2"));
  assert.ok(source.includes("generic-print-address { grid-column:2; grid-row:3"));
  assert.ok(source.includes("generic-print-header-blank { grid-column:2; grid-row:4"));
  assert.ok(source.includes("generic-print-title { grid-column:2; grid-row:5"));
  assert.ok(source.includes("generic-print-term-year { grid-column:2; grid-row:6"));
  assert.ok(source.includes("generic-print-logo-placeholder"));
  assert.ok(source.includes('useEffect(() => { setSchoolAddress(user.school.address || ""); }, [user.school.address]);'));
  assert.ok(source.includes('useEffect(() => { setDepartmentName(user.school.departmentName || ""); }, [user.school.departmentName]);'));
  assert.ok(source.includes('function printFinalGradesPdf(format: "generic" | "iso" = "generic")'));
  assert.ok(source.includes("College / Department name is missing."));
  assert.ok(source.includes('onClick={() => printFinalGradesPdf("generic")}'));
  assert.ok(source.includes('onClick={() => printFinalGradesPdf("iso")}'));
  assert.match(source, /generic-print-address/);
  assert.match(source, /generic-print-department/);
  assert.match(source, /generic-print-title/);
  assert.match(source, /text-align:center/);
  assert.doesNotMatch(source, /generic-print-doc-control|generic-print-membership|grade-sheet-calculation-note|Institutional membership \/ accreditation/);
  assert.ok(source.includes("Save / Print Generic PDF"));
  assert.ok(source.includes("Save / Print ISO PDF"));
  assert.ok(printHeader.includes('<table className="iso-print-header-table" aria-label="ISO document control header">'));
  assert.ok(printHeader.includes('<td rowSpan={4} className="iso-print-seal-cell">'), "school seal spans all four ISO header rows");
  assert.ok(printHeader.includes('<td colSpan={3} className="iso-print-organization-cell">'), "institution name and address span columns 2–4");
  assert.ok(printHeader.includes("Form Name:"));
  assert.ok(printHeader.includes("Effectivity:"));
  assert.ok(printHeader.includes("Form No:"));
  assert.ok(printHeader.includes("Issuing Office:"));
  assert.ok(printHeader.includes("Revision No. {isoHeaderConfig.revisionNo}"));
  assert.ok(printHeader.includes('<div className="iso-print-page-cell"><span>Page No.</span><b>1</b></div>'));
  assert.ok(printHeader.includes("isoHeaderConfig.affiliationLine1"));
  assert.ok(printHeader.includes("isoHeaderConfig.affiliationLine2"));
  assert.ok(source.includes("border:1px solid black!important; border-collapse:collapse!important;"));
  assert.ok(source.includes('organizationAddress: "Roxas Avenue, Roxas City, Capiz, Philippines"'));
  assert.ok(source.includes('formNo: "FCU-EOMS-RO-006-F"'));
  assert.ok(source.includes('effectivity: "October 1, 2025"'));
  assert.ok(source.includes('issuingOffice: "REGISTRAR’S OFFICE"'));
  assert.ok(source.includes('isoStandard: "ISO 21001:2025"'));
  assert.ok(source.includes("function readIsoHeaderConfig("));
  assert.ok(source.includes("setIsoHeaderConfig(current => ({...current, affiliationLine1:event.target.value}))"));
  assert.ok(source.includes("isoHeaderConfig }"));
  const profileRoute = fs.readFileSync("src/app/api/profile/route.ts", "utf8");
  assert.match(profileRoute, /isoHeaderConfig: z\.object\(/);
  assert.match(profileRoute, /isoHeaderConfig: JSON\.stringify\(parsed\.data\.isoHeaderConfig\)/);
  const auth = fs.readFileSync("src/lib/auth.ts", "utf8");
  assert.match(auth, /isoHeaderConfig: true/);
  const schema = fs.readFileSync("prisma/schema.prisma", "utf8");
  assert.match(schema, /isoHeaderConfig\s+String\?/);
  const migration = fs.readFileSync("prisma/migrations/20261121000300_iso_document_header_config/migration.sql", "utf8");
  assert.match(migration, /ADD COLUMN "isoHeaderConfig" TEXT/);
  const courseDetails = source.slice(source.indexOf('<div className="generic-print-course-details">'), source.indexOf('<table className="print-grade-table generic-print-grade-table">'));
  assert.match(courseDetails, /generic-print-course-details-row-primary[\s\S]*?Course No\.[\s\S]*?detail\.code[\s\S]*?Descriptive Title[\s\S]*?detail\.title/);
  assert.match(courseDetails, /generic-print-course-details-row-secondary[\s\S]*?Class ID[\s\S]*?Semester[\s\S]*?Academic Year/);
  assert.doesNotMatch(courseDetails, /Course &amp; Year/);
  assert.match(source, /generic-print-course-details \{ display:flex; flex-direction:column/);
  assert.match(source, /generic-print-course-details-row>div \{ display:flex; align-items:baseline/);
  assert.match(source, /border:0/);
});

test("assessment item order is saved and applied consistently in Assessment Items and Record Scores", () => {
  assert.match(source, /async function moveAssessmentItem/);
  assert.match(source, /scorebookItems = useMemo\(\(\) => detail\?\.assessments\.filter\([\s\S]*?sort\(\(a,b\) => \(a\.sortOrder \?\? 0\) - \(b\.sortOrder \?\? 0\)\)/);
  assert.match(source, /sortOrder: item\.sortOrder \?\? 0/);
  assert.match(source, /items\.map\(\(item,itemIndex\)/);
  assert.match(source, /moveAssessmentItem\(category\.id,item\.id,-1\)/);
  const route = fs.readFileSync("src/app/api/teacher/subjects/[subjectId]/route.ts", "utf8");
  assert.match(route, /sortOrder: z\.number\(\)\.int\(\)\.min\(0\)\.max\(1000\)\.optional\(\)/);
  assert.match(route, /item\.sortOrder !== undefined && item\.sortOrder !== previous\.sortOrder/);
  assert.match(route, /sortOrder: item\.sortOrder \?\? existingById\.get\(item\.id\)!\.sortOrder/);
  const schema = fs.readFileSync("prisma/schema.prisma", "utf8");
  const modelStart = schema.indexOf("model Assessment {");
  const modelEnd = schema.indexOf("\nmodel Score", modelStart);
  assert.match(schema.slice(modelStart, modelEnd), /sortOrder\s+Int\s+@default\(0\)/);
  const migration = fs.readFileSync("prisma/migrations/20261121000200_add_assessment_sort_order/migration.sql", "utf8");
  assert.match(migration, /ROW_NUMBER\(\) OVER/);
  assert.match(migration, /PARTITION BY "subjectId", "categoryId"/);
  assert.match(migration, /ORDER BY "createdAt" ASC, "id" ASC/);
});


test("ISO header configuration is isolated per school and FCU receives its supplied preset", () => {
  const start = source.indexOf("type IsoHeaderConfig =");
  const end = source.indexOf("\ntype Detail =", start);
  assert.ok(start >= 0 && end > start, "ISO header defaults and parser are present");
  const compiled = ts.transpileModule(source.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
  }).outputText;
  const context = {};
  vm.runInNewContext(compiled + "\nthis.readIsoHeaderConfig = readIsoHeaderConfig;", context);
  const fcu = context.readIsoHeaderConfig("Filamer Christian University, Inc.", "filamer", null);
  assert.equal(fcu.formNo, "FCU-EOMS-RO-006-F");
  assert.equal(fcu.organizationAddress, "Roxas Avenue, Roxas City, Capiz, Philippines");
  assert.equal(fcu.issuingOffice, "REGISTRAR’S OFFICE");
  assert.equal(fcu.isoStandard, "ISO 21001:2025");
  const otherSchool = context.readIsoHeaderConfig("Another College", "another-college", null);
  assert.equal(otherSchool.formName, "");
  assert.equal(otherSchool.formNo, "");
  const savedOtherSchool = context.readIsoHeaderConfig("Another College", "another-college", JSON.stringify({
    ...otherSchool,
    formName: "INSTITUTIONAL RECORD SHEET",
    formNo: "AC-REG-001"
  }));
  assert.equal(savedOtherSchool.formName, "INSTITUTIONAL RECORD SHEET");
  assert.equal(savedOtherSchool.formNo, "AC-REG-001");
});

 
test("Final Grades exposes separate Generic and ISO Excel exports and includes nested category components", () => {
  assert.match(source, /Download Generic Excel Sheet/);
  assert.match(source, /Download ISO Excel Sheet/);
  assert.match(source, /function exportIsoGradesExcel\\(\\)/);
  assert.match(source, /Add category or subcategory from Grading Setup/);
  assert.match(source, /categoryPath\\(category, detail\\.categories\\)/);
  assert.match(source, /while \\(current && current\\.id !== root\\.id/);
});
