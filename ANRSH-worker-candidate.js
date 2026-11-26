/**
 * ANRSH DIGITAL — Cloudflare Worker (D1 edition)
 * API compatible with the current ANRSH HTML frontend routes.
 *
 * Required bindings/secrets:
 *   D1 binding: DB  -> database "anrsh"
 *   Secret: ADMIN_API_KEY  -> long random value (minimum 32 characters)
 *   Existing secret: RESEND_API_KEY (optional; email sending also needs RESEND_FROM)
 *   Variable: RESEND_FROM (optional verified sender, e.g. "ANRSH <noreply@your-domain.dz>")
 *
 * IMPORTANT:
 * - R2 is currently unavailable to this Worker. Private attachments are therefore
 *   stored in the existing D1 members.files JSON column, with strict size limits.
 * - No document is exposed publicly. Document routes require ADMIN_API_KEY.
 * - WhatsApp messages cannot be sent automatically without a WhatsApp Business API.
 *   Approval returns the one-time code for the authorized office operator to send.
 * - This Worker does not alter or create database tables.
 */

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'"
};

const ALLOWED_ORIGINS = new Set([
  "https://irched66.github.io",
  "https://anrsh.netlify.app",
  "https://animated-moonbeam-256371.netlify.app"
]);

const MAX_FILE_BYTES = 220 * 1024;
const MAX_TOTAL_BYTES = 760 * 1024;
const ALLOWED_FILE_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp", "application/pdf"
]);
const FILE_KEYS = ["photo", "cni", "cni_back", "retire", "proof"];
const OTP_TTL_MS = 24 * 60 * 60 * 1000;
const PRINT_TTL_SECONDS = 15 * 60;
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
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "access-control-allow-headers": "Content-Type, x-admin-key",
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
  return cleanText(v, 30).replace(/[^\d+]/g, "");
}
function validRef(v) {
  return /^[A-Za-z0-9_-]{8,80}$/.test(String(v || ""));
}
function adminKeyOk(request, env) {
  const configured = env.ADMIN_API_KEY;
  const supplied = request.headers.get("x-admin-key") || "";
  return typeof configured === "string" && configured.length >= 32 &&
    safeEqual(supplied, configured);
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
async function checkPrintToken(token, env) {
  try {
    if (!env.ADMIN_API_KEY || typeof token !== "string") return false;
    const parts = token.split(".");
    if (parts.length !== 2) return false;
    const expected = b64url(await hmac(parts[0], env.ADMIN_API_KEY));
    if (!safeEqual(parts[1], expected)) return false;
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(parts[0])));
    return validRef(payload.ref) && Number(payload.exp) >= Math.floor(Date.now() / 1000) ? payload : null;
  } catch { return false; }
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
  if (!env.DB) return json({ error: "database_unavailable" }, 503);
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return json({ error: "multipart_form_required" }, 415);
  }

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
  if (!bureau || !first || !last || phone.length < 8) {
    return json({ error: "required_fields_missing" }, 400);
  }

  const office = await env.DB.prepare(
    "SELECT bureau FROM regional_offices WHERE bureau = ? AND active = 1"
  ).bind(bureau).first();
  if (!office) return json({ error: "invalid_or_inactive_office" }, 400);

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
  for (const required of ["photo", "cni", "retire", "proof"]) {
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
    nin: cleanText(p.nin, 30),
    matricule: cleanText(p.matricule, 40),
    activity: cleanText(p.activity, 120),
    work_region: cleanText(p.work_region, 100),
    specialty: cleanText(p.specialty, 120),
    retire_year: cleanText(p.retire_year, 10),
    phone, email: cleanText(p.email, 160),
    nss: cleanText(p.nss, 40), cnr: cleanText(p.cnr, 40),
    consent: true, submitted_at: new Date().toISOString()
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
  if (!env.DB) return json({ error: "database_unavailable" }, 503);
  if (!validRef(ref)) return json({ error: "invalid_request_number" }, 400);
  const body = await request.json().catch(() => ({}));
  const code = String(body.code || "").trim();
  if (!/^\d{6}$/.test(code)) return json({ error: "invalid_code" }, 400);

  const row = await env.DB.prepare(
    "SELECT ref, otp_hash, otp_exp, otp_tries, status FROM members WHERE ref = ?"
  ).bind(ref).first();
  if (!row || !row.otp_hash || !row.otp_exp) return json({ error: "code_not_issued" }, 400);
  if (row.status !== "code_sent") return json({ error: "payment_not_approved_or_code_already_used" }, 403);
  if (Number(row.otp_exp) < Date.now()) return json({ error: "code_expired" }, 410);
  if (Number(row.otp_tries || 0) >= MAX_OTP_TRIES) return json({ error: "too_many_attempts" }, 429);

  const candidate = await sha256(ref + ":" + code);
  if (!safeEqual(candidate, row.otp_hash)) {
    await env.DB.prepare("UPDATE members SET otp_tries = otp_tries + 1 WHERE ref = ?").bind(ref).run();
    return json({ error: "invalid_code" }, 401);
  }

  const token = await makePrintToken(ref, env);
  const updated = await env.DB.prepare(
    "UPDATE members SET status = 'unlocked', otp_hash = NULL, otp_exp = NULL, otp_tries = 0 WHERE ref = ? AND status = 'code_sent' AND otp_hash = ?"
  ).bind(ref, row.otp_hash).run();
  if (!updated.meta || Number(updated.meta.changes || 0) !== 1) {
    return json({ error: "verification_already_processed" }, 409);
  }
  return json({ ok: true, unlockToken: token, expiresIn: PRINT_TTL_SECONDS });
}

async function handlePrintCheck(url, env) {
  if (!env.DB) return json({ ok: false, error: "database_unavailable" }, 503);
  const token = url.searchParams.get("t") || "";
  const payload = await checkPrintToken(token, env);
  if (!payload) return json({ ok: false, error: "invalid_or_expired_token" }, 401);
  const member = await env.DB.prepare(
    "SELECT status FROM members WHERE ref = ?"
  ).bind(payload.ref).first();
  if (!member || member.status !== "unlocked") {
    return json({ ok: false, error: "membership_not_unlocked" }, 403);
  }
  return json({ ok: true, ref: payload.ref });
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
  if (!env.DB) return json({ error: "database_unavailable" }, 503);
  if (!adminKeyOk(request, env)) return json({ error: "unauthorized" }, 401);
  const row = await env.DB.prepare(
    "SELECT id, ref, name, phone, profile, status FROM members WHERE id = ?"
  ).bind(id).first();
  if (!row) return json({ error: "member_not_found" }, 404);
  if (row.status !== "pending_payment") {
    return json({ error: "request_not_pending_payment", status: row.status }, 409);
  }
  const storedFiles = parseJson(
    (await env.DB.prepare("SELECT files FROM members WHERE id = ?").bind(id).first())?.files,
    {}
  );
  if (!storedFiles.proof || !storedFiles.proof.data) {
    return json({ error: "payment_proof_missing" }, 409);
  }

  const code = randomDigits(6);
  const hash = await sha256(row.ref + ":" + code);
  const expires = Date.now() + OTP_TTL_MS;
  const issued = await env.DB.prepare(`
    UPDATE members SET otp_hash = ?, otp_exp = ?, otp_tries = 0, status = 'code_sent'
    WHERE id = ? AND status = 'pending_payment'
  `).bind(hash, expires, id).run();
  if (!issued.meta || Number(issued.meta.changes || 0) !== 1) {
    return json({ error: "request_state_changed_retry" }, 409);
  }

  const profile = parseJson(row.profile, {});
  const emailResult = await sendEmail(
    env, cleanText(profile.email, 160),
    "ANRSH — Code de confirmation",
    `Votre paiement a été validé par le bureau ANRSH.\nNuméro de demande : ${row.ref}\nCode de confirmation : ${code}\nCe code expire dans 24 heures.`
  );

  // The current frontend does not yet display this code or send WhatsApp automatically.
  // It is returned only to the authenticated office interface.
  const digits = String(row.phone || "").replace(/\D/g, "").replace(/^0/, "213");
  const waText = encodeURIComponent(
    `ANRSH : paiement confirmé. Votre code de confirmation pour la demande ${row.ref} est ${code}.`
  );
  return json({
    ok: true, status: "code_sent", requestNumber: row.ref,
    code, emailSent: emailResult.sent,
    whatsappUrl: digits ? `https://wa.me/${digits}?text=${waText}` : null,
    expiresAt: expires
  });
}

async function handleAdminDelete(id, request, env) {
  if (!env.DB) return json({ error: "database_unavailable" }, 503);
  if (!adminKeyOk(request, env)) return json({ error: "unauthorized" }, 401);
  const row = await env.DB.prepare("SELECT id FROM members WHERE id = ?").bind(id).first();
  if (!row) return json({ error: "member_not_found" }, 404);
  await env.DB.prepare("DELETE FROM members WHERE id = ?").bind(id).run();
  return json({ ok: true, deleted: true });
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
      message: "Association Nationale des Retraités de Sonatrach"
    });
  }
  if (request.method === "GET" && path === "/api/health") return handleHealth(env);
  if (request.method === "GET" && path === "/api/public-stats") return handlePublicStats(env);
  if (request.method === "POST" && path === "/api/visitor-visit") return handleVisitorVisit(request, env);
  if (request.method === "GET" && path === "/api/wilayas") return handleWilayas(env);
  if (request.method === "GET" && path === "/api/offices") return handleOffices(env);
  if (request.method === "POST" && path === "/api/requests") return handleCreateRequest(request, env);

  const verifyMatch = path.match(/^\/api\/requests\/([^/]+)\/verify$/);
  if (request.method === "POST" && verifyMatch) return handleVerify(decodeURIComponent(verifyMatch[1]), request, env);

  if (request.method === "GET" && path === "/api/print-check") return handlePrintCheck(url, env);

  if (path === "/api/admin/requests" && request.method === "GET") return handleAdminList(request, env);

  const fileMatch = path.match(/^\/api\/admin\/requests\/([^/]+)\/files\/([^/]+)$/);
  if (request.method === "GET" && fileMatch) {
    return handleAdminFile(decodeURIComponent(fileMatch[1]), decodeURIComponent(fileMatch[2]), request, env);
  }

  const approveMatch = path.match(/^\/api\/admin\/requests\/([^/]+)\/approve$/);
  if (request.method === "POST" && approveMatch) {
    return handleAdminApprove(decodeURIComponent(approveMatch[1]), request, env);
  }

  const deleteMatch = path.match(/^\/api\/admin\/members\/([^/]+)$/);
  if (request.method === "DELETE" && deleteMatch) {
    return handleAdminDelete(decodeURIComponent(deleteMatch[1]), request, env);
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