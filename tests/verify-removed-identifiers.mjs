import fs from "node:fs";
import assert from "node:assert/strict";

const html = fs.readFileSync("index.html", "utf8");
const worker = fs.readFileSync("ANRSH-worker-counter.js", "utf8");

for (const id of ["nin_no", "matricule_sh", "nss_no", "cnr_no"]) {
  assert.equal(html.includes('id="' + id + '"'), false, "registration field remains: " + id);
}
for (const key of ["nin", "matricule", "nss", "cnr"]) {
  assert.equal(new RegExp("\\b" + key + "\\s*:").test(worker), false, "Worker still stores " + key);
}
assert.match(html, /id="doc_cni"/, "front side of identity card must remain");
assert.match(html, /id="doc_cni_back"/, "back side of identity card must remain");
assert.match(html, /cni_back/, "back-side document mapping must remain");
console.log("PASS: four identifier fields removed; both identity-card images retained.");
