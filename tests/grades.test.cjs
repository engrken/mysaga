const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

// Run actual production calculator code without requiring Next.js or a database.
function loadCalculator(name, imports = {}) {
  const source = fs.readFileSync(path.join(__dirname, "../src/lib", name + ".ts"), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const exports = {};
  new Function("require", "exports", compiled)(id => imports[id], exports);
  return exports;
}
const attendance = loadCalculator("attendance");
const calculatorExports = loadCalculator("grades", { "./attendance": attendance });
const { calculateCategoryPercent, calculateGradeBreakdown, calculateFinal, convertRawPercent, expectedChildAllocation, remainingChildAllocation, firstOverallocatedCategoryGroup, normalizeRemark, gradeRemarkExportCode, isClassRemark, CLASS_REMARK_OPTIONS } = calculatorExports;
const scored = (points, maxScore = 100, title = "Exam", remark = null, weight = null) =>
  ({ title, maxScore, weight, scores: [{ points, remark }] });
const pending = (maxScore = 100, title = "Exam", weight = null) =>
  ({ title, maxScore, weight, scores: [] });
const cat = (id, parentId, weight, assessments = [], conversionBase = 100) =>
  ({ id, parentId, weight, assessments, conversionBase });

test("class remarks use one unique canonical dictionary and normalize legacy values", () => {
  assert.deepEqual(CLASS_REMARK_OPTIONS, [
    { label: "PASSED", value: "PASSED" },
    { label: "FAILED", value: "FAILED" },
    { label: "INC", value: "INC" },
    { label: "NP", value: "NP" },
    { label: "DROPPED", value: "DROPPED" }
  ]);
  assert.equal(CLASS_REMARK_OPTIONS.find(option => option.value === "NP")?.label, "NP");
  assert.equal(new Set(CLASS_REMARK_OPTIONS.map(option => option.value)).size, CLASS_REMARK_OPTIONS.length);
  assert.equal(normalizeRemark("INCOMPLETE"), "INC");
  assert.equal(normalizeRemark(" incomplete "), "INC");
  assert.equal(normalizeRemark("inc"), "INC");
  assert.equal(normalizeRemark("NO EXAMINATION PERMIT"), "NP");
  assert.equal(normalizeRemark("NO EXAMINATION PERMIT (NP)"), "NP");
  assert.equal(normalizeRemark("NO PRIVILEGE"), "NP");
  assert.equal(normalizeRemark("NO PERMIT"), "NP");
  assert.equal(gradeRemarkExportCode("NO EXAMINATION PERMIT"), "NP");
  assert.equal(gradeRemarkExportCode("INCOMPLETE"), "INC");
  assert.equal(gradeRemarkExportCode("DROPPED"), "DRP");
  assert.equal(gradeRemarkExportCode("DRP"), "DRP");
  assert.equal(normalizeRemark("DRP"), "DROPPED");
  assert.equal(normalizeRemark("PASS"), "PASSED");
  assert.equal(normalizeRemark("Failed"), "FAILED");
  assert.equal(isClassRemark("INCOMPLETE"), true);
  assert.equal(isClassRemark("inc"), true);
  assert.equal(isClassRemark("ABSENT"), false);
});

test("transmutation respects school passing base", () => {
  assert.equal(convertRawPercent(70, 70), 79);
  assert.equal(convertRawPercent(50, 50), 75);
  assert.equal(convertRawPercent(100, 70), 100);
});

test("Lecture 60% and child 15% contributes a maximum 9% of course", () => {
  const categories = [
    cat("lecture", null, 60),
    cat("quizzes", "lecture", 15, [scored(70)])
  ];
  const breakdown = calculateGradeBreakdown(categories);
  const quiz = breakdown.items.find(item => item.categoryId === "quizzes");
  assert.equal(quiz.courseWeight, 9);
  assert.equal(quiz.earnedCourse, 6.3);
  assert.equal(quiz.withinRootWeight, 15);
  assert.equal(quiz.earnedWithinRoot, 10.5);
  assert.equal(calculateFinal(categories), 6.3);
});

test("three-level major examination uses the root-group allocation (not double multiplication)", () => {
  const categories = [
    cat("lecture", null, 60),
    cat("major", "lecture", 50),
    cat("prelim", "major", 10, [scored(75)])
  ];
  const result = calculateGradeBreakdown(categories);
  assert.equal(result.items[0].courseWeight, 6);
  assert.equal(result.items[0].earnedCourse, 4.5);
  assert.equal(result.items[0].earnedWithinRoot, 7.5);
});

test("Record Scores equivalent uses weight within root while final uses course weight", () => {
  const categories = [
    cat("lecture", null, 60, [], 70),
    cat("major", "lecture", 50, [], 70),
    cat("midterm", "major", 20, [scored(27, 50)]),
    cat("reporter", "lecture", 25, [scored(90, 100)]),
    cat("quiz", "lecture", 15, [scored(30, 100)])
  ];
  const { items } = calculateGradeBreakdown(categories);
  const midterm = items.find(item => item.categoryId === "midterm");
  const reporter = items.find(item => item.categoryId === "reporter");
  const quiz = items.find(item => item.categoryId === "quiz");
  assert.equal(midterm.percent, 67.8);
  assert.equal(midterm.withinRootWeight, 20);
  assert.equal(midterm.earnedWithinRoot, 13.56);
  assert.equal(midterm.earnedCourse, 8.14);
  assert.equal(reporter.percent, 93);
  assert.equal(reporter.withinRootWeight, 25);
  assert.equal(reporter.earnedWithinRoot, 23.25);
  assert.equal(reporter.earnedCourse, 13.95);
  assert.equal(quiz.percent, 51);
  assert.equal(quiz.withinRootWeight, 15);
  assert.equal(quiz.earnedWithinRoot, 7.65);
  assert.equal(quiz.earnedCourse, 4.59);
});

test("base 70 exams show course contribution after transmutation", () => {
  const categories = [cat("exam", null, 15, [scored(80)], 70)];
  const result = calculateGradeBreakdown(categories);
  assert.equal(result.items[0].percent, 86);
  assert.equal(result.items[0].earnedCourse, 12.9);
  assert.equal(result.totalPercent, 12.9);
});

test("attendance ignores grade-transmutation base and excludes excused dates", () => {
  const assessments = [
    scored(null, 1, "Attendance · 2026-11-01", "PRESENT"),
    scored(null, 1, "Attendance · 2026-11-02", "PRESENT"),
    scored(null, 1, "Attendance · 2026-11-03", "ABSENT"),
    scored(null, 1, "Attendance · 2026-11-04", "EXCUSED")
  ];
  const data = calculateGradeBreakdown([cat("attendance", null, 10, assessments, 70)]);
  assert.equal(data.items[0].percent, 66.67);
  assert.equal(data.items[0].earnedCourse, 6.67);
  assert.equal(data.items[0].excusedItems, 1);
  assert.equal(data.items[0].pendingItems, 0);
});

test("null points with a PENDING marker stay pending and never calculate as a failing zero", () => {
  const pendingAssessment = { title: "Unentered quiz", maxScore: 100, weight: null, scores: [{ points: null, remark: "PENDING" }] };
  const result = calculateGradeBreakdown([cat("tests", null, 25, [pendingAssessment], 100)]);
  assert.equal(calculateCategoryPercent({ conversionBase: 100, assessments: [pendingAssessment] }), null);
  assert.equal(result.items[0].percent, null);
  assert.equal(result.items[0].earnedCourse, null);
  assert.equal(result.items[0].recordedItems, 0);
  assert.equal(result.items[0].pendingItems, 1);
  assert.equal(result.totalPercent, null);
});

test("valid attendance and explicit absence remarks still count as recorded when points are null", () => {
  const attendanceMarks = [
    scored(null, 1, "Attendance · 2026-11-01", "PRESENT"),
    scored(null, 1, "Attendance · 2026-11-02", "ABSENT")
  ];
  const result = calculateGradeBreakdown([cat("attendance", null, 10, attendanceMarks, 50)]);
  assert.equal(result.items[0].recordedItems, 2);
  assert.equal(result.items[0].pendingItems, 0);
  assert.equal(result.totalPercent, 5);
});

test("blank score is pending; recorded zero is not a pending score", () => {
  const items = [scored(100), pending()];
  const first = calculateGradeBreakdown([cat("tests", null, 25, items, 50)]);
  assert.equal(first.items[0].percent, 100);
  assert.equal(first.items[0].earnedCourse, 25);
  assert.equal(first.items[0].pendingItems, 1);
  const second = calculateGradeBreakdown([cat("tests", null, 25, [scored(100), scored(0)], 50)]);
  assert.equal(second.items[0].percent, 75);
  assert.equal(second.items[0].earnedCourse, 18.75);
  assert.equal(second.items[0].pendingItems, 0);
});

test("quick-select status semantics keep DNS and AB in the denominator while EX is omitted", () => {
  const assessments = [
    scored(80, 100, "Quiz A"),
    scored(null, 100, "Quiz B", "ABSENT"),
    scored(null, 100, "Quiz C", "DID_NOT_SUBMIT"),
    scored(null, 100, "Quiz D", "EXCUSED")
  ];
  const result = calculateGradeBreakdown([cat("quizzes", null, 100, assessments, 100)]);
  assert.equal(result.items[0].percent, 26.67);
  assert.equal(result.items[0].recordedItems, 3);
  assert.equal(result.items[0].pendingItems, 0);
  assert.equal(result.items[0].excusedItems, 1);
  assert.equal(result.totalPercent, 26.67);
});

test("EXCUSED is omitted; ABSENT and DID_NOT_SUBMIT are recorded as zero raw marks", () => {
  assert.equal(calculateCategoryPercent({ conversionBase: 100, assessments: [scored(80), scored(null, 100, "Quiz", "EXCUSED")] }), 80);
  assert.equal(calculateCategoryPercent({ conversionBase: 100, assessments: [scored(80), scored(null, 100, "Quiz", "ABSENT")] }), 40);
  assert.equal(calculateCategoryPercent({ conversionBase: 100, assessments: [scored(80), scored(null, 100, "Quiz", "DID_NOT_SUBMIT")] }), 40);
});

test("explicitly weighted questions normalize over recorded and non-excused assessments", () => {
  const quiz = [scored(80, 100, "Quiz A", null, 25), pending(100, "Quiz B", 75)];
  assert.equal(calculateCategoryPercent({ conversionBase: 100, assessments: quiz }), 80);
  assert.equal(calculateCategoryPercent({ conversionBase: 100, assessments: [scored(80,100,"Quiz A",null,25),scored(40,100,"Quiz B",null,75)] }), 50);
});

test("all score cells blank: final is null rather than a failing zero", () => {
  const data = calculateGradeBreakdown([cat("lecture", null, 100, [pending()])]);
  assert.equal(data.totalPercent, null);
  assert.equal(data.items[0].pendingItems, 1);
});

test("displayed earned course parts add to displayed final percent", () => {
  const categories = [
    cat("lecture",null,60),
    cat("major","lecture",50),
    cat("prelim","major",10,[scored(72)]),
    cat("midterm","major",15,[scored(78)]),
    cat("finals","major",25,[scored(91)]),
    cat("self","lecture",25,[scored(65)]),
    cat("quiz","lecture",15,[scored(95)]),
    cat("att","lecture",10,[scored(null,1,"Attendance · 2026-11-06","PRESENT"),scored(null,1,"Attendance · 2026-11-07","ABSENT")],70),
    cat("lab",null,40),
    cat("labexam","lab",50,[scored(77)]),
    cat("labwork","lab",50,[scored(83)])
  ];
  const data = calculateGradeBreakdown(categories);
  assert.equal(data.items.reduce((sum,item)=>sum+item.courseWeight,0),100);
  assert.equal(Math.round(data.items.reduce((sum,item)=>sum+(item.earnedCourse||0),0)*100)/100, data.totalPercent);
  assert.equal(calculateFinal(categories),data.totalPercent);
});

test("fully recorded perfect course returns 100 across nested categories", () => {
  const c=[cat("lec",null,60),cat("exam","lec",25,[scored(100)]),cat("quiz","lec",75,[scored(100)]),cat("lab",null,40),cat("experiment","lab",100,[scored(100)])];
  assert.equal(calculateFinal(c),100);
});

test("adding a subcategory uses pending edits, not stale saved category allocations", () => {
  const saved = [
    { id: "laboratory", parentId: null, weight: 100 },
    { id: "periodic", parentId: "laboratory", weight: 50 },
    { id: "midterm", parentId: "periodic", weight: 20 },
    { id: "output", parentId: "periodic", weight: 30 },
    { id: "exercises", parentId: "laboratory", weight: 50 }
  ];
  const edited = saved.map(category => category.id === "exercises" ? { ...category, weight: 15 } : category);
  assert.equal(remainingChildAllocation("laboratory", saved), 0);
  assert.equal(remainingChildAllocation("laboratory", edited), 35);
  assert.equal(expectedChildAllocation("periodic", edited), 50);
  assert.equal(remainingChildAllocation("periodic", edited), 0);
  const withAttendance = [...edited, { id: "attendance", parentId: "laboratory", weight: 10 }];
  assert.equal(remainingChildAllocation("laboratory", withAttendance), 25);
  assert.equal(firstOverallocatedCategoryGroup(withAttendance), null);
  const excessive = [...edited, { id: "attendance", parentId: "laboratory", weight: 36 }];
  assert.deepEqual(firstOverallocatedCategoryGroup(excessive), { parentId: "laboratory", allocated: 101, expected: 100 });
});


test("only the third consecutive late counts as absent", () => {
  const late = date => scored(null, 1, "Attendance · " + date, "LATE");
  const present = date => scored(null, 1, "Attendance · " + date, "PRESENT");
  const first = late("2026-11-11");
  const second = late("2026-11-13");
  const third = late("2026-11-16");
  const fourth = late("2026-11-18");
  assert.equal(calculateCategoryPercent({ assessments: [third, first, second] }), 66.67);
  assert.equal(calculateCategoryPercent({ assessments: [third, first, present("2026-11-12"), second] }), 100);
  assert.equal(calculateCategoryPercent({ assessments: [fourth, third, first, second] }), 75);
  const dates = [first, second, third, fourth].map((item, id) => ({ ...item, id: String(id) }));
  const days = attendance.attendanceDays(dates);
  assert.deepEqual([...attendance.consecutiveLateAbsences(days, () => "LATE")], ["2"]);
  assert.deepEqual([...attendance.consecutiveLateAbsences(days, id => id === "1" ? "EXCUSED" : "LATE")], []);
  const extendedDays = [...days, ["2026-11-20", ["4"]], ["2026-11-23", ["5"]]];
  assert.deepEqual([...attendance.consecutiveLateAbsences(extendedDays, () => "LATE")], ["2", "5"]);
});

test("dropping warning clears when the student returns and a new streak starts at zero", () => {
  const dates = ["2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23", "2026-11-30", "2026-12-07"];
  const days = dates.map((date, id) => [date, [String(id)]]);
  const marks = ["ABSENT", "ABSENT", "ABSENT"];
  const warning = () => attendance.droppingAbsenceStreak(days,
    id => ({ remark: marks[Number(id)] ?? null, points: null }), new Set());
  assert.deepEqual(warning(), { days: 3, startDate: dates[0], endDate: dates[2], dates: dates.slice(0, 3) });
  marks.push("PRESENT");
  assert.equal(warning(), null);
  marks.push("ABSENT", "ABSENT");
  assert.equal(warning(), null);
  marks.push("ABSENT");
  assert.deepEqual(warning(), { days: 3, startDate: dates[4], endDate: dates[6], dates: dates.slice(4) });
});

test("attendance risk excludes future marks and uses one cutoff for server and browser dates", () => {
  const date = i => `2026-11-${String(i + 1).padStart(2, "0")}`;
  const assessments = Array.from({ length: 23 }, (_, i) => ({
    id: String(i), title: "Attendance · meeting", dueDate: new Date(date(i))
  }));
  const scores = new Map(assessments.map((item, i) => [
    item.id, { remark: i < 4 ? "ABSENT" : "PRESENT", points: null }
  ]));
  const browserAssessments = assessments.map(item => ({ ...item, dueDate: item.dueDate.toISOString() }));
  const serverSummary = attendance.attendanceRiskSummary(assessments, scores, "2026-11-20");
  assert.deepEqual(attendance.attendanceRiskSummary(browserAssessments, scores, "2026-11-20"), serverSummary);
  assert.equal(serverSummary.percent, 20);
  assert.equal(serverSummary.counted, 20);
  assert.equal(attendance.attendanceRiskSummary(assessments, scores, "2026-11-23").percent.toFixed(1), "17.4");
});


test("primary domain summaries return raw equivalents and rounded course-weighted contributions", () => {
  const categories = [
    cat("lecture", null, 60),
    cat("lecture-assessment", "lecture", 100, [scored(71.39)]),
    cat("laboratory", null, 40),
    cat("lab-assessment", "laboratory", 100, [scored(89.5)])
  ];
  const result = calculateGradeBreakdown(categories);
  const lecture = result.domains.find(item => item.categoryId === "lecture");
  const laboratory = result.domains.find(item => item.categoryId === "laboratory");
  assert.deepEqual(
    { raw: lecture.rawEquivalentPercent, weighted: lecture.parentWeightedScore },
    { raw: 71.39, weighted: 42.83 }
  );
  assert.deepEqual(
    { raw: laboratory.rawEquivalentPercent, weighted: laboratory.parentWeightedScore },
    { raw: 89.5, weighted: 35.8 }
  );
  assert.equal(result.totalPercent, 78.63);
  assert.equal(
    Number((lecture.parentWeightedScore + laboratory.parentWeightedScore).toFixed(2)),
    result.totalPercent
  );
});

test("domain summary is null until its primary component has at least one recorded score", () => {
  const result = calculateGradeBreakdown([
    cat("lecture", null, 60),
    cat("lecture-assessment", "lecture", 100, [pending()]),
    cat("lab", null, 40),
    cat("lab-assessment", "lab", 100, [scored(80)])
  ]);
  assert.deepEqual(result.domains.find(item => item.categoryId === "lecture"), {
    categoryId: "lecture", courseWeight: 60, rawEquivalentPercent: null,
    parentWeightedScore: null, recordedItems: 0, pendingItems: 1
  });
  assert.equal(result.domains.find(item => item.categoryId === "lab").parentWeightedScore, 32);
});


test("primary domains with direct assessments retain raw percent before course weighting", () => {
  const result = calculateGradeBreakdown([
    cat("lecture", null, 60, [scored(71.39)]),
    cat("lab", null, 40, [scored(89.5)])
  ]);
  assert.deepEqual(
    result.domains.map(item => [item.rawEquivalentPercent, item.parentWeightedScore]),
    [[71.39, 42.83], [89.5, 35.8]]
  );
  assert.equal(result.totalPercent, 78.63);
});
