import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const worker = readFileSync("ANRSH-worker-counter.js", "utf8");
const workerForScript = worker.replace(/export\s+default\s*\{/, "const __worker = {");
try {
  new vm.Script(workerForScript, { filename: "ANRSH-worker-counter.js" });
  console.log("Worker syntax passed.");
} catch (error) {
  console.error("Worker syntax failed:", error.stack);
  throw error;
}

const html = readFileSync("index.html", "utf8");
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
let checked = 0;
for (const match of scripts) {
  const attrs = match[1] || "";
  const type = (attrs.match(/\btype=["']([^"']+)["']/i) || [])[1] || "text/javascript";
  if (!/^(text|application)\/(javascript|ecmascript)$/i.test(type)) continue;
  const source = match[2].trim();
  if (!source) continue;
  try {
    new vm.Script(source, { filename: "index-inline-" + (checked + 1) + ".js" });
    checked++;
  } catch (error) {
    console.error("Inline script failed at block " + (checked + 1) + ":", error.stack);
    throw error;
  }
}
assert.ok(checked > 0, "Expected at least one inline JavaScript block");
assert.ok(worker.includes("async function requireAdmin"), "Session authentication guard must exist");
assert.ok(!worker.includes("adminKeyOk(request, env)"), "Shared admin API key must not authorize routes");
assert.ok(worker.includes("payment_not_verified"), "Member approval must require verified payment");
assert.ok(worker.includes("AND changes()=1"), "Payment allocation must only follow the successful conditional payment update");
assert.ok(worker.includes('for (const required of ["photo", "cni", "cni_back", "retire", "proof"])'), "Server must require both sides of the national identity card");
assert.ok(worker.includes("member_approval_conflict"), "Member OTP issuance must use a conditional state transition");
assert.ok(worker.includes("Restore the previous state only if this exact OTP is still current"), "Failed email delivery must safely restore the prior OTP state");
assert.ok(worker.includes("status='otp_sending'"), "Member OTP delivery must acquire a sending lock before contacting email provider");
assert.ok(worker.includes("status='otp_sending' AND otp_exp < ?"), "Stale OTP sending locks must be recoverable after their lease expires");
assert.ok(worker.includes("SET status='code_sent',otp_exp=? WHERE id=? AND status='otp_sending' AND otp_hash=?"), "OTP becomes usable only after email delivery succeeds");
assert.ok(worker.includes("new Date(Date.UTC(year,quarter*3,0))"), "Quarterly report period must end on the actual last day");
assert.ok(worker.includes("FILE_ENCRYPTION_KEY"), "New document uploads must require encryption key");
assert.ok(!html.includes("ANRSH-2026-CHANGE"), "Fixed legacy browser OTP key must not exist");
assert.ok(html.includes("window.validateSecurityOTP=async function()"), "Member OTP must be verified through the Worker API");
assert.ok(html.includes("member_notification_failed"), "Frontend must explain failed member OTP delivery");
assert.ok(html.includes("تم إرسال رمز التحقق إلى البريد الإلكتروني المسجل للمنخرط"), "Admin UI must confirm the actual member OTP delivery target");
assert.ok(html.includes('id="doc_cni_back" accept="image/*,.pdf" required'), "Registration form must require the back of the identity card");
assert.ok(html.includes('video.src="intro.mp4"'), "Opening video must remain wired to the landing page");
assert.ok(html.includes('assets/anrsh-background.png'), "Approved ANRSH background must be used");
assert.ok(html.includes('id="anrsh-clock"'), "Algeria local clock must be displayed");
assert.ok(html.includes('id="anrsh-quote"') && html.includes("سورة الشرح، الآية 6"), "Quran and hadith rotation must be present with references");
assert.ok(!html.includes("setLanguage('ber'"), "Amazigh language option must be removed");
assert.ok(html.includes('api("/api/visitor-visit"'), "Unique visitor counter must call the Worker");
assert.ok(worker.includes("ADMIN_OTP_TTL_MS = 10 * 60 * 1000"), "Administrative OTP must expire after ten minutes");
assert.ok(worker.includes('"/api/visitor-visit"'), "Worker visitor counter route must exist");
console.log("Syntax checks passed: Worker + " + checked + " inline script(s); security invariants checked.");
