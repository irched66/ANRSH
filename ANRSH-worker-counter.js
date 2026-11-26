/**
 * ANRSH DIGITAL — Cloudflare Worker (D1 edition)
 * API compatible with the current ANRSH HTML frontend routes.
 *
 * Staging deployment bindings/secrets (see wrangler.staging.toml):
 *   D1 binding: DB -> database "anrsh-staging"
 *   Variable: ANRSH_ENV = "staging" (write routes fail closed otherwise)
 *   Secret: ADMIN_API_KEY -> random value of at least 32 characters
 *   Secret: TEXTBEE_API_KEY -> TextBee gateway API key
 *   Optional email: RESEND_API_KEY and RESEND_FROM
 *
 * IMPORTANT:
 * - This staging edition stores private attachments in D1 members.files JSON
 *   because an R2 bucket is not configured. Request attachments are limited to 1 MiB total.
 * - Document routes require a National Office key or a bureau-scoped regional session.
 * - WhatsApp is a manual fallback; the Worker does not send WhatsApp automatically.
 * - Apply the D1 migrations separately and only to the isolated staging database.
 * - Do not deploy this staging edition to production without a separate review.
 */

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "x-permitted-cross-domain-policies": "none",
  "strict-transport-security": "max-age=31536000",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'"
};

const ALLOWED_ORIGINS = new Set([
  "https://irched66.github.io",
  "https://anrsh.netlify.app",
  "https://animated-moonbeam-256371.netlify.app",
  "https://luxury-malabi-c2f0fb.netlify.app"
]);

// D1 stores attachment metadata and base64 content in a single member row.
// Keep the combined raw attachment size below 1 MiB to stay within safe row limits.
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024;
const ALLOWED_FILE_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"
]);
const FILE_KEYS = ["photo", "cni", "cni_back", "retire", "proof"];
const OTP_TTL_MS = 5 * 60 * 1000;
const PRINT_TTL_SECONDS = 15 * 60;
const DEFAULT_MEMBERSHIP_FEE_DZD = 500;
const MAX_MEMBERSHIP_FEE_DZD = 1000000;
const MAX_OTP_TRIES = 5;

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...extra }
  });
}

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  const allowed = ALLOWED_ORIGINS.has(origin);
  const headers = {
    "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
    "access-control-allow-headers": "Content-Type, x-admin-key, Authorization",
    "access-control-max-age": "86400",
    "vary": "Origin"
  };
  // Never grant browser access to an unapproved origin.
  if (allowed) headers["access-control-allow-origin"] = origin;
  return headers;
}

function withCors(response, request) {
  const h = new Headers(response.headers);
  for (const [k, v] of Object.entries(corsHeaders(request))) h.set(k, v);
  return new Response(response.body, { status: response.status, headers: h });
}

function b64(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function unb64(s) {
  const raw = atob(s);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
function b64url(bytes) {
  return b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function fromB64url(s) {
  const t = s.replace(/-/g, "+").replace(/_/g, "/");
  return unb64(t + "=".repeat((4 - t.length % 4) % 4));
}
function randomHex(n = 16) {
  const a = crypto.getRandomValues(new Uint8Array(n));
  return [...a].map(x => x.toString(16).padStart(2, "0")).join("");
}
function randomDigits(n = 6) {
  const a = crypto.getRandomValues(new Uint32Array(n));
  return [...a].map(x => String(x % 10)).join("");
}
async function sha256(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("");
}
async function hmac(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function cleanText(v, max = 300) {
  return String(v ?? "").trim().replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max);
}
function parseJson(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}
function clientIp(request) {
  return cleanText(request.headers.get("CF-Connecting-IP") || "", 80);
}
function normalizePhone(v) {
  let digits = cleanText(v, 30).replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = "213" + digits.slice(1);
  else if (!digits.startsWith("213") && /^[567]\d{8}$/.test(digits)) digits = "213" + digits;
  const normalized = "+" + digits;
  return /^\+213[567]\d{8}$/.test(normalized) ? normalized : "";
}
function validRef(v) {
  return /^[A-Za-z0-9_-]{8,80}$/.test(String(v || ""));
}
async function currentMembershipFee(env) {
  const row = await env.DB.prepare("SELECT fee_dzd FROM anrsh_platform_settings WHERE id = 1").first();
  const amount = Number(row && row.fee_dzd);
  // The current finance-ledger migration enforces a fixed 500 DZD fee.
  // Do not allow a settings mismatch to break payment confirmation/accounting.
  if (!Number.isSafeInteger(amount) || amount !== DEFAULT_MEMBERSHIP_FEE_DZD) throw new Error("membership_settings_unavailable");
  return amount;
}

function adminKeyOk(request, env) {
  const configured = env.ADMIN_API_KEY;
  const supplied = request.headers.get("x-admin-key") || "";
  return typeof configured === "string" && configured.length >= 32 &&
    safeEqual(supplied, configured);
}
function stagingOnly(env) {
  return env.ANRSH_ENV === "staging";
}
function fileName(name) {
  return cleanText(name, 100).replace(/[^\w.\-ء-ي]/g, "_") || "document";
}
function bytesToBase64(bytes) {
  return b64(bytes);
}
function base64ToBytes(value) {
  return unb64(value);
}

async function makePrintToken(ref, env) {
  const secret = env.ADMIN_API_KEY;
  const payload = { ref, exp: Math.floor(Date.now() / 1000) + PRINT_TTL_SECONDS };
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = b64url(await hmac(body, secret));
  return body + "." + sig;
}
async function checkPrintToken(token, env, expectedRef) {
  try {
    if (!env.ADMIN_API_KEY || typeof token !== "string" || !validRef(expectedRef)) return false;
    const parts = token.split(".");
    if (parts.length !== 2) return false;
    const expected = b64url(await hmac(parts[0], env.ADMIN_API_KEY));
    if (!safeEqual(parts[1], expected)) return false;
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(parts[0])));
    return payload.ref === expectedRef && Number(payload.exp) >= Math.floor(Date.now() / 1000);
  } catch { return false; }
}

async function sendTextBeeSMS(env, phone, code) {
  const apiKey = env.TEXTBEE_API_KEY;
  const deviceId = "6b05933f96bbd64a7027a511";
  if (!apiKey) return { sent: false, reason: "sms_not_configured" };
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = "213" + digits.slice(1);
  else if (!digits.startsWith("213")) digits = "213" + digits;
  const recipient = "+" + digits;
  if (!/^\+213[567]\d{8}$/.test(recipient)) return { sent: false, reason: "invalid_phone" };
  // Mobilis SIM 1 first; Ooredoo SIM 2 only if the primary attempt fails.
  for (const simSlotIndex of [0, 1]) {
    try {
      const response = await fetch("https://api.textbee.dev/api/v1/gateway/send-sms", {
        method: "POST",
        headers: { "x-api-key": apiKey, "content-type": "application/json" },
        body: JSON.stringify({ recipients: [recipient], message: String(code), deviceId, simSlotIndex })
      });
      if (response.ok) return { sent: true, simSlotIndex };
      console.error("TextBee SMS error", response.status, (await response.text().catch(() => "")).slice(0, 300));
    } catch (e) {
      console.error("TextBee SMS network error", String(e).slice(0, 300));
    }
  }
  return { sent: false, reason: "sms_provider_error" };
}

async function sendEmail(env, to, subject, text) {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM || !to) return { sent: false, reason: "email_not_configured" };
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "authorization": "Bearer " + env.RESEND_API_KEY,
        "content-type": "application/json"
      },
      body: JSON.stringify({ from: env.RESEND_FROM, to: [to], subject, text })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.error("Resend error", response.status, detail.slice(0, 500));
      return { sent: false, reason: "email_provider_error" };
    }
    return { sent: true };
  } catch (e) {
    console.error("Resend network error", String(e).slice(0, 300));
    return { sent: false, reason: "email_provider_unavailable" };
  }
}


// Anonymous visitor analytics. The raw browser ID is never stored; only its SHA-256 hash is kept.
function algeriaDay() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Algiers", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date());
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
async function readPublicStats(env) {
  const [visitors, today, members, applications] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS n FROM anrsh_site_visitors").first(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM anrsh_site_daily_visitors WHERE visit_day = ?").bind(algeriaDay()).first(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM members WHERE status = 'unlocked'").first(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM members").first()
  ]);
  return {
    ok: true,
    totalVisitors: Number(visitors?.n || 0),
    todayVisitors: Number(today?.n || 0),
    approvedMembers: Number(members?.n || 0),
    totalApplications: Number(applications?.n || 0),
    day: algeriaDay()
  };
}
async function handlePublicStats(env) {
  if (!env.DB) return json({ error: "database_unavailable" }, 503);
  return json(await readPublicStats(env));
}
async function handleVisitorVisit(request, env) {
  if (!env.DB) return json({ error: "database_unavailable" }, 503);
  const body = await request.json().catch(() => ({}));
  const visitorId = String(body.visitorId || "");
  if (!/^[a-f0-9-]{20,80}$/i.test(visitorId)) return json({ error: "invalid_visitor_id" }, 400);
  const hash = await sha256("ANRSH-public-visitor-v1:" + visitorId);
  const now = new Date().toISOString();
  const day = algeriaDay();
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO anrsh_site_visitors (visitor_hash, first_seen, last_seen) VALUES (?, ?, ?)").bind(hash, now, now),
    env.DB.prepare("UPDATE anrsh_site_visitors SET last_seen = ? WHERE visitor_hash = ?").bind(now, hash),
    env.DB.prepare("INSERT OR IGNORE INTO anrsh_site_daily_visitors (visit_day, visitor_hash) VALUES (?, ?)").bind(day, hash)
  ]);
  return json(await readPublicStats(env));
}

async function handleHealth(env) {
  if (!env.DB) return json({ ok: false, database: "binding_missing" }, 503);
  try {
    const row = await env.DB.prepare(`
      SELECT
        (SELECT COUNT(*) FROM wilayas WHERE active = 1) AS wilayas,
        (SELECT COUNT(*) FROM regional_offices WHERE active = 1) AS offices
    `).first();
    return json({
      ok: true, database: "connected",
      environment: env.ANRSH_ENV || "unset",
      active_wilayas: Number(row?.wilayas || 0),
      active_regional_offices: Number(row?.offices || 0)
    });
  } catch (e) {
    console.error("health", e);
    return json({ ok: false, database: "connection_error" }, 500);
  }
}

async function handleWilayas(env) {
  if (!env.DB) return json({ error: "database_unavailable" }, 503);
  const r = await env.DB.prepare(`
    SELECT code, name_ar, name_fr, name_en, name_tz
    FROM wilayas WHERE active = 1 ORDER BY CAST(code AS INTEGER)
  `).all();
  return json({ ok: true, count: r.results.length, wilayas: r.results });
}

async function handleOffices(env) {
  if (!env.DB) return json({ error: "database_unavailable" }, 503);
  const r = await env.DB.prepare(`
    SELECT bureau, office_name AS name, president_name AS head, president_phone AS tel
    FROM regional_offices WHERE active = 1 ORDER BY office_name
  `).all();
  return json({ ok: true, count: r.results.length, offices: r.results });
}

async function handleCreateRequest(request, env) {
  if (!stagingOnly(env)) return json({ error: "staging_environment_required" }, 503);

  if (!env.DB) return json({ error: "database_unavailable" }, 503);
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return json({ error: "multipart_form_required" }, 415);
  }

  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > 2 * 1024 * 1024) return json({ error: "request_too_large" }, 413);
  const form = await request.formData();
  const profileRaw = form.get("profile");
  if (typeof profileRaw !== "string" || profileRaw.length > 30000) {
    return json({ error: "invalid_profile" }, 400);
  }
  const p = parseJson(profileRaw, null);
  if (!p || typeof p !== "object") return json({ error: "invalid_profile_json" }, 400);
  if (form.get("consent") !== "true" || p.consent !== true) {
    return json({ error: "consent_required" }, 400);
  }

  const bureau = cleanText(p.bureau, 80);
  const first = cleanText(p.first_name, 100);
  const last = cleanText(p.last_name, 100);
  const phone = normalizePhone(p.phone);
  if (!bureau || !first || !last || !phone) {
    return json({ error: "required_fields_missing" }, 400);
  }

  const office = await env.DB.prepare(
    "SELECT bureau FROM regional_offices WHERE bureau = ? AND active = 1"
  ).bind(bureau).first();
  if (!office) return json({ error: "invalid_or_inactive_office" }, 400);

  let membershipFeeDzd;
  try { membershipFeeDzd = await currentMembershipFee(env); }
  catch (e) { console.error("membership settings", e); return json({ error: "settings_unavailable" }, 503); }

  const files = {};
  let total = 0;
  for (const key of FILE_KEYS) {
    const item = form.get(key);
    if (!item || typeof item === "string") continue;
    if (!(item instanceof File) || item.size <= 0) continue;
    if (!ALLOWED_FILE_TYPES.has(item.type)) return json({ error: "unsupported_file_type", file: key }, 415);
    if (item.size > MAX_FILE_BYTES) return json({ error: "file_too_large", file: key, max_bytes: MAX_FILE_BYTES }, 413);
    total += item.size;
    if (total > MAX_TOTAL_BYTES) return json({ error: "total_files_too_large", max_bytes: MAX_TOTAL_BYTES }, 413);
    const bytes = new Uint8Array(await item.arrayBuffer());
    files[key] = {
      name: fileName(item.name),
      type: item.type,
      size: item.size,
      data: bytesToBase64(bytes)
    };
  }
  // The current HTML requires the core identity/payment documents.
  for (const required of FILE_KEYS) {
    if (!files[required]) return json({ error: "required_document_missing", file: required }, 400);
  }

  const id = crypto.randomUUID();
  const ref = "ANR-" + new Date().getUTCFullYear() + "-" + randomHex(5).toUpperCase();
  const displayName = (first + " " + last).trim();
  const safeProfile = {
    bureau, first_name: first, last_name: last,
    birth_date: cleanText(p.birth_date, 20),
    birth_place: cleanText(p.birth_place, 100),
    birth_wilaya: cleanText(p.birth_wilaya, 100),
    birth_daira: cleanText(p.birth_daira, 100),
    birth_commune: cleanText(p.birth_commune, 100),
    blood_group: cleanText(p.blood_group, 10),
    user_type: cleanText(p.user_type, 50),
    demand_type: cleanText(p.demand_type, 50),
    wilaya: cleanText(p.wilaya, 100),
    wilaya_name: cleanText(p.wilaya_name, 120),
    daira: cleanText(p.daira, 100),
    commune: cleanText(p.commune, 100),
    postal_code: cleanText(p.postal_code, 10),
    address: cleanText(p.address, 300),
    activity: cleanText(p.activity, 120),
    work_region: cleanText(p.work_region, 100),
    retire_year: cleanText(p.retire_year, 10),
    phone, email: cleanText(p.email, 160),
    consent: true, membership_fee_dzd: membershipFeeDzd, submitted_at: new Date().toISOString()
  };

  try {
    await env.DB.prepare(`
      INSERT INTO members
        (id, ref, bureau, name, phone, profile, files, status, otp_hash, otp_exp, otp_tries, ip, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_payment', NULL, NULL, 0, ?, CAST(strftime('%s','now') AS INTEGER))
    `).bind(
      id, ref, bureau, displayName, phone,
      JSON.stringify(safeProfile), JSON.stringify(files), clientIp(request)
    ).run();

    return json({
      ok: true, requestNumber: ref,
      message: "request_received_pending_payment"
    }, 201);
  } catch (e) {
    console.error("create request", e);
    return json({ error: "request_save_failed" }, 500);
  }
}

async function handleVerify(ref, request, env) {
  if (!stagingOnly(env)) return json({ error: "staging_environment_required" }, 503);

  if (!env.DB) return json({ error: "database_unavailable" }, 503);
  if (!validRef(ref)) return json({ error: "invalid_request_number" }, 400);
  const body = await request.json().catch(() => ({}));
  const code = String(body.code || "").trim();
  if (!/^\d{6}$/.test(code)) return json({ error: "invalid_code" }, 400);

  const row = await env.DB.prepare(
    "SELECT ref, otp_hash, otp_exp, otp_tries, status FROM members WHERE ref = ?"
  ).bind(ref).first();
  if (!row || !row.otp_hash || !row.otp_exp) return json({ error: "code_not_issued" }, 400);
  if (row.status !== "code_sent") return json({ error: row.status === "unlocked" ? "code_already_used" : "payment_not_approved" }, 403);
  if (Number(row.otp_exp) < Date.now()) return json({ error: "code_expired" }, 410);
  if (Number(row.otp_tries || 0) >= MAX_OTP_TRIES) return json({ error: "too_many_attempts" }, 429);

  const candidate = await sha256(ref + ":" + code);
  if (!safeEqual(candidate, row.otp_hash)) {
    await env.DB.prepare("UPDATE members SET otp_tries = otp_tries + 1 WHERE ref = ?").bind(ref).run();
    return json({ error: "invalid_code" }, 401);
  }

  const token = await makePrintToken(ref, env);
  await env.DB.prepare("UPDATE members SET status = 'unlocked' WHERE ref = ?").bind(ref).run();
  return json({ ok: true, unlockToken: token, expiresIn: PRINT_TTL_SECONDS });
}

async function handlePrintCheck(url, env) {
  const token = url.searchParams.get("t") || "";
  const ref = url.searchParams.get("ref") || "";
  if (!(await checkPrintToken(token, env, ref))) return json({ ok: false, error: "invalid_or_expired_token" }, 401);
  return json({ ok: true });
}

async function handleAdminList(request, env) {
  if (!env.DB) return json({ error: "database_unavailable" }, 503);
  if (!adminKeyOk(request, env)) return json({ error: "unauthorized" }, 401);
  const r = await env.DB.prepare(`
    SELECT id, ref, bureau, name, phone, profile, files, status, created_at
    FROM members ORDER BY created_at DESC LIMIT 500
  `).all();
  const requests = r.results.map(row => ({
    id: row.id, memberId: row.id, requestNumber: row.ref,
    name: row.name, phone: row.phone, bureau: row.bureau,
    status: row.status, createdAt: row.created_at,
    profile: parseJson(row.profile, {}),
    files: Object.keys(parseJson(row.files, {}))
  }));
  return json(requests);
}

async function archiveAccess(id, request, env) {
  // National administrators use the server-side secret; regional presidents use their scoped bearer session.
  if (adminKeyOk(request, env)) return { role: "national", bureau: "NATIONAL" };
  const session = await officeSession(request, env);
  if (!session) return null;
  const member = await env.DB.prepare("SELECT bureau FROM members WHERE id = ?").bind(id).first();
  if (!member || member.bureau !== session.bureau) return null;
  return { role: "regional", bureau: session.bureau };
}
async function handleAdhesionArchive(id, request, env) {
  if (!env.DB) return json({ error: "database_unavailable" }, 503);
  const access = await archiveAccess(id, request, env);
  if (!access) return json({ error: "unauthorized_or_out_of_scope" }, 403);
  const member = await env.DB.prepare("SELECT id, ref, bureau, name, phone, profile, files, status, created_at FROM members WHERE id = ?").bind(id).first();
  if (!member) return json({ error: "member_not_found" }, 404);
  if (request.method === "GET") {
    const archives = await env.DB.prepare("SELECT id, member_ref, bureau, snapshot, created_at FROM member_adhesion_archive WHERE member_id = ? ORDER BY created_at DESC LIMIT 100").bind(id).all();
    const profile = parseJson(member.profile, {});
    const files = parseJson(member.files, {});
    const photo = files.photo && files.photo.data ? { name: files.photo.name || "photo", type: files.photo.type || "image/jpeg", data: files.photo.data } : null;
    return json({ ok: true, member: { id:member.id, reference:member.ref, bureau:member.bureau, name:member.name, phone:member.phone, profile, photo, status:member.status, createdAt:member.created_at }, archives: archives.results || [] }, 200, { "cache-control": "private, no-store" });
  }
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!stagingOnly(env)) return json({ error: "staging_environment_required" }, 503);
  const profile = parseJson(member.profile, {});
  const files = parseJson(member.files, {});
  const photo = files.photo && files.photo.data ? { name: files.photo.name || "photo", type: files.photo.type || "image/jpeg", data: files.photo.data } : null;
  const now = new Date().toISOString();
  const snapshot = JSON.stringify({ memberId:member.id, reference:member.ref, bureau:member.bureau, name:member.name, phone:member.phone, profile, photo, status:member.status, memberCreatedAt:member.created_at, archivedAt:now, archivedBy:access.role });
  if (snapshot.length > 1400000) return json({ error:"archive_snapshot_too_large" }, 413);
  const archiveId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO member_adhesion_archive (id, member_id, member_ref, bureau, snapshot, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(archiveId,member.id,member.ref,member.bureau,snapshot,now).run();
  return json({ok:true,archiveId,memberRef:member.ref,createdAt:now},201,{ "cache-control":"no-store" });
}

async function handleAdminFile(id, type, request, env) {
  if (!env.DB) return json({ error: "database_unavailable" }, 503);
  if (!adminKeyOk(request, env)) return json({ error: "unauthorized" }, 401);
  if (!FILE_KEYS.includes(type)) return json({ error: "invalid_file_type" }, 400);
  const row = await env.DB.prepare("SELECT files FROM members WHERE id = ?").bind(id).first();
  if (!row) return json({ error: "member_not_found" }, 404);
  const files = parseJson(row.files, {});
  const file = files[type];
  if (!file || !file.data) return json({ error: "file_not_found" }, 404);
  const bytes = base64ToBytes(file.data);
  return new Response(bytes, {
    status: 200,
    headers: {
      ...JSON_HEADERS,
      "content-type": file.type || "application/octet-stream",
      "content-length": String(bytes.byteLength),
      "content-disposition": `inline; filename="${fileName(file.name)}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff"
    }
  });
}

async function handleAdminApprove(id, request, env) {
  if (!stagingOnly(env)) return json({ error: "staging_environment_required" }, 503);

  if (!env.DB) return json({ error: "database_unavailable" }, 503);
  if (!adminKeyOk(request, env)) return json({ error: "unauthorized" }, 401);
  const row = await env.DB.prepare(
    "SELECT id, ref, name, phone, profile, status FROM members WHERE id = ?"
  ).bind(id).first();
  if (!row) return json({ error: "member_not_found" }, 404);

  const profile = parseJson(row.profile, {});
  const confirmedAt = new Date().toISOString();
  const financeId = crypto.randomUUID();
  const feeAmount = Number(profile.membership_fee_dzd);
  if (!Number.isSafeInteger(feeAmount) || feeAmount < 1 || feeAmount > MAX_MEMBERSHIP_FEE_DZD) return json({ error: "invalid_membership_fee_snapshot" }, 409);
  // Current association policy: all membership receipts are collected centrally by the National Office.
  const nationalAmount = feeAmount;
  const regionalAmount = 0;
  // Payment is treated as confirmed only at this authenticated national-office approval step.
  // UNIQUE member_id + request_ref make repeated approval idempotent (no double accounting).
  try {
    await env.DB.prepare(`
        INSERT OR IGNORE INTO anrsh_membership_finance
          (id, member_id, request_ref, bureau, wilaya, member_name, demand_type,
           fee_amount, national_rate, national_amount, regional_rate, regional_amount,
           payment_status, payment_confirmed_at, confirmed_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 100, ?, 0, ?, 'confirmed', ?, 'national_admin')
      `).bind(
        financeId, row.id, row.ref, cleanText(profile.bureau, 80),
        cleanText(profile.wilaya_name || profile.wilaya, 120),
        cleanText(row.name, 200), cleanText(profile.demand_type, 60), feeAmount, nationalAmount, regionalAmount, confirmedAt
      ).run();
  } catch (e) {
    console.error("finance confirmation", e);
    return json({ error: "finance_record_failed" }, 500);
  }

  const code = randomDigits(6);
  const hash = await sha256(row.ref + ":" + code);
  const expires = Date.now() + OTP_TTL_MS;
  await env.DB.prepare(`
    UPDATE members SET otp_hash = ?, otp_exp = ?, otp_tries = 0, status = 'code_sent'
    WHERE id = ?
  `).bind(hash, expires, id).run();
  const smsResult = await sendTextBeeSMS(env, row.phone, code);
  const emailResult = await sendEmail(
    env, cleanText(profile.email, 160),
    "ANRSH — Code de confirmation",
    `Votre paiement a été validé par le bureau ANRSH.\nNuméro de demande : ${row.ref}\nCode de confirmation : ${code}\nCe code expire dans 5 minutes.`
  );

  // The current frontend does not yet display this code or send WhatsApp automatically.
  // It is returned only to the authenticated office interface.
  const digits = String(row.phone || "").replace(/\D/g, "").replace(/^0/, "213");
  const waText = encodeURIComponent(
    `ANRSH : paiement confirmé. Votre code de confirmation pour la demande ${row.ref} est ${code}.`
  );
  return json({
    ok: true, status: "code_sent", requestNumber: row.ref,
    code, smsSent: smsResult.sent, smsSimSlotIndex: smsResult.simSlotIndex ?? null,
    emailSent: emailResult.sent,
    whatsappUrl: digits ? `https://wa.me/${digits}?text=${waText}` : null,
    expiresAt: expires
  });
}

async function handleAdminFinance(url, request, env) {
  if (!env.DB) return json({ error: "database_unavailable" }, 503);
  if (!adminKeyOk(request, env)) return json({ error: "unauthorized" }, 401);
  const validDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v || "");
  const from = url.searchParams.get("from") || new Date(Date.now() - 183 * 86400000).toISOString().slice(0, 10);
  const to = url.searchParams.get("to") || new Date().toISOString().slice(0, 10);
  const bureau = cleanText(url.searchParams.get("bureau") || "", 80);
  if (!validDate(from) || !validDate(to) || from > to) return json({ error: "invalid_date_range" }, 400);
  const where = "payment_status = 'confirmed' AND date(payment_confirmed_at) >= date(?) AND date(payment_confirmed_at) <= date(?)";
  const args = [from, to];
  const officeFilter = bureau ? " AND bureau = ?" : "";
  if (bureau) args.push(bureau);
  let currentFee;
  try { currentFee = await currentMembershipFee(env); }
  catch (e) { return json({ error: "settings_unavailable" }, 503); }
  const [summary, offices, entries, transfers] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(fee_amount),0) AS gross,
      COALESCE(SUM(national_amount),0) AS national, COALESCE(SUM(regional_amount),0) AS regional
      FROM anrsh_membership_finance WHERE ${where}${officeFilter}`).bind(...args).first(),
    env.DB.prepare(`SELECT bureau, COUNT(*) AS count, COALESCE(SUM(fee_amount),0) AS gross,
      COALESCE(SUM(national_amount),0) AS national, COALESCE(SUM(regional_amount),0) AS regional
      FROM anrsh_membership_finance WHERE ${where}${officeFilter}
      GROUP BY bureau ORDER BY bureau`).bind(...args).all(),
    env.DB.prepare(`SELECT id, request_ref, bureau, wilaya, member_name, demand_type, fee_amount,
      national_amount, regional_amount, payment_confirmed_at
      FROM anrsh_membership_finance WHERE ${where}${officeFilter}
      ORDER BY payment_confirmed_at DESC LIMIT 5000`).bind(...args).all(),
    env.DB.prepare(`SELECT id, bureau, amount, period_start, period_end, transfer_date, bank_reference, note
      FROM anrsh_regional_transfers WHERE period_start >= ? AND period_end <= ?${bureau ? " AND bureau = ?" : ""}
      ORDER BY transfer_date DESC`).bind(...(bureau ? [from, to, bureau] : [from, to])).all()
  ]);
  const paidByOffice = {};
  for (const t of transfers.results || []) paidByOffice[t.bureau] = (paidByOffice[t.bureau] || 0) + Number(t.amount || 0);
  const officeRows = (offices.results || []).map(o => ({
    ...o, transferred: paidByOffice[o.bureau] || 0,
    outstanding: Math.max(0, Number(o.regional || 0) - (paidByOffice[o.bureau] || 0))
  }));
  return json({
    ok: true, period: { from, to }, policy: { fee: currentFee, nationalRate: 100, nationalAmount: currentFee, regionalRate: 0, regionalAmount: 0 },
    summary: summary || { count: 0, gross: 0, national: 0, regional: 0 },
    offices: officeRows, entries: entries.results || [], transfers: transfers.results || []
  });
}

async function handlePublicSettings(env) {
  if (!env.DB) return json({ error: "database_unavailable" }, 503);
  try { return json({ ok: true, membershipFeeDzd: await currentMembershipFee(env) }); }
  catch (e) { console.error("public settings", e); return json({ error: "settings_unavailable" }, 503); }
}

async function handleAdminMembershipFeeUpdate(request, env) {
  if (!stagingOnly(env)) return json({ error: "staging_environment_required" }, 503);

  if (!env.DB) return json({ error: "database_unavailable" }, 503);
  if (!adminKeyOk(request, env)) return json({ error: "unauthorized" }, 401);
  const body = await request.json().catch(() => ({}));
  const amount = Number(body.amountDzd);
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > MAX_MEMBERSHIP_FEE_DZD) return json({ error: "invalid_membership_fee" }, 400);
  if (amount !== DEFAULT_MEMBERSHIP_FEE_DZD) return json({ error: "membership_fee_fixed_at_500" }, 409);
  try {
    await env.DB.prepare("UPDATE anrsh_platform_settings SET fee_dzd = ?, updated_at = CAST(strftime('%s','now') AS INTEGER), updated_by = 'national_admin' WHERE id = 1").bind(amount).run();
    return json({ ok: true, membershipFeeDzd: amount });
  } catch (e) { console.error("membership fee update", e); return json({ error: "settings_unavailable" }, 503); }
}

async function handleAdminFinanceTransfer(request, env) {
  if (!env.DB) return json({ error: "database_unavailable" }, 503);
  if (!adminKeyOk(request, env)) return json({ error: "unauthorized" }, 401);
  const body = await request.json().catch(() => ({}));
  const bureau = cleanText(body.bureau, 80);
  const amount = Number(body.amount);
  const periodStart = cleanText(body.periodStart, 10);
  const periodEnd = cleanText(body.periodEnd, 10);
  const transferDate = cleanText(body.transferDate, 10);
  const bankReference = cleanText(body.bankReference, 100);
  if (!bureau || !Number.isSafeInteger(amount) || amount <= 0 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(periodStart) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(transferDate) ||
      !bankReference || periodStart > periodEnd) return json({ error: "invalid_transfer_data" }, 400);
  const office = await env.DB.prepare("SELECT bureau FROM regional_offices WHERE bureau = ? AND active = 1").bind(bureau).first();
  if (!office) return json({ error: "invalid_or_inactive_office" }, 400);
  const earned = await env.DB.prepare(`SELECT COALESCE(SUM(regional_amount),0) AS n FROM anrsh_membership_finance
    WHERE bureau = ? AND payment_status = 'confirmed' AND date(payment_confirmed_at) >= date(?) AND date(payment_confirmed_at) <= date(?)`)
    .bind(bureau, periodStart, periodEnd).first();
  const transferred = await env.DB.prepare(`SELECT COALESCE(SUM(amount),0) AS n FROM anrsh_regional_transfers
    WHERE bureau = ? AND period_start = ? AND period_end = ?`).bind(bureau, periodStart, periodEnd).first();
  const outstanding = Number(earned?.n || 0) - Number(transferred?.n || 0);
  if (amount > outstanding) return json({ error: "transfer_exceeds_outstanding", outstanding }, 409);
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO anrsh_regional_transfers
    (id, bureau, amount, period_start, period_end, transfer_date, bank_reference, note, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'national_admin')`)
    .bind(id, bureau, amount, periodStart, periodEnd, transferDate, bankReference, cleanText(body.note, 300)).run();
  return json({ ok: true, id, bureau, amount, outstandingAfter: outstanding - amount }, 201);
}

async function handleAdminDelete(id, request, env) {
  if (!env.DB) return json({ error: "database_unavailable" }, 503);
  if (!adminKeyOk(request, env)) return json({ error: "unauthorized" }, 401);
  const row = await env.DB.prepare("SELECT id FROM members WHERE id = ?").bind(id).first();
  if (!row) return json({ error: "member_not_found" }, 404);
  await env.DB.prepare("DELETE FROM members WHERE id = ?").bind(id).run();
  return json({ ok: true, deleted: true });
}


/* ===== Independent regional-office authentication ===== */
const OFFICE_SESSION_TTL = 8 * 60 * 60;
const OFFICE_PASSWORD_ITERATIONS = 210000;
async function deriveOfficePassword(password, saltHex, iterations) {
  const salt = new Uint8Array((saltHex.match(/../g) || []).map(x => parseInt(x, 16)));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, key, 256);
  return [...new Uint8Array(bits)].map(x => x.toString(16).padStart(2, "0")).join("");
}
async function handleOfficeActivationIssue(bureau, request, env) {
  if (!stagingOnly(env)) return json({ error: "staging_environment_required" }, 503);

  if (!adminKeyOk(request, env)) return json({ error: "unauthorized" }, 401);
  bureau = cleanText(bureau, 80);
  const office = await env.DB.prepare("SELECT bureau FROM regional_offices WHERE bureau = ? AND active = 1").bind(bureau).first();
  if (!office) return json({ error: "invalid_or_inactive_office" }, 404);
  const account = await env.DB.prepare("SELECT bureau FROM anrsh_office_accounts WHERE bureau = ?").bind(bureau).first();
  if (account) return json({ error: "office_account_already_activated" }, 409);
  const code = randomHex(24);
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(`INSERT INTO anrsh_office_activation_tokens (bureau, token_hash, expires_at, used_at, created_at)
    VALUES (?, ?, ?, NULL, ?)
    ON CONFLICT(bureau) DO UPDATE SET token_hash=excluded.token_hash, expires_at=excluded.expires_at, used_at=NULL, created_at=excluded.created_at`)
    .bind(bureau, await sha256(bureau + ":" + code), now + 24 * 60 * 60, now).run();
  return json({ ok: true, bureau, activationCode: code, expiresIn: 86400, message: "activation_code_show_once" }, 201);
}
async function handleOfficeActivate(request, env) {
  if (!stagingOnly(env)) return json({ error: "staging_environment_required" }, 503);

  const body = await request.json().catch(() => ({}));
  const bureau = cleanText(body.bureau, 80);
  const activationCode = String(body.activationCode || "");
  const password = String(body.password || "");
  const confirmation = String(body.confirmPassword || "");
  if (!bureau || !/^[a-f0-9]{48}$/i.test(activationCode)) return json({ error: "invalid_activation_data" }, 400);
  if (password.length < 12 || password.length > 128 || password !== confirmation) return json({ error: "password_policy_failed" }, 400);
  const now = Math.floor(Date.now() / 1000);
  const token = await env.DB.prepare("SELECT token_hash, expires_at, used_at FROM anrsh_office_activation_tokens WHERE bureau = ?").bind(bureau).first();
  if (!token || token.used_at || Number(token.expires_at) < now ||
      !safeEqual(token.token_hash, await sha256(bureau + ":" + activationCode))) {
    return json({ error: "activation_code_invalid_or_expired" }, 403);
  }
  const existing = await env.DB.prepare("SELECT bureau FROM anrsh_office_accounts WHERE bureau = ?").bind(bureau).first();
  if (existing) return json({ error: "office_account_already_activated" }, 409);
  const salt = randomHex(16);
  const hash = await deriveOfficePassword(password, salt, OFFICE_PASSWORD_ITERATIONS);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO anrsh_office_accounts
      (bureau, password_salt, password_hash, password_iterations, activated_at, updated_at, failed_login_count, locked_until)
      VALUES (?, ?, ?, ?, ?, ?, 0, 0)`).bind(bureau, salt, hash, OFFICE_PASSWORD_ITERATIONS, now, now),
    env.DB.prepare("UPDATE anrsh_office_activation_tokens SET used_at = ? WHERE bureau = ? AND used_at IS NULL").bind(now, bureau)
  ]);
  return json({ ok: true, activated: true, bureau, message: "office_account_activated_login_now" }, 201);
}
async function handleOfficeLogin(request, env) {
  if (!stagingOnly(env)) return json({ error: "staging_environment_required" }, 503);

  const body = await request.json().catch(() => ({}));
  const bureau = cleanText(body.bureau, 80);
  const password = String(body.password || "");
  if (!bureau || !password || password.length > 128) return json({ error: "invalid_login" }, 400);
  const now = Math.floor(Date.now() / 1000);
  const account = await env.DB.prepare("SELECT * FROM anrsh_office_accounts WHERE bureau = ?").bind(bureau).first();
  if (!account) return json({ error: "invalid_credentials" }, 401);
  if (Number(account.locked_until || 0) > now) return json({ error: "office_login_temporarily_locked" }, 429);
  const candidate = await deriveOfficePassword(password, account.password_salt, Number(account.password_iterations) || OFFICE_PASSWORD_ITERATIONS);
  if (!safeEqual(candidate, account.password_hash)) {
    const failures = Number(account.failed_login_count || 0) + 1;
    await env.DB.prepare("UPDATE anrsh_office_accounts SET failed_login_count = ?, locked_until = ? WHERE bureau = ?")
      .bind(failures >= 8 ? 0 : failures, failures >= 8 ? now + 15 * 60 : 0, bureau).run();
    return json({ error: "invalid_credentials" }, 401);
  }
  const raw = randomHex(32);
  const tokenHash = await sha256(raw);
  await env.DB.prepare("UPDATE anrsh_office_accounts SET failed_login_count = 0, locked_until = 0 WHERE bureau = ?").bind(bureau).run();
  await env.DB.prepare("INSERT INTO anrsh_office_sessions (token_hash, bureau, created_at, expires_at, last_seen) VALUES (?, ?, ?, ?, ?)")
    .bind(tokenHash, bureau, now, now + OFFICE_SESSION_TTL, now).run();
  return json({ ok: true, token: raw, expiresIn: OFFICE_SESSION_TTL, bureau });
}
async function officeSession(request, env) {
  const header = request.headers.get("authorization") || "";
  const raw = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!/^[a-f0-9]{64}$/i.test(raw)) return null;
  const now = Math.floor(Date.now() / 1000);
  const hash = await sha256(raw);
  const session = await env.DB.prepare(`SELECT s.bureau, o.office_name
    FROM anrsh_office_sessions s JOIN regional_offices o ON o.bureau = s.bureau
    WHERE s.token_hash = ? AND s.expires_at > ? AND o.active = 1`).bind(hash, now).first();
  if (!session) return null;
  await env.DB.prepare("UPDATE anrsh_office_sessions SET last_seen = ? WHERE token_hash = ?").bind(now, hash).run();
  return { bureau: session.bureau, officeName: session.office_name, tokenHash: hash };
}
async function handleOfficeMe(request, env) {
  const session = await officeSession(request, env);
  if (!session) return json({ error: "office_session_invalid_or_expired" }, 401);
  return json({ ok: true, role: "regional_office", bureau: session.bureau, officeName: session.officeName });
}
async function handleOfficeLogout(request, env) {
  if (!stagingOnly(env)) return json({ error: "staging_environment_required" }, 503);
  const session = await officeSession(request, env);
  if (!session) return json({ ok: true });
  await env.DB.prepare("DELETE FROM anrsh_office_sessions WHERE token_hash = ?").bind(session.tokenHash).run();
  return json({ ok: true, loggedOut: true });
}
async function handleOfficeRequests(request, env) {
  const session = await officeSession(request, env);
  if (!session) return json({ error: "office_session_invalid_or_expired" }, 401);
  const r = await env.DB.prepare(`SELECT id, ref, bureau, name, phone, profile, files, status, created_at
    FROM members WHERE bureau = ? ORDER BY created_at DESC LIMIT 500`).bind(session.bureau).all();
  return json((r.results || []).map(row => ({
    id: row.id, memberId: row.id, requestNumber: row.ref, name: row.name, phone: row.phone,
    bureau: row.bureau, status: row.status, createdAt: row.created_at,
    profile: parseJson(row.profile, {}), files: Object.keys(parseJson(row.files, {}))
  })));
}
async function handleOfficeFile(id, type, request, env) {
  const session = await officeSession(request, env);
  if (!session) return json({ error: "office_session_invalid_or_expired" }, 401);
  if (!FILE_KEYS.includes(type)) return json({ error: "invalid_file_type" }, 400);
  const row = await env.DB.prepare("SELECT files FROM members WHERE id = ? AND bureau = ?").bind(id, session.bureau).first();
  if (!row) return json({ error: "member_not_found" }, 404);
  const file = parseJson(row.files, {})[type];
  if (!file || !file.data) return json({ error: "file_not_found" }, 404);
  const bytes = base64ToBytes(file.data);
  return new Response(bytes, { status: 200, headers: {
    ...JSON_HEADERS, "content-type": file.type || "application/octet-stream",
    "content-length": String(bytes.byteLength),
    "content-disposition": `inline; filename="${fileName(file.name)}"`,
    "cache-control": "private, no-store", "x-content-type-options": "nosniff"
  }});
}

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  if (request.method === "GET" && path === "/") {
    return json({
      platform: "ANRSH DIGITAL",
      status: "Worker active",
      edition: "2026/2027",
      environment: env.ANRSH_ENV || "unset",
      message: "Association Nationale des Retraités de Sonatrach"
    });
  }

  if (request.method === "POST" && path === "/api/office/activate") return handleOfficeActivate(request, env);
  if (request.method === "POST" && path === "/api/office/login") return handleOfficeLogin(request, env);
  if (request.method === "GET" && path === "/api/office/me") return handleOfficeMe(request, env);
  if (request.method === "POST" && path === "/api/office/logout") return handleOfficeLogout(request, env);
  if (request.method === "GET" && path === "/api/office/requests") return handleOfficeRequests(request, env);
  const officeFileMatch = path.match(/^\/api\/office\/requests\/([^/]+)\/files\/([^/]+)$/);
  if (request.method === "GET" && officeFileMatch) return handleOfficeFile(decodeURIComponent(officeFileMatch[1]), decodeURIComponent(officeFileMatch[2]), request, env);
  const activationMatch = path.match(/^\/api\/admin\/offices\/([^/]+)\/activation$/);
  if (request.method === "POST" && activationMatch) return handleOfficeActivationIssue(decodeURIComponent(activationMatch[1]), request, env);

  if (request.method === "GET" && path === "/api/health") return handleHealth(env);
  if (request.method === "GET" && path === "/api/public-stats") return handlePublicStats(env);
  if (request.method === "GET" && path === "/api/public-settings") return handlePublicSettings(env);
  if (request.method === "PUT" && path === "/api/admin/settings/membership-fee") return handleAdminMembershipFeeUpdate(request, env);
  if (request.method === "POST" && path === "/api/visitor-visit") return handleVisitorVisit(request, env);
  if (request.method === "GET" && path === "/api/wilayas") return handleWilayas(env);
  if (request.method === "GET" && path === "/api/offices") return handleOffices(env);
  if (request.method === "POST" && path === "/api/requests") return handleCreateRequest(request, env);

  const verifyMatch = path.match(/^\/api\/requests\/([^/]+)\/verify$/);
  if (request.method === "POST" && verifyMatch) return handleVerify(decodeURIComponent(verifyMatch[1]), request, env);

  if (request.method === "GET" && path === "/api/print-check") return handlePrintCheck(url, env);

  if (path === "/api/admin/requests" && request.method === "GET") return handleAdminList(request, env);
  if (path === "/api/admin/finance" && request.method === "GET") return handleAdminFinance(url, request, env);
  if (path === "/api/admin/finance/transfers" && request.method === "POST") return handleAdminFinanceTransfer(request, env);

  const archiveMatch = path.match(/^\/api\/admin\/requests\/([^/]+)\/adhesion-archive$/);
  if ((request.method === "GET" || request.method === "POST") && archiveMatch) return handleAdhesionArchive(decodeURIComponent(archiveMatch[1]), request, env);

  const fileMatch = path.match(/^\/api\/admin\/requests\/([^/]+)\/files\/([^/]+)$/);
  if (request.method === "GET" && fileMatch) {
    return handleAdminFile(decodeURIComponent(fileMatch[1]), decodeURIComponent(fileMatch[2]), request, env);
  }

  const approveMatch = path.match(/^\/api\/admin\/requests\/([^/]+)\/approve$/);
  if (request.method === "POST" && approveMatch) {
    return handleAdminApprove(decodeURIComponent(approveMatch[1]), request, env);
  }

  return json({ error: "not_found" }, 404);
}

export default {
  async fetch(request, env) {
    try {
      const response = await route(request, env);
      return withCors(response, request);
    } catch (e) {
      console.error("ANRSH Worker unhandled error", e);
      return withCors(json({ error: "internal_server_error" }, 500), request);
    }
  }
};