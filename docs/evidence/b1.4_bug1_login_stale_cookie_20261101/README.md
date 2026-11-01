# Bằng chứng B1.4 — Sửa BUG-1: đăng nhập bị chặn khi còn cookie phiên đã chết (2026-11-01)

**Lỗi:** `CsrfOriginGuard` coi mọi request ghi có cookie `siscom_sid` là "đang có phiên" ⇒ bắt buộc phiên còn sống + `X-CSRF-Token`. Khi phiên đã chết phía server (thu hồi do đổi mật khẩu ở nơi khác, khoá, phát hiện phát lại token ghi nhớ, dựng DB demo mới…) mà cookie vẫn còn, `POST /auth/login` trả **403 CSRF_FAILED**, giao diện báo "Đăng nhập thất bại." và người dùng không đăng nhập lại được tới khi cookie hết hạn (≤ 8 giờ) hoặc tự xoá cookie. Phát hiện khi kiểm thử Remember Me trên Chrome (bằng chứng `docs/evidence/b1.4_demo_isolated_pg_20261101/`, mục BUG-1).

**Sửa (owner duyệt trong chat 2026-11-01, phương án hẹp):** decorator mới `@LoginEndpoint()` chỉ gắn cho `POST /auth/login`. Với route này, nếu có cookie nhưng tra **không thấy phiên còn sống** ⇒ xử lý như chưa có cookie (Origin kiểm nếu trình duyệt gửi — y như lần đăng nhập đầu). **Phiên còn sống giữ nguyên** kiểm Origin + `X-CSRF-Token`. Các route khác không đổi (cookie phiên chết vẫn 403). Provider không phải phiên thật ⇒ vẫn 403 (fail-closed).

| File | Nội dung | Kết quả |
|---|---|---|
| (test đơn vị) `csrf-origin.guard.spec.ts` | 6 ca mới: phiên chết + Origin hợp lệ qua; Origin lạ/"null" 403; không Origin qua (như không cookie); phiên sống thiếu/sai CSRF 403, đủ qua; route khác vẫn 403; provider giả 403 | **15 / 15**; đã kiểm tắt nhánh sửa ⇒ 2 ca đỏ |
| (test tích hợp, chạy trong CI trên PostgreSQL tạm) `test/auth.int-spec.ts` | cookie rác / cookie của phiên đã đăng xuất ⇒ đăng nhập đúng 200 (cookie mới), sai 401 LOGIN_INVALID; phiên sống + thiếu CSRF ⇒ 403, có CSRF ⇒ 200 | xem CI của PR |
| `01_chrome_remember_me_bug1.txt/.json` + `01_rmbChrome.mjs` | Chrome thật trên bản demo (cụm 55433, backend + web build từ nhánh này): sau khi chuỗi ghi nhớ bị thu hồi (REPLAY) cookie phiên chết vẫn còn ⇒ đăng nhập sai trả 401 (không còn 403); **đăng nhập thật qua giao diện khi vẫn còn cookie chết** thành công | **PASS 24 / FAIL 0 / KNOWN 0** (trước sửa: R4.4 KNOWN) |
| `02_chrome_hoi_quy_4_vai_tro.txt/.json` | Hồi quy `sessionRolesChrome.mjs` (đăng nhập, quyền 4 vai trò, khách hàng, CSRF, đổi mật khẩu) | **PASS 91 / FAIL 0 / KNOWN 0** |

## Sau QA bảo mật độc lập (0 Critical, 0 Important, 3 Minor)
- Minor 1 đã sửa: route đăng nhập có Origin lạ bị từ chối **trước** khi tra phiên (không truy vấn DB, không gia hạn idle) — test mới, thấy đỏ trước khi sửa.
- Minor 2 (đăng nhập lại khi phiên còn sống không thu hồi phiên cũ) và Minor 3 (hai cookie siscom_sid trùng tên => coi như không cookie) có từ trước, PR không đổi; ghi nhận chờ owner.
- Tài liệu thiết kế  ghi ngoại lệ .
- CI trên e376dff (trước sửa Minor 1): 5/5 xanh, gồm 2 ca tích hợp mới trên PostgreSQL tạm.

Backend unit toàn bộ: **550 / 550** (sau sửa Minor 1). Không đổi database, migration, API trả về, frontend. Không chạm `siscom_crm_dev` / PostgreSQL 5432.
Runbook: dòng sự cố BUG-1 cập nhật "đã sửa".
