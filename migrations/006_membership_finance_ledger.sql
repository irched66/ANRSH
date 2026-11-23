-- ANRSH DIGITAL — Membership finance ledger (additive migration)
-- Apply this migration to the production D1 database only after taking a backup.
-- Amounts are recorded only when the authenticated national office confirms payment.

CREATE TABLE IF NOT EXISTS anrsh_membership_finance (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL UNIQUE,
  request_ref TEXT NOT NULL UNIQUE,
  bureau TEXT NOT NULL,
  wilaya TEXT,
  member_name TEXT NOT NULL,
  demand_type TEXT,
  fee_amount INTEGER NOT NULL DEFAULT 500 CHECK (fee_amount = 500),
  national_rate INTEGER NOT NULL DEFAULT 20 CHECK (national_rate = 20),
  national_amount INTEGER NOT NULL DEFAULT 100 CHECK (national_amount = 100),
  regional_rate INTEGER NOT NULL DEFAULT 80 CHECK (regional_rate = 80),
  regional_amount INTEGER NOT NULL DEFAULT 400 CHECK (regional_amount = 400),
  currency TEXT NOT NULL DEFAULT 'DZD',
  payment_status TEXT NOT NULL DEFAULT 'confirmed' CHECK (payment_status = 'confirmed'),
  payment_confirmed_at TEXT NOT NULL,
  confirmed_by TEXT NOT NULL DEFAULT 'national_admin',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (member_id) REFERENCES members(id)
);

CREATE INDEX IF NOT EXISTS idx_anrsh_finance_bureau_date
  ON anrsh_membership_finance(bureau, payment_confirmed_at);

CREATE INDEX IF NOT EXISTS idx_anrsh_finance_date
  ON anrsh_membership_finance(payment_confirmed_at);

CREATE TABLE IF NOT EXISTS anrsh_regional_transfers (
  id TEXT PRIMARY KEY,
  bureau TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  transfer_date TEXT NOT NULL,
  bank_reference TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by TEXT NOT NULL DEFAULT 'national_admin'
);

CREATE INDEX IF NOT EXISTS idx_anrsh_transfers_bureau_date
  ON anrsh_regional_transfers(bureau, transfer_date);
