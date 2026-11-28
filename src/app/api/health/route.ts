import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { reportCognixDatabaseUnavailable } from "@/lib/cognix-error-reporter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const headers = {
  "Cache-Control": "no-store, max-age=0",
  "X-Robots-Tag": "noindex, nofollow",
};

export async function GET() {
  const checkedAt = new Date().toISOString();

  try {
    // A minimal read-only query confirms the app's configured PostgreSQL connection.
    await prisma.$queryRaw`SELECT 1`;

    return NextResponse.json({
      service: "saga",
      status: "ok",
      database: "ok",
      checkedAt,
    }, { headers });
  } catch {
    // Keep database connection details and query errors out of the public response.
    reportCognixDatabaseUnavailable();
    console.error("[saga-health] database readiness check failed");
    return NextResponse.json({
      service: "saga",
      status: "degraded",
      database: "unavailable",
      checkedAt,
    }, { status: 503, headers });
  }
}
