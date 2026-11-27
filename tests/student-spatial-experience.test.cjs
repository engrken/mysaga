const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("student portal spatial workspace is shared by authenticated and demo Portal sessions", () => {
  const portal = read("src/components/Portal.tsx");
  assert.match(portal, /import StudentSpatialExperience from "\.\/StudentSpatialExperience"/);
  assert.match(portal, /<StudentSpatialExperience[\s\S]*?isDemo=\{user\.isDemo\}/);
});

test("student preferences are account-scoped and demo preferences are session-only", () => {
  const component = read("src/components/StudentSpatialExperience.tsx");
  assert.match(component, /window\.sessionStorage/);
  assert.match(component, /window\.localStorage/);
  assert.match(component, /\$\{STORAGE_KEY\}:\$\{userId\}/);
  assert.match(component, /Reset to Original/);
});

test("customizer supports glass themes, wallpapers, accents, module visibility and freeform mode", () => {
  const component = read("src/components/StudentSpatialExperience.tsx");
  for (const token of ["sunlit", "cafe", "silk", "mesh", "custom", "emerald", "violet", "amber", "rose", "freeform", "insights", "courses"]) {
    assert.ok(component.includes(token), `Expected customization option: ${token}`);
  }
});

test("floating companion supports pointer dragging, minimizing and restoring", () => {
  const component = read("src/components/StudentSpatialExperience.tsx");
  assert.match(component, /onPointerDown=\{onDragStart\}/);
  assert.match(component, /onPointerMove=\{onDragMove\}/);
  assert.match(component, /update\("minimized", true\)/);
  assert.match(component, /update\("minimized", false\)/);
  assert.match(component, /aria-label="Minimize companion panel"/);
});

test("student schedule endpoint returns the actual class schedule for the selected academic period", () => {
  const route = read("src/app/api/student/classes/route.ts");
  assert.match(route, /schedule: true/);\n  assert.match(component, /item\\.isPublished/);
  assert.match(route, /academicYear/);
  assert.match(route, /term/);
});

test("spatial workspace includes mobile drawer behavior and reduced-motion support", () => {
  const css = read("src/components/StudentSpatialExperience.module.css");
  assert.match(css, /@media\(max-width:767px\)/);
  assert.match(css, /bottom:72px/);
  assert.match(css, /prefers-reduced-motion:reduce/);
});
