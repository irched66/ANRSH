-- ANRSH DIGITAL — additive security phase 1 schema proposal
-- REVIEW ONLY. Do NOT execute against production D1 until reviewed and separately approved.
-- No existing tables or records are altered or deleted by this migration.

CREATE TABLE IF NOT EXISTS member_payments (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  member_ref TEXT NOT NULL,
  bureau TEXT NOT NULL,
  membership_year INTEGER NOT NULL,
  amount_dzd INTEGER NOT NULL CHECK (amount_dzd = 500),
  currency TEXT NOT NULL DEFAULT 'DZD' CHECK (currency = 'DZD'),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('bank_transfer', 'ccp', 'other')),
  receipt_ref TEXT,
  status TEXT NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review', 'verified', 'rejected', 'cancelled')),
  reviewed_by TEXT,
  reviewed_at INTEGER,
  rejection_reason TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (member_id) REFERENCES members(id),
  FOREIGN KEY (reviewed_by) REFERENCES admin_users(id)
);

CREATE INDEX IF NOT EXISTS idx_member_payments_bureau_year
  ON member_payments(bureau, membership_year);
CREATE INDEX IF NOT EXISTS idx_member_payments_member
  ON member_payments(member_id, membership_year);
CREATE INDEX IF NOT EXISTS idx_member_payments_status
  ON member_payments(status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_verified_payment_per_member_year
  ON member_payments(member_id, membership_year)
  WHERE status = 'verified';

CREATE TABLE IF NOT EXISTS member_card_tokens (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  issued_by TEXT,
  issued_at INTEGER NOT NULL,
  revoked_at INTEGER,
  FOREIGN KEY (member_id) REFERENCES members(id),
  FOREIGN KEY (issued_by) REFERENCES admin_users(id)
);

CREATE INDEX IF NOT EXISTS idx_member_card_tokens_member
  ON member_card_tokens(member_id, active);

CREATE TABLE IF NOT EXISTS quarterly_reports (
  id TEXT PRIMARY KEY,
  bureau TEXT NOT NULL,
  report_year INTEGER NOT NULL,
  quarter INTEGER NOT NULL CHECK (quarter BETWEEN 1 AND 4),
  generated_by TEXT,
  generated_at INTEGER NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'generated'
    CHECK (status IN ('generated', 'reviewed', 'sent')),
  reviewed_by TEXT,
  reviewed_at INTEGER,
  sent_at INTEGER,
  UNIQUE (bureau, report_year, quarter),
  FOREIGN KEY (generated_by) REFERENCES admin_users(id),
  FOREIGN KEY (reviewed_by) REFERENCES admin_users(id)
);

CREATE INDEX IF NOT EXISTS idx_quarterly_reports_period
  ON quarterly_reports(report_year, quarter, bureau);

CREATE TABLE IF NOT EXISTS notification_log (
  id TEXT PRIMARY KEY,
  member_id TEXT,
  recipient TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'sms', 'whatsapp_manual')),
  event_type TEXT NOT NULL
    CHECK (event_type IN ('application_received', 'approved', 'rejected', 'renewal_due', 'payment_verified')),
  provider_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sent', 'failed')),
  error_code TEXT,
  created_at INTEGER NOT NULL,
  sent_at INTEGER,
  FOREIGN KEY (member_id) REFERENCES members(id)
);

CREATE INDEX IF NOT EXISTS idx_notification_log_member
  ON notification_log(member_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notification_log_status
  ON notification_log(status, created_at);

-- Security notes:
-- 1) The payment receipt remains in the existing private document store; receipt_ref is metadata only.
-- 2) The QR contains a random opaque token. Store only its hash here; public verification must also
--    check current member approval and verified payment status.
-- 3) Do not store OTP values, password values, or full message bodies in notification_log.
-- 4) The 20/80 allocation should be calculated from verified payments and written to a separate,
--    auditable remittance ledger only after its accounting rules are reviewed.
