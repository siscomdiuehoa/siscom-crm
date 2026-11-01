# Bằng chứng diễn tập runbook demo Windows (2026-11-01)

| Mục | Giá trị |
|---|---|
| Runbook | `docs/B1.4_DEMO_WINDOWS_RUNBOOK.md`; script `backend/scripts/windows/create-test-db.ps1`, `auth-demo-stack.ps1`, `demo-split.ps1` (working tree của PR, base `main` `d963543`) |
| Môi trường | Cluster PostgreSQL 18 **riêng** (`initdb` thư mục tạm, chỉ `127.0.0.1:55432`), huỷ sau khi kiểm. Không dùng server của owner (5432); không chạm `siscom_crm_dev`/baseline |
| Trạng thái ban đầu | Giống máy owner: chỉ có role `siscom_app` và DB `siscom_crm_dev_canary` thuộc `siscom_app` (thay cho `siscom_crm_dev`, để kiểm tách role không đụng DB khác) |
| Dữ liệu | Giả: tài khoản `*@demo.siscom.local`, mật khẩu ngẫu nhiên (đã xoá); mật khẩu role do script sinh, file `roles-55432.secrets` đã xoá |
| Đã loại bỏ | Chuỗi kết nối, mật khẩu, đường dẫn/tên người dùng cục bộ, mã ANSI |

| File | Nội dung | Kết quả |
|---|---|---|
| `01_…` | create-test-db → auth-demo-stack migrate/seed/bootstrap → demo-split split (×2, idempotent) → demo-split migrate → các ca phải từ chối (seed trên DB đã tách; tên `siscom_crm_dev`) → chủ sở hữu DB → auth-demo-stack start + health → harness Chrome | Mọi bước `ma thoat: 0` trừ 2 ca từ chối có chủ đích; VERIFY `PASS|73`, VERIFY_AUTH `PASS|33` (3 lần); canary **giữ** chủ sở hữu `siscom_app`; health `authPool=separate`, `leastPrivilege=true`, `authLeastPrivilege=true`; Chrome **91 PASS / 0 FAIL / 0 KNOWN** |
| `02_…` | JSON bằng chứng harness Chrome 4 vai trò (chỉ tên/thuộc tính cookie, không giá trị) | 91/0/0 |
| `03_…` | **Lượt 2 sau QA PR #185** (cluster dựng mới): split khi **chưa seed** ⇒ từ chối trước khi ghi (chủ sở hữu vẫn `siscom_app`); seed + bootstrap ⇒ split đạt; split lần 2 (đăng nhập thử mật khẩu role); file mật khẩu **sai** ⇒ từ chối, chưa ghi gì; log máy chủ ghi DDL ⇒ `resetpw` từ chối; `resetpw` (log an toàn) ⇒ đặt lại + đăng nhập thử; split sau resetpw; migrate DB đã tách; verify; seed trên DB đã tách và tên `siscom_crm_dev`/baseline ⇒ từ chối; ACL file mật khẩu chỉ tài khoản hiện tại; start (mật khẩu mới) + health; harness Chrome | Đúng mọi kỳ vọng; VERIFY `PASS|73`, VERIFY_AUTH `PASS|33`; canary giữ `siscom_app`; health `authPool=separate`; Chrome **91/0/0** |
| `04_…` | JSON harness lượt 2 | 91/0/0 |
| `05_…` | **Lượt 3 sau QA lần 2** (cluster dựng mới), ghi **mã thoát thật của từng script** (khung diễn tập lưu `$LASTEXITCODE` ngay sau script chính): như lượt 2 + `ALTER DATABASE <DB> SET log_statement = ddl` ⇒ split (tạo role) từ chối trước khi ghi; từ chối do thiếu seed **không** để lại file mật khẩu | 19 bước đúng kỳ vọng (các ca từ chối mã 1, còn lại 0); VERIFY `PASS|73`, VERIFY_AUTH `PASS|33`; canary giữ `siscom_app`; health `authPool=separate`; Chrome **91/0/0** |
| `06_…` | JSON harness lượt 3 | 91/0/0 |

Lỗi tìm thấy khi diễn tập lượt 1 và đã sửa trước commit đầu: file mật khẩu role bị ghi gộp thành một dòng (ưu tiên toán tử dấu phẩy trong PowerShell) ⇒ lần chạy thứ hai không đọc được mật khẩu; đã sửa và chạy lại toàn bộ trên cluster dựng mới (file `01` là lượt chạy lại).

**Đính chính (QA lần 2, I-A):** trong file `03`, ca 9 (log máy chủ ghi DDL ⇒ `resetpw` từ chối) in `[LOI]` đúng nhưng dòng `##### ma thoat: 0` là mã thoát của lệnh `psql` khôi phục cấu hình chạy sau đó (lỗi của khung diễn tập, không phải của script). File `05` chạy lại với khung đã sửa: ca này ghi đúng mã thoát `1`.
