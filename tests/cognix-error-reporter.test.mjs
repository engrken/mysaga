import test from "node:test";
import assert from "node:assert/strict";
import { buildCognixErrorEvent } from "../src/lib/cognix-error-reporter.ts";

test("builds a fixed technical event without application or user data", () => {
  const event = buildCognixErrorEvent("saga", "2026-11-26T12:00:00.000Z", "6ba7b810-9dad-11d1-80b4-00c04fd430c8");
  assert.deepEqual(event, {
    schemaVersion: 1,
    eventId: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
    occurredAt: "2026-11-26T12:00:00.000Z",
    app: "saga",
    category: "database_unavailable",
    severity: "critical",
    component: "database",
    operationCode: "read",
    httpStatus: 503,
    dependencyCode: "primary_database",
    environment: "staging",
  });
  assert.equal(Object.hasOwn(event, "message"), false);
  assert.equal(Object.hasOwn(event, "stack"), false);
  assert.equal(Object.hasOwn(event, "requestBody"), false);
});
