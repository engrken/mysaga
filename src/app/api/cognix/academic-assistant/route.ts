import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Retired endpoint for the former COGNIX lesson-material generator.
 * The SAGA Virtual Assistant now uses a read-only, workspace-scoped adapter.
 * This compatibility route intentionally performs no academic query and no
 * outbound COGNIX request.
 */
export async function POST() {
  const teacher = await requireRole("TEACHER");
  if (!teacher || teacher.isDemo) {
    return NextResponse.json(
      { error: "unauthorized", message: "An active, non-demo teacher session is required." },
      { status: 401 },
    );
  }

  return NextResponse.json(
    {
      error: "feature_retired",
      message: "The lesson-material generator has been retired. Open a class workspace and use the SAGA Virtual Assistant for system guidance and read-only class summaries.",
    },
    {
      status: 410,
      headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" },
    },
  );
}
