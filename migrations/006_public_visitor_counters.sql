-- ANRSH DIGITAL — public visitor counters (D1)
-- Additive migration. Creates only the two analytics tables used by
-- GET /api/public-stats and POST /api/visitor-visit.
-- Review and apply to a STAGING D1 database first.
-- Do not run against production until the backup and deployment plan are approved.

CREATE TABLE IF NOT EXISTS anrsh_site_visitors (
  visitor_hash TEXT PRIMARY KEY NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS anrsh_site_daily_visitors (
  visit_day TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  PRIMARY KEY (visit_day, visitor_hash)
);

CREATE INDEX IF NOT EXISTS idx_anrsh_site_daily_visitors_day
  ON anrsh_site_daily_visitors (visit_day);
