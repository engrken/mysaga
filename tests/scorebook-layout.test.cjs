const assert = require("node:assert/strict");
const test = require("node:test");
const ts = require("typescript");
const fs = require("node:fs");
const path = require("node:path");
const raw = fs.readFileSync(path.join(__dirname, "../src/lib/scorebook-layout.ts"),"utf8");
const compiled=ts.transpileModule(raw,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const m={exports:{}};new Function("exports","module",compiled)(m.exports,m);
const {buildWorkbookPages, workbookColumnBudget, estimateWorkbookSegmentWidth, workbookWidths}=m.exports;
const source=[
{id:"self",label:"Self-Evaluation",assessmentIds:["s1","s2","s3"]},
{id:"quizzes",label:"Quizzes",assessmentIds:["q1","q2","q3"]},
{id:"mid",label:"Midterm",assessmentIds:["m1"]},
{id:"final",label:"Final",assessmentIds:["f1"]},
{id:"lab",label:"Lab",assessmentIds:["l1","l2","l3","l4"]}
];
test("Auto-fit contains every assessment exactly once and preserves original order",()=>{
  for(const width of [760,900,1100,1440,1920,2560]){
    const pages=buildWorkbookPages(source,width);
    const actual=pages.flatMap(p=>p.segments.flatMap(s=>s.assessmentIds));
    assert.deepEqual(actual,source.flatMap(s=>s.assessmentIds));
    assert.equal(new Set(actual).size,actual.length);
  }
});
test("narrower workspaces show fewer assessment columns per page",()=>{
  assert.ok(buildWorkbookPages(source,900).length > buildWorkbookPages(source,2000).length);
});
test("each page fits the measured column budget at desktop widths",()=>{
  for (const width of [900,1100,1280,1600,1920]) {
    for (const page of buildWorkbookPages(source,width)) {
      const pixels=page.segments.reduce((sum,segment)=>sum+estimateWorkbookSegmentWidth(segment.assessmentIds.length,width),0);
      assert.ok(pixels<=workbookColumnBudget(width), `width ${width} exceeded by ${pixels-workbookColumnBudget(width)}`);
    }
  }
});
test("long individual category splits without hiding assessments or totals",()=>{
 const pages=buildWorkbookPages([{id:"ex",label:"Exercises",assessmentIds:Array.from({length:24},(_,i)=>String(i))}],980);
 assert.ok(pages.length>1);
 assert.equal(pages.flatMap(p=>p.segments.flatMap(s=>s.assessmentIds)).length,24);
 assert.ok(pages.every(p=>p.segments[0].totalParts===pages.length));
});
test("no category items does not create phantom pages",()=>{
 assert.deepEqual(buildWorkbookPages([],1200),[]);
 assert.deepEqual(buildWorkbookPages([{id:"a",label:"No items",assessmentIds:[]}],1200),[]);
});
test("each assessment group reserves only an Equivalent subtotal",()=>{
 const widths=workbookWidths(1200);
 assert.equal(estimateWorkbookSegmentWidth(3,1200),3*widths.assessment+widths.equivalent);
 assert.equal(Object.hasOwn(widths,"weight"),false);
});
test("student name and summary column widths remain useful",()=>{
 const w=workbookWidths(1500);
 assert.ok(w.student>=200);
 assert.ok(w.total>=100);
 assert.ok(w.final>=85);
 assert.ok(w.assessment>=75);
});


test("Show all layout keeps a floating horizontal scrollbar synchronized with the workbook",()=>{
 const portal=fs.readFileSync(path.join(__dirname,"../src/components/Portal.tsx"),"utf8");
 const css=fs.readFileSync(path.join(__dirname,"../src/app/globals.css"),"utf8");
 assert.ok(portal.includes('id="score-sheet-scroll-viewport"'));
 assert.ok(portal.includes("ref={scorebookScrollRef}"));
 assert.ok(portal.includes("ref={scorebookFloatingScrollRef}"));
 assert.ok(portal.includes('scorebookFloatingScroll.visible && scorebookView === "all"'));
 assert.ok(portal.includes('import { createPortal } from "react-dom"'));
 assert.match(portal,/scorebookFloatingScroll\.visible && scorebookView === "all" && typeof document !== "undefined" && createPortal\(/);
 assert.ok(portal.includes("document.body)"));
 assert.ok(portal.includes("[scorebookFloatingScroll.visible, scorebookFloatingScroll.left, scorebookFloatingScroll.width, scorebookFloatingScroll.scrollWidth, scorebookView]"));
 assert.ok(portal.includes("function syncHorizontalScrollProgress(source: HTMLElement, target: HTMLElement)"));
 assert.ok(portal.includes("const sourceRange = Math.max(0, source.scrollWidth - source.clientWidth)"));
 assert.ok(portal.includes("const targetRange = Math.max(0, target.scrollWidth - target.clientWidth)"));
 assert.ok(portal.includes("source.scrollLeft / sourceRange"));
 assert.ok(portal.includes("progress * targetRange"));
 assert.ok(portal.includes("syncHorizontalScrollProgress(event.currentTarget, floating)"));
 assert.ok(portal.includes("syncHorizontalScrollProgress(event.currentTarget, sheet)"));
 assert.ok(portal.includes("useLayoutEffect"));
 assert.match(portal,/track\.style\.width = `\$\{floating\.clientWidth \+ workbookRange\}px`/);
 assert.ok(portal.includes("sheet.getBoundingClientRect()"));
 assert.ok(portal.includes("new ResizeObserver(updateFloatingScrollbar)"));
 assert.match(css,/\.score-sheet-floating-scroll\s*\{[^}]*position:\s*fixed/s);
 assert.match(css,/\.score-sheet-floating-scroll-track\s*\{[^}]*flex:\s*none/s);
 assert.match(css,/\.score-sheet-floating-scroll\s*\{[^}]*box-sizing:\s*border-box/s);
 assert.match(css,/scrollbar-color:\s*#c3c9d1\s+#eef1f4/);
 assert.match(css,/\.score-sheet-floating-scroll\[data-bs-theme="dark"\]/);
 assert.doesNotMatch(css,/\.portal-layout\s+\.score-sheet-floating-scroll/);
 assert.match(css,/@media\s*\(max-width:\s*760px\),\s*print\s*\{[^}]*\.score-sheet-floating-scroll/s);
});


test("Record Scores reserves root-domain total and weighted columns before the course total", () => {
  const portal = fs.readFileSync(path.join(__dirname, "../src/components/Portal.tsx"), "utf8");
  assert.match(portal, /\{ kind: "domain-total" as const, category: group\.parent \}/);
  assert.match(portal, /\{ kind: "domain-weighted" as const, category: group\.parent \}/);
  assert.match(portal, /buildScorebookHeaderLayout\(/);
  assert.match(portal, /domain\?\.rawEquivalentPercent/);
  assert.match(portal, /domain\?\.parentWeightedScore/);
  assert.match(portal, /<f>.*?<\/f><v>/);
  assert.match(portal, /SUM\(.*map\(col => excelColumn\(col\) \+ currentRow\)/s);
});


test("primary-domain summary columns are budgeted once per root on every auto-fit page", () => {
  for (const width of [900, 1100, 1280, 1600]) {
    const categories = [
      { id: "lecture-a", parentId: "lecture", label: "Lecture / Class Work", assessmentIds: Array.from({ length: 17 }, (_, i) => "la" + i) },
      { id: "lecture-b", parentId: "lecture", label: "Lecture / Exams", assessmentIds: Array.from({ length: 12 }, (_, i) => "le" + i) },
      { id: "lab-a", parentId: "lab", label: "Lab / Activities", assessmentIds: Array.from({ length: 8 }, (_, i) => "lb" + i) }
    ];
    const widths = workbookWidths(width);
    const limit = workbookColumnBudget(width);
    const pages = buildWorkbookPages(categories, width);
    for (const page of pages) {
      const summaries = new Set(page.segments.map(segment => segment.parentId).filter(Boolean)).size * 2 * widths.equivalent;
      const segmentWidth = page.segments.reduce((sum, segment) =>
        sum + estimateWorkbookSegmentWidth(segment.assessmentIds.length, width), 0);
      assert.ok(segmentWidth + summaries <= limit,
        `width ${width} page ${page.label} exceeds budget by ${segmentWidth + summaries - limit}px`);
    }
  }
});


test("Record Scores header matrix accounts for each root summary column and unequal category depths", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/lib/scorebook-layout.ts"), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const module = { exports: {} };
  new Function("exports", "module", compiled)(module.exports, module);
  const { buildScorebookHeaderLayout } = module.exports;

  const categories = [
    { id: "lecture", parentId: null, sortOrder: 0 },
    { id: "major", parentId: "lecture", sortOrder: 0 },
    { id: "prelim", parentId: "major", sortOrder: 0 },
    { id: "midterm", parentId: "major", sortOrder: 1 },
    { id: "finals", parentId: "major", sortOrder: 2 },
    { id: "self", parentId: "lecture", sortOrder: 1 },
    { id: "quizzes", parentId: "lecture", sortOrder: 2 },
    { id: "lab", parentId: null, sortOrder: 1 },
    { id: "lab-exam", parentId: "lab", sortOrder: 0 },
    { id: "lab-exercises", parentId: "lab", sortOrder: 1 },
    { id: "lab-output", parentId: "lab-exercises", sortOrder: 0 },
    { id: "lab-activity", parentId: "lab-exercises", sortOrder: 1 }
  ];
  const columns = [
    ...["prelim", "midterm", "finals", "self", "quizzes"].flatMap(id => [
      { categoryId: id, kind: "assessment" },
      { categoryId: id, kind: "equivalent" }
    ]),
    { categoryId: "lecture", kind: "domain-total" },
    { categoryId: "lecture", kind: "domain-weighted" },
    ...["lab-exam", "lab-output", "lab-activity"].flatMap(id => [
      { categoryId: id, kind: "assessment" },
      { categoryId: id, kind: "equivalent" }
    ]),
    { categoryId: "lab", kind: "domain-total" },
    { categoryId: "lab", kind: "domain-weighted" }
  ];
  const layout = buildScorebookHeaderLayout(categories, ["lecture", "lab"], columns);
  assert.equal(layout.columnCount, columns.length);
  assert.equal(layout.rowSpan, layout.maxDepth + 2);
  assert.equal(layout.rows[0].reduce((sum, cell) => sum + cell.colSpan, 0), columns.length);

  const lectureSpan = layout.rows[0].find(cell => cell.kind === "category" && cell.categoryId === "lecture").colSpan;
  const labSpan = layout.rows[0].find(cell => cell.kind === "category" && cell.categoryId === "lab").colSpan;
  assert.equal(lectureSpan, 12);
  assert.equal(labSpan, 8);
  assert.deepEqual(
    layout.rows[1].map(cell => cell.kind === "category" ? cell.categoryId : cell.kind),
    ["major", "self", "quizzes", "domain-total", "domain-weighted", "lab-exam", "lab-exercises", "domain-total", "domain-weighted"]
  );
  assert.deepEqual(
    layout.bottomColumnIndexes.map(index => columns[index].kind).filter(kind => kind.startsWith("domain-")),
    []
  );

  const grid = Array.from({ length: layout.rowSpan }, () => Array(layout.columnCount).fill(false));
  layout.rows.forEach((row, rowIndex) => {
    let cursor = 0;
    for (const cell of row) {
      while (cursor < layout.columnCount && grid[rowIndex][cursor]) cursor += 1;
      for (let rowOffset = 0; rowOffset < cell.rowSpan; rowOffset += 1) {
        for (let colOffset = 0; colOffset < cell.colSpan; colOffset += 1) {
          const targetRow = rowIndex + rowOffset;
          const targetColumn = cursor + colOffset;
          assert.ok(targetRow < layout.rowSpan && targetColumn < layout.columnCount);
          assert.equal(grid[targetRow][targetColumn], false);
          grid[targetRow][targetColumn] = true;
        }
      }
      cursor += cell.colSpan;
    }
  });

  const bottomRow = layout.rowSpan - 1;
  let cursor = 0;
  for (const columnIndex of layout.bottomColumnIndexes) {
    while (cursor < layout.columnCount && grid[bottomRow][cursor]) cursor += 1;
    assert.equal(cursor, columnIndex, "bottom-level item heading aligns with its body column");
    grid[bottomRow][cursor] = true;
    cursor += 1;
  }
  assert.ok(grid.every(row => row.every(Boolean)), "every header tier covers the full leaf-column grid");
});

test("Record Scores header uses explicit summary subheaders and the same body leaf-column count", () => {
  const portal = fs.readFileSync(path.join(__dirname, "../src/components/Portal.tsx"), "utf8");
  assert.match(portal, /scorebookHeaderRows\.bottomColumnIndexes\.map/);
  assert.match(portal, /scorebookBodyColumnCount = scorebookDisplayColumns\.length \+ 5/);
  assert.match(portal, /colSpan=\{scorebookBodyColumnCount\}/);
  const tick = String.fromCharCode(96);
  const interpolation = "$" + "{scorebookTableMinWidth}px";
  assert.ok(portal.includes("width: " + tick + interpolation + tick));
  assert.match(portal, /score-sheet-domain-summary-head/);
  assert.match(portal, /score-sheet-subcategory-placeholder/);
  assert.match(portal, /scope="colgroup"/);
  assert.match(portal, /scope="col"/);
});


test("Record Scores never masks score cells for class remarks; only DROPPED is masked on Final Grades", () => {
  const portal = fs.readFileSync(path.join(__dirname, "../src/components/Portal.tsx"), "utf8");
  const recordStart = portal.indexOf('{classSection === "record" && <section id="class-section-record"');
  const analyticsStart = portal.indexOf('{classSection === "analytics"', recordStart);
  const recordSection = portal.slice(recordStart, analyticsStart);
  assert.ok(recordStart >= 0 && analyticsStart > recordStart);
  assert.doesNotMatch(recordSection, /hasSpecialRemark|isPassedGradeRemark|mobile-score-status-only/);
  assert.match(recordSection, /className="score-sheet-input"/);
  assert.match(recordSection, /className="score-sheet-category-equivalent"/);
  assert.match(recordSection, /showWeightBreakdown && <tr className="score-sheet-breakdown-row"/);
  assert.match(portal, /const isFinalGradesTab = classSection === "final"/);

  const finalStart = portal.indexOf('{classSection === "final" && <section id="class-section-final"');
  const finalEnd = portal.indexOf(String.fromCharCode(10) + "        </>}", finalStart);
  const finalSection = portal.slice(finalStart, finalEnd);
  assert.match(finalSection, /isDroppedStatus=isFinalGradesTab && resolvedGradeRemark\(en\.remarks,band\?\.remarks\)==="DROPPED"/);
  assert.doesNotMatch(finalSection, /!passed|passed\?/);
  assert.match(finalSection, /isDroppedStatus[\s\S]*?<span className="score-sheet-status-indicator"[^>]*>DRP<\/span>/);
  assert.match(portal, /if \(value === "DRP" \|\| value === "DROP"\) return "DROPPED"/);

  const contribution = fs.readFileSync(path.join(__dirname, "../src/components/GradeContributionPanel.tsx"), "utf8");
  assert.doesNotMatch(contribution, /Not displayed for|\["INC", "NP", "DROPPED"\]/);
});


test("class remark selectors share the unique canonical status list", () => {
  const portal = fs.readFileSync(path.join(__dirname, "../src/components/Portal.tsx"), "utf8");
  const grades = fs.readFileSync(path.join(__dirname, "../src/lib/grades.ts"), "utf8");
  const subjectRoute = fs.readFileSync(path.join(__dirname, "../src/app/api/teacher/subjects/[subjectId]/route.ts"), "utf8");
  assert.match(grades, /value: "INC"/);
  assert.match(grades, /label: "INCOMPLETE"/);
  assert.match(grades, /export function normalizeRemark\(/);
  assert.match(grades, /if \(value === "INCOMPLETE"\) return "INC"/);
  assert.match(portal, /CLASS_REMARK_OPTIONS\.map\(option=> <option key=\{option\.value\} value=\{option\.value\}>\{option\.label\}<\/option>\)/);
  assert.doesNotMatch(portal, /<option value="INCOMPLETE"/);
  assert.match(portal, /function gradeRemarkSelectionValue[\s\S]*CLASS_REMARK_OPTIONS\.some/);
  assert.match(portal, /const value = remark \? normalizeGradeRemark\(remark\) : null/);
  assert.match(subjectRoute, /normalizeRemark\(parsed\.data\.remark\)/);
  assert.match(subjectRoute, /isClassRemark\(normalizedRemark\)/);
});

test("Edit Components saves update the active class and optionally the teacher default atomically", () => {
  const portal = fs.readFileSync(path.join(__dirname, "../src/components/Portal.tsx"), "utf8");
  const subjectRoute = fs.readFileSync(path.join(__dirname, "../src/app/api/teacher/subjects/[subjectId]/route.ts"), "utf8");
  const profileRoute = fs.readFileSync(path.join(__dirname, "../src/app/api/profile/route.ts"), "utf8");
  assert.match(portal, /componentSelectionByClassRef\.current\.get\(detail\.id\)/);
  assert.match(portal, /const activeGradeSheetComponents = gradeSheetComponents\.length \? gradeSheetComponents : defaultGradeSheetComponents/);
  assert.match(portal, /saveGradeSheetComponents: selectedComponents, saveAsDefault: true/);
  assert.match(portal, /setDefaultGradeSheetComponentsOverride\(savedComponents\)/);
  assert.match(portal, /setGradeSheetComponents\(savedComponents\)/);
  assert.match(portal, /router\.refresh\(\)/);
  assert.match(portal, /componentSaving==="default"/);
  assert.match(portal, /componentSaving==="class"/);
  assert.match(subjectRoute, /saveAsDefault: z\.boolean\(\)\.optional\(\)\.default\(false\)/);
  assert.match(subjectRoute, /await prisma\.\$transaction\(async tx =>/);
  assert.match(subjectRoute, /if \(parsed\.data\.saveAsDefault\)[\s\S]*tx\.user\.update/);
  assert.match(subjectRoute, /tx\.subject\.update[\s\S]*tx\.auditEvent\.create/);
  assert.match(profileRoute, /displayed weights do not need to total 100%/);
  assert.doesNotMatch(profileRoute, /percentages must total 100%/);
});
