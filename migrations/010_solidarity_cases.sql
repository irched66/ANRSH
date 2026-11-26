-- ANRSH DIGITAL: public solidarity cases with private, revocable contributor keys.
-- Apply to anrsh-staging only after confirming previous migrations and taking a staging backup.
CREATE TABLE IF NOT EXISTS anrsh_solidarity_cases (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  assistance_type TEXT NOT NULL,
  wilaya TEXT NOT NULL,
  public_contact TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','published','closed','rejected')),
  expires_at TEXT,
  contributor_key_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_anrsh_solidarity_public
  ON anrsh_solidarity_cases(status, expires_at, created_at);

CREATE TABLE IF NOT EXISTS anrsh_solidarity_keys (
  id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'case:submit',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_anrsh_solidarity_keys_active
  ON anrsh_solidarity_keys(key_hash, revoked_at, expires_at);

CREATE TABLE IF NOT EXISTS anrsh_solidarity_audit (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  case_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
