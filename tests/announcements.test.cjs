const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const read = file => fs.readFileSync(path.join(process.cwd(), file), "utf8");

test("class announcements are tenant-, subject-, and teacher-scoped", () => {
  const route = read("src/app/api/teacher/subjects/[subjectId]/announcements/route.ts");
  const itemRoute = read("src/app/api/teacher/announcements/[announcementId]/route.ts");
  assert.match(route, /requireRole\("TEACHER"\)/);
  assert.match(route, /schoolId: teacher\.schoolId, teacherId: teacher\.id/);
  assert.match(route, /authorId: teacher\.id/);
  assert.match(itemRoute, /schoolId: teacher\.schoolId, authorId: teacher\.id/);
  assert.match(itemRoute, /subject: \{ schoolId: teacher\.schoolId, teacherId: teacher\.id \}/);
});

test("student feed only returns live notices from enrolled subjects", () => {
  const route = read("src/app/api/student/announcements/route.ts");
  const readRoute = read("src/app/api/student/announcements/[announcementId]/read/route.ts");
  assert.match(route, /requireRole\("STUDENT"\)/);
  assert.match(route, /status: "PUBLISHED"/);
  assert.match(route, /publishAt: \{ lte: now \}/);
  assert.match(route, /expiresAt: \{ gt: now \}/);
  assert.match(route, /studentUserId: student\.id/);
  assert.match(route, /studentNumber: \{ equals: student\.studentNumber\.trim\(\), mode: "insensitive" as const \}/);
  assert.match(route, /subject: \{ enrollments: \{ some:/);
  assert.match(readRoute, /subject: \{ enrollments: \{ some:/);
  assert.match(readRoute, /announcementRead\.upsert/);
});

test("announcement schema includes status and idempotent read receipts", () => {
  const schema = read("prisma/schema.prisma");
  const migration = read("prisma/migrations/20261127000400_class_announcements_bulletin/migration.sql");
  assert.match(schema, /model Announcement \{/);
  assert.match(schema, /model AnnouncementRead \{/);
  assert.match(schema, /@@unique\(\[announcementId, studentId\]\)/);
  assert.match(migration, /CREATE TYPE "AnnouncementStatus"/);
  assert.match(migration, /AnnouncementRead_announcementId_studentId_key/);
});

test("teacher gets a class tab and students get one compiled feed", () => {
  const portal = read("src/components/Portal.tsx");
  const nav = read("src/lib/class-navigation.ts");
  const page = read("src/app/[schoolId]/[page]/page.tsx");
  assert.match(nav, /"announcements"/);
  assert.match(portal, /openClassSection\("announcements"\)/);
  assert.match(portal, /<TeacherClassAnnouncements/);
  assert.match(portal, /<StudentAnnouncements/);
  assert.match(page, /page === "announcements" && user\.role !== "STUDENT"/);
});
