/**
 * ANRSH DIGITAL — Cloudflare Worker (D1 edition)
 * API compatible with the current ANRSH HTML frontend routes.
 *
 * Required bindings/secrets:
 *   D1 binding: DB  -> database "anrsh"
 *   Secret: ANRSH_BOOTSTRAP_SECRET (32+ random characters; one-time initial account setup)
 *   Secret: CARD_SIGNING_SECRET (32+ random characters; card print-token signing)
 *   Secret: FILE_ENCRYPTION_KEY (64 hexadecimal characters; AES-256-GCM document encryption)
 *   Secret: RESEND_API_KEY and variable RESEND_FROM (verified sender; required for admin/member email OTP)
 *
 * IMPORTANT:
 * - R2 is currently unavailable to this Worker. Private attachments are therefore
 *   stored in the existing D1 members.files JSON column, with strict size limits.
 * - New uploaded documents are encrypted with AES-256-GCM; legacy Base64 records remain unencrypted
 *   until a separately reviewed migration is completed.
 * - Administrative routes require individual password + email OTP authentication and bureau scoping.
 * - WhatsApp/SMS sending is not integrated; email OTP requires verified Resend configuration.
 * - Apply the reviewed D1 proposal migration before enabling registration or administrative workflows.
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
    "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
    "access-control-allow-headers": "Content-Type, Authorization, x-bootstrap-secret",
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
function fileName(name) {
  return cleanText(name, 100).replace(/[^\w.\-ء-ي]/g, "_") || "document";
}
async function fileEncryptionKey(env) {
  const hex=String(env.FILE_ENCRYPTION_KEY||"");
  if(!/^[a-f0-9]{64}$/i.test(hex)) throw new Error("file_encryption_not_configured");
  const raw=new Uint8Array(hex.match(/.{2}/g).map(x=>parseInt(x,16)));
  return crypto.subtle.importKey("raw",raw,{name:"AES-GCM"},false,["encrypt","decrypt"]);
}
async function encryptFileData(bytes,env) {
  const key=await fileEncryptionKey(env),iv=crypto.getRandomValues(new Uint8Array(12));
  const cipher=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,bytes);
  return "enc:v1:"+b64url(iv)+":"+b64url(new Uint8Array(cipher));
}
async function decryptFileData(value,env) {
  if(!String(value||"").startsWith("enc:v1:")) return base64ToBytes(value);
  const parts=value.split(":");
  if(parts.length!==4) throw new Error("invalid_encrypted_file");
  const key=await fileEncryptionKey(env);
  const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:fromB64url(parts[2])},key,fromB64url(parts[3]));
  return new Uint8Array(plain);
}
function bytesToBase64(bytes) {
  return b64(bytes);
}
function base64ToBytes(value) {
  return unb64(value);
}

async function makePrintToken(ref, env) {
  const secret = env.CARD_SIGNING_SECRET;
  const payload = { ref, exp: Math.floor(Date.now() / 1000) + PRINT_TTL_SECONDS };
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = b64url(await hmac(body, secret));
  return body + "." + sig;
}
async function checkPrintToken(token, env) {
  try {
    if (!env.CARD_SIGNING_SECRET || typeof token !== "string") return false;
    const parts = token.split(".");
    if (parts.length !== 2) return false;
    const expected = b64url(await hmac(parts[0], env.CARD_SIGNING_SECRET));
    if (!safeEqual(parts[1], expected)) return false;
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(parts[0])));
    return !!payload.ref && Number(payload.exp) >= Math.floor(Date.now() / 1000);
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
    SELECT code, name_ar, name_fr, name_en
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

  if (!/^[a-f0-9]{64}$/i.test(String(env.FILE_ENCRYPTION_KEY||""))) return json({error:"document_encryption_not_configured"},503);
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
      data: await encryptFileData(bytes,env), encrypted: true
    };
  }
  // The current HTML requires the core identity/payment documents.
  for (const required of ["photo", "cni", "cni_back", "retire", "proof"]) {
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
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO members
          (id, ref, bureau, name, phone, profile, files, status, otp_hash, otp_exp, otp_tries, ip, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_payment', NULL, NULL, 0, ?, CAST(strftime('%s','now') AS INTEGER))
      `).bind(
        id, ref, bureau, displayName, phone,
        JSON.stringify(safeProfile), JSON.stringify(files), clientIp(request)
      ),
      env.DB.prepare(`
        INSERT INTO member_payments
          (id, member_id, member_ref, bureau, membership_year, amount_dzd, currency, payment_method, receipt_ref, status, created_at)
        VALUES (?, ?, ?, ?, ?, 500, 'DZD', 'other', ?, 'pending_review', ?)
      `).bind(crypto.randomUUID(), id, ref, bureau, new Date().getFullYear(), ref, Date.now())
    ]);

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

  const row = await env.DB.prepare(`
    SELECT m.ref,m.id,m.otp_hash,m.otp_exp,m.otp_tries,m.status
    FROM members m
    WHERE m.ref=? AND EXISTS (
      SELECT 1 FROM member_payments p WHERE p.member_id=m.id
        AND p.membership_year=CAST(strftime('%Y','now') AS INTEGER)
        AND p.status='verified' AND p.amount_dzd=500
    )
  `).bind(ref).first();
  if (!row || !row.otp_hash || !row.otp_exp) return json({ error: "code_not_issued" }, 400);
  if (row.status !== "code_sent") return json({ error: "payment_not_approved_or_code_used" }, 403);
  if (Number(row.otp_exp) < Date.now()) return json({ error: "code_expired" }, 410);
  if (Number(row.otp_tries || 0) >= MAX_OTP_TRIES) return json({ error: "too_many_attempts" }, 429);
  const candidate = await sha256(ref + ":" + code);
  if (!safeEqual(candidate, row.otp_hash)) {
    await env.DB.prepare("UPDATE members SET otp_tries=otp_tries+1 WHERE ref=? AND status='code_sent'").bind(ref).run();
    return json({ error: "invalid_code" }, 401);
  }
  if (!env.CARD_SIGNING_SECRET || String(env.CARD_SIGNING_SECRET).length < 32) return json({error:"card_signing_not_configured"},503);
  const token = await makePrintToken(ref, env);
  const cardToken=randomHex(32), cardHash=await sha256(cardToken);
  let issueResults;
  try {
    issueResults=await env.DB.batch([
      env.DB.prepare("UPDATE members SET status='unlocked',otp_hash=NULL,otp_exp=NULL WHERE ref=? AND status='code_sent' AND otp_hash=? AND otp_exp>? AND otp_tries<5")
        .bind(ref,row.otp_hash,Date.now()),
      env.DB.prepare("INSERT INTO member_card_tokens (id,member_id,token_hash,active,issued_by,issued_at,revoked_at) SELECT ?,?,?,1,NULL,?,NULL WHERE changes()=1")
        .bind(crypto.randomUUID(),row.id,cardHash,Date.now())
    ]);
  } catch(e) {
    console.error("member card token issuance failed");
    return json({error:"card_activation_failed"},503);
  }
  if(!issueResults?.[0]?.meta||issueResults[0].meta.changes!==1)
    return json({error:"code_already_used"},409);
  if(!issueResults?.[1]?.meta||issueResults[1].meta.changes!==1)
    return json({error:"card_activation_failed"},503);
  return json({ ok: true, unlockToken: token, cardVerifyToken: cardToken, expiresIn: PRINT_TTL_SECONDS });
}

async function handleCardVerify(url,env) {
  if(!env.DB) return json({ok:false,error:"database_unavailable"},503);
  const token=url.searchParams.get("t")||"";
  if(!/^[a-f0-9]{64}$/i.test(token)) return json({ok:false,error:"invalid_card"},400);
  const hash=await sha256(token);
  const row=await env.DB.prepare(`
    SELECT m.name,m.bureau,m.ref,p.membership_year
    FROM member_card_tokens c
    JOIN members m ON m.id=c.member_id
    JOIN member_payments p ON p.member_id=m.id
    WHERE c.token_hash=? AND c.active=1 AND c.revoked_at IS NULL
      AND m.status='unlocked' AND p.status='verified' AND p.amount_dzd=500
      AND p.membership_year=CAST(strftime('%Y','now') AS INTEGER)
    ORDER BY p.created_at DESC LIMIT 1
  `).bind(hash).first();
  if(!row) return json({ok:false,valid:false,error:"membership_inactive"},404);
  return json({ok:true,valid:true,member:row.name,office:row.bureau,year:row.membership_year});
}
async function handlePrintCheck(url, env) {
  const token = url.searchParams.get("t") || "";
  if (!(await checkPrintToken(token, env))) return json({ ok: false, error: "invalid_or_expired_token" }, 401);
  try {
    const body=JSON.parse(new TextDecoder().decode(fromB64url(token.split(".")[0])));
    const row=await env.DB.prepare(`
      SELECT m.status FROM members m WHERE m.ref=? AND m.status='unlocked'
      AND EXISTS (SELECT 1 FROM member_payments p WHERE p.member_id=m.id
        AND p.membership_year=CAST(strftime('%Y','now') AS INTEGER)
        AND p.status='verified' AND p.amount_dzd=500)
    `).bind(body.ref).first();
    if(!row) return json({ok:false,error:"membership_inactive"},403);
    return json({ok:true});
  } catch(e) { return json({ok:false,error:"verification_unavailable"},503); }
}

async function handleAdminList(request, env) {
  if (!env.DB) return json({ error: "database_unavailable" }, 503);
  const actor = await requireAdmin(request, env);
  if (!actor) return json({ error: "unauthorized" }, 401);
  const r = actor.role === "national"
    ? await env.DB.prepare(`
        SELECT m.id, m.ref, m.bureau, m.name, m.phone, m.profile, m.files, m.status, m.created_at,
               p.id AS payment_id, p.status AS payment_status
        FROM members m LEFT JOIN member_payments p ON p.member_id=m.id AND p.membership_year=CAST(strftime('%Y','now') AS INTEGER)
        ORDER BY m.created_at DESC LIMIT 500
      `).all()
    : await env.DB.prepare(`
        SELECT m.id, m.ref, m.bureau, m.name, m.phone, m.profile, m.files, m.status, m.created_at,
               p.id AS payment_id, p.status AS payment_status
        FROM members m LEFT JOIN member_payments p ON p.member_id=m.id
        WHERE m.bureau = ? ORDER BY m.created_at DESC LIMIT 500
      `).bind(actor.bureau).all();
  const requests = r.results.map(row => ({
    id: row.id, memberId: row.id, requestNumber: row.ref,
    name: row.name, phone: row.phone, bureau: row.bureau,
    status: row.status, createdAt: row.created_at,
    paymentId: row.payment_id || null, paymentStatus: row.payment_status || "pending_review",
    profile: parseJson(row.profile, {}),
    files: Object.keys(parseJson(row.files, {}))
  }));
  return json(requests);
}

async function handleAdminFile(id, type, request, env) {
  if (!env.DB) return json({ error: "database_unavailable" }, 503);
  const actor = await requireAdmin(request, env);
  if (!actor) return json({ error: "unauthorized" }, 401);
  if (!FILE_KEYS.includes(type)) return json({ error: "invalid_file_type" }, 400);
  const row = await env.DB.prepare("SELECT bureau, files FROM members WHERE id = ?").bind(id).first();
  if (row && actor.role !== "national" && row.bureau !== actor.bureau) return json({ error: "forbidden" }, 403);
  if (!row) return json({ error: "member_not_found" }, 404);
  const files = parseJson(row.files, {});
  const file = files[type];
  if (!file || !file.data) return json({ error: "file_not_found" }, 404);
  let bytes;
  try { bytes=await decryptFileData(file.data,env); }
  catch(e) { return json({error:"document_decryption_failed"},503); }
  await env.DB.prepare("INSERT INTO audit (at,actor,action,target) VALUES (?,?,?,?)")
    .bind(Date.now(),actor.email,"private_document_access",id+":"+type).run();
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
  const actor = await requireAdmin(request, env);
  if (!actor) return json({ error: "unauthorized" }, 401);
  const row = await env.DB.prepare(
    "SELECT id, ref, bureau, name, phone, profile, status, otp_hash, otp_exp, otp_tries FROM members WHERE id = ?"
  ).bind(id).first();
  if (!row) return json({ error: "member_not_found" }, 404);
  if (actor.role !== "national" && row.bureau !== actor.bureau) return json({ error: "forbidden" }, 403);
  if (!["pending_payment", "code_sent"].includes(row.status)) {
    return json({ error: "member_not_awaiting_confirmation" }, 409);
  }
  const payment = await env.DB.prepare(
    "SELECT id,status,amount_dzd FROM member_payments WHERE member_id=? AND membership_year=? ORDER BY created_at DESC LIMIT 1"
  ).bind(id,new Date().getFullYear()).first();
  if (!payment || payment.status !== "verified" || Number(payment.amount_dzd) !== 500) {
    return json({ error: "payment_not_verified" }, 409);
  }
  const profile = parseJson(row.profile, {});
  const email = cleanText(profile.email,160);
  if (!email || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email) || !env.RESEND_API_KEY || !env.RESEND_FROM) {
    return json({ error: "member_email_delivery_not_configured" }, 503);
  }

  const code = randomDigits(6), hash = await sha256(row.ref + ":" + code);
  const expires = Date.now() + 10 * 60 * 1000;
  const issued = await env.DB.prepare(`
    UPDATE members SET otp_hash=?,otp_exp=?,otp_tries=0,status='code_sent'
    WHERE id=? AND status=? AND EXISTS (
      SELECT 1 FROM member_payments
      WHERE member_id=? AND membership_year=? AND status='verified' AND amount_dzd=500
    )
  `).bind(hash,expires,id,row.status,id,new Date().getFullYear()).run();
  if (!issued.meta || issued.meta.changes !== 1) {
    return json({ error: "member_approval_conflict" }, 409);
  }

  const sent = await sendEmail(env,email,"ANRSH — Code de confirmation",
    "Votre paiement de 500 DZD a été vérifié.\\nDemande : "+row.ref+"\\nCode : "+code+"\\nCe code expire dans 10 minutes et ne peut être utilisé qu'une fois.");
  if (!sent.sent) {
    // Restore the previous state only if this exact OTP is still current.
    await env.DB.prepare(`
      UPDATE members SET otp_hash=?,otp_exp=?,otp_tries=?,status=?
      WHERE id=? AND status='code_sent' AND otp_hash=?
    `).bind(row.otp_hash,row.otp_exp,row.otp_tries||0,row.status,id,hash).run();
    return json({ error: "member_notification_failed" },503);
  }
  await env.DB.prepare("INSERT INTO notification_log (id,member_id,recipient,channel,event_type,provider_message_id,status,created_at,sent_at) VALUES (?,?,?,'email','approved',NULL,'sent',?,?)")
    .bind(crypto.randomUUID(),id,email,Date.now(),Date.now()).run();
  await env.DB.prepare("INSERT INTO audit (at,actor,action,target) VALUES (?,?,?,?)").bind(Date.now(),actor.email,"member_approval_code_sent",id).run();
  return json({ok:true,status:"code_sent",requestNumber:row.ref,expiresAt:expires,emailSent:true});
}

async function handleAdminPaymentReview(id, request, env) {
  if (!env.DB) return json({error:"database_unavailable"},503);
  const actor = await requireAdmin(request,env);
  if (!actor) return json({error:"unauthorized"},401);
  const body = await request.json().catch(()=>({}));
  const decision = body.decision === "verify" ? "verified" : body.decision === "reject" ? "rejected" : "";
  if (!decision) return json({error:"invalid_payment_decision"},400);
  const payment = await env.DB.prepare(
    "SELECT p.id,p.member_id,p.bureau,p.amount_dzd,p.status FROM member_payments p WHERE p.id=?"
  ).bind(id).first();
  if (!payment) return json({error:"payment_not_found"},404);
  if (actor.role !== "national" && payment.bureau !== actor.bureau) return json({error:"forbidden"},403);
  if (payment.status !== "pending_review") return json({error:"payment_not_pending"},409);
  if (decision === "verified" && Number(payment.amount_dzd) !== 500) return json({error:"invalid_payment_amount"},409);
  const now=Date.now();
  const statements=[
    env.DB.prepare("UPDATE member_payments SET status=?,reviewed_by=?,reviewed_at=?,rejection_reason=? WHERE id=? AND status='pending_review'")
      .bind(decision,actor.id,now,decision==="rejected"?cleanText(body.reason,300):null,id)
  ];
  if(decision==="verified") statements.push(env.DB.prepare(`
    INSERT INTO payment_allocations (id,payment_id,member_id,bureau,membership_year,gross_amount_dzd,national_share_dzd,regional_share_dzd,allocated_at)
    SELECT ?,id,member_id,bureau,membership_year,500,100,400,?
    FROM member_payments WHERE id=? AND status='verified' AND changes()=1
  `).bind(crypto.randomUUID(),now,id));
  let reviewResults;
  try { reviewResults=await env.DB.batch(statements); }
  catch(e) { console.error("payment review transaction failed"); return json({error:"payment_review_failed"},500); }
  if(!reviewResults?.[0]?.meta||reviewResults[0].meta.changes!==1)
    return json({error:"payment_review_conflict"},409);
  if(decision==="verified" && (!reviewResults?.[1]?.meta||reviewResults[1].meta.changes!==1))
    return json({error:"payment_allocation_failed"},500);
  const check=await env.DB.prepare("SELECT status,member_id FROM member_payments WHERE id=?").bind(id).first();
  if(!check||check.status!==decision) return json({error:"payment_review_conflict"},409);
  await env.DB.prepare("INSERT INTO audit (at,actor,action,target) VALUES (?,?,?,?)")
    .bind(now,actor.email,"payment_"+decision,id).run();
  if(decision==="rejected") {
    const member=await env.DB.prepare("SELECT ref,profile FROM members WHERE id=?").bind(check.member_id).first();
    const profile=parseJson(member?.profile,{});
    const email=cleanText(profile.email,160);
    const sent=email?await sendEmail(env,email,"ANRSH — ملاحظة بخصوص وصل الاشتراك",
      "تعذر اعتماد وصل دفع الاشتراك لطلب "+(member?.ref||"")+". السبب: "+cleanText(body.reason,300)+". يرجى التواصل مع مكتبكم الجهوي لتسوية الملف."): {sent:false,reason:"member_email_missing"};
    await env.DB.prepare("INSERT INTO notification_log (id,member_id,recipient,channel,event_type,status,error_code,created_at,sent_at) VALUES (?,?,?,'email','rejected',?,?,?,?)")
      .bind(crypto.randomUUID(),check.member_id,email||"unavailable",sent.sent?"sent":"failed",sent.reason||null,Date.now(),sent.sent?Date.now():null).run();
  }
  return json({ok:true,status:decision});
}

async function handleAdminDelete(id, request, env) {
  if (!env.DB) return json({ error: "database_unavailable" }, 503);
  const actor = await requireAdmin(request, env);
  if (!actor) return json({ error: "unauthorized" }, 401);
  // Permanent deletion is disabled pending an approved retention policy.
  return json({ error: "deletion_disabled_retention_policy" }, 403);
}


// ===== ANRSH individual administrator authentication =====
const NATIONAL_EMAILS = new Set(["irched2521@gmail.com", "anrsh1994@gmail.com"]);
const ADMIN_PASSWORD_ITERATIONS = 310000;
const ADMIN_OTP_TTL_MS = 10 * 60 * 1000;
const ADMIN_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

async function passwordDigest(password, saltHex) {
  const salt = new Uint8Array(saltHex.match(/.{2}/g).map(x => parseInt(x, 16)));
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ADMIN_PASSWORD_ITERATIONS }, material, 256);
  return [...new Uint8Array(bits)].map(x => x.toString(16).padStart(2, "0")).join("");
}
function bearer(request) {
  const h = request.headers.get("authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
}
async function requireAdmin(request, env) {
  if (!env.DB) return null;
  const token = bearer(request);
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(token)) return null;
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(`
    SELECT u.id, u.email, u.role, u.bureau, u.active, s.id AS session_id, s.expires_at
    FROM admin_sessions s JOIN admin_users u ON u.id = s.admin_id
    WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?
      AND u.active = 1 LIMIT 1
  `).bind(tokenHash, Date.now()).first();
  if (!row) return null;
  await env.DB.prepare("UPDATE admin_sessions SET last_seen_at = ? WHERE id = ?").bind(Date.now(), row.session_id).run();
  return row;
}
async function authBootstrap(request, env) {
  if (!env.DB || !env.ANRSH_BOOTSTRAP_SECRET || String(env.ANRSH_BOOTSTRAP_SECRET).length < 32) {
    return json({ error: "bootstrap_not_configured" }, 503);
  }
  const supplied = request.headers.get("x-bootstrap-secret") || "";
  if (!safeEqual(supplied, env.ANRSH_BOOTSTRAP_SECRET)) return json({ error: "unauthorized" }, 401);
  const body = await request.json().catch(() => ({}));
  const accounts = Array.isArray(body.accounts) ? body.accounts : [];
  if (accounts.length !== 2) return json({ error: "exactly_two_national_accounts_required" }, 400);
  const normalized = accounts.map(x => ({ email: cleanText(x.email, 160).toLowerCase(), password: String(x.password || "") }));
  if (new Set(normalized.map(x => x.email)).size !== 2 ||
      normalized.some(x => !NATIONAL_EMAILS.has(x.email) || x.password.length < 14 || x.password.length > 128)) {
    return json({ error: "invalid_bootstrap_accounts" }, 400);
  }
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM admin_users").first();
  if (Number(count?.n || 0) !== 0) return json({ error: "bootstrap_already_used" }, 409);
  const now = Date.now();
  const statements = [];
  for (const a of normalized) {
    const id = crypto.randomUUID(), salt = randomHex(16), hash = await passwordDigest(a.password, salt);
    statements.push(env.DB.prepare("INSERT INTO admin_users (id,email,role,bureau,active,created_at) VALUES (?,?,'national',NULL,1,?)").bind(id,a.email,now));
    statements.push(env.DB.prepare("INSERT INTO admin_credentials (admin_id,password_hash,password_salt,password_changed_at,failed_attempts,locked_until) VALUES (?,?,?,?,0,NULL)").bind(id,hash,salt,now));
  }
  try { await env.DB.batch(statements); }
  catch (e) { console.error("bootstrap failed"); return json({ error: "bootstrap_failed" }, 500); }
  return json({ ok: true, created: 2 });
}
async function authLogin(request, env) {
  if (!env.DB) return json({ error: "database_unavailable" }, 503);
  const body = await request.json().catch(() => ({}));
  const email = cleanText(body.email, 160).toLowerCase(), password = String(body.password || "");
  if (!email || password.length < 1 || password.length > 128) return json({ error: "invalid_credentials" }, 400);
  const row = await env.DB.prepare(`
    SELECT u.id,u.email,u.role,u.bureau,u.active,c.password_hash,c.password_salt,c.failed_attempts,c.locked_until
    FROM admin_users u JOIN admin_credentials c ON c.admin_id=u.id WHERE u.email=? LIMIT 1
  `).bind(email).first();
  if (!row || !row.active) return json({ error: "invalid_credentials" }, 401);
  if (row.locked_until && Number(row.locked_until) > Date.now()) return json({ error: "account_temporarily_locked" }, 423);
  const candidate = await passwordDigest(password, row.password_salt);
  if (!safeEqual(candidate, row.password_hash)) {
    const attempts = Number(row.failed_attempts || 0) + 1;
    await env.DB.prepare("UPDATE admin_credentials SET failed_attempts=?,locked_until=? WHERE admin_id=?")
      .bind(attempts >= 8 ? 0 : attempts, attempts >= 8 ? Date.now() + 15*60*1000 : null, row.id).run();
    return json({ error: "invalid_credentials" }, 401);
  }
  await env.DB.prepare("UPDATE admin_credentials SET failed_attempts=0,locked_until=NULL WHERE admin_id=?").bind(row.id).run();
  if (!env.RESEND_API_KEY || !env.RESEND_FROM) return json({ error: "admin_otp_delivery_not_configured" }, 503);
  await env.DB.prepare("UPDATE admin_otps SET used_at=? WHERE admin_id=? AND purpose='login' AND used_at IS NULL").bind(Date.now(),row.id).run();
  const code = randomDigits(6), id = crypto.randomUUID(), expires = Date.now() + ADMIN_OTP_TTL_MS;
  const codeHash = await sha256(row.id + ":login:" + code);
  await env.DB.prepare("INSERT INTO admin_otps (id,admin_id,code_hash,purpose,expires_at,attempts,used_at,created_at) VALUES (?,?,?,'login',?,0,NULL,?)")
    .bind(id,row.id,codeHash,expires,Date.now()).run();
  const sent = await sendEmail(env,row.email,"ANRSH — رمز الدخول الإداري","رمز الدخول: "+code+"\nصالح لمدة 10 دقائق ويستعمل مرة واحدة.");
  if (!sent.sent) {
    await env.DB.prepare("UPDATE admin_otps SET used_at=? WHERE id=?").bind(Date.now(),id).run();
    return json({ error: "admin_otp_delivery_failed" }, 503);
  }
  return json({ ok: true, challengeId: id, expiresAt: expires });
}
async function authVerify(request, env) {
  if (!env.DB) return json({ error: "database_unavailable" }, 503);
  const body = await request.json().catch(() => ({}));
  const challengeId = cleanText(body.challengeId, 80), code = String(body.code || "");
  if (!/^[0-9a-f-]{36}$/i.test(challengeId) || !/^\d{6}$/.test(code)) return json({ error: "invalid_code" }, 400);
  const row = await env.DB.prepare("SELECT id,admin_id,code_hash,expires_at,attempts,used_at FROM admin_otps WHERE id=? AND purpose='login'").bind(challengeId).first();
  if (!row || row.used_at || Number(row.expires_at) < Date.now()) return json({ error: "code_expired_or_used" }, 410);
  if (Number(row.attempts) >= 5) return json({ error: "too_many_attempts" }, 429);
  const candidate = await sha256(row.admin_id + ":login:" + code);
  if (!safeEqual(candidate,row.code_hash)) {
    await env.DB.prepare("UPDATE admin_otps SET attempts=attempts+1 WHERE id=? AND used_at IS NULL").bind(challengeId).run();
    return json({ error: "invalid_code" }, 401);
  }
  const consumed = await env.DB.prepare("UPDATE admin_otps SET used_at=? WHERE id=? AND used_at IS NULL AND expires_at>? AND attempts<5")
    .bind(Date.now(),challengeId,Date.now()).run();
  if (!consumed.meta || consumed.meta.changes !== 1) return json({ error: "code_already_used" }, 409);
  const token = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const tokenHash = await sha256(token), sessionId = crypto.randomUUID(), expiry = Date.now()+ADMIN_SESSION_TTL_MS;
  await env.DB.prepare("INSERT INTO admin_sessions (id,admin_id,token_hash,expires_at,revoked_at,created_at,last_seen_at) VALUES (?,?,?, ?,NULL,?,?)")
    .bind(sessionId,row.admin_id,tokenHash,expiry,Date.now(),Date.now()).run();
  const user = await env.DB.prepare("SELECT id,email,role,bureau FROM admin_users WHERE id=? AND active=1").bind(row.admin_id).first();
  return json({ ok:true, token, expiresAt:expiry, user });
}
async function authMe(request, env) {
  const actor = await requireAdmin(request,env);
  return actor ? json({ok:true,user:{id:actor.id,email:actor.email,role:actor.role,bureau:actor.bureau}}) : json({error:"unauthorized"},401);
}
async function authLogout(request, env) {
  if (!env.DB) return json({ error: "database_unavailable" }, 503);
  const token = bearer(request);
  if (token) await env.DB.prepare("UPDATE admin_sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL").bind(Date.now(),await sha256(token)).run();
  return json({ok:true});
}


async function authCreateInvitation(request,env) {
  const actor=await requireAdmin(request,env);
  if(!actor) return json({error:"unauthorized"},401);
  if(actor.role!=="national") return json({error:"forbidden"},403);
  const body=await request.json().catch(()=>({}));
  const email=cleanText(body.email,160).toLowerCase(), bureau=cleanText(body.bureau,80);
  if(!/^\S+@\S+\.\S+$/.test(email)||!bureau) return json({error:"invalid_invitation"},400);
  const office=await env.DB.prepare("SELECT bureau FROM regional_offices WHERE bureau=? AND active=1").bind(bureau).first();
  if(!office) return json({error:"invalid_or_inactive_office"},400);
  const token=randomHex(32), tokenHash=await sha256(token), id=crypto.randomUUID(), expires=Date.now()+72*60*60*1000;
  const sent=await sendEmail(env,email,"ANRSH — دعوة حساب المكتب الجهوي",
    "لإنشاء حساب رئيس المكتب الجهوي، افتح صفحة المنصة وأدخل رمز الدعوة التالي خلال 72 ساعة:\n"+token);
  if(!sent.sent) return json({error:"invitation_email_failed"},503);
  await env.DB.prepare("INSERT INTO admin_invitations (id,email,role,bureau,token_hash,expires_at,used_at,created_by,created_at) VALUES (?,?,'regional',?,?,?,NULL,?,?)")
    .bind(id,email,bureau,tokenHash,expires,actor.id,Date.now()).run();
  await env.DB.prepare("INSERT INTO audit (at,actor,action,target) VALUES (?,?,?,?)")
    .bind(Date.now(),actor.email,"regional_invitation_created",id).run();
  return json({ok:true,expiresAt:expires});
}
async function authAcceptInvitation(request,env) {
  const body=await request.json().catch(()=>({}));
  const token=String(body.token||""), password=String(body.password||"");
  if(!/^[a-f0-9]{64}$/i.test(token)||password.length<14||password.length>128) return json({error:"invalid_invitation_or_password"},400);
  const tokenHash=await sha256(token);
  const invite=await env.DB.prepare("SELECT id,email,role,bureau,expires_at,used_at FROM admin_invitations WHERE token_hash=?").bind(tokenHash).first();
  if(!invite||invite.used_at||Number(invite.expires_at)<Date.now()) return json({error:"invitation_expired_or_used"},410);
  const id=crypto.randomUUID(),salt=randomHex(16),hash=await passwordDigest(password,salt);
  // Consume the invitation and create the inactive account in one D1 batch.
  // This prevents a failed account insert from permanently burning a valid invitation.
  let results;
  try {
    results=await env.DB.batch([
      env.DB.prepare("UPDATE admin_invitations SET used_at=? WHERE id=? AND used_at IS NULL AND expires_at>?")
        .bind(Date.now(),invite.id,Date.now()),
      // Each following insert is conditional on the immediately preceding statement changing exactly one row.
      env.DB.prepare("INSERT INTO admin_users (id,email,role,bureau,active,created_at) SELECT ?,?,?,?,0,? WHERE changes()=1")
        .bind(id,invite.email,invite.role,invite.bureau,Date.now()),
      env.DB.prepare("INSERT INTO admin_credentials (admin_id,password_hash,password_salt,password_changed_at,failed_attempts,locked_until) SELECT ?,?,?,?,0,NULL WHERE changes()=1")
        .bind(id,hash,salt,Date.now())
    ]);
  } catch(e) {
    return json({error:"account_creation_failed_invitation_not_consumed"},409);
  }
  if(!results?.[0]?.meta||results[0].meta.changes!==1 ||
     !results?.[1]?.meta||results[1].meta.changes!==1 ||
     !results?.[2]?.meta||results[2].meta.changes!==1) {
    return json({error:"invitation_already_used_or_account_exists"},409);
  }
  return json({ok:true,status:"pending_national_approval"});
}
async function authActivateOfficer(request,env,id) {
  const actor=await requireAdmin(request,env);
  if(!actor) return json({error:"unauthorized"},401);
  if(actor.role!=="national") return json({error:"forbidden"},403);
  const result=await env.DB.prepare("UPDATE admin_users SET active=1 WHERE id=? AND role='regional' AND active=0").bind(id).run();
  if(!result.meta||result.meta.changes!==1) return json({error:"regional_account_not_pending"},404);
  await env.DB.prepare("INSERT INTO audit (at,actor,action,target) VALUES (?,?,?,?)").bind(Date.now(),actor.email,"regional_account_activated",id).run();
  return json({ok:true,active:true});
}
async function handleReports(request,env,method) {
  const actor=await requireAdmin(request,env);
  if(!actor) return json({error:"unauthorized"},401);
  if(method==="GET") {
    const r=actor.role==="national"
      ? await env.DB.prepare("SELECT id,bureau,report_year,quarter,generated_at,payload_json,status FROM quarterly_reports ORDER BY report_year DESC,quarter DESC LIMIT 200").all()
      : await env.DB.prepare("SELECT id,bureau,report_year,quarter,generated_at,payload_json,status FROM quarterly_reports WHERE bureau=? ORDER BY report_year DESC,quarter DESC LIMIT 100").bind(actor.bureau).all();
    return json({ok:true,reports:r.results.map(x=>({...x,payload:parseJson(x.payload_json,{})}))});
  }
  const body=await request.json().catch(()=>({}));
  const bureau=actor.role==="national"?cleanText(body.bureau,80):actor.bureau;
  const year=Number(body.year),quarter=Number(body.quarter);
  if(!bureau||!Number.isInteger(year)||year<2020||year>2100||![1,2,3,4].includes(quarter)) return json({error:"invalid_report_period"},400);
  const periodStart=year+"-"+String((quarter-1)*3+1).padStart(2,"0")+"-01";
  const periodEnd=new Date(Date.UTC(year,quarter*3,0)).toISOString().slice(0,10);
  const id=crypto.randomUUID(), periodFrom=Date.parse(periodStart+"T00:00:00.000Z"), periodTo=Date.parse(periodEnd+"T23:59:59.999Z");
  const financial=await env.DB.prepare(`
    SELECT COUNT(*) AS payment_count,COALESCE(SUM(amount_dzd),0) AS gross_dzd
    FROM member_payments WHERE bureau=? AND status='verified' AND membership_year=? AND reviewed_at BETWEEN ? AND ?
  `).bind(bureau,year,periodFrom,periodTo).first();
  const gross=Number(financial?.gross_dzd||0);
  const payload=Object.assign({},body.payload||{},{financialSummary:{verifiedPayments:Number(financial?.payment_count||0),grossDzd:gross,nationalShareDzd:Math.floor(gross*0.2),regionalShareDzd:gross-Math.floor(gross*0.2)}});
  try {
    await env.DB.prepare("INSERT INTO quarterly_reports (id,bureau,report_year,quarter,generated_by,generated_at,period_start,period_end,payload_json,status) VALUES (?,?,?,?,?,?,?,?,?,'generated')")
      .bind(id,bureau,year,quarter,actor.id,Date.now(),periodStart,periodEnd,JSON.stringify(payload)).run();
  } catch(e) { return json({error:"report_already_exists_or_save_failed"},409); }
  await env.DB.prepare("INSERT INTO audit (at,actor,action,target) VALUES (?,?,?,?)").bind(Date.now(),actor.email,"quarterly_report_created",id).run();
  return json({ok:true,id,bureau,year,quarter});
}


async function handleOfficeWilayas(request,env,method) {
  const actor=await requireAdmin(request,env);
  if(!actor) return json({error:"unauthorized"},401);
  if(method==="GET") {
    const rows=actor.role==="national"
      ? await env.DB.prepare("SELECT bureau,wilaya_code,wilaya_name FROM office_wilayas ORDER BY bureau,CAST(wilaya_code AS INTEGER)").all()
      : await env.DB.prepare("SELECT bureau,wilaya_code,wilaya_name FROM office_wilayas WHERE bureau=? ORDER BY CAST(wilaya_code AS INTEGER)").bind(actor.bureau).all();
    return json({ok:true,assignments:rows.results});
  }
  const body=await request.json().catch(()=>({}));
  const bureau=actor.role==="national"?cleanText(body.bureau,80):actor.bureau;
  const code=cleanText(body.wilaya_code,3);
  const w=await env.DB.prepare("SELECT code,name_ar FROM wilayas WHERE code=? AND active=1").bind(code).first();
  if(!bureau||!w) return json({error:"invalid_bureau_or_wilaya"},400);
  const office=await env.DB.prepare("SELECT bureau FROM regional_offices WHERE bureau=? AND active=1").bind(bureau).first();
  if(!office) return json({error:"invalid_or_inactive_office"},400);
  try {
    const inserted=await env.DB.prepare(`
      INSERT INTO office_wilayas (bureau,wilaya_code,wilaya_name)
      SELECT ?,?,?
      WHERE NOT EXISTS (SELECT 1 FROM office_wilayas WHERE wilaya_code=?)
    `).bind(bureau,code,w.name_ar,code).run();
    if(!inserted.meta||inserted.meta.changes!==1) return json({error:"wilaya_already_assigned"},409);
  } catch(e) { return json({error:"wilaya_already_assigned_or_save_failed"},409); }
  await env.DB.prepare("INSERT INTO audit (at,actor,action,target) VALUES (?,?,?,?)").bind(Date.now(),actor.email,"wilaya_assigned",bureau+":"+code).run();
  return json({ok:true,bureau,wilaya_code:code,wilaya_name:w.name_ar});
}
async function handleOfficeProfile(request,env) {
  const actor=await requireAdmin(request,env);
  if(!actor) return json({error:"unauthorized"},401);
  const body=await request.json().catch(()=>({}));
  const bureau=actor.role==="national"?cleanText(body.bureau,80):actor.bureau;
  if(!bureau) return json({error:"bureau_required"},400);
  const office=await env.DB.prepare("SELECT bureau FROM regional_offices WHERE bureau=?").bind(bureau).first();
  if(!office) return json({error:"office_not_found"},404);
  const bank=cleanText(body.bank_name,120),rib=cleanText(body.rib,40),ccp=cleanText(body.ccp,30),key=cleanText(body.ccp_key,20);
  const now=Date.now();
  await env.DB.prepare(`
    INSERT INTO offices (bureau,bank_name,rib,ccp,ccp_key,updated_by,updated_at)
    VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(bureau) DO UPDATE SET bank_name=excluded.bank_name,rib=excluded.rib,
      ccp=excluded.ccp,ccp_key=excluded.ccp_key,updated_by=excluded.updated_by,updated_at=excluded.updated_at
  `).bind(bureau,bank||null,rib||null,ccp||null,key||null,actor.id,now).run();
  const president=cleanText(body.president_name,120),phone=normalizePhone(body.president_phone),email=cleanText(body.email,160),address=cleanText(body.address,300);
  await env.DB.prepare("UPDATE regional_offices SET president_name=COALESCE(?,president_name),president_phone=COALESCE(?,president_phone),email=COALESCE(?,email),address=COALESCE(?,address),updated_at=? WHERE bureau=?")
    .bind(president||null,phone||null,email||null,address||null,now,bureau).run();
  await env.DB.prepare("INSERT INTO audit (at,actor,action,target) VALUES (?,?,?,?)").bind(now,actor.email,"office_profile_updated",bureau).run();
  return json({ok:true,bureau});
}
async function handlePendingOfficers(request,env) {
  const actor=await requireAdmin(request,env);
  if(!actor) return json({error:"unauthorized"},401);
  if(actor.role!=="national") return json({error:"forbidden"},403);
  const r=await env.DB.prepare("SELECT id,email,bureau,created_at FROM admin_users WHERE role='regional' AND active=0 ORDER BY created_at").all();
  return json({ok:true,officers:r.results});
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

  if (request.method === "GET" && path === "/api/card/verify") return handleCardVerify(url,env);
  if (request.method === "GET" && path === "/api/print-check") return handlePrintCheck(url, env);

  if (request.method === "POST" && path === "/api/auth/bootstrap") return authBootstrap(request, env);
  if (request.method === "POST" && path === "/api/auth/invitation/accept") return authAcceptInvitation(request,env);
  if (request.method === "POST" && path === "/api/admin/invitations") return authCreateInvitation(request,env);
  if (request.method === "GET" && path === "/api/admin/officers/pending") return handlePendingOfficers(request,env);
  if (request.method === "GET" && path === "/api/admin/wilayas") return handleOfficeWilayas(request,env,"GET");
  if (request.method === "POST" && path === "/api/admin/wilayas") return handleOfficeWilayas(request,env,"POST");
  if (request.method === "POST" && path === "/api/admin/office-profile") return handleOfficeProfile(request,env);
  if (request.method === "GET" && path === "/api/admin/reports") return handleReports(request,env,"GET");
  if (request.method === "POST" && path === "/api/admin/reports") return handleReports(request,env,"POST");
  const activateMatch=path.match(/^\/api\/admin\/officers\/([^/]+)\/activate$/);
  if(request.method==="POST"&&activateMatch) return authActivateOfficer(request,env,decodeURIComponent(activateMatch[1]));
  if (request.method === "POST" && path === "/api/auth/login") return authLogin(request, env);
  if (request.method === "POST" && path === "/api/auth/verify") return authVerify(request, env);
  if (request.method === "GET" && path === "/api/auth/me") return authMe(request, env);
  if (request.method === "POST" && path === "/api/auth/logout") return authLogout(request, env);

  if (path === "/api/admin/requests" && request.method === "GET") return handleAdminList(request, env);

  const fileMatch = path.match(/^\/api\/admin\/requests\/([^/]+)\/files\/([^/]+)$/);
  if (request.method === "GET" && fileMatch) {
    return handleAdminFile(decodeURIComponent(fileMatch[1]), decodeURIComponent(fileMatch[2]), request, env);
  }

  const paymentReviewMatch = path.match(/^\/api\/admin\/payments\/([^/]+)\/review$/);
  if (request.method === "POST" && paymentReviewMatch) {
    return handleAdminPaymentReview(decodeURIComponent(paymentReviewMatch[1]),request,env);
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

async function generateRenewalReminders(env,nowDate=new Date()) {
  if(!env.DB) throw new Error("database_unavailable");
  const nextYear=nowDate.getUTCFullYear()+1;
  const rows=await env.DB.prepare(`
    SELECT m.id,m.ref,m.name,m.profile,m.bureau
    FROM members m WHERE m.status='unlocked' AND EXISTS (
      SELECT 1 FROM member_payments p WHERE p.member_id=m.id
        AND p.membership_year=? AND p.status='verified' AND p.amount_dzd=500
    )
  `).bind(nextYear-1).all();
  let sentCount=0;
  for(const member of rows.results||[]) {
    const profile=parseJson(member.profile,{});
    const email=cleanText(profile.email,160);
    if(!email) continue;
    const already=await env.DB.prepare("SELECT id FROM notification_log WHERE member_id=? AND event_type='renewal_due' AND error_code=? LIMIT 1")
      .bind(member.id,"renewal_"+nextYear).first();
    if(already) continue;
    const sent=await sendEmail(env,email,"ANRSH — تذكير بتجديد الانخراط",
      "نذكركم بقرب انتهاء اشتراك ANRSH لسنة "+(nextYear-1)+". يمكنكم تجديد الانخراط السنوي بمبلغ 500 دج للسنة "+nextYear+" عبر مكتبكم الجهوي.");
    await env.DB.prepare("INSERT INTO notification_log (id,member_id,recipient,channel,event_type,status,error_code,created_at,sent_at) VALUES (?,?,?,'email','renewal_due',?,?,?,?)")
      .bind(crypto.randomUUID(),member.id,email,sent.sent?"sent":"failed","renewal_"+nextYear,Date.now(),sent.sent?Date.now():null).run();
    if(sent.sent) sentCount++;
  }
  return {year:nextYear,notified:sentCount};
}
async function generateQuarterlyReports(env,nowDate=new Date()) {
  if(!env.DB) throw new Error("database_unavailable");
  const month=nowDate.getUTCMonth(), currentQuarter=Math.floor(month/3)+1;
  const quarter=currentQuarter===1?4:currentQuarter-1;
  const year=currentQuarter===1?nowDate.getUTCFullYear()-1:nowDate.getUTCFullYear();
  const startMonth=(quarter-1)*3;
  const start=new Date(Date.UTC(year,startMonth,1));
  const end=new Date(Date.UTC(year,startMonth+3,0,23,59,59,999));
  const startMs=start.getTime(),endMs=end.getTime();
  const offices=await env.DB.prepare("SELECT bureau,office_name FROM regional_offices WHERE active=1").all();
  let created=0;
  for(const office of offices.results||[]) {
    const totals=await env.DB.prepare("SELECT COUNT(*) AS n,COALESCE(SUM(amount_dzd),0) AS gross FROM member_payments WHERE bureau=? AND status='verified' AND membership_year=? AND reviewed_at BETWEEN ? AND ?")
      .bind(office.bureau,year,startMs,endMs).first();
    const gross=Number(totals?.gross||0),national=Math.floor(gross*0.2);
    const payload={source:"scheduled",officeName:office.office_name,financialSummary:{verifiedPayments:Number(totals?.n||0),grossDzd:gross,nationalShareDzd:national,regionalShareDzd:gross-national}};
    const result=await env.DB.prepare("INSERT OR IGNORE INTO quarterly_reports (id,bureau,report_year,quarter,generated_by,generated_at,period_start,period_end,payload_json,status) VALUES (?,?,?,?,NULL,?,?,?,?,'generated')")
      .bind(crypto.randomUUID(),office.bureau,year,quarter,Date.now(),start.toISOString().slice(0,10),end.toISOString().slice(0,10),JSON.stringify(payload)).run();
    if(result.meta&&result.meta.changes===1) created++;
  }
  const summary="تم إنشاء تقارير ANRSH الفصلية للفترة "+quarter+"/"+year+". عدد المكاتب: "+created+".";
  for(const email of ["irched2521@gmail.com","anrsh1994@gmail.com"]) {
    const sent=await sendEmail(env,email,"ANRSH — التقارير الفصلية",summary);
    await env.DB.prepare("INSERT INTO notification_log (id,member_id,recipient,channel,event_type,status,error_code,created_at,sent_at) VALUES (?,NULL,?,'email','quarterly_report',?,?,?,?)")
      .bind(crypto.randomUUID(),email,sent.sent?"sent":"failed",sent.reason||null,Date.now(),sent.sent?Date.now():null).run();
  }
  return {year,quarter,created};
}
export default {
  async scheduled(controller, env, ctx) {
    const now=new Date();
    if(now.getUTCDate()===1 && [0,3,6,9].includes(now.getUTCMonth())) {
      ctx.waitUntil(generateQuarterlyReports(env,now).catch(e => console.error("quarterly report cron failed")));
    }
    if(now.getUTCMonth()===10 && now.getUTCDate()===1) {
      ctx.waitUntil(generateRenewalReminders(env,now).catch(e => console.error("renewal reminder cron failed")));
    }
  },
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