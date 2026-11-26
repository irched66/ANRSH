-- ANRSH DIGITAL — Regional office authentication schema
-- Apply to isolated staging D1 only. The parent regional_offices table must exist.

CREATE TABLE IF NOT EXISTS anrsh_office_accounts (
  bureau TEXT PRIMARY KEY,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_iterations INTEGER NOT NULL DEFAULT 210000,
  activated_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (bureau) REFERENCES regional_offices(bureau) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS anrsh_office_activation_tokens (
  bureau TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (bureau) REFERENCES regional_offices(bureau) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS anrsh_office_sessions (
  token_hash TEXT PRIMARY KEY,
  bureau TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  FOREIGN KEY (bureau) REFERENCES regional_offices(bureau) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_anrsh_office_sessions_bureau_expiry
  ON anrsh_office_sessions(bureau, expires_at);

CREATE INDEX IF NOT EXISTS idx_anrsh_office_sessions_expiry
  ON anrsh_office_sessions(expires_at);
