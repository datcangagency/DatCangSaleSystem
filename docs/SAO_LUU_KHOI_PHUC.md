# Sao lưu và khôi phục

## Dữ liệu
- Admin vào tab **Tài khoản** → **Tải bản sao lưu** → file `DatCang_SaoLuu_<ngày-giờ>.sql`. Nên tải mỗi tuần, lưu trên máy (G:), KHÔNG đưa lên GitHub/Drive (có thông tin khách, mật khẩu đã băm).
- Khôi phục vào database D1 mới/rỗng: tạo D1, chạy `migrations/*.sql`, rồi chạy file `.sql` sao lưu (D1 Console hoặc `wrangler d1 execute DB --remote --file=...`). File tự xóa danh mục mặc định trước khi nạp lại.
- Đã thử khôi phục trên bản local: số khách, lịch sử, tài khoản, danh mục khớp.
- Cloudflare Time Travel (gói free) chỉ giữ 7 ngày: không thay thế bản sao lưu này.

## Mã nguồn
- Nguồn chính: GitHub `datcangagency/DatCangSaleSystem`. Bản local: thư mục `DatCangSaleSystem` (git clone đầy đủ) trong Agent Phoenix 8.0.
- Triển khai lại: Cloudflare Workers Builds tự chạy khi push vào `main`; hoặc `npx wrangler deploy`.
