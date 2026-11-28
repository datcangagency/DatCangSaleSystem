-- Tách giai đoạn Proposal: thêm "Khách chờ Proposal", đổi "Đã gửi proposal/báo giá" thành "Đã gửi Proposal", thêm cột link Proposal.
-- Chỉ chạy MỘT lần (ALTER TABLE không chạy lại được). Trên bản thật: chạy file này TRƯỚC khi đưa mã mới lên.
ALTER TABLE leads ADD COLUMN link_proposal TEXT NOT NULL DEFAULT '';
UPDATE catalog SET ord = ord + 1 WHERE kind = 'giai_doan' AND ord >= (SELECT ord FROM catalog WHERE kind = 'giai_doan' AND value = 'Đã gửi proposal/báo giá');
INSERT OR IGNORE INTO catalog(kind, value, ord) SELECT 'giai_doan', 'Khách chờ Proposal', ord - 1 FROM catalog WHERE kind = 'giai_doan' AND value = 'Đã gửi proposal/báo giá';
UPDATE catalog SET value = 'Đã gửi Proposal' WHERE kind = 'giai_doan' AND value = 'Đã gửi proposal/báo giá';
UPDATE leads SET giai_doan = 'Đã gửi Proposal' WHERE giai_doan = 'Đã gửi proposal/báo giá';
UPDATE stage_history SET tu = 'Đã gửi Proposal' WHERE tu = 'Đã gửi proposal/báo giá';
UPDATE stage_history SET den = 'Đã gửi Proposal' WHERE den = 'Đã gửi proposal/báo giá';
