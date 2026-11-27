-- Hop dong, dot thu tien (ke hoach), thu tien thuc te, su kien thuc thi
CREATE TABLE contracts (
  ma TEXT PRIMARY KEY, lead_ma TEXT NOT NULL DEFAULT '', khach TEXT NOT NULL, sale TEXT NOT NULL,
  loai TEXT NOT NULL CHECK (loai IN ('Theo gói','Theo thời hạn')),
  ngay_ky TEXT NOT NULL DEFAULT '', so_thang INTEGER NOT NULL DEFAULT 0, ngay_het TEXT NOT NULL DEFAULT '',
  cam_ket INTEGER NOT NULL DEFAULT 0, don_vi TEXT NOT NULL DEFAULT '',
  gia_tri REAL NOT NULL DEFAULT 0, ke_hoach TEXT NOT NULL DEFAULT 'mot_lan',
  trang_thai TEXT NOT NULL DEFAULT 'Đang thực hiện', can_xac_nhan INTEGER NOT NULL DEFAULT 0,
  ghi_chu TEXT NOT NULL DEFAULT '', tao_luc INTEGER NOT NULL, sua_boi TEXT NOT NULL, sua_luc INTEGER NOT NULL
);
CREATE INDEX ix_hd_sale ON contracts(sale);
CREATE INDEX ix_hd_lead ON contracts(lead_ma);
CREATE TABLE dot_thu (id INTEGER PRIMARY KEY AUTOINCREMENT, hd_ma TEXT NOT NULL, dot INTEGER NOT NULL, ty_le REAL NOT NULL, so_tien REAL NOT NULL, han TEXT NOT NULL);
CREATE INDEX ix_dot_hd ON dot_thu(hd_ma);
CREATE TABLE thu_tien (id INTEGER PRIMARY KEY AUTOINCREMENT, hd_ma TEXT NOT NULL, ngay TEXT NOT NULL, so_tien REAL NOT NULL, ghi_chu TEXT NOT NULL DEFAULT '', boi TEXT NOT NULL, luc INTEGER NOT NULL);
CREATE INDEX ix_thu_hd ON thu_tien(hd_ma);
CREATE INDEX ix_thu_ngay ON thu_tien(ngay);
CREATE TABLE thuc_thi (id INTEGER PRIMARY KEY AUTOINCREMENT, hd_ma TEXT NOT NULL, ngay TEXT NOT NULL, loai TEXT NOT NULL, so_luong INTEGER NOT NULL DEFAULT 0, noi_dung TEXT NOT NULL DEFAULT '', boi TEXT NOT NULL, luc INTEGER NOT NULL);
CREATE INDEX ix_tt_hd ON thuc_thi(hd_ma);
CREATE INDEX ix_ky_ngay ON contracts(ngay_ky);
