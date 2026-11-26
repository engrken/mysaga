import { after } from "next/server";
import { buildCognixErrorEvent } from "@/lib/cognix-error-event";

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
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
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
