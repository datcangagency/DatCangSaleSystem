-- Dat Cang Sale System: luoc do D1 (SQLite). Khong chua du lieu that.
CREATE TABLE users (
  username TEXT PRIMARY KEY, ten TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('Admin','QLDA','Sale')),
  salt TEXT NOT NULL, hash TEXT NOT NULL, iters INTEGER NOT NULL,
  must_change INTEGER NOT NULL DEFAULT 1, fails INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, username TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE catalog (kind TEXT NOT NULL, value TEXT NOT NULL, ord INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (kind, value));
CREATE TABLE counters (key TEXT PRIMARY KEY, n INTEGER NOT NULL);
CREATE TABLE leads (
  ma TEXT PRIMARY KEY, ngay_nhan TEXT NOT NULL, ten TEXT NOT NULL,
  sdt TEXT NOT NULL DEFAULT '', link TEXT NOT NULL DEFAULT '', link_key TEXT NOT NULL DEFAULT '',
  nguon TEXT NOT NULL, cach_sdt TEXT NOT NULL DEFAULT '', sale TEXT NOT NULL,
  giai_doan TEXT NOT NULL, ngay_doi_gd INTEGER NOT NULL, muc_tiem_nang TEXT NOT NULL DEFAULT 'Chưa phân loại',
  tom_luoc TEXT NOT NULL DEFAULT '', loai_viec TEXT NOT NULL DEFAULT '', hanh_dong TEXT NOT NULL DEFAULT '',
  ngay_hd TEXT NOT NULL DEFAULT '', gia_tri REAL, ly_do TEXT NOT NULL DEFAULT '', ghi_chu TEXT NOT NULL DEFAULT '',
  uu_tien INTEGER NOT NULL DEFAULT 0, ngay_co_sdt INTEGER,
  tao_luc INTEGER NOT NULL, sua_boi TEXT NOT NULL, sua_luc INTEGER NOT NULL
);
CREATE UNIQUE INDEX ux_lead_sdt ON leads(sdt) WHERE sdt <> '';
CREATE UNIQUE INDEX ux_lead_link ON leads(link_key) WHERE link_key <> '';
CREATE INDEX ix_lead_sale ON leads(sale);
CREATE INDEX ix_lead_order ON leads(uu_tien DESC, tao_luc DESC);
CREATE TABLE stage_history (id INTEGER PRIMARY KEY AUTOINCREMENT, ma TEXT NOT NULL, tu TEXT NOT NULL, den TEXT NOT NULL, luc INTEGER NOT NULL, boi TEXT NOT NULL, ghi_chu TEXT NOT NULL DEFAULT '');
CREATE INDEX ix_hist_ma ON stage_history(ma);
CREATE TABLE audit (id INTEGER PRIMARY KEY AUTOINCREMENT, luc INTEGER NOT NULL, usr TEXT NOT NULL, action TEXT NOT NULL, obj TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '');
