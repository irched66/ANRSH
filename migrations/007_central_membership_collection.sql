-- ANRSH DIGITAL — Centralized membership collection policy
-- Apply ONLY to the isolated staging D1 first. Back up before any production migration.
-- Preserve the old 20/80 ledger unchanged for historical audit; start the new 100/0 ledger.

ALTER TABLE anrsh_membership_finance
  RENAME TO anrsh_membership_finance_legacy_006;

DROP INDEX IF EXISTS idx_anrsh_finance_bureau_date;
DROP INDEX IF EXISTS idx_anrsh_finance_date;

CREATE TABLE anrsh_membership_finance (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL UNIQUE,
  request_ref TEXT NOT NULL UNIQUE,
  bureau TEXT NOT NULL,
  wilaya TEXT,
  member_name TEXT NOT NULL,
  demand_type TEXT,
  fee_amount INTEGER NOT NULL DEFAULT 500 CHECK (fee_amount = 500),
  national_rate INTEGER NOT NULL DEFAULT 100 CHECK (national_rate = 100),
  national_amount INTEGER NOT NULL DEFAULT 500 CHECK (national_amount = 500),
  regional_rate INTEGER NOT NULL DEFAULT 0 CHECK (regional_rate = 0),
  regional_amount INTEGER NOT NULL DEFAULT 0 CHECK (regional_amount = 0),
  currency TEXT NOT NULL DEFAULT 'DZD',
  payment_status TEXT NOT NULL DEFAULT 'confirmed' CHECK (payment_status = 'confirmed'),
  payment_confirmed_at TEXT NOT NULL,
  confirmed_by TEXT NOT NULL DEFAULT 'national_admin',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (member_id) REFERENCES members(id)
);

CREATE INDEX idx_anrsh_finance_bureau_date
  ON anrsh_membership_finance(bureau, payment_confirmed_at);

CREATE INDEX idx_anrsh_finance_date
  ON anrsh_membership_finance(payment_confirmed_at);

-- Regional transfer records from the former allocation model remain untouched
-- for historical traceability. The new ledger accrues no regional share.
