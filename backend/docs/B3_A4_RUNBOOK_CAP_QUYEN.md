# B3 A4 — Runbook cấp 9 mã quyền `activity.*` cho DB đã bootstrap (demo 55433 / thật)

**Chưa chạy trên DB nào.** Chỉ chạy khi anh phê duyệt riêng (A9), sau khi A2 (migration B3) và A3 (APP_GRANTS_V4) đã áp lên DB đó và đã sao lưu + thử khôi phục (`demo-backup` / `demo-restore-test`, PR #206).

## Vì sao không dùng bootstrap
Bootstrap đã đóng vĩnh viễn trên DB demo/thật ⇒ `role_permission` chỉ nhận dòng mới qua **yêu cầu đặc quyền 2 người** (M1.2). Ma trận `BIZ` trong `bootstrap.ts` chỉ dùng cho DB mới tinh; unit test `activity-permissions.spec.ts` giữ `BIZ` và script SQL luôn trùng nhau.

## Các bước (trên bản sao trước, rồi demo)
1. Lấy 2 uuid: **người yêu cầu** = nhân viên giữ vai trò `admin` (sysadmin, nhóm REQUEST), **người duyệt** = nhân viên giữ `crm_admin` (`access.approve`). Hai người khác nhau, `employee.status = ACTIVE`, credential ACTIVE.
   ```sql
   SELECT e.id, e.full_name, r.code FROM employee e JOIN employee_role er ON er.employee_id = e.id JOIN role r ON r.id = er.role_id WHERE r.code IN ('admin','crm_admin') AND e.status = 'ACTIVE';
   ```
2. Chạy bằng `siscom_migrator` (các hàm `fn_auth_api_*` đã REVOKE FROM PUBLIC):
   ```bash
   psql -X -v ON_ERROR_STOP=1 -v b3_sysadmin=<uuid> -v b3_approver=<uuid> -d <db> -f backend/docs/B3_ACTIVITY_PERMISSIONS.sql.txt
   ```
   Kỳ vọng bảng tóm tắt: `ma_activity 9`, `dong_crm_admin 6`, `dong_sales 5`, `dong_technician 4`, `dong_accountant 1`, `dong_admin 0`, `tong_dong_activity 16`. Chạy lại cho cùng kết quả (bỏ qua dòng đã có, không tạo thêm yêu cầu).
3. Kiểm: đăng nhập lại 4 vai trò (phiên cũ không tự nhận quyền mới cho tới khi `SessionActorProvider` nạp lại — đăng xuất/đăng nhập), `GET /auth/me` phải thấy khoá `activity.*` tương ứng.
4. **Rollback** (anh duyệt riêng): `B3_ACTIVITY_PERMISSIONS_REMOVE.sql.txt` cùng tham số — gỡ từng dòng qua yêu cầu `REMOVE` rồi xoá 9 mã. Không đụng vai trò/quyền khác.

## Đã diễn tập ở đâu
CI: `B3_ACTIVITY_PERMISSIONS_TEST.sql.txt` (`res migrator`, trước bootstrap, 1 transaction ROLLBACK): ADD → 9 mã/16 dòng/scope/audit → ADD lần 2 idempotent → SoD (admin không nhận BIZ) → REMOVE sạch.
