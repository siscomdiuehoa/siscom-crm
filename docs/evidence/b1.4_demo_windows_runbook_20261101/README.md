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

Lỗi tìm thấy khi diễn tập và đã sửa trước khi commit: file mật khẩu role bị ghi gộp thành một dòng (ưu tiên toán tử dấu phẩy trong PowerShell) ⇒ lần chạy thứ hai không đọc được mật khẩu; đã sửa và chạy lại toàn bộ trên cluster dựng mới (file `01` là lượt chạy lại).
