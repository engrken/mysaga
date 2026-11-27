import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { schoolStorageUsage } from "@/lib/storage-quota";

export const runtime = "nodejs";

export async function GET() {
  const user = await getSession();
  if (!user || user.role !== "TEACHER" || !user.isSchoolAdmin) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 403 });
  }
  try {
    const usage = await schoolStorageUsage(user.schoolId);
    return NextResponse.json({
      usedBytes: usage.usedBytes.toString(),
      quotaBytes: usage.quotaBytes.toString(),
      availableBytes: usage.availableBytes.toString(),
      usagePercent: usage.usagePercent
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    console.error("School storage usage could not be read:", cause instanceof Error ? cause.message : "unknown error");
    return NextResponse.json({ error: "Storage usage is temporarily unavailable." }, { status: 503 });
  }
}
