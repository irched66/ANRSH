import fs from "node:fs";
import assert from "node:assert/strict";

const worker = fs.readFileSync("ANRSH-worker-counter.js", "utf8");

// Public routes must not expose member documents or administrative data.
assert.ok(worker.includes('const fileMatch = path.match(/^\\/api\\/admin\\/requests\\/([^/]+)\\/files\\/([^/]+)$/)'));
assert.ok(worker.includes("handleAdminFile("));
assert.ok(worker.includes("requireAdmin(request,env)"));
assert.ok(!worker.includes("public_file_url"), "public file URL field must not be introduced");
assert.ok(!worker.includes("r2.dev"), "public R2 URL must not be introduced");

// Uploads must be encrypted and validated before persistence.
for (const needle of [
  "FILE_ENCRYPTION_KEY",
  "AES-GCM",
  "encryptFileData(bytes,env)",
  "fileSignatureMatches(bytes, item.type)",
  "MAX_TOTAL_BYTES"
]) {
  assert.ok(worker.includes(needle), "document boundary missing: " + needle);
}

// Auth boundaries must include OTP, sessions, logout and bureau scoping.
for (const needle of [
  "authLogin(request, env)",
  "authVerify(request, env)",
  "authLogout(request, env)",
  "admin_sessions",
  "revoked_at",
  "actor.bureau"
]) {
  assert.ok(worker.includes(needle), "auth boundary missing: " + needle);
}

// Destructive operations must remain authenticated and auditable.
assert.ok(worker.includes('request.method === "DELETE" && deleteMatch'));
assert.ok(worker.includes("handleAdminDelete("));
assert.ok(worker.includes("audit"), "audit trail must remain present");

console.log("PASS: security-phase-1 boundary checks");
