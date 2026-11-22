-- ANRSH REV4 — public visitor counters for the landing page.
-- Additive migration only. Apply to an isolated staging D1 database first.
-- Do NOT apply to production before backup and review.
-- The Worker hashes browser visitor IDs before storage; no raw ID or personal data is stored.

CREATE TABLE IF NOT EXISTS anrsh_site_visitors (
  visitor_hash TEXT PRIMARY KEY,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS anrsh_site_daily_visitors (
  visit_day TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  PRIMARY KEY (visit_day, visitor_hash),
  FOREIGN KEY (visitor_hash) REFERENCES anrsh_site_visitors(visitor_hash)
);

CREATE INDEX IF NOT EXISTS idx_anrsh_site_daily_visitors_day
  ON anrsh_site_daily_visitors(visit_day);
