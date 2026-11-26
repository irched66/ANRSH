import fs from "node:fs";
import assert from "node:assert/strict";

const workerPath = new URL("../ANRSH-worker-counter.js", import.meta.url);
const worker = fs.readFileSync(workerPath, "utf8");

function pass(name, condition) {
  assert.ok(condition, name);
  console.log("PASS", name);
}

const normalized = worker.replace(/^export default\s+/, "return ");
new Function(normalized);
pass("worker syntax parses in Node-compatible wrapper", true);

pass("both national emails are allowlisted",
  worker.includes('"irched2521@gmail.com"') &&
  worker.includes('"anrsh1994@gmail.com"'));

pass("PBKDF2 password hashing is configured",
  worker.includes('name: "PBKDF2"') &&
  worker.includes('hash: "SHA-256"') &&
  worker.includes("ADMIN_PASSWORD_ITERATIONS = 310000"));

pass("bootstrap requires exactly two national accounts",
  worker.includes("exactly_two_national_accounts_required") &&
  worker.includes("accounts.length !== 2"));

pass("bootstrap is one-time and secret-gated",
  worker.includes("x-bootstrap-secret") &&
  worker.includes("bootstrap_already_used") &&
  worker.includes("COUNT(*) AS n FROM admin_users"));

pass("login OTP is short-lived",
  worker.includes("ADMIN_OTP_TTL_MS = 10 * 60 * 1000") &&
  worker.includes("expiresAt"));

pass("OTP attempt limit is enforced atomically",
  worker.includes("attempts<5") &&
  worker.includes("used_at IS NULL AND expires_at>?"));

pass("sessions support revocation/logout",
  worker.includes("/api/auth/logout") &&
  worker.includes("revoked_at=?"));

pass("role and bureau are attached to authenticated identity",
  worker.includes("u.role") &&
  worker.includes("u.bureau") &&
  worker.includes('row.role === "regional" && !row.bureau'));

pass("regional invitation creation is national-only",
  worker.includes('actor.role!=="national"') &&
  worker.includes("regional_invitation_created"));

pass("permanent deletion is disabled",
  worker.includes("deletion_disabled_retention_policy"));

console.log("ALL AUTH CONTRACT CHECKS PASSED");
