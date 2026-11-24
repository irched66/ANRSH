-- ANRSH DIGITAL — Regional-office transfer ledger
-- PROPOSAL ONLY: do not execute against D1 until reviewed and explicitly approved.
-- This table records transfers from the National Office to regional offices.
-- It does not create, update, or delete member/payment records.

CREATE TABLE IF NOT EXISTS anrsh_regional_transfers (
  id TEXT PRIMARY KEY,
  bureau TEXT NOT NULL,
  amount_dzd INTEGER NOT NULL CHECK (amount_dzd > 0),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL CHECK (period_end >= period_start),
  transfer_date TEXT NOT NULL,
  bank_reference TEXT NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  UNIQUE (bureau, bank_reference)
);

CREATE INDEX IF NOT EXISTS idx_anrsh_regional_transfers_period
  ON anrsh_regional_transfers (bureau, period_start, period_end);

CREATE INDEX IF NOT EXISTS idx_anrsh_regional_transfers_date
  ON anrsh_regional_transfers (bureau, transfer_date);
