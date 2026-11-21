-- ANRSH D1 supporting migration
-- Safe to run more than once. Existing members/offices/wilayas tables are not modified.

CREATE TABLE IF NOT EXISTS anrsh_site_visitors (
  visitor_hash TEXT PRIMARY KEY,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS anrsh_site_daily_visitors (
  visit_day TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  PRIMARY KEY (visit_day, visitor_hash)
);

CREATE INDEX IF NOT EXISTS idx_members_ref
  ON members(ref);

CREATE INDEX IF NOT EXISTS idx_members_status_created
  ON members(status, created_at);
