-- ANRSH DIGITAL — Prevent duplicate wilaya assignments across regional offices
-- PROPOSAL ONLY: inspect the live table and reconcile any duplicate rows before applying.
-- Do not delete or silently reassign existing office/wilaya records.
-- Preflight query:
-- SELECT wilaya_code, COUNT(*) AS assignment_count
-- FROM office_wilayas GROUP BY wilaya_code HAVING COUNT(*) > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_office_wilayas_wilaya_code
  ON office_wilayas (wilaya_code);
