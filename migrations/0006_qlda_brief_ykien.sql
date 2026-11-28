-- QLDA phụ trách, link Brief (ở lead; hợp đồng không gắn lead thì lưu ở hợp đồng) và ý kiến khách trước ký.
-- Chỉ chạy MỘT lần (ALTER TABLE không chạy lại được). Trên bản thật: chạy file này TRƯỚC khi đưa mã mới lên.
ALTER TABLE leads ADD COLUMN qlda TEXT NOT NULL DEFAULT '';
ALTER TABLE leads ADD COLUMN link_brief TEXT NOT NULL DEFAULT '';
ALTER TABLE contracts ADD COLUMN qlda TEXT NOT NULL DEFAULT '';
ALTER TABLE contracts ADD COLUMN link_brief TEXT NOT NULL DEFAULT '';
CREATE TABLE y_kien (id INTEGER PRIMARY KEY AUTOINCREMENT, lead_ma TEXT NOT NULL, ngay TEXT NOT NULL, giai_doan TEXT NOT NULL, muc TEXT NOT NULL, ghi_chu TEXT NOT NULL DEFAULT '', boi TEXT NOT NULL, luc INTEGER NOT NULL);
CREATE INDEX ix_yk_lead ON y_kien(lead_ma);
INSERT OR IGNORE INTO catalog(kind, value, ord) VALUES ('lan_tan','Giá/ngân sách',1),('lan_tan','Nội dung đề xuất',2),('lan_tan','Thời điểm',3),('lan_tan','Niềm tin',4),('lan_tan','Đang so sánh bên khác',5),('lan_tan','Khác',6);
