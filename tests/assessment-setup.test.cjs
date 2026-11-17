const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const assessment = (id, weight = null) => ({
  id, title: id, categoryId: "quizzes", maxScore: 20, weight, dueDate: null,
  scheduleOverrideReason: null, attendanceType: null
});
const context = { params: Promise.resolve({ subjectId: "subject" }) };
function route(assessments) {
  const writes = [];
  const subject = { id: "subject", gradeStatus: "DRAFT", enrollments: [], categories: [{ id: "quizzes", parentId: null }], assessments };
  const imports = {
    "next/server": { NextResponse: { json: (body, init) => ({ body, status: init?.status ?? 200 }) } },
    "zod": require("zod"),
    "@/lib/auth": { requireRole: async () => ({ id: "teacher", schoolId: "school" }) },
    "@/lib/prisma": { prisma: {
      subject: { findFirst: async () => subject },
      assessment: { create: async ({ data }) => { writes.push(data); return data; }, update: ({ data }) => ({ data }) },
      auditEvent: { create: async () => ({}) },
      $transaction: async operations => typeof operations === "function"
        ? operations(imports["@/lib/prisma"].prisma) : writes.push(...operations)
    }}
  };
  const source = fs.readFileSync(path.join(__dirname, "../src/app/api/teacher/subjects/[subjectId]/route.ts"), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const handlers = {};
  new Function("exports", "require", js)(handlers, id => imports[id] ?? {});
  return { ...handlers, writes };
}
const request = body => new Request("http://localhost", { method: "POST", body: JSON.stringify(body) });

test("assessment creation rejects mixed item weights and invalid dates", async () => {
  const api = route([assessment("existing")]);
  const newItem = { title: "Quiz 2", categoryId: "quizzes", maxScore: 20 };
  const mixed = await api.POST(request({ ...newItem, weight: 25 }), context);
  assert.equal(mixed.status, 400);
  assert.match(mixed.body.error, /item weighting/);
  assert.equal((await api.POST(request({ ...newItem, dueDate: "2026-02-30" }), context)).status, 400);
  assert.equal(api.writes.length, 0);
  assert.equal((await api.POST(request({ ...newItem, dueDate: "2026-11-17" }), context)).status, 201);
});

test("assessment changes reject duplicate IDs and mixed weights, but allow a whole category to change", async () => {
  const one = assessment("one");
  const two = assessment("two");
  const api = route([one, two]);
  const patch = assessmentItems => api.PATCH(request({ assessmentItems }), context);
  assert.equal((await patch([one, one])).status, 409);
  assert.equal((await patch([{ ...one, weight: 25 }, two])).status, 400);
  assert.equal(api.writes.length, 0);
  assert.equal((await patch([{ ...one, weight: 25 }, { ...two, weight: 75 }])).status, 200);
});
