const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("private media route permits the school's separate department logo path", () => {
  const source = fs.readFileSync("src/app/api/media/route.ts", "utf8");
  assert.match(source, /schools\/\$\{user\.schoolId\}\/department-logo\//);
  assert.match(source, /schools\/\$\{user\.schoolId\}\/logo\//);
});

test("department logo upload persists to its own school field and blob prefix", () => {
  const source = fs.readFileSync("src/app/api/profile/media/route.ts", "utf8");
  assert.match(source, /kind === "school-logo" \? "logo" : "department-logo"/);
  assert.match(source, /const field = kind === "school-logo" \? "logoPath" : "departmentLogoPath"/);
  assert.match(source, /data: \{ \[field\]: pathname \}/);
});
