-- ANRSH DIGITAL TEST ONLY — fresh D1 base schema
-- Target: anrsh-test-db ONLY. Never run against production database "anrsh".
-- The regional_offices table is intentionally empty; add only approved test offices.
-- Latin official names are used as temporary FR/EN labels; Tamazight labels are blank pending verified translations.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS anrsh_platform_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  fee_dzd INTEGER NOT NULL DEFAULT 500 CHECK (fee_dzd = 500),
  updated_at INTEGER,
  updated_by TEXT
);
INSERT OR IGNORE INTO anrsh_platform_settings (id, fee_dzd) VALUES (1, 500);

CREATE TABLE IF NOT EXISTS wilayas (
  code TEXT PRIMARY KEY,
  name_ar TEXT NOT NULL,
  name_fr TEXT NOT NULL,
  name_en TEXT NOT NULL,
  name_tz TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
);

CREATE TABLE IF NOT EXISTS regional_offices (
  bureau TEXT PRIMARY KEY,
  office_name TEXT NOT NULL,
  president_name TEXT,
  president_phone TEXT,
  email TEXT,
  address TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS office_wilayas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bureau TEXT NOT NULL,
  wilaya_code TEXT NOT NULL,
  wilaya_name TEXT,
  UNIQUE (bureau, wilaya_code),
  FOREIGN KEY (bureau) REFERENCES regional_offices(bureau),
  FOREIGN KEY (wilaya_code) REFERENCES wilayas(code)
);

CREATE TABLE IF NOT EXISTS offices (
  bureau TEXT PRIMARY KEY,
  bank_name TEXT,
  rib TEXT,
  ccp TEXT,
  ccp_key TEXT,
  updated_by TEXT,
  updated_at INTEGER,
  FOREIGN KEY (bureau) REFERENCES regional_offices(bureau)
);

CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  ref TEXT NOT NULL UNIQUE,
  bureau TEXT,
  name TEXT,
  phone TEXT,
  profile TEXT,
  files TEXT,
  status TEXT NOT NULL DEFAULT 'pending_payment',
  otp_hash TEXT,
  otp_exp INTEGER,
  otp_tries INTEGER NOT NULL DEFAULT 0,
  ip TEXT,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER,
  actor TEXT,
  action TEXT,
  target TEXT
);

CREATE TABLE IF NOT EXISTS anrsh_site_visitors (
  visitor_hash TEXT PRIMARY KEY,
  first_seen INTEGER,
  last_seen INTEGER
);

CREATE TABLE IF NOT EXISTS anrsh_site_daily_visitors (
  visit_day TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  PRIMARY KEY (visit_day, visitor_hash)
);

-- One clearly labelled dummy office enables safe end-to-end testing; it is not a real ANRSH office.
INSERT OR IGNORE INTO regional_offices
  (bureau, office_name, president_name, president_phone, email, address, active, created_at, updated_at)
VALUES
  ('TEST-01', 'مكتب تجريبي - الجزائر العاصمة', 'مسؤول تجريبي', NULL, NULL, 'بيانات اختبار فقط', 1, unixepoch(), unixepoch());
INSERT OR IGNORE INTO office_wilayas (bureau, wilaya_code, wilaya_name)
VALUES ('TEST-01', '16', 'الجزائر');

-- Official Arabic names and Latin source labels for the 69 wilayas in the supplied 2026 dataset.
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('01','أدرار','Adrar','Adrar','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('02','الشلف','Chlef','Chlef','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('03','الأغواط','Laghouat','Laghouat','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('04','أم البواقي','Oum El Bouaghi','Oum El Bouaghi','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('05','باتنة','Batna','Batna','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('06','بجاية','Bejaia','Bejaia','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('07','بسكرة','Biskra','Biskra','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('08','بشار','Bechar','Bechar','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('09','البليدة','Blida','Blida','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('10','البويرة','Bouira','Bouira','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('11','تمنراست','Tamanrasset','Tamanrasset','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('12','تبسة','Tebessa','Tebessa','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('13','تلمسان','Tlemcen','Tlemcen','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('14','تيارت','Tiaret','Tiaret','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('15','تيزي وزو','Tizi Ouzou','Tizi Ouzou','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('16','الجزائر','Alger','Alger','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('17','الجلفة','Djelfa','Djelfa','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('18','جيجل','Jijel','Jijel','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('19','سطيف','Setif','Setif','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('20','سعيدة','Saida','Saida','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('21','سكيكدة','Skikda','Skikda','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('22','سيدي بلعباس','Sidi Bel Abbes','Sidi Bel Abbes','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('23','عنابة','Annaba','Annaba','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('24','قالمة','Guelma','Guelma','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('25','قسنطينة','Constantine','Constantine','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('26','المدية','Medea','Medea','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('27','مستغانم','Mostaganem','Mostaganem','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('28','المسيلة','M''Sila','M''Sila','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('29','معسكر','Mascara','Mascara','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('30','ورقلة','Ouargla','Ouargla','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('31','وهران','Oran','Oran','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('32','البيض','El Bayadh','El Bayadh','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('33','إليزي','Illizi','Illizi','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('34','برج بوعريريج','Bordj Bou Arreridj','Bordj Bou Arreridj','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('35','بومرداس','Boumerdes','Boumerdes','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('36','الطارف','El Tarf','El Tarf','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('37','تندوف','Tindouf','Tindouf','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('38','تسمسيلت','Tissemsilt','Tissemsilt','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('39','الوادي','El Oued','El Oued','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('40','خنشلة','Khenchela','Khenchela','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('41','سوق أهراس','Souk Ahras','Souk Ahras','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('42','تيبازة','Tipaza','Tipaza','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('43','ميلة','Mila','Mila','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('44','عين الدفلى','Ain Defla','Ain Defla','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('45','النعامة','Naama','Naama','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('46','عين تموشنت','Ain Temouchent','Ain Temouchent','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('47','غرداية','Ghardaia','Ghardaia','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('48','غليزان','Relizane','Relizane','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('49','تيميمون','Timimoun','Timimoun','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('50','برج باجي مختار','Bordj Badji Mokhtar','Bordj Badji Mokhtar','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('51','أولاد جلال','Ouled Djellal','Ouled Djellal','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('52','بني عباس','Beni Abbes','Beni Abbes','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('53','عين صالح','In Salah','In Salah','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('54','عين قزام','In Guezzam','In Guezzam','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('55','تقرت','Touggourt','Touggourt','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('56','جانت','Djanet','Djanet','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('57','المغير','El M''Ghair','El M''Ghair','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('58','المنيعة','El Meniaa','El Meniaa','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('59','أفلو','Aflou','Aflou','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('60','بريكة','Barika','Barika','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('61','القنطرة','El Kantara','El Kantara','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('62','بئر العاتر','Bir El Ater','Bir El Ater','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('63','العريشة','El Aricha','El Aricha','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('64','قصر الشلالة','Ksar Chellala','Ksar Chellala','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('65','عين وسارة','Ain Oussara','Ain Oussara','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('66','مسعد','Messaad','Messaad','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('67','قصر البخاري','Ksar El Boukhari','Ksar El Boukhari','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('68','بوسعادة','Bou Saada','Bou Saada','',1);
INSERT OR IGNORE INTO wilayas (code,name_ar,name_fr,name_en,name_tz,active) VALUES ('69','الأبيض سيدي الشيخ','El Abiodh Sidi Cheikh','El Abiodh Sidi Cheikh','',1);
CREATE INDEX IF NOT EXISTS idx_members_status_created ON members(status, created_at);
CREATE INDEX IF NOT EXISTS idx_members_bureau_created ON members(bureau, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit(at);
