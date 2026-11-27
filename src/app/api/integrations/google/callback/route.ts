import { NextResponse } from "next/server";
import { completeGoogleOAuth, verifyGoogleOAuthState } from "@/lib/google-chat";
import { clearGoogleSignInCookies, completeGoogleSignInOAuth } from "@/lib/google-auth";

export const runtime = "nodejs";

function safeRedirect(path: string, origin: string) {
  const destination = new URL(path, origin);
  return destination.origin === origin ? destination : new URL("/login?googleError=invalid-state", origin);
}

function withQuery(path: string, origin: string, key: string, value: string) {
  const destination = safeRedirect(path, origin);
  destination.searchParams.set(key, value);
  return destination;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const providerError = url.searchParams.get("error");

  if (!state) {
    return NextResponse.redirect(new URL("/login?googleError=invalid-state", url.origin));
  }
  const statePayload = await verifyGoogleOAuthState(state).catch(() => null);
  if (!statePayload) {
    await clearGoogleSignInCookies();
    return NextResponse.redirect(new URL("/login?googleError=invalid-state", url.origin));
  }
  const expectedCallback = new URL("/api/integrations/google/callback", url.origin).toString();
  if (
    (statePayload.purpose === "google-login" && statePayload.redirectUri !== expectedCallback) ||
    (typeof statePayload.redirectUri === "string" && statePayload.redirectUri !== expectedCallback)
  ) {
    await clearGoogleSignInCookies();
    return NextResponse.redirect(new URL("/login?googleError=invalid-state", url.origin));
  }

  if (providerError || !code) {
    if (statePayload.purpose === "google-login") {
      await clearGoogleSignInCookies();
      return NextResponse.redirect(new URL("/login?googleError=cancelled", url.origin));
    }
    const fallback = typeof statePayload.returnTo === "string" ? statePayload.returnTo : "/dashboard";
    return NextResponse.redirect(withQuery(fallback, url.origin, "googleServices", "declined"));
  }

  if (statePayload.purpose === "google-login") {
    try {
      const result = await completeGoogleSignInOAuth(code, state);
      return NextResponse.redirect(safeRedirect(result.redirectTo, url.origin), {
        headers: { "Cache-Control": "no-store" }
      });
    } catch (error) {
      await clearGoogleSignInCookies();
      const code = error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "failed";
      const allowed = new Set([
        "GOOGLE_ACCOUNT_NOT_FOUND",
        "SCHOOL_INACTIVE",
        "GOOGLE_NOT_CONFIGURED",
        "INVALID_GOOGLE_STATE",
        "GOOGLE_IDENTITY_UNVERIFIED",
        "GOOGLE_TOKEN_EXCHANGE_FAILED"
      ]);
      const reason = allowed.has(code) ? code : "failed";
      return NextResponse.redirect(new URL("/login?googleError=" + encodeURIComponent(reason), url.origin));
    }
  }

  if (statePayload.purpose === "google-chat-oauth") {
    try {
      const result = await completeGoogleOAuth(code, state);
      return NextResponse.redirect(safeRedirect(result.returnTo || "/dashboard", url.origin), {
        headers: { "Cache-Control": "no-store" }
      });
    } catch {
      const fallback = typeof statePayload.returnTo === "string" ? statePayload.returnTo : "/dashboard";
      return NextResponse.redirect(withQuery(fallback, url.origin, "googleServices", "error"));
    }
  }

  await clearGoogleSignInCookies();
  return NextResponse.redirect(new URL("/login?googleError=invalid-state", url.origin));
}
