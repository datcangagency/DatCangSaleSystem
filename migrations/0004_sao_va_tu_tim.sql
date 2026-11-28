-- Đổi tên "Mình tự tìm" thành "Tự tìm"; lead đã có SĐT được tối thiểu 1 sao.
-- Cột uu_tien (0..3) đã có sẵn nên không đổi cấu trúc bảng. Chạy lại nhiều lần không sao.
UPDATE catalog SET value = 'Tự tìm' WHERE kind = 'cach_sdt' AND value = 'Mình tự tìm';
UPDATE leads SET cach_sdt = 'Tự tìm' WHERE cach_sdt = 'Mình tự tìm';
UPDATE leads SET uu_tien = 1 WHERE uu_tien < 1 AND sdt <> '';
