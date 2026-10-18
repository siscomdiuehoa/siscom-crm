# Checklist nghiệm thu B1.1

Điền kết quả **thật** từ máy của bạn. *Cập nhật 11/10/2026 theo báo cáo của người dùng tại `D:\SISCOM-CRM\backend` (Windows, PostgreSQL 18.6). Các mục chưa có kết quả được báo giữ nguyên trống — chưa được xác nhận.* Ô trống = chưa kiểm. Không ghi mật khẩu/URL kết nối.

| # | Hạng mục | Cách kiểm | Kết quả đúng | Kết quả của bạn (Đạt/Lỗi + ghi chú) |
|---|---|---|---|---|
| 1 | Node.js đúng phiên bản | `node -v`, `npm -v` | 24.x ≥ 24.11; npm ≥ 11.6 | |
| 2 | PostgreSQL hoạt động | `check-env.bat`; dịch vụ Running | Running, cổng 5432 listening | **Đạt** — PostgreSQL 18.6 hoạt động, kết nối thành công (người dùng báo). Trạng thái dịch vụ/cổng chưa báo chi tiết. |
| 3 | PostgreSQL chỉ cho nội bộ | `setup-db.bat` dòng `listen_addresses`; Firewall không mở 5432 | `localhost` | |
| 4 | Tài khoản ứng dụng không superuser | `setup-db.bat` dòng cuối | `superuser=false` | |
| 5 | Không dùng `postgres` để chạy CRM | Đổi tạm `.env` sang user `postgres` → khởi động backend | Backend từ chối khởi động, nêu rõ lý do (rồi **khôi phục** `.env`) | |
| 6 | Database UTF8 | `setup-db.bat` | `[OK] Ma hoa database: UTF8` | |
| 7 | Cài thư viện | `npm install` | không lỗi; có `package-lock.json` | **Đạt (suy ra)** — build chạy được nên thư viện đã cài; chưa xác nhận có `package-lock.json`. |
| 8 | Migration | `npm run db:migrate` rồi `npm run db:status` | đã áp dụng `20261011000000_init`; "Database schema is up to date" | **Đạt (suy ra)** — `schema.migrated: true`, `baseline: b1.1`; chưa báo kết quả `npm run db:status`. |
| 9 | Prisma kết nối | `/api/v1/health/database` | `database: up`, `schema.migrated: true` | **Đạt** — `database: up`, `latencyMs: 235`, `schema.migrated: true`. |
| 10 | Build backend | `npm run build` | không lỗi; có `dist\main.js` | **Đạt** — `dist\main.js` đã tạo (sau khi sửa lỗi cache incremental, xem ghi chú). |
| 11 | Backend khởi động | `npm run start:dev` | log "đang chạy tại http://127.0.0.1:3000/api/v1" | **Đạt** — `npm run start:dev` chạy, "Found 0 errors". |
| 12 | Health | `GET /api/v1/health` | 200, `status: ok`, có header `X-Request-Id` | **Đạt một phần** — `status: ok`, `service: siscom-crm-backend`, `version: 0.1.0`. Header `X-Request-Id` chưa xác nhận. |
| 13 | Health database | `GET /api/v1/health/database` | 200, `database: up` | **Đạt** — `status: ok`, `database: up`. |
| 14 | Ngắt DB → lỗi an toàn | Stop dịch vụ PostgreSQL, gọi lại | 503, `database: down`, thông báo chung, không lộ chi tiết; backend vẫn sống; `/health` vẫn ok | |
| 15 | Phục hồi sau khi bật lại DB | Start dịch vụ, gọi lại | 200 `up` (không cần khởi động lại backend) | |
| 16 | Đường dẫn lạ | `GET /api/v1/abc` | 404 JSON tiếng Việt, không có stack/đường dẫn file | |
| 17 | CORS | `npm run test:e2e` (hoặc DevTools từ trang khác) | chỉ `localhost:5173`/`127.0.0.1:5173` được phép | |
| 18 | e2e | `npm run test:e2e` | tất cả đạt | |
| 19 | Backend không lộ ra mạng | Từ máy khác trong LAN truy cập `http://<IP-máy>:3000` | không truy cập được | |
| 20 | Không có bí mật trong mã | Tìm `.env` trong thư mục dự án; `git status` (nếu dùng Git) | `.env` bị bỏ qua; `.env.example` chỉ có `CHANGE_ME…` | |
| 21 | Sao lưu | `backup-db.bat` | tạo `.dump` + `.sha256` trong `D:\SISCOM-CRM\db-backups`, báo số mục |  | |
| 22 | Frontend vẫn chạy | `npm run dev` ở frontend | giao diện bình thường | |
| 23 | Test B0 | `/tests/b0-repository.test.html` | 50 đạt · 0 lỗi | |
| 24 | Test trường tuỳ chọn | `/tests/customer-optional-fields.test.html` | 64 đạt · 0 lỗi | |
| 25 | localStorage cũ nguyên vẹn | DevTools → Application → Local Storage: `siscom-crm-db-v2` trước/sau | số khách hàng không đổi | |

Điểm cần kiểm chứng đặc biệt (xem `PRISMA7_NOTES.md`): #8, #9, #10.

**Chữ ký nghiệm thu:** ______________  Ngày: ____________

## Ghi chú sự cố đã xử lý
- **Build không tạo `dist\main.js`** (`start:dev` báo `MODULE_NOT_FOUND`): do cache `*.tsbuildinfo` của `incremental` nằm ngoài `dist` bị `nest build` xoá. Đã tắt `incremental`, thêm bước kiểm tra `dist\main.js` vào `npm run build`. Người dùng xác nhận build tạo đúng file sau khi sửa.

## Còn thiếu để nghiệm thu B1.1
Các mục **1, 3, 4, 5, 6, 12 (header), 14–25** chưa có kết quả. Đặc biệt cần: ngắt DB (14–15), CORS/e2e (17–18), không lộ ra mạng LAN (19), sao lưu (21), frontend + test B0 (22–25).
