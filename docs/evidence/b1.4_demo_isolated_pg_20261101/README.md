# Bằng chứng B1.4 — bản demo trên cụm PostgreSQL 18 riêng (Windows, 2026-11-01)

Máy owner (Windows 11), worktree `D:\SISCOM-CRM-demo2`, nhánh `ops/b1.4-demo-isolated-pg` (gốc `main` 765d30c). Cụm demo: `D:\SISCOM-CRM-demo-pg\data`, `127.0.0.1:55433`, `cluster_name = siscom_demo`.
**Không** có lệnh nào kết nối hay ghi vào PostgreSQL cổng 5432 (`siscom_crm_dev`, baseline). Tên người dùng Windows được che (`<WINUSER>`); không có mật khẩu trong các file này (đã quét mẫu 64-hex và hậu tố mật khẩu tài khoản).

| File | Nội dung | Kết quả |
|---|---|---|
| `00_demo-setup_run1_FAIL_env-bug.txt` | Lần chạy `demo-setup` đầu tiên | **FAIL** ở bước 4: `demo-pg init` ghi `demo-55433.env` thành MỘT dòng (lỗi ưu tiên dấu phẩy PowerShell `@('a' + $x, 'b')`). Đã sửa ở `demo-pg.ps1` (+ chỗ tương tự trong `demo-setup.ps1`). File env của cụm 55433 (đã init trước khi sửa) được Claude **ghi lại bằng tay** đúng 2 dòng từ `pg-55433.secrets` (cùng ACL theo SID; lệnh chỉ in bản che mật khẩu) — không có file bằng chứng riêng cho thao tác này; bằng chứng script đã sửa là file 06. DB `siscom_crm_test_20261101_095918` tạo rỗng ở lần này còn nằm trên cụm demo (vô hại) |
| `01_demo-setup_run.txt` | `demo-setup.ps1 -Yes` lần 2: start cụm → tạo DB `siscom_crm_test_20261101_100155` → migrate (7 migration) → seed 23 danh mục → bootstrap 5 tài khoản → tách role | **PASS** (mã 0), `VERIFY PASS\|73`, `VERIFY_AUTH PASS\|33`. Các dòng `NativeCommandError` quanh "Loaded Prisma config" là do cách bắt log (`*>` của PowerShell 5.1 bọc stderr của Prisma), không phải lỗi |
| `02_demo-run.txt` | `demo-run.ps1 -NoBrowser` | **PASS**: backend 3100 + web 4173; health `authPool=separate`, `leastPrivilege=true`, `authLeastPrivilege=true` |
| `03_guard_port5432.txt` | 6 script với `-PgPort 5432` | **PASS**: cả 6 trả mã 1. "Trước khi gọi `psql`" là theo đọc mã (QA độc lập xác nhận `Assert-DemoPort` đứng trước mọi lệnh psql); số kết nối TCP trước/sau chỉ là ảnh chụp tham khảo, không phải bằng chứng |
| `04_guard_cluster_label.txt` | Cụm TẠM 55432 không nhãn (initdb trong scratchpad, đã huỷ) | **PASS**: `create-test-db`, `auth-demo-stack`, `demo-split` đều mã 1 với thông báo sai `cluster_name`; không DB nào được tạo |
| `05_chrome_4roles.txt/.json` | `sessionRolesChrome.mjs` (Chrome thật headless) trên bản demo: đăng nhập, ma trận quyền 4 vai trò, khách hàng (tạo/xem/sửa theo phạm vi), CSRF, đổi mật khẩu | **PASS 91 / FAIL 0 / KNOWN 0** |
| `06_demo-pg_init_envfix_55434.txt` | `demo-pg init` thật trên cụm thử 55434 (sau khi sửa) | **PASS**: env 2 dòng, nhãn `siscom_demo`; cụm thử + file secrets/env của nó đã xoá |
| `07_chrome_remember_me.txt/.json` + `07_rmbChrome.mjs` (kịch bản, chạy tay, không thuộc test tự động) | Remember Me trong Chrome thật: không tích ⇒ không cookie; tích ⇒ `siscom_rmb` HttpOnly/SameSite=Lax/Path=/api/v1/auth, hạn 90 ngày, JS không đọc được, 1 thiết bị; mất phiên + F5 ⇒ tự vào lại, token xoay vòng, không kéo dài mốc 90 ngày; phát lại token cũ sau 10 giây ⇒ 401 + phiên đang mở bị thu hồi + cả chuỗi chết; đăng xuất ⇒ xoá ghi nhớ; thu hồi thiết bị ⇒ không tự vào; restore thiếu header ⇒ 403 | **PASS 22 / FAIL 0 / KNOWN 1** (R4.4, lỗi BUG-1 dưới) |

### Sau QA độc lập (commit sửa QA, 0 Critical / 2 Important / 8 Minor)
| File | Nội dung | Kết quả |
|---|---|---|
| `08_qa_fixes_guards.txt` | I-1: `demo-pg start/stop` trên thư mục giả không nhãn / nhãn đúng nhưng `port = 5432` / `postmaster.pid` cổng 5432 ⇒ từ chối; `status` với tên ngắn 8.3 của thư mục data dịch vụ ⇒ từ chối; cụm demo thật `status` vẫn chạy. I-2: cổng không có file mật khẩu ⇒ `create-test-db`, `demo-split` từ chối, không dùng `SISCOM_PG_ADMIN_PASSWORD`. M-3: `demo-run` qua chốt ký tự đường dẫn. Chạy lại bài cụm không nhãn + bài 5432. `demo-pg init` cụm thử 55434: thư mục data và file bí mật chỉ 1 quy tắc ACL (SID hiện tại), không kế thừa | **PASS** toàn bộ (mọi lần từ chối mã 1) |
| `09_demo-setup_after_qa.txt` | `demo-setup -Yes` sau sửa: DB `siscom_crm_test_20261101_103435` | **PASS**, `VERIFY PASS\|73`, `VERIFY_AUTH PASS\|33`; file tài khoản ACL 1 quy tắc |
| `10_chrome_4roles_after_qa.txt/.json` | Chrome 4 vai trò trên DB mới (backend khởi động lại bằng `demo-run`) | **PASS 91 / FAIL 0 / KNOWN 0** |
| `11_chrome_remember_me_after_qa.txt/.json` | Remember Me Chrome trên DB mới | **PASS 22 / FAIL 0 / KNOWN 1** (BUG-1) |

Minor chưa sửa (ghi nhận, chờ owner): M-1 kiểm nhãn và lệnh ghi dùng hai kết nối khác nhau (cùng host/cổng; cần một tiến trình khác chiếm cổng đúng giữa hai lệnh); M-2 `init` dừng giữa chừng phải dọn tay (runbook mục 7 đã ghi cách dọn); M-5 `CREATE ROLE ... PASSWORD` có thể vào log máy chủ nếu chính câu lệnh đó lỗi (`log_min_error_statement`); cụm demo 55433 hiện tại được init TRƯỚC khi thêm ACL thư mục data (thư mục kế thừa ACL của `D:\`; init lại để có ACL riêng).

### Các lần chạy Remember Me trước lần cuối (ghi đúng sự thật)
1. R1–R4 đạt; R5 dừng vì "Quá nhiều lần thử": hạn mức đăng nhập 5 lần / 15 phút / (nguồn + tài khoản), tính cả lần đúng (thiết kế đã nghiệm thu, không đổi); `sale` đã đăng nhập nhiều lần trong bài 05. Sửa kịch bản: R5 dùng `ketoan`, R6 dùng `kythuat`, `sale` đăng nhập bằng mã `NV-0003`.
2. R1–R4 đạt; R5 "Đăng nhập thất bại." — bắt phản hồi: `POST /auth/login` **403 CSRF_FAILED** ⇒ phát hiện **BUG-1**.
3. R4.2 lỗi `Failed to fetch` (trang đang tự điều hướng khi kịch bản gọi fetch; hai lần trước cùng bước đều đạt) ⇒ kịch bản thử lại 1 lần khi fetch bị ngắt. Lần 4 (file 07) đạt.

### BUG-1 (Important, CHƯA sửa — chờ owner quyết vì chạm guard CSRF đã nghiệm thu)
`CsrfOriginGuard`: request ghi có cookie `siscom_sid` ⇒ bắt buộc phiên còn sống + `X-CSRF-Token`. Khi phiên đã chết phía server nhưng cookie còn trong trình duyệt, `POST /auth/login` bị **403 CSRF_FAILED**, giao diện báo "Đăng nhập thất bại." và người dùng **không đăng nhập lại được** cho tới khi cookie hết hạn (Max-Age = 8 giờ tính từ lúc đăng nhập) hoặc tự xoá cookie. Tái hiện bằng API trên bản demo: cùng yêu cầu đăng nhập sai mật khẩu, không cookie ⇒ `401 LOGIN_INVALID`; có cookie `siscom_sid` giả/chết ⇒ `403 CSRF_FAILED`.
Khi nào gặp (phiên bị thu hồi phía server trong lúc cookie còn hạn): đổi mật khẩu trên thiết bị/trình duyệt khác; bị khoá hoặc thu hồi phiên; phát hiện phát lại token ghi nhớ; **dựng DB demo mới (`demo-setup` lần nữa) trong khi Chrome còn cookie của DB cũ**. Hết hạn nhàn rỗi thông thường KHÔNG gây lỗi (cookie hết hạn cùng lúc). Người đã tích ghi nhớ vẫn bị nếu chuỗi ghi nhớ cũng đã bị thu hồi.
Xử lý tạm cho demo: Chrome → F12 → Application → Cookies → `http://127.0.0.1:4173` → xoá `siscom_sid` (hoặc xoá dữ liệu trang 127.0.0.1:4173), rồi đăng nhập lại.
Phương án sửa đề xuất (cần owner duyệt, PR riêng): (a) `POST /auth/login` chỉ kiểm Origin như khi không có cookie, bỏ qua cookie phiên — đăng nhập không dựa vào phiên cũ; hoặc (b) guard: có cookie nhưng phiên không còn sống ⇒ xử lý như không có cookie (kiểm Origin nếu có). (a) phạm vi hẹp nhất.

Chưa kiểm chứng: các bước nhập tay (gõ `TAO-DEMO`, mở Chrome có giao diện bằng `demo-run` không `-NoBrowser`), đóng/mở lại Chrome thật (checklist mục 7), cài trên máy khác.
