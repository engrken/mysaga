import { createHash, randomBytes } from "node:crypto";

export function createTenantInvitationToken() {
  const token = randomBytes(32).toString("hex");
  return { token, tokenHash: tenantInvitationDigest(token) };
}

export function tenantInvitationDigest(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function tenantInvitationUrl(token: string, requestUrl: string) {
  const origin = process.env.APP_URL || new URL(requestUrl).origin;
  return new URL(`/register?invite=${encodeURIComponent(token)}`, origin).toString();
}
