import { randomUUID } from "node:crypto";
import { after } from "next/server";

type CognixErrorCategory = "database_unavailable";
type CognixComponent = "database";
type CognixDependency = "primary_database";

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
    category: "database_unavailable" as CognixErrorCategory,
    severity: "critical" as const,
    component: "database" as CognixComponent,
    operationCode: "read" as const,
    httpStatus: 503,
    dependencyCode: "primary_database" as CognixDependency,
    environment: process.env.VERCEL_ENV === "production" ? "production" as const : "staging" as const,
  };
}

/**
 * Best-effort technical event delivery after the health response is sent.
 * The payload is fixed metadata only; no request, user, tenant, or database data
 * is accepted by this adapter. Cognix outages never affect SAGA's health response.
 */
export function reportCognixDatabaseUnavailable() {
  const baseUrl = process.env.COGNIX_API_URL?.trim();
  const token = process.env.COGNIX_API_KEY?.trim();
  if (!baseUrl || !token) return;

  let endpoint: URL;
  try {
    endpoint = new URL("/api/v1/errors", baseUrl);
    if (endpoint.protocol !== "https:") return;
  } catch {
    return;
  }

  const event = buildCognixErrorEvent("saga");
  after(async () => {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(2_000),
        cache: "no-store",
      });
      if (!response.ok && response.status !== 429) {
        console.warn("[cognix-error-report] delivery rejected", { app: "saga", status: response.status });
      }
    } catch {
      console.warn("[cognix-error-report] delivery unavailable", { app: "saga" });
    }
  });
}
