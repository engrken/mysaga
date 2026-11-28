const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const source = fs.readFileSync("src/components/Portal.tsx", "utf8");
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
        : value === "INCOMPLETE" ? "INC" : value === "PASS" ? "PASSED" : value;
      return normalized === "DROPPED" ? "DRP" : normalized === "INC" ? "INC"
        : normalized === "NP" ? "NP" : ["FAILED", "FAIL", "NOT PASSED"].includes(normalized) ? "FAIL" : normalized || "—";
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

test("FCU final-grade export shows each saved component as raw and weighted columns", async () => {
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
  assert.match(sheet, /<mergeCell ref="A1:K9"\/>/);
  assert.match(sheet, /<pageSetup paperSize="14" orientation="portrait" fitToWidth="1"/);
  assert.match(sheet, /showGridLines="0" zoomScale="90"/);
  assert.match(sheet, /<selection pane="bottomLeft" activeCell="A17"/);
  assert.match(sheet, /<c r="A15"[^>]*><is><t xml:space="preserve"><\/t><\/is><\/c>/);
  assert.match(sheet, /<c r="B15"[^>]*>.*?NAME OF STUDENTS/s);
  assert.match(sheet, /<c r="C15"[^>]*>.*?EXAM · TOTAL \(RAW %\)/s);
  assert.match(sheet, /<c r="D15"[^>]*>.*?EXAM · WEIGHTED \(50\.00% OF COURSE\)/s);
  assert.match(sheet, /<c r="E15"[^>]*>.*?ACT · TOTAL \(RAW %\)/s);
  assert.match(sheet, /<c r="F15"[^>]*>.*?ACT · WEIGHTED \(40\.00% OF COURSE\)/s);
  assert.match(sheet, /<c r="G15"[^>]*>.*?ARP · TOTAL \(RAW %\)/s);
  assert.match(sheet, /<c r="H15"[^>]*>.*?ARP · WEIGHTED \(10\.00% OF COURSE\)/s);
  assert.match(sheet, /<c r="I15"[^>]*>.*?TOTAL GRADE/s);
  assert.match(sheet, /<c r="J15"[^>]*>.*?FINAL GRADE/s);
  assert.match(sheet, /<c r="K15"[^>]*>.*?REMARKS/s);
  assert.match(sheet, /<c r="A17"[^>]*>.*?1\./s);
  assert.match(sheet, /<c r="B17"[^>]*>.*?EXAMPLE STUDENT/s);
  assert.match(sheet, /<c r="C17"[^>]*><v>80<\/v>/);
  assert.match(sheet, /<c r="D17"[^>]*><v>40<\/v>/);
  assert.match(sheet, /<c r="E17"[^>]*><v>90<\/v>/);
  assert.match(sheet, /<c r="F17"[^>]*><v>36<\/v>/);
  assert.match(sheet, /<c r="G17"[^>]*><v>100<\/v>/);
  assert.match(sheet, /<c r="H17"[^>]*><v>10<\/v>/);
  assert.match(sheet, /<c r="I17"[^>]*><v>86<\/v>/);
  assert.match(sheet, /<c r="J17"[^>]*>.*?2\.00/s);
  assert.match(sheet, /<c r="K18"[^>]*>.*?INC/s);
  assert.doesNotMatch(sheet, /<c r="C18"[^>]*><v>/);
  assert.match(styles, /numFmtId="164"/);
  assert.match(styles, /<sz val="9"\/>/);
  assert.ok(files["xl/drawings/drawing1.xml"]);
  assert.ok(files["xl/media/image1.png"]);
  assert.doesNotMatch(sheet, /2023-0001|2023-0002/);
  assert.match(sheet, /<c r="A18"[^>]*>.*?2\./s);
  assert.match(sheet, /<col min="1" max="1" width="6"/);
  assert.match(sheet, /<col min="2" max="2" width="32"/);
  assert.match(sheet, /<col min="3" max="8" width="13"/);
  assert.match(sheet, /<col min="9" max="9" width="14"/);
  assert.match(sheet, /<col min="10" max="10" width="11"/);
  assert.match(sheet, /<col min="11" max="11" width="18"/);
});
test("Generic Excel keeps primary domains before additional saved subcomponents", async () => {
  const categories = [
    { id: "lecture", name: "Lecture", weight: 60, sortOrder: 1 },
    { id: "exams", name: "Exams", parentId: "lecture", weight: 50, sortOrder: 1 },
    { id: "lab", name: "Lab", weight: 40, sortOrder: 2 }
  ];
  const components = [{ name: "Lecture / Exams", percentage: 50 }];
  const files = await generate(categories, [
    student("Domain Student", { lecture: 71.39, lab: 89.5, "Lecture / Exams": 86 }, 78.63)
  ], components);
  const sheet = files["xl/worksheets/sheet1.xml"];
  assert.match(sheet, /<c r="C15"[^>]*>.*?LECTURE · Total \(RAW %\)/s);
  assert.match(sheet, /<c r="D15"[^>]*>.*?LECTURE · WEIGHTED \(60\.00% OF COURSE\)/s);
  assert.match(sheet, /<c r="E15"[^>]*>.*?LAB · TOTAL \(RAW %\)/s);
  assert.match(sheet, /<c r="F15"[^>]*>.*?LAB · WEIGHTED \(40\.00% OF COURSE\)/s);
  assert.match(sheet, /<c r="G15"[^>]*>.*?LECTURE \/ EXAMS · TOTAL \(RAW %\)/s);
  assert.match(sheet, /<c r="H15"[^>]*>.*?LECTURE \/ EXAMS · WEIGHTED \(50\.00%\)/s);
  assert.match(sheet, /<c r="I15"[^>]*>.*?TOTAL GRADE/s);
  assert.match(sheet, /<c r="C17"[^>]*><v>71\.39<\/v>/);
  assert.match(sheet, /<c r="D17"[^>]*><v>42\.83<\/v>/);
  assert.match(sheet, /<c r="E17"[^>]*><v>89\.5<\/v>/);
  assert.match(sheet, /<c r="F17"[^>]*><v>35\.8<\/v>/);
  assert.match(sheet, /<c r="G17"[^>]*><v>86<\/v>/);
  assert.match(sheet, /<c r="H17"[^>]*><v>43<\/v>/);
  assert.match(sheet, /<c r="I17"[^>]*><v>78\.63<\/v>/);
});

test("non-passing grade remarks hide numerical rows and resolve the correct shorthand", () => {
  const helperStart = source.indexOf("function normalizeGradeRemark(");
  const helperEnd = source.indexOf("\nfunction gradeSheetRootDomainSummary(", helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart, "shared status helpers are defined");
  const compiledHelpers = ts.transpileModule(source.slice(helperStart, helperEnd), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
  }).outputText;
  const context = {};
  vm.runInNewContext(compiledHelpers + "\nthis.helpers = { normalizeGradeRemark, resolvedGradeRemark, isPassedGradeRemark, gradeRemarkIndicator, gradeRemarkSelectionValue };", context);
  const h = context.helpers;
  assert.equal(h.normalizeGradeRemark("DRP"), "DROPPED");
  assert.equal(h.normalizeGradeRemark("INCOMPLETE"), "INC");
  assert.equal(h.isPassedGradeRemark("PASSED"), true);
  assert.equal(h.isPassedGradeRemark("Passed"), true);
  assert.equal(h.isPassedGradeRemark("DRP", "PASSED"), false);
  assert.equal(h.isPassedGradeRemark("DROPPED"), false);
  assert.equal(h.isPassedGradeRemark("INCOMPLETE"), false);
  assert.equal(h.isPassedGradeRemark(null, "FAILED"), false);
  assert.equal(h.gradeRemarkIndicator("DROPPED"), "DRP");
  assert.equal(h.gradeRemarkIndicator("DRP"), "DRP");
  assert.equal(h.gradeRemarkIndicator("INCOMPLETE"), "INC");
  assert.equal(h.gradeRemarkIndicator("INC"), "INC");
  assert.equal(h.gradeRemarkIndicator("FAILED"), "FAIL");
  assert.equal(h.gradeRemarkSelectionValue("DRP"), "DROPPED");
  assert.equal(h.gradeRemarkSelectionValue("INCOMPLETE"), "INC");

  assert.match(source, /if \(hasSpecialRemark\) return <td className="score-sheet-score score-sheet-score-hidden"/);
  assert.match(source, /hasSpecialRemark \? "" : enrollment\.finalPercent/);
  assert.match(source, /hasSpecialRemark \? <span className="score-sheet-status-indicator"/);
  assert.match(source, /mobile-score-status-only/);
  assert.match(source, /const passed=isPassedGradeRemark\(en\.remarks,band\?\.remarks\)/);
  assert.match(source, /!passed\?""/);
  assert.match(source, /!isPassedGradeRemark\(enrollment\.remarks,band\?\.remarks\)/);
  assert.match(source, /gradeRemarkIndicator\(enrollment\.remarks,band\?\.remarks\)/);
});

test("FCU Excel renders non-passing statuses in the grade cell and leaves numeric columns blank", async () => {
  const components = [{ name: "EXAM", percentage: 100 }];
  const categories = [{ id: "EXAM", name: "EXAM", weight: 100 }];
  const files = await generate(categories, [
    student("Dropped Student", { EXAM: 83 }, 83, "DRP"),
    student("Incomplete Student", { EXAM: 79 }, 79, "INCOMPLETE")
  ], components);
  const sheet = files["xl/worksheets/sheet1.xml"];
  assert.match(sheet, /<c r="F17"[^>]*><is><t xml:space="preserve">DRP<\/t><\/is><\/c>/);
  assert.match(sheet, /<c r="G17"[^>]*><is><t xml:space="preserve">DROPPED<\/t><\/is><\/c>/);
  assert.match(sheet, /<c r="F18"[^>]*><is><t xml:space="preserve">INC<\/t><\/is><\/c>/);
  assert.match(sheet, /<c r="G18"[^>]*><is><t xml:space="preserve">INC<\/t><\/is><\/c>/);
  for (const cell of ["C17", "D17", "E17", "C18", "D18", "E18"]) {
    assert.doesNotMatch(sheet, new RegExp('<c r="' + cell + '"[^>]*><v>'));
  }
});

test("Generic PDF export is offered only once inside the export dropdown", () => {
  assert.match(source, /<strong>Save \/ Print Generic PDF<\/strong>/, "the Generic dropdown retains its PDF option");
  assert.match(source, /"Download Generic Excel Sheet"/, "the Generic dropdown retains its idle Excel option label");
  assert.match(source, /Generating Excel file…/, "the Generic dropdown exposes its loading label");
  assert.doesNotMatch(source, /<button className="btn btn-outline-primary" onClick=\{\(\) => printFinalGradesPdf\("generic"\)\}>Save \/ Print Generic PDF<\/button>/, "the duplicate standalone PDF button is removed");
  assert.match(source, /gradeSheetPrimaryDomains\.map/);
  assert.match(source, /gradeSheetAdditionalComponents\.map/);
  assert.match(source, /gradeSheetComponents\.map\(component=>\{/);
});

test("ISO Excel export uses dynamic class metadata and omits student-number columns", () => {
  const route = fs.readFileSync("src/app/api/teacher/subjects/[subjectId]/iso-export/route.ts", "utf8");
  assert.match(route, /const headers = \[\s*"NO\.",\s*"NAME OF STUDENTS",\s*\.\.\.assessmentHeaders/);
  assert.doesNotMatch(route, /"Student Number"/);
  assert.doesNotMatch(route, /enrollment\.studentNumber/);
  assert.match(route, /courseCode: subject\.code/);
  assert.match(route, /courseTitle: subject\.title/);
  assert.match(route, /id: subject\.id/);
  assert.match(route, /semester: subject\.term/);
  assert.match(route, /academicYear: subject\.academicYear/);
  assert.match(route, /classId: resolveClassId\(subject\)/);
  assert.doesNotMatch(route, /sectionName: resolveSectionName/);
  assert.doesNotMatch(route, /calculateGradeBreakdown|calculateCategoryPercent|componentContribution/, "ISO export must not calculate grades");
  assert.match(route, /return score\?\.points \?\? score\?\.remark \?\? ""/);
  assert.match(route, /\.\.\.parsed\.data\.componentNames\.map\(\(\) => ""\)/);
  assert.match(route, /enrollment\.finalGradeOverride \?\? ""/);
  assert.match(route, /enrollment\.remarks \?\? ""/);
});

test("ISO Excel export uses the authenticated Python openpyxl generator", () => {
  const pythonSource = fs.readFileSync("api/iso_export.py", "utf8");
  const endpoint = fs.readFileSync("src/app/api/teacher/subjects/[subjectId]/iso-export/route.ts", "utf8");
  const profileRoute = fs.readFileSync("src/app/api/profile/route.ts", "utf8");
  const prismaSchema = fs.readFileSync("prisma/schema.prisma", "utf8");
  const signatoryMigration = fs.readFileSync("prisma/migrations/20261124000200_teacher_profile_signatory_titles/migration.sql", "utf8");
  assert.doesNotMatch(source, /function downloadIsoXlsx\(/, "the handwritten ISO OOXML writer is removed");
  assert.match(source, /renderIsoExcelSealPng\(\)/);
  assert.doesNotMatch(source, /renderIsoExcelLogoBlockPng/);
  assert.match(source, /ctx\.arc\(80, 80, 76/);
  assert.match(source, /loadGradeHeaderLogo\(schoolLogoPath\)/);
  assert.doesNotMatch(source.slice(source.indexOf("async function renderIsoExcelSealPng"), source.indexOf("async function exportIsoGradesExcel")), /departmentLogoPath/);
  assert.match(source, /ctx\.drawImage\(schoolLogo, sourceX, sourceY, cropSize, cropSize, 4, 4, 152, 152\)/);
  assert.doesNotMatch(source.slice(source.indexOf("async function renderIsoExcelSealPng"), source.indexOf("async function exportIsoGradesExcel")), /fillText\(/);
  assert.match(source, /componentNames: gradeSheetComponents\.map/);
  assert.match(source, /\/iso-export/);
  assert.match(source, /window\.btoa\(binary\)/);
  assert.match(source, /response\.blob\(\)/);
  assert.match(pythonSource, /from openpyxl import Workbook/);
  assert.match(pythonSource, /column_count = max\(7, len\(headers\)/, "active column count is computed before header layout");
  assert.match(pythonSource, /center_end_column = column_count - 2/);
  assert.match(pythonSource, /metadata_label_column = column_count - 1/);
  assert.match(pythonSource, /metadata_value_column = column_count/);
  assert.match(pythonSource, /_merge_with_border\(worksheet, "A1:A4", THIN_BORDER\)/);
  assert.match(pythonSource, /_merge_with_border\(worksheet, "B1:B4", THIN_BORDER\)/);
  assert.match(pythonSource, /"C\{0\}:\{1\}\{0\}"\.format\(row_number, center_end_letter\)/);
  assert.match(pythonSource, /enumerate\(\(32, 24, 24, 22\), start=1\)/);
  assert.match(pythonSource, /wrap_text=False, shrink_to_fit=True/);
  assert.match(pythonSource, /CellRichText/);
  assert.match(pythonSource, /InlineFont\(rFont="Arial", sz=11, b=True\)/);
  assert.match(pythonSource, /InlineFont\(rFont="Arial", sz=8\.5, i=True\)/);
  assert.match(pythonSource, /"FORM NAME:\\n"/);
  assert.match(pythonSource, /"FORM NO\.:\\n"/);
  assert.match(pythonSource, /"REVISION NO\.: "/);
  assert.match(pythonSource, /metadata = \(/);
  assert.match(pythonSource, /"Effectivity:"/);
  assert.match(pythonSource, /"Issuing Office:"/);
  assert.match(pythonSource, /"Page No\."/);
  assert.match(pythonSource, /column_dimensions\[get_column_letter\(metadata_label_column\)\]\.width = 18/);
  assert.match(pythonSource, /column_dimensions\[get_column_letter\(metadata_value_column\)\]\.width = 22/);
  assert.match(pythonSource, /worksheet\.merge_cells\("D7:G7"\)/);
  assert.match(pythonSource, /_set_literal\(worksheet\["A8"\], "Class I\.D\."\)/);
  assert.match(pythonSource, /METADATA_BOTTOM_BORDER/);
  assert.match(pythonSource, /image\.width = 80/);
  assert.match(pythonSource, /image\.height = 80/);
  assert.match(pythonSource, /OneCellAnchor/);
  assert.match(pythonSource, /cell\.number_format = "0\.00%"/);
  assert.match(pythonSource, /Percentage columns are passed as fractions/);
  assert.match(pythonSource, /def _normalize_signature_name/);
  assert.match(pythonSource, /signature_space_rows = range\(signature_label_row \+ 1, signature_label_row \+ 4\)/);
  assert.match(pythonSource, /signature_name_row = signature_label_row \+ 4/);
  assert.match(pythonSource, /signature_position_row = signature_label_row \+ 5/);
  assert.match(pythonSource, /clean_header\["teacherPosition"\]/);
  assert.match(pythonSource, /clean_header\["notedByPosition"\]/);
  assert.match(pythonSource, /teacher_name = _normalize_signature_name\(clean_header\["submittedBy"\]\)/);
  assert.match(pythonSource, /noted_by_name = _normalize_signature_name\(clean_header\["notedByName"\]\)/);
  assert.doesNotMatch(pythonSource, /class_metadata\.get\("(?:teacherName|notedByName)"/);
  assert.doesNotMatch(pythonSource, /^\s*BOTTOM_BORDER\s*=|signature_rule_row/m);
  assert.match(pythonSource, /Font\(name="Arial", size=10, bold=True\)/);
  assert.match(pythonSource, /Alignment\(horizontal="center", vertical="center", wrap_text=True\)/);
  assert.match(pythonSource, /merge_cells\("A5:\{0\}5"\.format\(last_column_letter\)\)/);
  assert.match(pythonSource, /merge_cells\("A6:\{0\}6"\.format\(last_column_letter\)\)/);
  assert.match(pythonSource, /paperSize = "14"/);
  assert.match(pythonSource, /showGridLines = True/);
  assert.match(pythonSource, /fitToWidth = 1/);
  assert.match(pythonSource, /fitToHeight = 0/);
  assert.match(pythonSource, /SAGA-ISO-EXPORT-v1/);
  assert.match(endpoint, /requireRole\("TEACHER"\)/);
  assert.match(endpoint, /teacherId: teacher\.id, schoolId: teacher\.schoolId/);
  assert.doesNotMatch(endpoint, /calculateGradeBreakdown|calculateCategoryPercent|componentContribution/, "ISO export must not calculate grades");
  assert.match(endpoint, /createHmac\("sha256", secret\)/);
  assert.match(endpoint, /function normalizeSignatureName\(/);
  assert.match(endpoint, /submittedBy: normalizeSignatureName\(teacher\.fullName\)/);
  assert.match(endpoint, /function readHeaderConfig\(teacher: any\)/);
  assert.match(endpoint, /normalizeSignatureName\(teacher\.notedByName\)/);
  assert.match(endpoint, /teacher\.positionTitle/);
  assert.match(endpoint, /teacher\.notedByPosition/);
  assert.match(endpoint, /const configuredHeader = readHeaderConfig\(teacher\)/);
  assert.doesNotMatch(endpoint, /signatories:|parsed\.data\.notedByName|parsed\.data\.teacherPosition/);
  assert.match(profileRoute, /notedByName: z\.string\(\)\.trim\(\)\.min\(1\)/);
  assert.match(profileRoute, /notedByPosition: z\.string\(\)\.trim\(\)\.min\(1\)/);
  assert.match(profileRoute, /notedByName: parsed\.data\.notedByName/);
  assert.match(profileRoute, /notedByPosition: parsed\.data\.notedByPosition/);
  assert.doesNotMatch(profileRoute, /tx\.school\.update\([\s\S]*notedByName/);
  assert.match(prismaSchema, /model User \{[\s\S]*?notedByName\s+String\?[\s\S]*?notedByPosition\s+String\?/);
  assert.doesNotMatch(prismaSchema.slice(prismaSchema.indexOf("model School"), prismaSchema.indexOf("model TenantPayment")), /notedByName|notedByPosition|deanName/);
  assert.match(signatoryMigration, /UPDATE "User" AS teacher[\s\S]*teacher\."schoolId" = school\."id"[\s\S]*teacher\."role" = 'TEACHER'/);
  assert.doesNotMatch(signatoryMigration, /ALTER TABLE "School"\s+DROP COLUMN/i, "retain legacy columns until the new production version has replaced the currently serving app");
  assert.doesNotMatch(endpoint, /normalizeSignatureName\([^)]*,\s*"ENGR\."\)/, "profile titles must not be forced");
  assert.match(endpoint, /function resolveClassId\(/);
  assert.match(endpoint, /classId: resolveClassId\(subject\)/);
  assert.doesNotMatch(endpoint, /resolveSectionName|hasUnenteredMajorCategories|sectionName:/);
  assert.doesNotMatch(endpoint, /Number\(\(contribution \/ 100\)\.toFixed\(6\)\)|effectiveTotalPercent/);
  assert.match(endpoint, /header: configuredHeader\.header/);
  assert.doesNotMatch(endpoint, /teacherName: configuredHeader\.header|notedByName: configuredHeader\.header/);
  assert.match(source, /function ensureSignatoriesConfigured\(\)/);
  assert.match(source, /const unsavedChanges =/);
  assert.match(source, /Save your Profile Information changes before exporting/);
  assert.match(source, /if \(!ensureSignatoriesConfigured\(\)\) return;/);
  assert.match(source, /!ensureSignatoriesConfigured\(\) \|\| !ensureGenericHeaderConfigured\(\)/);
  assert.match(source, /!ensureSignatoriesConfigured\(\) \|\| !ensureIsoHeaderConfigured\(\)/);
  assert.match(source, /className="signature-space"/);
  assert.match(source, /className="signature-position"/);
  assert.match(source, /useState\(user\.notedByName \|\| ""\)/);
  assert.match(source, /useState\(user\.positionTitle \|\| ""\)/);
  assert.match(source, /useState\(user\.notedByPosition \|\| ""\)/);
  assert.doesNotMatch(source, /school\.notedByName|school\.notedByPosition/);
  assert.doesNotMatch(source, /print-signatures u \{[^}]*border-bottom/s);
  assert.match(endpoint, /process\.env\.VERCEL_PROJECT_PRODUCTION_URL/, "production calls use the stable project domain");
  assert.match(endpoint, /process\.env\.VERCEL_ENV === "production"/, "the routing choice distinguishes production from previews");
  assert.match(endpoint, /productionHost \|\| deploymentHost/, "production prefers the stable production host");
  assert.match(endpoint, /deploymentHost \|\| productionHost/, "previews prefer their own deployment host");
  assert.match(endpoint, /ISO_EXPORT_FUNCTION_URL/, "an explicit internal function URL can override automatic routing");
});

test("ISO signature names preserve saved profile titles without adding a forced prefix", () => {
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

test("FCU final-grade export calculates Attendance as a weighted component", async () => {
  const components = [{ name: "Attendance", percentage: 20 }];
  const categories = [{ id: "ATT", parentId: null, name: "Attendance", weight: 20 }];
  const files = await generate(categories, [{
    ...student("Attendance Student", {}, 80),
    attendancePercent: { ATT: 75 }
  }], components);
  const sheet = files["xl/worksheets/sheet1.xml"];
  assert.match(sheet, /<c r="C15"[^>]*>.*?ATTENDANCE · TOTAL \(RAW %\)/s);
  assert.match(sheet, /<c r="D15"[^>]*>.*?ATTENDANCE · WEIGHTED \(20\.00% OF COURSE\)/s);
  assert.match(sheet, /<c r="C17"[^>]*><v>75<\/v>/);
  assert.match(sheet, /<c r="D17"[^>]*><v>15<\/v>/);
});

test("FCU final-grade export supports a variable number of primary domains", async () => {
  const components = [
    { name: "QUIZZES", percentage: 30 },
    { name: "LABORATORY", percentage: 50 },
    { name: "PROJECT", percentage: 20 },
    { name: "ORAL", percentage: 0 }
  ];
  const cats = components.map((item,index) => ({ id: item.name, name: item.name, weight: item.percentage, sortOrder:index }));
  const files = await generate(cats, [student("Student Name", { QUIZZES: 100, LABORATORY: 80, PROJECT: 90, ORAL: 75 }, 85.5)], components);
  const sheet = files["xl/worksheets/sheet1.xml"];
  assert.match(sheet, /<mergeCell ref="A1:M9"/);
  assert.match(sheet, /<c r="C15"[^>]*>.*?QUIZZES · TOTAL \(RAW %\)/s);
  assert.match(sheet, /<c r="D15"[^>]*>.*?QUIZZES · WEIGHTED \(30\.00% OF COURSE\)/s);
  assert.match(sheet, /<c r="E15"[^>]*>.*?LABORATORY · TOTAL \(RAW %\)/s);
  assert.match(sheet, /<c r="F15"[^>]*>.*?LABORATORY · WEIGHTED \(50\.00% OF COURSE\)/s);
  assert.match(sheet, /<c r="G15"[^>]*>.*?PROJECT · TOTAL \(RAW %\)/s);
  assert.match(sheet, /<c r="H15"[^>]*>.*?PROJECT · WEIGHTED \(20\.00% OF COURSE\)/s);
  assert.match(sheet, /<c r="I15"[^>]*>.*?ORAL · TOTAL \(RAW %\)/s);
  assert.match(sheet, /<c r="J15"[^>]*>.*?ORAL · WEIGHTED \(0\.00% OF COURSE\)/s);
  assert.match(sheet, /<c r="K15"[^>]*>.*?TOTAL GRADE/s);
});
test("Record Scores Excel export mirrors the full grouped scorebook and saved signature profiles", () => {
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
    attendanceDays: assessments => assessments,
    consecutiveLateAbsences: () => new Set()
  };
  const gradeSource = fs.readFileSync("src/lib/grades.ts", "utf8")
    .replace('import { attendanceDays, consecutiveLateAbsences } from "./attendance";', "")
    .replace(/^export\s+/gm, "");
  const compiledGrades = ts.transpileModule(gradeSource, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
  }).outputText;
  vm.runInNewContext(compiledGrades + "\nthis.calculateGradeBreakdown = calculateGradeBreakdown;", context);
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
  context.generateGeneric("record-scores.xlsx", "Record Scores", detail, "Example University", "123 College Road", "COLLEGE OF ENGINEERING", "Teacher One", "Instructor", "Dean Two", "Dean", [{ name: "Quizzes", percentage: 30 }, { name: "Major Exam", percentage: 50 }]);
  const files = Object.fromEntries(saved.map(file => [file.name, file.content]));
  const sheet = files["xl/worksheets/sheet1.xml"];
  assert.match(sheet, /Example University/);
  assert.match(sheet, /123 College Road/);
  assert.doesNotMatch(sheet, /School Address:/);
  assert.match(sheet, /COLLEGE OF ENGINEERING/);
  assert.doesNotMatch(sheet, /RECORD SCORES|RECORD SCORED/);
  assert.match(sheet, /Course Number:/);
  assert.match(sheet, /ECE 16/);
  assert.match(sheet, /Descriptive Title:/);
  assert.match(sheet, /Design Project/);
  assert.match(sheet, /Class ID:/);
  assert.match(sheet, /BSECE-4A/);
  assert.match(sheet, /Semester:/);
  assert.match(sheet, /1st Semester/);
  assert.match(sheet, /Academic Year:/);
  assert.match(sheet, /2026-2027/);
  assert.match(sheet, /Schedule:/);
  assert.match(sheet, /Lecture · Monday, 04:00 PM–05:30 PM/);
  assert.doesNotMatch(sheet, /Teacher: Teacher One|Dean: Dean Two/);
  assert.match(sheet, /Display Components:/);
  assert.match(sheet, /Quizzes 30\.00% · Major Exam 50\.00%/);
  assert.match(sheet, /NO\./);
  assert.match(sheet, /NAME OF STUDENTS/);
  assert.match(sheet, /QUIZZES/);
  assert.match(sheet, /MAJOR EXAM/);
  assert.match(sheet, /Quiz 1/);
  assert.match(sheet, /MAX: 10/);
  assert.match(sheet, /EQUIVALENT/);
  assert.match(sheet, /\(\%\)/);
  assert.doesNotMatch(sheet, /Lecture \/ Quizzes|Quizzes · Quiz 1|Item wt|Course wt|Student Number|2023-0001/);
  assert.match(sheet, /<mergeCell ref="D14:G15"\/>/);
  assert.match(sheet, /<mergeCell ref="H14:K15"\/>/);
  assert.match(sheet, /<c r="A18"[^>]*><v>1<\/v><\/c>/);
  assert.match(sheet, /<c r="B18"[^>]*>.*?Ana Reyes/s);
  assert.match(sheet, /<c r="A19"[^>]*><v>2<\/v><\/c>/);
  assert.match(sheet, /<c r="D18"[^>]*>.*?8 \/ 10/s);
  assert.match(sheet, /<c r="E18"[^>]*><v>27<\/v>/);
  assert.match(sheet, /<c r="I18"[^>]*><v>46<\/v>/);
  assert.match(sheet, /<c r="L18"[^>]*><f>SUM\(G18,K18\)<\/f><v>90<\/v>/);
  assert.match(sheet, /<c r="M18"[^>]*>.*?2\.00/s);
  assert.match(sheet, /<c r="N18"[^>]*>.*?PASSED/s);
  assert.match(sheet, /TEACHER ONE/);
  assert.match(sheet, /DEAN TWO/);
  assert.match(sheet, /<c r="A21"[^>]*>.*?Submitted by:/s);
  assert.match(sheet, /<c r="H21"[^>]*>.*?Noted:/s);
  for (let rowNumber = 21; rowNumber <= 26; rowNumber++) {
    assert.ok(sheet.includes('<mergeCell ref="A' + rowNumber + ':G' + rowNumber + '"/>'));
    assert.ok(sheet.includes('<mergeCell ref="H' + rowNumber + ':N' + rowNumber + '"/>'));
  }
  for (const cell of ["A25", "H25", "A26", "H26"]) {
    assert.match(sheet, new RegExp('<c r="' + cell + '" s="17"'));
  }
  assert.match(sheet, /<c r="A25"[^>]*>.*?TEACHER ONE/s);
  assert.match(sheet, /<c r="H25"[^>]*>.*?DEAN TWO/s);
  assert.match(sheet, /<c r="A26"[^>]*>.*?Instructor/s);
  assert.match(sheet, /<c r="H26"[^>]*>.*?Dean/s);
  assert.doesNotMatch(sheet, /SIGNATURE OVER PRINTED NAME \/ DATE/);
  assert.doesNotMatch(sheet, /Teacher&apos;s Signature over Printed Name|Dean&apos;s Signature over Printed Name/);
  assert.match(sheet, /orientation="landscape" fitToWidth="1"/);
  assert.match(sheet, /<pane ySplit="17" topLeftCell="A18"/);
  assert.match(source, /@page \{ size: 8\.5in 13in/);
  assert.doesNotMatch(sheet, /Class Summary|Certification/);
  assert.ok(files["xl/styles.xml"]);
});


test("Record Scores export dynamically merges institutional, metadata, category, summary, and signature headers", () => {
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

test("PDF component values are weighted by the configured course allocation", () => {
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
    gradeRemarkIndicator: (remark, fallback) => {
      const value = String(remark || fallback || "").trim().toUpperCase();
      const normalized = value === "DRP" || value === "DROP" ? "DROPPED"
        : value === "INCOMPLETE" ? "INC" : value === "PASS" ? "PASSED" : value;
      return normalized === "DROPPED" ? "DRP" : normalized === "INC" ? "INC"
        : normalized === "NP" ? "NP" : ["FAILED", "FAIL", "NOT PASSED"].includes(normalized) ? "FAIL" : normalized || "—";
    },
    gradeSheetComponentPercent: () => 90,
    gradeSheetRootDomainSummary: () => null
  };
  vm.runInNewContext(compiledContribution + "\nthis.contribution = gradeSheetComponentContribution;", context);
  assert.equal(context.contribution({ categories: [{ id: "quiz", parentId: "lecture", name: "Quiz" }] }, {}, { name: "Quiz", percentage: 70 }), 63);
  assert.equal(context.contribution({ categories: [{ id: "exam", parentId: "lecture", name: "Exam" }] }, {}, { name: "Exam", percentage: 40 }), 36);
  assert.match(source, /gradeSheetComponentSummary\(detail,enrollment,component\)/);
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
  assert.ok(source.includes("Your generic grading-sheet header is incomplete."));
  assert.ok(source.includes('setTab("profile");'));
  assert.ok(source.includes('printFinalGradesPdf("generic"); event.currentTarget.closest("details")'));
  assert.ok(source.includes('printFinalGradesPdf("iso"); event.currentTarget.closest("details")'));
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

test("printable Collegiate sheet shows each root group's weighted course contribution across classes", () => {
  const helperStart = source.indexOf("function categoryDescendantIds(");
  const helperEnd = source.indexOf("\nfunction downloadGradeSheetXlsx(", helperStart);
  assert.ok(helperStart > 0 && helperEnd > helperStart, "print component helpers are present");
  const compiledHelpers = ts.transpileModule(source.slice(helperStart, helperEnd), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
  }).outputText;
  const gradeSource = fs.readFileSync("src/lib/grades.ts", "utf8")
    .replace('import { attendanceDays, consecutiveLateAbsences } from "./attendance";', "")
    .replace(/^export\s+/gm, "");
  const compiledGrades = ts.transpileModule(gradeSource, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
  }).outputText;
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
  const context = {
    categoryPath,
    attendanceDays: assessments => assessments,
    consecutiveLateAbsences: () => new Set()
  };
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
    const enrollment = {
      studentName: "AMBITO, JENSEN ANTON",
      scores: [
        { assessmentId: "lecture-score", points: lectureScore, remark: null },
        { assessmentId: "lab-score", points: labScore, remark: null }
      ]
    };
    return { categories, assessments, enrollments: [enrollment] };
  };

  const fcuClass = makeClass(60, 40, 58.983, 96.5);
  const lecture = context.componentContribution(fcuClass, fcuClass.enrollments[0], { name: "Lecture", percentage: 60 });
  const laboratory = context.componentContribution(fcuClass, fcuClass.enrollments[0], { name: "Laboratory", percentage: 40 });
  assert.equal(lecture, 35.39);
  assert.equal(laboratory, 38.6);
  assert.equal(Number((lecture + laboratory).toFixed(2)), 73.99);

  const differentlyWeightedClass = makeClass(70, 30, 80, 90);
  assert.equal(context.componentContribution(differentlyWeightedClass, differentlyWeightedClass.enrollments[0], { name: "Lecture", percentage: 70 }), 56);
  assert.equal(context.componentContribution(differentlyWeightedClass, differentlyWeightedClass.enrollments[0], { name: "Laboratory", percentage: 30 }), 27);

  const printSectionStart = source.indexOf('<table className="print-grade-table generic-print-grade-table">');
  const printSectionEnd = source.indexOf("</table>", printSectionStart);
  const printTable = source.slice(printSectionStart, printSectionEnd);
  assert.ok(printTable.includes("gradeSheetPrimaryDomains.map"), "each primary domain is displayed in PDF before the final total");
  assert.ok(printTable.includes("gradeSheetAdditionalComponents.map"), "saved non-root components are retained in the PDF");
  assert.ok(printTable.includes("gradeSheetComponentSummary(detail,enrollment,component)"), "saved component values use the shared raw/weighted mapper");
  assert.ok(printTable.includes('enrollment.finalPercent.toFixed(2)+"%"'), "TOTAL GRADE continues to show the official calculated course total");
  assert.ok(source.includes('{classSection === "final" && <section id="class-section-final"'), "the same print component is reached from each class Final Grades preview");
});
