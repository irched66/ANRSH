-- ANRSH DIGITAL — allow variable membership fees in the finance ledger.
-- Apply ONLY after backing up the production D1 database and confirming migration 006 was applied.
-- This rebuild preserves existing finance rows; existing 500 DZD records remain unchanged.

CREATE TABLE anrsh_membership_finance_new (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL UNIQUE,
  request_ref TEXT NOT NULL UNIQUE,
  bureau TEXT NOT NULL,
  wilaya TEXT,
  member_name TEXT NOT NULL,
  demand_type TEXT,
  fee_amount INTEGER NOT NULL CHECK (fee_amount BETWEEN 1 AND 1000000),
  national_rate INTEGER NOT NULL DEFAULT 20 CHECK (national_rate = 20),
  national_amount INTEGER NOT NULL,
  regional_rate INTEGER NOT NULL DEFAULT 80 CHECK (regional_rate = 80),
  regional_amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'DZD',
  payment_status TEXT NOT NULL DEFAULT 'confirmed' CHECK (payment_status = 'confirmed'),
  payment_confirmed_at TEXT NOT NULL,
  confirmed_by TEXT NOT NULL DEFAULT 'national_admin',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (national_amount = CAST((fee_amount * 20 + 50) / 100 AS INTEGER)),
  CHECK (regional_amount = fee_amount - national_amount),
  FOREIGN KEY (member_id) REFERENCES members(id)
);

INSERT INTO anrsh_membership_finance_new (
  id, member_id, request_ref, bureau, wilaya, member_name, demand_type,
  fee_amount, national_rate, national_amount, regional_rate, regional_amount,
  currency, payment_status, payment_confirmed_at, confirmed_by, created_at
)
SELECT
  id, member_id, request_ref, bureau, wilaya, member_name, demand_type,
  fee_amount, national_rate, national_amount, regional_rate, regional_amount,
  currency, payment_status, payment_confirmed_at, confirmed_by, created_at
FROM anrsh_membership_finance;

DROP TABLE anrsh_membership_finance;
ALTER TABLE anrsh_membership_finance_new RENAME TO anrsh_membership_finance;

CREATE INDEX IF NOT EXISTS idx_anrsh_finance_bureau_date
  ON anrsh_membership_finance(bureau, payment_confirmed_at);
CREATE INDEX IF NOT EXISTS idx_anrsh_finance_date
  ON anrsh_membership_finance(payment_confirmed_at);
