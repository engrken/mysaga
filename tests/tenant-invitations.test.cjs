const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const source = fs.readFileSync(path.join(__dirname, "../src/lib/tenant-invitations.ts"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const mod = { exports: {} };
new Function("exports", "module", "require", compiled)(mod.exports, mod, require);
const { createTenantInvitationToken, tenantInvitationDigest, tenantInvitationUrl } = mod.exports;

test("tenant invitations use opaque random bearer tokens and store only their digest", () => {
  const first = createTenantInvitationToken();
  const second = createTenantInvitationToken();
  assert.match(first.token, /^[a-f0-9]{64}$/);
  assert.equal(first.tokenHash, createHash("sha256").update(first.token).digest("hex"));
  assert.equal(tenantInvitationDigest(first.token), first.tokenHash);
  assert.notEqual(first.token, second.token);
  assert.notEqual(first.tokenHash, second.tokenHash);
});

test("invitation links use the configured canonical application origin", () => {
  const original = process.env.APP_URL;
  process.env.APP_URL = "https://saga.example";
  try {
    assert.equal(tenantInvitationUrl("abc123", "https://preview.example/api/invite"), "https://saga.example/register?invite=abc123");
  } finally {
    if (original === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = original;
  }
});
