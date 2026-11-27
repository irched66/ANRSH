import fs from "node:fs";
import assert from "node:assert/strict";

const worker = fs.readFileSync("ANRSH-worker-counter.js", "utf8");

const required = [
  ["password hashing", "PBKDF2"],
  ["session lookup", "admin_sessions"],
  ["logout revocation", "revoked_at"],
  ["OTP attempt limit", "attempts<5"],
  ["regional bureau scoping", 'actor.role !== "national" && row.bureau !== actor.bureau'],
  ["payment review scoping", 'actor.role !== "national" && payment.bureau !== actor.bureau'],
  ["wilaya duplicate protection", "UNIQUE(bureau,wilaya_code)"],
  ["card token revocation", "revoked_at"],
  ["card active membership check", "c.active=1"],
  ["document encryption", "FILE_ENCRYPTION_KEY"],
  ["quarterly reports", "quarterly_reports"],
  ["20/80 allocation", "Math.floor(grossAmount*0.2)"],
];

for (const [label, needle] of required) {
  assert.ok(worker.includes(needle), label + " missing: " + needle);
}

assert.ok(/admin\/sessions\/logout/.test(worker) || /authLogout/.test(worker), "logout endpoint missing");
assert.ok(/authCreateInvitation/.test(worker) && /authAcceptInvitation/.test(worker), "invitation flow missing");
assert.ok(/secureFile|encrypt|AES-256-GCM/.test(worker), "encrypted document path missing");
console.log("PASS: security-phase-1 static authorization and feature checks");
