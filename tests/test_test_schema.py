from pathlib import Path
import sqlite3
import unittest

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "migrations" / "test"

class TestIsolatedSchema(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db = sqlite3.connect(":memory:")
        cls.db.execute("PRAGMA foreign_keys = ON")
        for migration in sorted(MIGRATIONS.glob("*.sql")):
            cls.db.executescript(migration.read_text(encoding="utf-8"))

    def test_seeded_wilayas_and_fee(self):
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM wilayas").fetchone()[0], 69)
        self.assertEqual(self.db.execute("SELECT fee_dzd FROM anrsh_platform_settings WHERE id=1").fetchone()[0], 500)

    def test_only_dummy_office_is_seeded(self):
        row = self.db.execute("SELECT bureau, office_name FROM regional_offices").fetchone()
        self.assertEqual(row[0], "TEST-01")
        self.assertIn("تجريبي", row[1])

    def test_archive_preserves_financial_ledger(self):
        self.db.execute(
            """INSERT INTO members (id, ref, bureau, name, status, created_at)
               VALUES ('m-1', 'R-1', 'TEST-01', 'عضو اختبار', 'pending_payment', 1)"""
        )
        self.db.execute(
            """INSERT INTO anrsh_membership_finance
               (id, member_id, request_ref, bureau, member_name, payment_confirmed_at)
               VALUES ('f-1', 'm-1', 'R-1', 'TEST-01', 'عضو اختبار', '2026-11-25 12:00:00')"""
        )
        self.db.execute(
            "UPDATE members SET status='archived', otp_hash=NULL, otp_exp=NULL, otp_tries=0 WHERE id='m-1'"
        )
        self.assertEqual(self.db.execute("SELECT status FROM members WHERE id='m-1'").fetchone()[0], "archived")
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM anrsh_membership_finance WHERE member_id='m-1'").fetchone()[0], 1)

    def test_regional_auth_tables_exist(self):
        names = {r[0] for r in self.db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        self.assertTrue({
            "anrsh_office_accounts",
            "anrsh_office_activation_tokens",
            "anrsh_office_sessions",
            "anrsh_regional_transfers",
            "audit",
        }.issubset(names))

if __name__ == "__main__":
    unittest.main()
