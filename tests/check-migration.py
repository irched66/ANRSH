import sqlite3
from pathlib import Path

db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys = ON")
db.executescript("""
CREATE TABLE admin_users (id TEXT PRIMARY KEY);
CREATE TABLE members (id TEXT PRIMARY KEY);
CREATE TABLE office_wilayas (bureau TEXT NOT NULL, wilaya_code TEXT NOT NULL, wilaya_name TEXT, UNIQUE(bureau,wilaya_code));
""")
sql = Path("migrations/2026-11-21-security-phase-1-proposal.sql").read_text(encoding="utf-8")
db.executescript(sql)
db.execute("INSERT INTO admin_users(id) VALUES ('admin-test')")
db.execute("INSERT INTO members(id) VALUES ('member-test')")
db.execute("""INSERT INTO member_payments
(id,member_id,member_ref,bureau,membership_year,amount_dzd,currency,payment_method,receipt_ref,status,reviewed_by,reviewed_at,created_at)
VALUES ('payment-test','member-test','ANR-TEST','bureau-test',2026,500,'DZD','other','receipt-test','verified','admin-test',1790000000000,1790000000000)""")
db.execute("""INSERT INTO payment_allocations
(id,payment_id,member_id,bureau,membership_year,gross_amount_dzd,national_share_dzd,regional_share_dzd,allocated_at)
VALUES ('allocation-test','payment-test','member-test','bureau-test',2026,500,100,400,1790000000000)""")
assert db.execute("SELECT national_share_dzd,regional_share_dzd FROM payment_allocations").fetchone() == (100,400)
db.execute("""INSERT INTO member_card_tokens(id,member_id,token_hash,active,issued_at)
VALUES ('card-test','member-test','hash-test',1,1790000000000)""")
db.execute("""INSERT INTO quarterly_reports
(id,bureau,report_year,quarter,generated_at,period_start,period_end,payload_json,status)
VALUES ('report-test','bureau-test',2026,1,1790000000000,'2026-01-01','2026-03-31','{}','generated')""")
db.execute("""INSERT INTO notification_log
(id,recipient,channel,event_type,status,created_at)
VALUES ('notice-test','admin@example.invalid','email','quarterly_report','sent',1790000000000)""")
# The same wilaya cannot be assigned to a second regional office.
db.execute("INSERT INTO office_wilayas(bureau,wilaya_code,wilaya_name) VALUES ('office-a','16','Alger')")
try:
    db.execute("INSERT INTO office_wilayas(bureau,wilaya_code,wilaya_name) VALUES ('office-b','16','Alger')")
    raise AssertionError("Global wilaya uniqueness constraint did not reject a duplicate")
except sqlite3.IntegrityError:
    pass

assert db.execute("PRAGMA foreign_key_check").fetchall() == []
print("D1 proposal migration passed SQLite schema, FK, payment allocation, card, report and notification checks.")
