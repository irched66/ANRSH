import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const worker = readFileSync("ANRSH-worker-counter.js", "utf8");
const workerForScript = worker.replace(/export\s+default\s*\{/, "const __worker = {");
assert.doesNotThrow(() => new vm.Script(workerForScript, { filename: "ANRSH-worker-counter.js" }));

const html = readFileSync("index.html", "utf8");
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
let checked = 0;
for (const match of scripts) {
  const attrs = match[1] || "";
  const type = (attrs.match(/\btype=["']([^"']+)["']/i) || [])[1] || "text/javascript";
  if (!/^(text|application)\/(javascript|ecmascript)$/i.test(type)) continue;
  const source = match[2].trim();
  if (!source) continue;
  assert.doesNotThrow(() => new vm.Script(source, { filename: \`index-inline-\${checked + 1}.js\` }));
  checked++;
}
assert.ok(checked > 0, "Expected at least one inline JavaScript block");
assert.ok(worker.includes("async function requireAdmin"), "Session authentication guard must exist");
assert.ok(!worker.includes("adminKeyOk(request, env)"), "Shared admin API key must not authorize routes");
assert.ok(worker.includes("payment_not_verified"), "Member approval must require verified payment");
assert.ok(worker.includes("FILE_ENCRYPTION_KEY"), "New document uploads must require encryption key");
console.log(\`Syntax checks passed: Worker + \${checked} inline script(s); security invariants checked.\`);
