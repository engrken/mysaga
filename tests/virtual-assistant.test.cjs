const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const sourcePath = path.join(__dirname, "../src/lib/virtual-assistant.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = new Module(sourcePath, module);
loaded.filename = sourcePath;
loaded.paths = module.paths;
loaded._compile(compiled, sourcePath);
const { classifyAssistantMessage, getStaticHelpAnswer } = loaded.exports;

test("class workspace questions are classified for local SAGA answers", () => {
  assert.deepEqual(classifyAssistantMessage("How many students are enrolled?"), {
    kind: "workspace", intent: "enrollment-count",
  });
  assert.deepEqual(classifyAssistantMessage("How many students does this class have?"), {
    kind: "workspace", intent: "enrollment-count",
  });
  assert.deepEqual(classifyAssistantMessage("What assessments are due this week?"), {
    kind: "workspace", intent: "upcoming-assessments",
  });
  assert.deepEqual(classifyAssistantMessage("How many assessments are due this week?"), {
    kind: "workspace", intent: "upcoming-assessments",
  });
  assert.deepEqual(classifyAssistantMessage("How many students failed?"), {
    kind: "unknown",
  });
  assert.deepEqual(classifyAssistantMessage("What is the grade sheet status?"), {
    kind: "workspace", intent: "grade-workflow",
  });
  assert.deepEqual(classifyAssistantMessage("Give me an overview of this class."), {
    kind: "workspace", intent: "class-overview",
  });
});

test("system-use questions map to fixed help topics", () => {
  assert.deepEqual(classifyAssistantMessage("How do I record scores?"), {
    kind: "system-help", topic: "score-entry",
  });
  assert.deepEqual(classifyAssistantMessage("Can you record a score from my Excel sheet?"), {
    kind: "system-help", topic: "score-entry",
  });
  assert.deepEqual(classifyAssistantMessage("How do I import scores from an Excel spreadsheet?"), {
    kind: "system-help", topic: "score-entry",
  });
  assert.deepEqual(classifyAssistantMessage("How to setup grade?"), {
    kind: "system-help", topic: "grading-setup",
  });
  assert.deepEqual(classifyAssistantMessage("How do I set up my grades?"), {
    kind: "system-help", topic: "grading-setup",
  });
  assert.deepEqual(classifyAssistantMessage("Where do I add students to the roster?"), {
    kind: "system-help", topic: "class-roster",
  });
  assert.deepEqual(classifyAssistantMessage("How can I submit final grades?"), {
    kind: "system-help", topic: "final-grades",
  });
  assert.ok(getStaticHelpAnswer("privacy").includes("fixed help-topic code"));
});

test("individual student record requests are not sent to COGNIX", () => {
  assert.deepEqual(classifyAssistantMessage("Show me the grade for student Juan Santos."), {
    kind: "individual-record",
  });
  assert.deepEqual(classifyAssistantMessage("List student names and IDs in this class."), {
    kind: "individual-record",
  });
  assert.deepEqual(classifyAssistantMessage("Show me Juan's attendance."), {
    kind: "individual-record",
  });
});

test("unknown questions fail closed to local clarification", () => {
  assert.deepEqual(classifyAssistantMessage("Can you do something unusual?"), { kind: "unknown" });
});

test("workspace adapter authorizes the current subject with teacher and school predicates", () => {
  const routePath = path.join(__dirname, "../src/app/api/teacher/subjects/[subjectId]/assistant/route.ts");
  const routeSource = fs.readFileSync(routePath, "utf8");
  assert.match(routeSource, /id:\s*subjectId[\s\S]{0,100}teacherId:\s*teacher\.id[\s\S]{0,100}schoolId:\s*teacher\.schoolId/);
  assert.match(routeSource, /input:\s*\{\s*topic\s*\}/);
  assert.doesNotMatch(routeSource, /input:\s*\{[^}]*message/);
});

test("former lesson-generation endpoint is retired without a model call", () => {
  const routePath = path.join(__dirname, "../src/app/api/cognix/academic-assistant/route.ts");
  const routeSource = fs.readFileSync(routePath, "utf8");
  assert.match(routeSource, /status:\s*410/);
  assert.match(routeSource, /feature_retired/);
  assert.doesNotMatch(routeSource, /fetch\s*\(/);
  assert.doesNotMatch(routeSource, /prisma\./);
});
