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

async function generate(categories, enrollments) {
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
    weightedCategoryPercent: (enrollment, category) => enrollment.equivalents[category.id] ?? null,
    effectiveCategoryWeight: category => category.weight
  };
  vm.runInNewContext(compiled + "\nthis.generateGradeFile = downloadFcuGradeXlsx;", context);
  const detail = {
    code: "ECE 16", title: "Design 1/Capstone Project 1",
    classId: "BSECE 4", term: "First Semester", academicYear: "2026-2027",
    categories, enrollments,
    assessments: [],
    gradeBands: [{ minPercent: 75, finalGrade: "2.00", remarks: "PASSED" }]
  };
  await context.generateGradeFile("demo.xlsx", "FCU Grading Sheet", detail, categories, "Faculty Example");
  assert.ok(saved, "xlsx files created");
  return Object.fromEntries(saved.map(file => [file.name, file.content]));
}
const student = (name, equivalents, finalPercent = 95, remarks = "") => ({
  studentName: name, equivalents, finalPercent, finalGradeOverride: null, remarks
});

test("FCU export keeps three fixed assessment headers and the approved Folio print format", async () => {
  const cats = [{ id: "EXAM", name: "EXAM", weight: 25 }, { id: "LECT", name: "LECT", weight: 75 }];
  const files = await generate(cats, [
    student("Example Student", { EXAM: 80, LECT: 100 }),
    student("Incomplete Student", { EXAM: null, LECT: null }, null, "INC")
  ]);
  const sheet = files["xl/worksheets/sheet1.xml"];
  const styles = files["xl/styles.xml"];
  assert.match(sheet, /<mergeCell ref="A1:K9"/);
  assert.match(sheet, /<mergeCell ref="A15:D15"/);
  assert.match(sheet, /<mergeCell ref="A17:D17"/);
  assert.match(sheet, /<mergeCell ref="G15:H15"/);
  assert.match(sheet, /<mergeCell ref="G17:H17"/);
  assert.match(sheet, /<pageSetup paperSize="14" orientation="portrait" fitToWidth="1"/);
  assert.match(sheet, /showGridLines="0" zoomScale="90"/);
  assert.match(sheet, /<selection pane="bottomLeft" activeCell="A17"/);
  assert.match(source, /display:table-header-group/);
  assert.match(source, /Print \/ Save PDF/);
  assert.match(sheet, /<c r="A11"[^>]*><is>.*?<u\/>.*?ECE 16/s);
  assert.match(sheet, /<c r="A13"[^>]*><is>.*?First Semester/s);
  assert.match(sheet, /<c r="A15"[^>]*>.*?NAME OF STUDENTS/s);
  assert.match(sheet, /<c r="E15"[^>]*>.*?: MAJOR EXAM :/s);
  assert.match(sheet, /<c r="F15"[^>]*>.*?: ATTENDANCE :/s);
  assert.match(sheet, /<c r="G15"[^>]*>.*?: ASSESSMENT :/s);
  assert.match(sheet, /<c r="A17"[^>]*>.*?1\. EXAMPLE STUDENT/s);
  assert.match(sheet, /<c r="I17"[^>]*><v>95<\/v>/);
  assert.match(sheet, /<c r="K18"[^>]*>.*?INC/s);
  assert.doesNotMatch(sheet, /<c r="E18"[^>]*><v>/);
  assert.match(styles, /numFmtId="164"/);
  assert.ok(files["xl/drawings/drawing1.xml"]);
  assert.ok(files["xl/media/image1.png"]);
  assert.doesNotMatch(sheet, /Example Student ID/);
});

test("FCU export keeps the same three assessment headings regardless of configured categories", async () => {
  const cats = ["EXAM", "SE", "LECT", "LAB"].map((id, i) => ({ id, name: id, weight: [30, 20, 30, 20][i] }));
  const files = await generate(cats, [student("Student Name", { EXAM: 100, SE: 100, LECT: 100, LAB: 100 }, 100)]);
  const sheet = files["xl/worksheets/sheet1.xml"];
  assert.match(sheet, /<c r="E15"[^>]*>.*?: MAJOR EXAM :/s);
  assert.match(sheet, /<c r="F15"[^>]*>.*?: ATTENDANCE :/s);
  assert.match(sheet, /<c r="G15"[^>]*>.*?: ASSESSMENT :/s);
  assert.match(sheet, /<c r="I15"[^>]*>.*?: TG :/s);
  assert.match(sheet, /<c r="J15"[^>]*>.*?: FG :/s);
  assert.match(sheet, /<c r="K15"[^>]*>.*?: REMARKS :/s);
  assert.match(sheet, /<mergeCell ref="G17:H17"/);
});


test("generic grading sheet export uses class records, actual assessment scores, and editable Dean name", () => {
  const start = source.indexOf("function downloadGradeSheetXlsx(");
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
    categoryPath: category => category.name
  };
  vm.runInNewContext(compiledGeneric + "\nthis.generateGeneric = downloadGradeSheetXlsx;", context);
  const detail = {
    code: "ECE 16", title: "Design Project", classId: "BSECE-4A",
    term: "1st Semester", academicYear: "2026-2027",
    categories: [{ id: "QUIZ", name: "Quizzes" }, { id: "EXAM", name: "Major Exam" }],
    assessments: [
      { id: "Q1", categoryId: "QUIZ", title: "Quiz 1", maxScore: 10 },
      { id: "M1", categoryId: "EXAM", title: "Midterm", maxScore: 50 }
    ],
    enrollments: [
      { studentName: "Ana Reyes", scores: [{ assessmentId: "Q1", points: 8, remark: null }, { assessmentId: "M1", points: 42, remark: null }], finalPercent: 90, finalGradeOverride: null, remarks: null },
      { studentName: "Ben Cruz", scores: [{ assessmentId: "Q1", points: null, remark: "EXCUSED" }, { assessmentId: "M1", points: 35, remark: null }], finalPercent: 80, finalGradeOverride: "2.00", remarks: "PASSED" }
    ],
    gradeBands: [{ minPercent: 75, finalGrade: "2.25", remarks: "PASSED" }]
  };
  context.generateGeneric("grading.xlsx", "Grading Sheet", detail, "Example University", "", "Teacher One", "Dean Two");
  const files = Object.fromEntries(saved.map(file => [file.name, file.content]));
  const sheet = files["xl/worksheets/sheet1.xml"];
  assert.match(sheet, /Example University/);
  assert.match(sheet, /School Address:/);
  assert.match(sheet, /GRADING SHEET/);
  assert.match(sheet, /Course Number: ECE 16/);
  assert.match(sheet, /Descriptive Title: Design Project/);
  assert.match(sheet, /Class ID: BSECE-4A/);
  assert.match(sheet, /Semester: 1st Semester/);
  assert.match(sheet, /Academic Year: 2026-2027/);
  assert.match(sheet, /NAME OF STUDENTS/);
  assert.match(sheet, /Quizzes · Quiz 1 \\(Max 10\\)/);
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
  assert.doesNotMatch(sheet, /Class Summary|Certification/);
  assert.ok(files["xl/styles.xml"]);
});

test("generic grading sheet supports a class with no assessment items without invalid Excel column ranges", () => {
  const start = source.indexOf("function downloadGradeSheetXlsx(");
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
    excelColumn: columns, xmlEscape: escape, categoryPath: category => category.name
  };
  vm.runInNewContext(compiledGeneric + "\nthis.generateGeneric = downloadGradeSheetXlsx;", context);
  const detail = { code:"X",title:"No Assessments",classId:"A",term:"1st",academicYear:"2026",categories:[],assessments:[],enrollments:[],gradeBands:[] };
  context.generateGeneric("empty.xlsx","Grading Sheet",detail,"School","Address","Teacher","");
  const sheet = saved.find(file => file.name === "xl/worksheets/sheet1.xml").content;
  assert.match(sheet, /<col min="2" max="4"/);
  assert.match(sheet, /orientation="landscape"/);
});
