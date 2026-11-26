-- ANRSH DIGITAL — Immutable member adhesion snapshots
-- Private archive records are accessible only to National Office or the matching regional office.

CREATE TABLE IF NOT EXISTS member_adhesion_archive (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  member_ref TEXT NOT NULL,
  bureau TEXT,
  snapshot TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_member_adhesion_archive_member
  ON member_adhesion_archive(member_id, created_at DESC);
