# Đất Cảng – Quản lý khách (Sale, doanh thu, hợp đồng, thực thi)

Hệ thống nội bộ của Đất Cảng. **Repo này chỉ chứa mã nguồn, không chứa dữ liệu khách, mật khẩu hay khóa.**

## Kiến trúc (hướng C, đề xuất ngày 27/11/2026)
- Cloudflare Worker (`src/index.js`) phục vụ cả API (`/api/*`) và giao diện (`public/`).
- Dữ liệu trong Cloudflare D1 (SQLite), lược đồ ở `migrations/`.
- Đăng nhập riêng của công ty (PBKDF2, khóa sau 5 lần sai, phiên 6 giờ), nhật ký thao tác trong bảng `audit`.
- `legacy-apps-script/`: bản thử cũ trên Google Apps Script + Google Trang tính (chỉ để tham khảo).

## Chạy thử cục bộ
```
npm install
echo "SETUP_KEY=khoa-thu" > .dev.vars        # file này không lên Git
npx wrangler d1 migrations apply dat-cang-sale-db --local
npx wrangler dev --local --port 8799
SETUP_KEY=khoa-thu node test/api.test.mjs                 # 51 ca API
JSDOM_PATH=<duong dan jsdom> node test/ui.test.mjs        # 21 ca giao diện
```

## Triển khai
Kết nối repo với Cloudflare (Workers Builds); đặt secret `SETUP_KEY` trong bảng điều khiển Cloudflare; gọi `POST /api/khoiTao` một lần để tạo tài khoản `admin`.

## Lưu ý
- Workers gói miễn phí giới hạn 10 ms CPU mỗi yêu cầu: số vòng PBKDF2 (`PBKDF2_ITERS`) phải đo lại trên môi trường thật.
- D1 gói miễn phí không tự sao lưu dài hạn: cần xuất dữ liệu định kỳ.
