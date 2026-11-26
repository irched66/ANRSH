import sqlite3
from pathlib import Path

root = Path(__file__).resolve().parents[1]
migrations = root / "migrations"

archive_migrations = [
    p for p in migrations.glob("*.sql")
    if "CREATE TABLE IF NOT EXISTS member_adhesion_archive" in p.read_text(encoding="utf-8")
]
assert len(archive_migrations) == 1, f"Expected one canonical archive migration, found: {[p.name for p in archive_migrations]}"
assert archive_migrations[0].name == "009_member_adhesion_archive.sql"

db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys = ON")
db.executescript("""
CREATE TABLE members (id TEXT PRIMARY KEY);
CREATE TABLE regional_offices (bureau TEXT PRIMARY KEY);
CREATE TABLE anrsh_membership_finance (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL UNIQUE,
  request_ref TEXT NOT NULL UNIQUE,
  bureau TEXT NOT NULL,
  wilaya TEXT,
  member_name TEXT NOT NULL,
  demand_type TEXT,
  fee_amount INTEGER NOT NULL DEFAULT 500,
  national_rate INTEGER NOT NULL,
  national_amount INTEGER NOT NULL,
  regional_rate INTEGER NOT NULL,
  regional_amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'DZD',
  payment_status TEXT NOT NULL,
  payment_confirmed_at TEXT NOT NULL,
  confirmed_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(member_id) REFERENCES members(id)
);
CREATE INDEX idx_anrsh_finance_bureau_date ON anrsh_membership_finance(bureau, payment_confirmed_at);
CREATE INDEX idx_anrsh_finance_date ON anrsh_membership_finance(payment_confirmed_at);
""")

db.executescript((migrations / "007_central_membership_collection.sql").read_text(encoding="utf-8"))
db.execute("INSERT INTO members(id) VALUES ('m500'), ('m700'), ('mbad')")
db.execute("""INSERT INTO anrsh_membership_finance
(id,member_id,request_ref,bureau,member_name,fee_amount,national_rate,national_amount,regional_rate,regional_amount,payment_status,payment_confirmed_at)
VALUES ('f500','m500','r500','NATIONAL','Test 500',500,100,500,0,0,'confirmed','2026-11-26')""")
db.execute("""INSERT INTO anrsh_membership_finance
(id,member_id,request_ref,bureau,member_name,fee_amount,national_rate,national_amount,regional_rate,regional_amount,payment_status,payment_confirmed_at)
VALUES ('f700','m700','r700','NATIONAL','Test 700',700,100,700,0,0,'confirmed','2026-11-26')""")
try:
    db.execute("""INSERT INTO anrsh_membership_finance
    (id,member_id,request_ref,bureau,member_name,fee_amount,national_rate,national_amount,regional_rate,regional_amount,payment_status,payment_confirmed_at)
    VALUES ('fbad','mbad','rbad','NATIONAL','Bad',700,100,500,0,0,'confirmed','2026-11-26')""")
except sqlite3.IntegrityError as error:
    assert "national_amount = fee_amount" in str(error), f"Unexpected constraint failure: {error}"
else:
    raise AssertionError("Finance ledger accepted an inconsistent national amount")

for name in ("008_regional_office_auth.sql", "009_member_adhesion_archive.sql"):
    db.executescript((migrations / name).read_text(encoding="utf-8"))

assert db.execute("SELECT COUNT(*) FROM anrsh_membership_finance_legacy_006").fetchone()[0] == 0
assert db.execute("SELECT COUNT(*) FROM anrsh_membership_finance").fetchone()[0] == 2
assert db.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='member_adhesion_archive'").fetchone()[0] == 1
print("PASS: staging migrations preserve legacy ledger, support 500/700 DZD, reject inconsistent allocations, and create regional/archive schema.")
