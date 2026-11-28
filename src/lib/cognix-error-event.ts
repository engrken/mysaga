import { randomUUID } from "node:crypto";

export function buildCognixErrorEvent(
  app: "saga",
  occurredAt = new Date().toISOString(),
  eventId = randomUUID(),
) {
  return {
    schemaVersion: 1 as const,
    eventId,
    occurredAt,
    app,
    category: "database_unavailable" as const,
    severity: "critical" as const,
    component: "database" as const,
    operationCode: "read" as const,
    httpStatus: 503,
    dependencyCode: "primary_database" as const,
    environment: process.env.VERCEL_ENV === "production" ? "production" as const : "staging" as const,
  };
}
