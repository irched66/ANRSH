-- ANRSH DIGITAL: configurable annual membership fee.
-- Apply once to the production D1 database before deploying the matching Worker.
CREATE TABLE IF NOT EXISTS anrsh_platform_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  fee_dzd INTEGER NOT NULL CHECK (fee_dzd BETWEEN 1 AND 1000000),
  updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)),
  updated_by TEXT NOT NULL DEFAULT 'system'
);

INSERT OR IGNORE INTO anrsh_platform_settings (id, fee_dzd, updated_by)
VALUES (1, 500, 'initial_default');
