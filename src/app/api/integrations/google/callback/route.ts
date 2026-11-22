import { NextResponse } from "next/server";
import { completeGoogleOAuth } from "@/lib/google-chat";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const providerError = url.searchParams.get("error");
  const destination = new URL("/", process.env.NEXT_PUBLIC_APP_URL || url.origin);
  if (providerError || !code || !state) {
    destination.searchParams.set("googleChat", "error");
    destination.searchParams.set("reason", "authorization");
    return NextResponse.redirect(destination);
  }
  try {
    await completeGoogleOAuth(code, state);
    destination.searchParams.set("googleChat", "connected");
    return NextResponse.redirect(destination);
  } catch {
    destination.searchParams.set("googleChat", "error");
    destination.searchParams.set("reason", "connection");
    return NextResponse.redirect(destination);
  }
}
