import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The initial COGNIX teacher-summary experiment is intentionally disabled
 * pending a documented purpose, necessity/proportionality assessment, and
 * model-provider retention review. This route performs no academic queries
 * and makes no outbound request to COGNIX.
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
      error: "capability_disabled",
      message: "The COGNIX teacher-summary capability is disabled pending privacy review. No SAGA academic records were queried and no data was sent to COGNIX.",
    },
    {
      status: 403,
      headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" },
    },
  );
}
