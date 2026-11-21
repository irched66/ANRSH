isolated D1 staging DB.
-- The members table is pre-existing; this index supports throttling pending OTP requests.
CREATE INDEX IF NOT EXISTS idx_members_phone_status_created
  ON members(phone, status, created_at);



-- ============================================================
-- REV3 MIGRATION: 004_member_sessions.sql
-- ============================================================
-- ANRSH REV3 — short-lived member sessions for post-OTP request tracking and payment reference submission.
-- Apply only to an isolated staging D1 database after reviewing migrations 001–003.
CREATE TABLE IF NOT EXISTS member_sessions (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (member_id) REFERENCES members(id)
);
CREATE INDEX IF NOT EXISTS idx_member_sessions_member_expiry
  ON member_sessions(member_id, expires_at);



-- ============================================================
-- REV3 MIGRATION: 005_membership_card_qr_indexes.sql
-- ============================================================
-- ANRSH REV3 — additive indexes supporting card lookup and verification.
-- The QR credential is an HMAC signature derived from the opaque card ID;
-- no personal data or reusable QR secret is stored in this migration.
-- Apply only to an isolated staging D1 after backup and review.
CREATE INDEX IF NOT EXISTS idx_membership_cards_issued_at
  ON membership_cards(issued_at);
CREATE INDEX IF NOT EXISTS idx_membership_cards_year
  ON membership_cards(membership_year);
