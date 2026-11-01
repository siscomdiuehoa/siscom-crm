# Bằng chứng B1.4 Remember Me 90 ngày trên PostgreSQL tạm cách ly (2026-11-01)

| Mục | Giá trị |
|---|---|
| PR | #184 `feat/b1.4-remember-me-90d-v3` (Draft, chưa merge). File 01–04: working tree tương đương `ca476b2`; 05–06: sau QA bảo mật lần 1 (`f98745a`); 07: sau QA bảo mật lần 2 (`efa9212`); 08: sau QA bảo mật lần 3 (`8ae0a4d`); 09: sau QA lần 3b (`150f7b5`); 10: sau QA lần 3c (commit kế tiếp của `150f7b5`) |
| Môi trường | Cluster PostgreSQL **riêng** (`initdb` thư mục tạm, PostgreSQL 18, chỉ `127.0.0.1:55432`), huỷ sau khi kiểm. **Không** dùng server của owner (5432); không chạm `siscom_crm_dev`/baseline |
| Dữ liệu | Giả: DB `siscom_crm_test_<stamp>`, tài khoản bootstrap `*@siscom.local` / `*@e2e.siscom.local`, mật khẩu ngẫu nhiên (đã xoá). Ba role: `siscom_app`, `siscom_migrator`, `siscom_auth` |
| Đã loại bỏ | Chuỗi kết nối (`<url-da-che>`), mật khẩu, đường dẫn cục bộ (`<repo>/`), mã ANSI. Nhật ký HTTP chỉ có đường dẫn/mã, không cookie |

| File | Nội dung | Kết quả |
|---|---|---|
| `01_…` | DB A: migrate (app) → tách role → V2 (RED) → V3 ×2 → VERIFY/VERIFY_AUTH → rollback Remember Me → V3 → `migrate deploy` bằng migrator (SAU tách role) → VERIFY → V3 → M1 | V2 RED `FAIL|10` (bắt cả B1f); V3 ⇒ `PASS|73` / `PASS|33`; sau rollback `PASS|73`; sau migrate lại: VERIFY `FAIL|1` (**B1f** — quyền mặc định) ⇒ V3 ⇒ `PASS|73`/`PASS|33`; M1 `131/43/115`. Dòng kiểm cấu trúc trong file này là lượt ĐẦU (lỗi ở chính ca S20, đã sửa — xem `02`) |
| `02_…` | Kiểm cấu trúc Remember Me (bản trước QA bảo mật, 24 ca) | `PASS|24` |
| `03_…` | DB B: integration lượt 1 | 153/154 — ca "nhân viên nghỉ việc" dùng tài khoản admin cuối cùng nên trigger M1.1 `LAST_ADMIN` chặn đổi trạng thái (đúng thiết kế); test đổi sang kỹ thuật viên |
| `04_…` | DB C: integration 13 suite, 3 pool | **154/154** |
| `05_…` | Sau QA bảo mật lần 1 (I-1/I-2/I-3), DB G mới: kiểm cấu trúc (29 ca, gồm trigger `BEFORE INSERT`) → integration → rollback (có dữ liệu) → V3 → `migrate deploy` (migrator) → VERIFY bắt B1f → V3 | `PASS|29`; **155/155**; rollback xoá 5 thiết bị còn hiệu lực, `PASS|73`; B1f RED rồi `PASS|73`/`PASS|33` |
| `06_…` | Trình duyệt thật (Chromium trong app): đăng nhập có tích → thu hồi phiên ở DB → tải lại trang / thao tác giữa chừng | `/auth/me` 401 ⇒ `restore` 200 ⇒ dữ liệu khách hàng; giữa chừng: `customers` 401 ⇒ `restore` 200 ⇒ tự tải lại; JS không thấy `siscom_rmb`/`siscom_sid`; 1 family, cùng mốc 90 ngày |
| `07_…` | Sau QA bảo mật lần 2, DB H mới: kiểm cấu trúc + integration (gồm ca đua thu hồi/xoay vòng trên DB thật) | `PASS|29`; **156/156** |
| `08_…` | Sau QA bảo mật lần 3, cluster tạm dựng lại, DB I mới: kiểm cấu trúc + integration (gồm ca kẻ trộm tự thu hồi thiết bị rồi nạn nhân dùng lại token cũ) | `PASS|29`; **157/157** |
| `09_…` | Sau QA lần 3b (Important-A), cluster tạm dựng lại, DB J: kiểm cấu trúc + integration (nạn nhân đăng nhập lại, token cũ gửi lại không đăng xuất được, không audit lặp) | `PASS|29`; **157/157** |
| `10_…` | Sau QA lần 3c (mốc thu hồi gồm `rotated_at` muộn nhất, audit luôn ghi, FE timeout/reset), cluster tạm dựng lại, DB K | `PASS|29`; **157/157** |

Chưa chạy (NOT_RUN): harness Chrome 4 vai trò (`sessionRolesChrome.mjs`) với Remember Me; chế độ `NODE_ENV=production` + HTTPS (`COOKIE_SECURE=true`).
