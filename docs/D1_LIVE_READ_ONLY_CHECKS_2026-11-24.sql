-- ANRSH DIGITAL — READ-ONLY D1 live verification
-- Run in Cloudflare D1 Console only after selecting the database bound to Worker DB.
-- Every statement below is SELECT/PRAGMA only. No data is changed.

-- 1) Confirm the required tables exist.
SELECT name, type
FROM sqlite_master
WHERE type IN ('table','index')
  AND name IN (
    'anrsh_platform_settings','wilayas','regional_offices','members',
    'member_payments','payment_allocations','anrsh_regional_transfers',
    'office_wilayas','notification_log','admin_users','admin_credentials',
    'admin_otps'
  )
ORDER BY type, name;

-- 2) Confirm the active membership fee setting.
SELECT id, fee_dzd
FROM anrsh_platform_settings
WHERE id = 1;

-- 3) Safe aggregate counts only; no names, phones, emails, documents or IDs.
SELECT COUNT(*) AS active_wilayas FROM wilayas WHERE active = 1;
SELECT COUNT(*) AS active_regional_offices FROM regional_offices WHERE active = 1;
SELECT status, COUNT(*) AS members_count FROM members GROUP BY status ORDER BY status;
SELECT status, COUNT(*) AS payments_count FROM member_payments GROUP BY status ORDER BY status;

-- 4) Check schema columns needed by the current Worker.
PRAGMA table_info('members');
PRAGMA table_info('member_payments');
PRAGMA table_info('regional_offices');
PRAGMA table_info('office_wilayas');
PRAGMA table_info('notification_log');

-- 5) Detect duplicate wilaya assignment before considering the unique-index proposal.
-- This is read-only. Do not delete/reassign duplicates automatically.
SELECT wilaya_code, COUNT(*) AS assignment_count
FROM office_wilayas
GROUP BY wilaya_code
HAVING COUNT(*) > 1;
