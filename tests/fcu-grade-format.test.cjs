const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const source = fs.readFileSync("src/components/Portal.tsx", "utf8");
const gradeSource = fs.readFileSync("src/lib/grades.ts", "utf8");
const start = source.indexOf("async function downloadFcuGradeXlsx(");
const end = source.indexOf("function categoryPercent(", start);
assert.ok(start > 0 && end > start, "FCU exporter is present");
const sortStart = source.indexOf("function sortWorksheetRowCells(");
const sortEnd = source.indexOf("function crc32(", sortStart);
assert.ok(sortStart >= 0 && sortEnd > sortStart, "shared worksheet cell sorter is present");
const compiledSorter = ts.transpileModule(source.slice(sortStart, sortEnd), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
}).outputText;
const compiledExporter = ts.transpileModule(source.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
}).outputText;
const compiled = compiledSorter + "\n" + compiledExporter;

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
    window: { setTimeout() {} },
    setTimeout() {},
    zipStored: files => { saved = files; return Uint8Array.from([80, 75]); },
    excelColumn: columns,
    xmlEscape: escape,
    getCleanComponentName: name => {
      const parts = String(name).split("/");
      return (parts.length > 1 ? parts[parts.length - 1] : String(name)).trim().toUpperCase();
    },
    gradeDomainHeading: category => /laboratory|lab/i.test(category.name) ? "LAB." : /lecture|lect/i.test(category.name) ? "LECT." : String(category.name).toUpperCase(),
    gradeDomainWeight: category => Number(category.weight.toFixed(2)).toString() + "%",
    weightedCategoryPercent: (enrollment, category) => enrollment.equivalents[category.id] ?? null,
    gradeSheetAttendancePercent: (detail, enrollment, categoryId) => enrollment.attendancePercent?.[categoryId] ?? null,
    gradeSheetRootDomainSummary: (detail, enrollment, category) => {
      const rawEquivalentPercent = /attendance/i.test(category.name)
        ? enrollment.attendancePercent?.[category.id] ?? null
        : enrollment.equivalents?.[category.id] ?? null;
      return {
        rawEquivalentPercent,
        parentWeightedScore: rawEquivalentPercent === null ? null
          : Math.round(rawEquivalentPercent * category.weight) / 100
      };
    },
    gradeSheetComponentSummary: (detail, enrollment, component) => {
      const rawEquivalentPercent = enrollment.equivalents[component.name] ?? null;
      return {
        rawEquivalentPercent,
        parentWeightedScore: rawEquivalentPercent === null ? null
          : Math.round(rawEquivalentPercent * component.percentage) / 100
      };
    }
  ,
    isPassedGradeRemark: (remark, fallback) => {
      const value = String(remark || fallback || "").trim().toUpperCase();
      return (value === "PASS" ? "PASSED" : value) === "PASSED";
    },
    gradeRemarkIndicator: (remark, fallback) => {
      const value = String(remark || fallback || "").trim().toUpperCase();
      const normalized = value === "DRP" || value === "DROP" ? "DROPPED"
        : value === "INCOMPLETE" ? "INC"
        : /^NO\s+(?:(?:EXAM(?:INATION)?|EXAMINATION)\s+)?PERMIT(?:\s*\(NP\))?$/.test(value) ? "NP"
        : value === "PASS" ? "PASSED" : value;
      return normalized || "—";
    },
  };
  vm.runInNewContext(compiled + "\nthis.generateGradeFile = downloadFcuGradeXlsx;", context);
  const detail = {
    code: "ECE 16", title: "Design 1/Capstone Project 1",
    classId: "BSECE 4", term: "First Semester", academicYear: "2026-2027",
    categories, enrollments,
    assessments: [],
    gradeBands: [{ minPercent: 75, finalGrade: "2.00", remarks: "PASSED" }]
  };
  await context.generateGradeFile("demo.xlsx", "FCU Grading Sheet", detail, categories, "Faculty Example", "Instructor", "Dean Example", "Dean", components, Uint8Array.from([137, 80, 78, 71]));
  assert.ok(saved, "xlsx files created");
  return Object.fromEntries(saved.map(file => [file.name, file.content]));
}
const student = (name, equivalents, finalPercent = 95, remarks = "", studentNumber = "2023-0001") => ({
  studentName: name, studentNumber, equivalents, finalPercent, finalGradeOverride: null, remarks
});

test("all hand-built OOXML worksheet rows sort cells by ascending column reference", () => {
  const sortStart = source.indexOf("function sortWorksheetRowCells(");
  const sortEnd = source.indexOf("function crc32(", sortStart);
  assert.ok(sortStart >= 0 && sortEnd > sortStart, "shared OOXML cell sorter is present");
  const compiledSorter = ts.transpileModule(source.slice(sortStart, sortEnd), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
  }).outputText;
  const context = {};
  vm.runInNewContext(compiledSorter + ";this.sortWorksheetRowCells = sortWorksheetRowCells;", context);

  const scrambled = [
    '<c r="D12" t="inlineStr"><is><t>D</t></is></c>',
    '<c r="A12" t="inlineStr"><is><t>A</t></is></c>',
    '<c r="C12" t="inlineStr"><is><t>C</t></is></c>',
    '<c r="B12" t="inlineStr"><is><t>B</t></is></c>'
  ].join("");
  const sorted = context.sortWorksheetRowCells(scrambled);
  assert.deepEqual(Array.from(sorted.matchAll(/<c r="([A-Z]+[0-9]+)"/g), match => match[1]), ["A12", "B12", "C12", "D12"]);
  assert.ok(source.includes("sortWorksheetRowCells(row.map("), "the simple worksheet XML builder uses the shared sorter");
  assert.ok(source.includes("sortWorksheetRowCells(values.map("), "the styled worksheet XML builder uses the shared sorter");
});

test("OOXML ZIP writer encodes XML as UTF-8 and writes valid uncompressed ZIP records", () => {
  const start = source.indexOf("function crc32(");
  const end = source.indexOf("\nfunction downloadXlsx(", start);
  assert.ok(start > 0 && end > start, "CRC and ZIP writer helpers are present");
  const compiledZip = ts.transpileModule(source.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
  }).outputText;
  const context = { Uint8Array, DataView, TextEncoder, Math, Number, Error };
  vm.runInNewContext(compiledZip + "\nthis.writeZip = zipStored; this.calculateCrc32 = crc32;", context);

  const xmlFiles = [
    {
      name: "[Content_Types].xml",
      content: '<?xml version="1.0" encoding="UTF-8"?><Types><Default Extension="xml" ContentType="application/xml"/></Types>'
    },
    {
      name: "xl/worksheets/sheet1.xml",
      content: '<?xml version="1.0" encoding="UTF-8"?><worksheet><sheetData><row><c>Filamér Christian University — Roxas City, Capiz</c></row><row><c>REGISTRAR’S OFFICE · ACUCA</c></row></sheetData></worksheet>'
    },
    {
      name: "xl/styles.xml",
      content: '<?xml version="1.0" encoding="UTF-8"?><styleSheet><fonts count="1"/></styleSheet>'
    }
  ];
  const archive = context.writeZip(xmlFiles);
  assert.ok(archive instanceof Uint8Array, "ZIP writer returns raw Uint8Array bytes");
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const endOffset = archive.byteLength - 22;
  assert.equal(view.getUint32(endOffset, true), 0x06054b50, "EOCD signature is present");
  const entryCount = view.getUint16(endOffset + 10, true);
  const centralSize = view.getUint32(endOffset + 12, true);
  const centralOffset = view.getUint32(endOffset + 16, true);
  assert.equal(entryCount, xmlFiles.length);
  assert.equal(centralOffset + centralSize, endOffset, "central directory ends immediately before EOCD");

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const entries = new Map();
  let centralCursor = centralOffset;
  for (let index = 0; index < entryCount; index++) {
    assert.equal(view.getUint32(centralCursor, true), 0x02014b50, "central-directory signature is valid");
    const flags = view.getUint16(centralCursor + 8, true);
    const method = view.getUint16(centralCursor + 10, true);
    const crc = view.getUint32(centralCursor + 16, true);
    const compressedSize = view.getUint32(centralCursor + 20, true);
    const uncompressedSize = view.getUint32(centralCursor + 24, true);
    const nameLength = view.getUint16(centralCursor + 28, true);
    const extraLength = view.getUint16(centralCursor + 30, true);
    const commentLength = view.getUint16(centralCursor + 32, true);
    const localOffset = view.getUint32(centralCursor + 42, true);
    const nameBytes = archive.subarray(centralCursor + 46, centralCursor + 46 + nameLength);
    const name = decoder.decode(nameBytes);

    assert.equal(flags, 0x0800, name + " declares UTF-8 filenames");
    assert.equal(method, 0, name + " uses ZIP STORE (uncompressed) mode");
    assert.equal(compressedSize, uncompressedSize, name + " stores raw bytes without compression");

    assert.equal(view.getUint32(localOffset, true), 0x04034b50, name + " has a valid local-header signature");
    assert.equal(view.getUint16(localOffset + 6, true), flags, name + " local flags match central flags");
    assert.equal(view.getUint16(localOffset + 8, true), method, name + " local compression method is STORE");
    assert.equal(view.getUint32(localOffset + 14, true), crc, name + " local CRC matches central CRC");
    assert.equal(view.getUint32(localOffset + 18, true), compressedSize);
    assert.equal(view.getUint32(localOffset + 22, true), uncompressedSize);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    assert.equal(localNameLength, nameLength);
    assert.equal(decoder.decode(archive.subarray(localOffset + 30, localOffset + 30 + localNameLength)), name);

    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = archive.subarray(dataStart, dataStart + uncompressedSize);
    assert.equal(context.calculateCrc32(data), crc, name + " CRC-32 matches its UTF-8 payload");
    entries.set(name, decoder.decode(data));
    centralCursor += 46 + nameLength + extraLength + commentLength;
  }
  assert.equal(centralCursor, centralOffset + centralSize, "all central-directory bytes are accounted for");
  for (const file of xmlFiles) {
    assert.equal(entries.get(file.name), file.content, file.name + " round-trips byte-for-byte as UTF-8");
  }
  assert.match(entries.get("xl/worksheets/sheet1.xml"), /Filamér Christian University — Roxas City, Capiz/);
  assert.match(entries.get("xl/worksheets/sheet1.xml"), /REGISTRAR’S OFFICE · ACUCA/);
});

test("Generic Excel emits the merged Lecture/Lab summary with numeric cells", async () => {
  const categories = [
    { id: "lecture", name: "Lecture", weight: 60, sortOrder: 1 },
    { id: "lab", name: "Laboratory", weight: 40, sortOrder: 2 }
  ];
  const files = await generate(categories, [
    student("Example Student", { lecture: 71.39, lab: 89.5 }, 78.63),
    student("Incomplete Student", { lecture: null, lab: null }, null, "INC", "2023-0002")
  ], []);
  const sheet = files["xl/worksheets/sheet1.xml"];
  assert.match(sheet, /<mergeCell ref="A1:I9"\/>/);
  assert.match(sheet, /<pageSetup paperSize="14" orientation="landscape" fitToWidth="1"/);
  assert.match(sheet, /<mergeCell ref="C15:D15"\/>/);
  assert.match(sheet, /<mergeCell ref="E15:F15"\/>/);
  for (const range of ["A15:A16","B15:B16","G15:G16","H15:H16","I15:I16"]) assert.ok(sheet.includes('<mergeCell ref="'+range+'"/>'));
  assert.match(sheet, /<c r="C15"[^>]*>.*?LECT\. 60%/s);
  assert.match(sheet, /<c r="E15"[^>]*>.*?LAB\. 40%/s);
  assert.match(sheet, /<c r="C16"[^>]*>.*?EQ/s);
  assert.match(sheet, /<c r="D16"[^>]*>.*?60%/s);
  assert.match(sheet, /<c r="G15"[^>]*>.*?TG/s);
  assert.match(sheet, /<c r="H15"[^>]*>.*?FG/s);
  assert.match(sheet, /<c r="I15"[^>]*>.*?REMARKS/s);
  assert.match(sheet, /<c r="A17" s="12"[^>]*><v>1<\/v>/);
  assert.match(sheet, /<c r="B17"[^>]*>.*?EXAMPLE STUDENT/s);
  assert.match(sheet, /<c r="C17"[^>]*><v>71\.39<\/v>/);
  assert.match(sheet, /<c r="D17"[^>]*><v>42\.83<\/v>/);
  assert.match(sheet, /<c r="E17"[^>]*><v>89\.5<\/v>/);
  assert.match(sheet, /<c r="F17"[^>]*><v>35\.8<\/v>/);
  assert.match(sheet, /<c r="G17"[^>]*><v>78\.63<\/v>/);
  assert.match(sheet, /<c r="H17"[^>]*>.*?2\.00/s);
  assert.match(sheet, /<c r="I18"[^>]*>.*?INC/s);
  assert.match(files["xl/styles.xml"], /formatCode="0\.00"/);
  assert.match(sheet, /<col min="1" max="1" width="7"/);
  assert.match(sheet, /<col min="2" max="2" width="32"/);
  assert.doesNotMatch(sheet, /2023-0001|2023-0002/);
});test("Saved subcomponents do not add columns to the Final Grades summary", async () => {
  const categories = [
    { id: "lecture", name: "Lecture", weight: 60, sortOrder: 1 },
    { id: "exams", name: "Exams", parentId: "lecture", weight: 50, sortOrder: 1 },
    { id: "lab", name: "Lab", weight: 40, sortOrder: 2 }
  ];
  const files = await generate(categories, [
    student("Domain Student", { lecture: 71.39, lab: 89.5, "Lecture / Exams": 86 }, 78.63)
  ], [{ name: "Lecture / Exams", percentage: 50 }]);
  const sheet = files["xl/worksheets/sheet1.xml"];
  assert.match(sheet, /<mergeCell ref="C15:D15"\/>/);
  assert.match(sheet, /<mergeCell ref="E15:F15"\/>/);
  assert.match(sheet, /<c r="C17"[^>]*><v>71\.39<\/v>/);
  assert.match(sheet, /<c r="D17"[^>]*><v>42\.83<\/v>/);
  assert.match(sheet, /<c r="E17"[^>]*><v>89\.5<\/v>/);
  assert.match(sheet, /<c r="F17"[^>]*><v>35\.8<\/v>/);
  assert.match(sheet, /<c r="G17"[^>]*><v>78\.63<\/v>/);
  assert.doesNotMatch(sheet, /EXAMS/);
});test("Final Grades uses canonical statuses, two-tier headers, and dropped-only masking", () => {
  const helperStart = source.indexOf("function normalizeGradeRemark(");
  const helperEnd = source.indexOf("\nfunction gradeSheetRootDomainSummary(", helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart);
  const compiledHelpers = ts.transpileModule(source.slice(helperStart, helperEnd), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const statusStart = gradeSource.indexOf("export const CLASS_REMARK_OPTIONS = [");
  const statusEnd = gradeSource.indexOf("\n\n/** Category weights", statusStart);
  assert.ok(statusStart >= 0 && statusEnd > statusStart);
  const compiledStatus = ts.transpileModule(gradeSource.slice(statusStart, statusEnd).replace(/^export /gm, ""), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const context = {};
  vm.runInNewContext(compiledStatus + "\n" + compiledHelpers + "\nthis.h = {normalizeGradeRemark,resolvedGradeRemark,isPassedGradeRemark,gradeRemarkIndicator,gradeRemarkSelectionValue};", context);
  const h = context.h;
  assert.equal(h.normalizeGradeRemark("DRP"), "DROPPED");
  assert.equal(h.normalizeGradeRemark("INCOMPLETE"), "INC");
  assert.equal(h.gradeRemarkIndicator("DROPPED"), "DROPPED");
  assert.equal(h.gradeRemarkIndicator("DRP"), "DROPPED");
  assert.equal(h.gradeRemarkIndicator("INCOMPLETE"), "INC");
  assert.equal(h.gradeRemarkIndicator("FAILED"), "FAILED");
  assert.equal(h.gradeRemarkIndicator("NO EXAMINATION PERMIT"), "NP");
  assert.equal(h.gradeRemarkIndicator("NO PRIVILEGE"), "NO PRIVILEGE");
  assert.equal(h.isPassedGradeRemark("PASSED"), true);
  assert.equal(h.isPassedGradeRemark("DRP", "PASSED"), false);
  assert.equal(h.gradeRemarkSelectionValue("DRP"), "DROPPED");

  const finalStart = source.indexOf('{classSection === "final" && <section id="class-section-final"');
  const finalEnd = source.indexOf(String.fromCharCode(10) + "        </>}", finalStart);
  const finalSection = source.slice(finalStart, finalEnd);
  assert.ok(finalStart >= 0 && finalEnd > finalStart);
  assert.match(finalSection, /<th rowSpan=\{2\} scope="col"/);
  assert.match(finalSection, /<th key=\{domain\.id\} colSpan=\{2\} scope="colgroup"/);
  assert.match(finalSection, /gradeSheetEnrollmentBreakdown\(detail, en\)/);
  assert.match(finalSection, /isDroppedRemark\(currentRemark\)/);
  assert.match(finalSection, /studentIndex \+ 1/);
  assert.match(finalSection, /isDroppedStatus \? "" : total == null/);
  assert.match(finalSection, /summary\?\.rawEquivalentPercent/);
  assert.match(finalSection, /summary\?\.parentWeightedScore/);
  assert.match(finalSection, /font-mono tabular-nums align-middle/);
  assert.doesNotMatch(finalSection, /activeGradeSheetComponents\.map\(component/);
  assert.doesNotMatch(finalSection, /gradeSheetAdditionalComponents/);
  assert.match(finalSection, /title="NP means No Examination Permit \(No Permit\)\."/);

  const printStart = source.indexOf('<table className="print-grade-table generic-print-grade-table">');
  const printEnd = source.indexOf("</thead>", printStart);
  const printHeader = source.slice(printStart, printEnd);
  assert.match(printHeader, /<th rowSpan=\{2\}>NO\.<\/th>/);
  assert.match(printHeader, /<th key=\{domain\.id\} colSpan=\{2\}>/);
  assert.match(printHeader, /<th rowSpan=\{2\}>TG<\/th>/);
  assert.match(printHeader, /<th rowSpan=\{2\}>FG<\/th>/);
  assert.match(printHeader, /<th rowSpan=\{2\}>REMARKS<\/th>/);
  assert.match(source, /@page \{ size: 13in 8\.5in;/);
  assert.match(source, /Edit Record Scores Columns/);
});test("Generic Excel masks only dropped TG/FG and keeps other status grades visible", async () => {
  const categories = [{ id: "lecture", name: "Lecture", weight: 100 }];
  const incomplete = student("Incomplete Student", { lecture: 79 }, 79, "INCOMPLETE");
  incomplete.finalGradeOverride = "2.50";
  const noPermit = student("No Permit Student", { lecture: 74 }, 74, "NO EXAMINATION PERMIT");
  noPermit.finalGradeOverride = "3.00";
  const failed = student("Failed Student", { lecture: 70 }, 70, "FAILED");
  failed.finalGradeOverride = "4.00";
  const files = await generate(categories, [
    student("Dropped Student", { lecture: 83 }, 83, "DRP"),
    incomplete, noPermit, failed,
    student("Passed Student", { lecture: 91 }, 91, "PASSED")
  ], []);
  const sheet = files["xl/worksheets/sheet1.xml"];
  assert.match(sheet, /<c r="C17"[^>]*><v>83<\/v>/);
  assert.match(sheet, /<c r="D17"[^>]*><v>83<\/v>/);
  assert.match(sheet, /<c r="E17"[^>]*><is><t xml:space="preserve"><\/t><\/is><\/c>/);
  assert.match(sheet, /<c r="F17"[^>]*><is><t xml:space="preserve"><\/t><\/is><\/c>/);
  assert.match(sheet, /<c r="G17"[^>]*>.*?DROPPED/s);
  assert.match(sheet, /<c r="E18"[^>]*><v>79<\/v>/);
  assert.match(sheet, /<c r="F18"[^>]*>.*?2\.50/s);
  assert.match(sheet, /<c r="G18"[^>]*>.*?INC/s);
  assert.match(sheet, /<c r="E19"[^>]*><v>74<\/v>/);
  assert.match(sheet, /<c r="F19"[^>]*>.*?3\.00/s);
  assert.match(sheet, /<c r="G19"[^>]*>.*?NP/s);
  assert.match(sheet, /<c r="F20"[^>]*>.*?4\.00/s);
  assert.match(sheet, /<c r="G20"[^>]*>.*?FAILED/s);
  assert.match(sheet, /<c r="E21"[^>]*><v>91<\/v>/);
  assert.match(sheet, /<c r="G21"[^>]*>.*?PASSED/s);
  assert.doesNotMatch(sheet, /NO PRIVILEGE/);
});test("Generic PDF uses the same compact summary headers and landscape printing", () => {
  assert.match(source, /<strong>Save \/ Print Generic PDF<\/strong>/);
  assert.match(source, /"Download Generic Excel Sheet"/);
  assert.match(source, /Generating Excel file…/);
  assert.match(source, /gradeSheetPrimaryDomains\.map/);
  assert.doesNotMatch(source, /gradeSheetAdditionalComponents/);
  assert.match(source, /<th rowSpan=\{2\}>NO\.<\/th>/);
  assert.match(source, /<th key=\{domain\.id\} colSpan=\{2\}>/);
  assert.match(source, /<th rowSpan=\{2\}>REMARKS<\/th>/);
  assert.match(source, /@page \{ size: 13in 8\.5in;/);
});test("ISO signature names preserve saved profile titles without adding a forced prefix", () => {
  const route = fs.readFileSync("src/app/api/teacher/subjects/[subjectId]/iso-export/route.ts", "utf8");
  const start = route.indexOf("function normalizeSignatureName(");
  const end = route.indexOf("\nfunction readHeaderConfig(", start);
  assert.ok(start >= 0 && end > start, "profile formatters are present");
  const compiled = ts.transpileModule(route.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
  }).outputText;
  const context = {};
  vm.runInNewContext(compiled + "\nthis.normalizeSignatureName = normalizeSignatureName; this.resolveClassId = resolveClassId;", context);

  assert.equal(context.normalizeSignatureName("  dr. Firstname  M. Lastname  "), "DR. FIRSTNAME M. LASTNAME");
  assert.equal(context.normalizeSignatureName("Prof. Dean Example"), "PROF. DEAN EXAMPLE");
  assert.equal(context.normalizeSignatureName("ARCH. Sample Name"), "ARCH. SAMPLE NAME");
  assert.equal(context.normalizeSignatureName("Firstname M. Lastname"), "FIRSTNAME M. LASTNAME");
  assert.equal(context.normalizeSignatureName(""), "");

  assert.equal(context.resolveClassId({ classId: "BSECE 4", courseYear: "BSECE 3" }), "BSECE 4");
  assert.equal(context.resolveClassId({ classId: null, courseYear: "BSECE 4", sectionName: "Section A" }), "");
  assert.equal(context.resolveClassId({ classId: undefined, courseYear: "BSECE 4" }), "");
  assert.equal(context.resolveClassId({ classId: "   ", courseYear: "BSECE 4" }), "");
  assert.equal(context.resolveClassId({ classId: "migration_2026_ece-16", courseYear: "BSECE 4" }), "");
});
test("Attendance component calculates its own session percentage and weighted contribution", () => {
  const start = source.indexOf("function categoryDescendantIds(");
  const end = source.indexOf("\nfunction downloadGradeSheetXlsx(", start);
  assert.ok(start > 0 && end > start, "attendance component calculation helpers are present");
  const compiled = ts.transpileModule(source.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
  }).outputText;
  const context = {
    Set, Number, Math,
    categoryPath: category => category.name,
    isPassedGradeRemark: (remark, fallback) => {
      const value = String(remark || fallback || "").trim().toUpperCase();
      return (value === "PASS" ? "PASSED" : value) === "PASSED";
    },
    gradeRemarkIndicator: (remark, fallback) => {
      const value = String(remark || fallback || "").trim().toUpperCase();
      const normalized = value === "DRP" || value === "DROP" ? "DROPPED"
        : value === "INCOMPLETE" ? "INC" : value === "PASS" ? "PASSED" : value;
      return normalized === "DROPPED" ? "DRP" : normalized === "INC" ? "INC"
        : normalized === "NP" ? "NP" : ["FAILED", "FAIL", "NOT PASSED"].includes(normalized) ? "FAIL" : normalized || "—";
    },
    calculateGradeBreakdown: () => ({
      items: [
        { categoryId: "sessions", earnedCourse: 10 },
        { categoryId: "other-attendance", earnedCourse: 10 }
      ],
      domains: [
        { categoryId: "attendance", rawEquivalentPercent: 50, parentWeightedScore: 10 },
        { categoryId: "other-attendance", rawEquivalentPercent: 100, parentWeightedScore: 10 }
      ]
    }),
    calculateCategoryPercent: ({ assessments }) => {
      const counted = assessments.filter(item => item.scores[0]?.remark !== "EXCUSED" && (item.scores[0]?.remark || item.scores[0]?.points != null));
      if (!counted.length) return null;
      const earned = counted.filter(item => ["PRESENT", "LATE"].includes(item.scores[0].remark) || (item.scores[0].points ?? 0) > 0);
      return Number((earned.length / counted.length * 100).toFixed(2));
    }
  };
  vm.runInNewContext(compiled + "\nthis.componentPercent = gradeSheetComponentPercent; this.componentContribution = gradeSheetComponentContribution;", context);
  const detail = {
    categories: [
      { id: "attendance", parentId: null, name: "Attendance", weight: 20, conversionBase: 100 },
      { id: "sessions", parentId: "attendance", name: "Sessions", weight: 100, conversionBase: 100 },
      { id: "other-attendance", parentId: null, name: "Attendance Lab", weight: 10, conversionBase: 100 }
    ],
    assessments: [
      { id: "present", categoryId: "sessions", title: "Attendance · Present day", maxScore: 1, weight: null },
      { id: "absent", categoryId: "sessions", title: "Attendance · Absent day", maxScore: 1, weight: null },
      { id: "excused", categoryId: "sessions", title: "Attendance · Excused day", maxScore: 1, weight: null },
      { id: "other", categoryId: "other-attendance", title: "Attendance · Other class", maxScore: 1, weight: null }
    ]
  };
  const enrollment = { scores: [
    { assessmentId: "present", points: null, remark: "PRESENT" },
    { assessmentId: "absent", points: null, remark: "ABSENT" },
    { assessmentId: "excused", points: null, remark: "EXCUSED" },
    { assessmentId: "other", points: null, remark: "PRESENT" }
  ] };
  const component = { name: "Attendance", percentage: 20 };
  assert.equal(context.componentPercent(detail, enrollment, component), 50, "only sessions within the selected Attendance category are included");
  assert.equal(context.componentContribution(detail, enrollment, component), 10, "the attendance percentage is multiplied by the configured component weight");
});

test("Generic summary exports Attendance as a top-level weighted domain", async () => {
  const categories = [{ id: "ATT", parentId: null, name: "Attendance", weight: 20, sortOrder: 0 }];
  const files = await generate(categories, [{
    ...student("Attendance Student", { ATT: 75 }, 80),
    attendancePercent: { ATT: 75 }
  }], [{ name: "Attendance", percentage: 20 }]);
  const sheet = files["xl/worksheets/sheet1.xml"];
  assert.match(sheet, /<mergeCell ref="C15:D15"\/>/);
  assert.match(sheet, /<c r="C15"[^>]*>.*?ATTENDANCE 20%/s);
  assert.match(sheet, /<c r="C16"[^>]*>.*?EQ/s);
  assert.match(sheet, /<c r="D16"[^>]*>.*?20%/s);
  assert.match(sheet, /<c r="C17"[^>]*><v>75<\/v>/);
  assert.match(sheet, /<c r="D17"[^>]*><v>15<\/v>/);
});test("Generic summary supports a variable number of top-level domains", async () => {
  const categories = [
    { id: "QUIZZES", name: "Quizzes", weight: 30, sortOrder: 0 },
    { id: "LABORATORY", name: "Laboratory", weight: 50, sortOrder: 1 },
    { id: "PROJECT", name: "Project", weight: 20, sortOrder: 2 },
    { id: "ORAL", name: "Oral", weight: 0, sortOrder: 3 }
  ];
  const files = await generate(categories, [
    student("Student Name", { QUIZZES: 100, LABORATORY: 80, PROJECT: 90, ORAL: 75 }, 85.5)
  ], []);
  const sheet = files["xl/worksheets/sheet1.xml"];
  assert.match(sheet, /<mergeCell ref="A1:M9"\/>/);
  for (const range of ["C15:D15","E15:F15","G15:H15","I15:J15"]) {
    assert.ok(sheet.includes('<mergeCell ref="' + range + '"/>'));
  }
  assert.match(sheet, /<c r="C15"[^>]*>.*?QUIZZES 30%/s);
  assert.match(sheet, /<c r="E15"[^>]*>.*?LAB\. 50%/s);
  assert.match(sheet, /<c r="G15"[^>]*>.*?PROJECT 20%/s);
  assert.match(sheet, /<c r="I15"[^>]*>.*?ORAL 0%/s);
  assert.match(sheet, /<c r="C16"[^>]*>.*?EQ/s);
  assert.match(sheet, /<c r="D16"[^>]*>.*?30%/s);
  assert.match(sheet, /<c r="K15"[^>]*>.*?TG/s);
  assert.match(sheet, /<c r="L15"[^>]*>.*?FG/s);
  assert.match(sheet, /<c r="M15"[^>]*>.*?REMARKS/s);
  assert.match(sheet, /<c r="A17" s="12"[^>]*><v>1<\/v>/);
});test("Record Scores Excel export mirrors the full grouped scorebook and saved signature profiles", () => {
  const start = source.indexOf("function gradeSheetAttendancePercent(");
  const end = source.indexOf("async function downloadFcuGradeXlsx(", start);
  assert.ok(start > 0 && end > start, "generic grading-sheet exporter is present");
  const compiledGeneric = ts.transpileModule(source.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
  }).outputText;
  assert.match(source, /@page \{ size: 13in 8\.5in;/, "Final Grades PDF is landscape");
  assert.match(source, /printFinalGradesPdf\("generic"\)/);
  assert.match(source, /printFinalGradesPdf\("iso"\)/);
  assert.ok(compiledGeneric.includes("gradeSheetEnrollmentBreakdown"), "shared domain helper remains available");
});test("Record Scores export dynamically merges institutional, metadata, category, summary, and signature headers", () => {
  const start = source.indexOf("function gradeSheetAttendancePercent(");
  const end = source.indexOf("async function downloadFcuGradeXlsx(", start);
  assert.ok(start > 0 && end > start, "generic grading-sheet exporter is present");
  const compiledGeneric = ts.transpileModule(source.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
  }).outputText;
  let saved;
  const context = {
    Uint8Array, Number, String, Math, Set, Blob, TextEncoder,
    URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} },
    document: { createElement: () => ({ click() {} }) },
    window: { setTimeout() {} },
    setTimeout() {},
    zipStored: files => { saved = files; return Uint8Array.from([80, 75]); },
    excelColumn: columns,
    sortWorksheetRowCells: value => value,
    xmlEscape: escape,
    categoryPath: category => category.name,
    isPassedGradeRemark: (remark, fallback) => {
      const value = String(remark || fallback || "").trim().toUpperCase();
      return (value === "PASS" ? "PASSED" : value) === "PASSED";
    },
    gradeRemarkIndicator: (remark, fallback) => {
      const value = String(remark || fallback || "").trim().toUpperCase();
      const normalized = value === "DRP" || value === "DROP" ? "DROPPED"
        : value === "INCOMPLETE" ? "INC" : value === "PASS" ? "PASSED" : value;
      return normalized === "DROPPED" ? "DRP" : normalized === "INC" ? "INC"
        : normalized === "NP" ? "NP" : ["FAILED", "FAIL", "NOT PASSED"].includes(normalized) ? "FAIL" : normalized || "—";
    },
    categoryDescendantIds: (rootId, categories) => {
      const ids = new Set([rootId]);
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
    },
    formatSchedule: raw => raw || "",
    attendanceDays: assessments => assessments,
    consecutiveLateAbsences: () => new Set()
  };
  vm.runInNewContext(compiledGeneric + "\nthis.generateGeneric = downloadGradeSheetXlsx;", context);

  const categories = [
    { id: "LECTURE", parentId: null, name: "Lecture", sortOrder: 0, weight: 60 },
    { id: "MAJOR", parentId: "LECTURE", name: "Major Examinations", sortOrder: 0, weight: 40 },
    { id: "SEE", parentId: "LECTURE", name: "Self-Evaluation Exercises", sortOrder: 1, weight: 30 },
    { id: "QUIZ", parentId: "LECTURE", name: "Quizzes/Assignments", sortOrder: 2, weight: 30 },
    { id: "LABORATORY", parentId: null, name: "Laboratory", sortOrder: 1, weight: 40 },
    { id: "LAB_ACT", parentId: "LABORATORY", name: "Laboratory Activities", sortOrder: 0, weight: 100 }
  ];
  const assessmentGroups = [
    ["MAJOR", ["Midterm Examination", "Final Examination", "Comprehensive Examination"]],
    ["SEE", ["SEE 1", "SEE 2", "SEE 3"]],
    ["QUIZ", ["Quiz 1", "Quiz 2", "Assignment 1"]],
    ["LAB_ACT", ["Laboratory Exercise 1", "Laboratory Exercise 2", "Laboratory Practical"]]
  ];
  const assessments = assessmentGroups.flatMap(([categoryId, names]) =>
    names.map((name, index) => ({
      id: categoryId + "_" + index, categoryId, title: categoryId + " · " + name,
      maxScore: 50, dueDate: null, weight: null
    }))
  );
  const detail = {
    code: "ECE 16", title: "Design Project", classId: "BSECE-4A",
    term: "1st Semester", academicYear: "2026-2027", courseYear: "BSECE 4",
    schedule: "MWF 1:00–2:00 PM", categories, assessments, enrollments: [], gradeBands: []
  };
  context.generateGeneric(
    "record-scores.xlsx", "Record Scores", detail,
    "FILAMER CHRISTIAN UNIVERSITY, INC.",
    "Roxas Avenue, Roxas City, Capiz, Philippines",
    "COLLEGE OF ENGINEERING", "Teacher Example", "Instructor", "Dean Example", "Dean",
    [{ name: "EXAM", percentage: 50 }, { name: "ACT", percentage: 40 }, { name: "ARP", percentage: 10 }],
    assessments
  );
  const files = Object.fromEntries(saved.map(file => [file.name, file.content]));
  const sheet = files["xl/worksheets/sheet1.xml"];
  const styles = files["xl/styles.xml"];

  for (const row of [1, 2, 3]) assert.match(sheet, new RegExp('<mergeCell ref="A' + row + ':Z' + row + '"/>'));
  assert.match(sheet, /FILAMER CHRISTIAN UNIVERSITY, INC\./);
  assert.match(sheet, /Roxas Avenue, Roxas City, Capiz, Philippines/);
  assert.match(sheet, /COLLEGE OF ENGINEERING/);
  assert.match(sheet, /<mergeCell ref="A5:B5"\/>/);
  assert.match(sheet, /<mergeCell ref="C5:F5"\/>/);
  assert.match(sheet, /<mergeCell ref="G5:H5"\/>/);
  assert.match(sheet, /<mergeCell ref="I5:Z5"\/>/);
  assert.match(sheet, /<mergeCell ref="A6:B6"\/>/);
  assert.match(sheet, /<mergeCell ref="C6:F6"\/>/);
  assert.match(sheet, /<mergeCell ref="G6:H6"\/>/);
  assert.match(sheet, /<mergeCell ref="I6:Z6"\/>/);
  assert.match(sheet, /<mergeCell ref="A8:B8"\/>/);
  assert.match(sheet, /<mergeCell ref="C8:Z8"\/>/);
  assert.match(sheet, /<mergeCell ref="A9:B9"\/>/);
  assert.match(sheet, /<mergeCell ref="C9:Z9"\/>/);

  assert.match(sheet, /<mergeCell ref="D14:Q14"\/>/);
  assert.match(sheet, /<mergeCell ref="R14:W14"\/>/);
  assert.match(sheet, /<mergeCell ref="D15:G15"\/>/);
  assert.match(sheet, /<mergeCell ref="H15:K15"\/>/);
  assert.match(sheet, /<mergeCell ref="L15:O15"\/>/);
  assert.match(sheet, /<mergeCell ref="R15:U15"\/>/);
  assert.match(sheet, /<c r="D16"[^>]*>.*?Midterm Examination/s);
  assert.match(sheet, /<c r="D17"[^>]*>.*?MAX: 50/s);
  assert.match(sheet, /<c r="G16"[^>]*>.*?EQUIVALENT/s);
  assert.match(sheet, /<c r="G17"[^>]*>.*?\(%\)/s);

  for (const reference of ["X14:X17", "Y14:Y17", "Z14:Z17"]) {
    assert.ok(sheet.includes('<mergeCell ref="' + reference + '"/>'), reference + " is merged vertically");
  }
  assert.match(sheet, /<c r="X14"[^>]*>.*?TOTAL GRADE \(%\)/s);
  assert.match(sheet, /<c r="Y14"[^>]*>.*?FINAL GRADE/s);
  assert.match(sheet, /<c r="Z14"[^>]*>.*?REMARKS/s);
  for (let rowNumber = 19; rowNumber <= 24; rowNumber++) {
    assert.ok(sheet.includes('<mergeCell ref="A' + rowNumber + ':M' + rowNumber + '"/>'));
    assert.ok(sheet.includes('<mergeCell ref="N' + rowNumber + ':Z' + rowNumber + '"/>'));
  }
  for (const rowNumber of [20, 21, 22]) {
    const rowXml = sheet.match(new RegExp('<row r="' + rowNumber + '".*?<\\/row>'))?.[0] ?? "";
    assert.ok(rowXml, 'signature spacer row ' + rowNumber + ' exists');
    assert.doesNotMatch(rowXml, /<t[^>]*>[^<]+<\/t>/, 'signature spacer row ' + rowNumber + ' is blank');
  }
  for (const cell of ["A23", "N23", "A24", "N24"]) {
    assert.match(sheet, new RegExp('<c r="' + cell + '" s="17"'));
  }
  assert.match(sheet, /<c r="A23"[^>]*>.*?TEACHER EXAMPLE/s);
  assert.match(sheet, /<c r="N23"[^>]*>.*?DEAN EXAMPLE/s);
  assert.match(sheet, /<c r="A24"[^>]*>.*?Instructor/s);
  assert.match(sheet, /<c r="N24"[^>]*>.*?Dean/s);
  assert.match(styles, /<cellXfs count="18">/);
  assert.match(sheet, /Submitted by:/);
  assert.match(sheet, /Noted:/);
  assert.match(sheet, /TEACHER EXAMPLE/);
  assert.match(sheet, /DEAN EXAMPLE/);
  assert.match(sheet, /Instructor/);
  assert.match(sheet, /Dean/);
  assert.match(sheet, /<pane ySplit="17" topLeftCell="A18"/);
  assert.match(sheet, /<c r="A1" s="11"/);
  assert.match(sheet, /<c r="A2" s="12"/);
  assert.match(sheet, /<c r="A3" s="3"/);
  assert.match(styles, /<fonts count="8">/);
  assert.match(styles, /<b\/><sz val="12"\/>/);
  assert.match(styles, /<i\/><sz val="9"\/>/);
  assert.match(styles, /<b\/><sz val="10"\/>/);
  assert.match(sheet, /<row r="4"[^>]*><c r="A4" s="0"/);
  assert.match(sheet, /<row r="13"[^>]*><c r="A13" s="0"/);
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
    window: { setTimeout() {} },
    setTimeout() {},
    zipStored: files => { saved = files; return Uint8Array.from([80, 75]); },
    excelColumn: columns, sortWorksheetRowCells: value => value, xmlEscape: escape, categoryPath: category => category.name,
    formatSchedule: raw => { try { return JSON.parse(raw).map(row => `${row.label || "Class"} · ${row.day}, ${row.startTime}–${row.endTime}`).join(" / "); } catch { return raw || ""; } }
  };
  vm.runInNewContext(compiledGeneric + "\nthis.generateGeneric = downloadGradeSheetXlsx;", context);
  const detail = { code:"X",title:"No Assessments",classId:"A",term:"1st",academicYear:"2026",categories:[],assessments:[],enrollments:[],gradeBands:[] };
  context.generateGeneric("empty.xlsx","Grading Sheet",detail,"School","Address","DEPARTMENT OF ENGINEERING","Teacher","Instructor","Dean","Dean");
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

test("Final Grades print summary uses root-domain weighted contributions", () => {
  const start = source.indexOf("function gradeSheetComponentSummary(");
  const end = source.indexOf("\nfunction downloadGradeSheetXlsx(", start);
  assert.ok(start > 0 && end > start, "weighted component helper is present");
  const compiledContribution = ts.transpileModule(source.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
  }).outputText;
  const context = {
    categoryPath: category => category.name,
    isPassedGradeRemark: (remark, fallback) => {
      const value = String(remark || fallback || "").trim().toUpperCase();
      return (value === "PASS" ? "PASSED" : value) === "PASSED";
    },
    gradeRemarkIndicator: (remark, fallback) => String(remark || fallback || "").trim().toUpperCase() || "—",
    gradeSheetComponentPercent: () => 90,
    gradeSheetRootDomainSummary: () => null
  };
  vm.runInNewContext(compiledContribution + "\nthis.contribution = gradeSheetComponentContribution;", context);
  assert.equal(context.contribution({ categories: [{ id: "quiz", parentId: "lecture", name: "Quiz" }] }, {}, { name: "Quiz", percentage: 70 }), 63);
  assert.equal(context.contribution({ categories: [{ id: "exam", parentId: "lecture", name: "Exam" }] }, {}, { name: "Exam", percentage: 40 }), 36);
  assert.match(source, /gradeSheetRootDomainSummary\(detail,enrollment,domain\)/);
  const printStart = source.indexOf('<table className="print-grade-table generic-print-grade-table">');
  const printEnd = source.indexOf("</table>", printStart);
  const printTable = source.slice(printStart, printEnd);
  assert.ok(printTable.includes("gradeSheetEnrollmentBreakdown(detail, enrollment)"));
  assert.ok(printTable.includes("gradeSheetPrimaryDomains.map"));
  assert.ok(printTable.includes("domainShares.reduce"));
  assert.ok(!printTable.includes("gradeSheetAdditionalComponents.map"));
  assert.ok(printTable.includes("total.toFixed(2)"));
});test("assessment item order is saved and applied consistently in Assessment Items and Record Scores", () => {
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

 
test("Final Grades Excel exports expose busy feedback and always reset the button state", () => {
  assert.match(source, /const \[gradeExcelExporting, setGradeExcelExporting\] = useState<"generic" \| "iso" \| null>\(null\)/);
  assert.match(source, /setGradeExcelExporting\("generic"\)/);
  assert.match(source, /setGradeExcelExporting\("iso"\)/);
  assert.ok((source.match(/setGradeExcelExporting\(null\)/g) || []).length >= 2);
  assert.match(source, /finally \{\s*setGradeExcelExporting\(null\);\s*\}/);
  assert.match(source, /Generating Excel file…/);
  assert.match(source, /Preparing download…/);
  assert.match(source, /disabled=\{gradeExcelExporting !== null\}/);
  assert.match(source, /aria-busy=\{gradeExcelExporting === "generic"\}/);
  assert.match(source, /aria-busy=\{gradeExcelExporting === "iso"\}/);
});

test("Final Grades exposes a universal ISO export format picker and includes nested category components", () => {
  assert.ok(source.includes("Download Generic Excel Sheet"));
  assert.ok(source.includes("Export / Save Generic Grading Sheet"));
  assert.ok(source.includes('aria-label="Generic grading sheet export formats"'));
  assert.ok(source.includes("ensureGenericHeaderConfigured()"));
  assert.ok(source.includes("Export / Save ISO Grading Sheet"));
  assert.ok(source.includes("Save / Print ISO PDF"));
  assert.ok(source.includes("Download ISO Excel Sheet"));
  assert.ok(source.includes("renderGenericGradeHeaderPng"));
  assert.ok(source.includes("renderIsoGradeHeaderPng"));
  assert.ok(source.includes("loadGradeHeaderLogo(schoolLogoPath)"));
  assert.ok(source.includes("function ensureIsoHeaderConfigured()"));
  assert.ok(source.includes("ISO grading-sheet export is unavailable until the ISO document header is completed."));
  assert.ok(source.includes("function exportIsoGradesExcel()"));
  assert.ok(source.includes("Add category or subcategory from Grading Setup"));
  assert.ok(source.includes("categoryPath(category, detail.categories)"));
  assert.ok(source.includes("while (current && current.id !== root.id"));
});

test("Edit Components displays each category weight relative to its immediate parent", () => {
  const start = source.indexOf("function localCategoryWeight(");
  const end = source.indexOf("\nexport default function Portal", start);
  assert.ok(start > 0 && end > start, "category weight helpers are present");
  const compiledWeights = ts.transpileModule(source.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
  }).outputText;
  const context = {};
  vm.runInNewContext(compiledWeights + "\nthis.localCategoryWeight = localCategoryWeight; this.categoryWeightLabel = categoryWeightLabel;", context);

  const categories = [
    { id: "lecture", parentId: null, name: "Lecture", weight: 60, conversionBase: 50, sortOrder: 0 },
    { id: "major-exams", parentId: "lecture", name: "Major Examinations", weight: 50, conversionBase: 50, sortOrder: 0 },
    { id: "midterm", parentId: "major-exams", name: "Midterm", weight: 20, conversionBase: 50, sortOrder: 0 },
    { id: "finals", parentId: "major-exams", name: "Finals", weight: 30, conversionBase: 50, sortOrder: 1 }
  ];

  assert.equal(context.localCategoryWeight(categories[0]), 60);
  assert.equal(context.localCategoryWeight(categories[1]), 50);
  assert.equal(context.localCategoryWeight(categories[2]), 20);
  assert.equal(context.localCategoryWeight(categories[3]), 30);
  assert.equal(context.categoryWeightLabel(categories[0], categories), "60.00% of course");
  assert.equal(context.categoryWeightLabel(categories[1], categories), "50.00% within Lecture");
  assert.equal(context.categoryWeightLabel(categories[2], categories), "20.00% within Major Examinations");
  assert.equal(context.categoryWeightLabel(categories[3], categories), "30.00% within Major Examinations");

  assert.match(source, /percentage: Number\(localCategoryWeight\(category\)\.toFixed\(2\)\)/);
  assert.match(source, /localCategoryWeight\(category\)\.toFixed\(2\)\}%/);
  assert.doesNotMatch(source.slice(source.indexOf("Add category or subcategory from Grading Setup")), /effectiveCategoryWeight/);
});

test("Edit Components category picker includes parents and every eligible nested descendant", () => {
  const start = source.indexOf("function categoryHasGradingAssessments(");
  const end = source.indexOf("\nfunction rootCategory", start);
  assert.ok(start > 0 && end > start, "recursive category assessment helper is present");
  const compiled = ts.transpileModule(source.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
  }).outputText;
  const context = {};
  vm.runInNewContext(compiled + "\nthis.hasGradingAssessments = categoryHasGradingAssessments;", context);

  const categories = [
    { id: "lecture", parentId: null, name: "Lecture", weight: 60, conversionBase: 50, sortOrder: 0 },
    { id: "major-exams", parentId: "lecture", name: "Major Examinations", weight: 50, conversionBase: 50, sortOrder: 0 },
    { id: "midterm", parentId: "major-exams", name: "Midterm", weight: 20, conversionBase: 50, sortOrder: 0 },
    { id: "finals", parentId: "major-exams", name: "Finals", weight: 30, conversionBase: 50, sortOrder: 1 },
    { id: "unused", parentId: null, name: "Unused", weight: 10, conversionBase: 50, sortOrder: 1 },
    { id: "attendance", parentId: "unused", name: "Attendance", weight: 100, conversionBase: 50, sortOrder: 0 }
  ];
  const assessments = [
    { id: "a-midterm", categoryId: "midterm", title: "Midterm Exam" },
    { id: "a-finals", categoryId: "finals", title: "Final Examination" },
    { id: "a-attendance", categoryId: "attendance", title: "Attendance · Session 1" }
  ];

  for (const id of ["lecture", "major-exams", "midterm", "finals"]) {
    const category = categories.find(item => item.id === id);
    assert.equal(context.hasGradingAssessments(category, categories, assessments), true, `${id} should appear in the picker`);
  }
  assert.equal(context.hasGradingAssessments(categories.find(item => item.id === "attendance"), categories, assessments), true, "Attendance should be directly selectable");
  assert.equal(context.hasGradingAssessments(categories.find(item => item.id === "attendance"), categories, []), true, "Attendance should remain selectable before the first session is created");
  assert.equal(context.hasGradingAssessments(categories.find(item => item.id === "unused"), categories, assessments), false, "a non-attendance parent with only attendance descendants should stay out of the picker");
  assert.ok(source.includes("orderedCategoryTree(detail.categories).filter(category=>categoryHasGradingAssessments(category,detail.categories,detail.assessments)"), "the picker renders the full category tree");
  assert.ok(source.includes("orderedCategoryTree(categories).filter(category => categoryHasGradingAssessments(category, categories, assessments))"), "saved defaults can resolve parent and nested categories");
});

test("printable Collegiate sheet shows each root-domain weighted contribution", () => {
  const helperStart = source.indexOf("function categoryDescendantIds(");
  const helperEnd = source.indexOf("\nfunction downloadGradeSheetXlsx(", helperStart);
  assert.ok(helperStart > 0 && helperEnd > helperStart, "domain contribution helpers are present");
  const compiledHelpers = ts.transpileModule(source.slice(helperStart, helperEnd), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const gradeSource = fs.readFileSync("src/lib/grades.ts", "utf8")
    .replace('import { attendanceDays, consecutiveLateAbsences } from "./attendance";', "")
    .replace(/^export\s+/gm, "");
  const compiledGrades = ts.transpileModule(gradeSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const categoryPath = (category, categories) => {
    const names = [category.name];
    let parent = categories.find(item => item.id === category.parentId);
    const visited = new Set([category.id]);
    while (parent && !visited.has(parent.id)) {
      names.unshift(parent.name);
      visited.add(parent.id);
      parent = categories.find(item => item.id === parent.parentId);
    }
    return names.join(" / ");
  };
  const context = { categoryPath, attendanceDays: assessments => assessments, consecutiveLateAbsences: () => new Set() };
  vm.runInNewContext(compiledGrades + "\nthis.calculateGradeBreakdown = calculateGradeBreakdown;", context);
  vm.runInNewContext(compiledHelpers + "\nthis.componentContribution = gradeSheetComponentContribution;", context);
  const makeClass = (lectureWeight, labWeight, lectureScore, labScore) => {
    const categories = [
      { id: "lecture", parentId: null, name: "Lecture", weight: lectureWeight, conversionBase: 100, sortOrder: 0 },
      { id: "lecture-leaf", parentId: "lecture", name: "Lecture Work", weight: 100, conversionBase: 100, sortOrder: 0 },
      { id: "laboratory", parentId: null, name: "Laboratory", weight: labWeight, conversionBase: 100, sortOrder: 1 },
      { id: "laboratory-leaf", parentId: "laboratory", name: "Laboratory Work", weight: 100, conversionBase: 100, sortOrder: 0 }
    ];
    const assessments = [
      { id: "lecture-score", categoryId: "lecture-leaf", title: "Lecture Assessment", maxScore: 100, weight: null, dueDate: null },
      { id: "lab-score", categoryId: "laboratory-leaf", title: "Laboratory Assessment", maxScore: 100, weight: null, dueDate: null }
    ];
    const enrollment = { studentName: "AMBITO, JENSEN ANTON", scores: [
      { assessmentId: "lecture-score", points: lectureScore, remark: null },
      { assessmentId: "lab-score", points: labScore, remark: null }
    ]};
    return { categories, assessments, enrollments: [enrollment] };
  };
  const sample = makeClass(60, 40, 58.983, 96.5);
  const lecture = context.componentContribution(sample, sample.enrollments[0], { name: "Lecture", percentage: 60 });
  const laboratory = context.componentContribution(sample, sample.enrollments[0], { name: "Laboratory", percentage: 40 });
  assert.equal(lecture, 35.39);
  assert.equal(laboratory, 38.6);
  assert.equal(Number((lecture + laboratory).toFixed(2)), 73.99);
  const printStart = source.indexOf('<table className="print-grade-table generic-print-grade-table">');
  const printEnd = source.indexOf("</table>", printStart);
  const printTable = source.slice(printStart, printEnd);
  assert.ok(printTable.includes("gradeSheetPrimaryDomains.map"));
  assert.ok(printTable.includes("gradeSheetEnrollmentBreakdown(detail, enrollment)"));
  assert.ok(!printTable.includes("gradeSheetAdditionalComponents.map"));
  assert.ok(printTable.includes("domainShares.reduce"));
  assert.ok(printTable.includes("total.toFixed(2)"));
});
