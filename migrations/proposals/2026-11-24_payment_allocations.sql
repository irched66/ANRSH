-- ANRSH DIGITAL — Payment allocation ledger
-- PROPOSAL ONLY: do not execute against D1 until the live schema has been inspected
-- and this migration has been explicitly approved.
-- The Worker inserts one immutable allocation after a payment is verified.
-- Existing payment/member records are not modified or deleted.

CREATE TABLE IF NOT EXISTS payment_allocations (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL UNIQUE,
  member_id TEXT NOT NULL,
  bureau TEXT NOT NULL,
  membership_year INTEGER NOT NULL,
  gross_amount_dzd INTEGER NOT NULL CHECK (gross_amount_dzd > 0),
  national_share_dzd INTEGER NOT NULL CHECK (national_share_dzd >= 0),
  regional_share_dzd INTEGER NOT NULL CHECK (regional_share_dzd >= 0),
  allocated_at INTEGER NOT NULL,
  CHECK (gross_amount_dzd = national_share_dzd + regional_share_dzd),
  CHECK (national_share_dzd = CAST(gross_amount_dzd * 20 / 100 AS INTEGER)),
  CHECK (regional_share_dzd = gross_amount_dzd - national_share_dzd),
  FOREIGN KEY (payment_id) REFERENCES member_payments(id),
  FOREIGN KEY (member_id) REFERENCES members(id)
);

CREATE INDEX IF NOT EXISTS idx_payment_allocations_bureau_date
  ON payment_allocations (bureau, allocated_at);

CREATE INDEX IF NOT EXISTS idx_payment_allocations_member_year
  ON payment_allocations (member_id, membership_year);
