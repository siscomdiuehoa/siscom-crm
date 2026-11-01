# Bằng chứng B1.4 — Remember Me câu 3: thu hồi thiết bị ⇒ thu hồi phiên đã khôi phục (2026-11-01)

**Quyết định owner (01/11/2026):** "Khi thu hồi một thiết bị, phiên đang hoạt động được khôi phục từ thiết bị đó cũng cần bị thu hồi. Mọi migration chỉ được thử trên PostgreSQL riêng, tuyệt đối không sửa database thật."

**Thiết kế:**
- Migration **chỉ cộng thêm** `20261101000000_b1_4_session_remember_family`: cột `auth_session.remember_family_id UUID NULL` + chỉ mục riêng phần `(remember_family_id) WHERE remember_family_id IS NOT NULL AND revoked_at IS NULL`. Không default, không ràng buộc mới ⇒ backend cũ vẫn chạy.
- Khôi phục phiên (`POST /auth/remember/restore`) ghi `remember_family_id` = family của thiết bị. Đăng nhập bằng mật khẩu để `NULL`.
- `DELETE /auth/remember/devices/:id` (thiết bị của chính mình): thu hồi thêm mọi phiên đang mở có `remember_family_id` = family đó (lý do `REMEMBER_DEVICE_REVOKED`), **kể cả phiên đang gửi yêu cầu** nếu nó được khôi phục từ chính thiết bị đó. Thiết bị của người khác / không tồn tại ⇒ 404, không thu hồi gì.
- `POST /auth/remember/revoke-all`: thu hồi thêm mọi phiên khôi phục (khác `NULL`) của chính mình; phiên đăng nhập bằng mật khẩu giữ nguyên.
- Quyền: `siscom_auth` đã có INSERT/UPDATE cấp bảng trên `auth_session` (V3) ⇒ không đổi V3; `siscom_app` vẫn không có quyền nào trên bảng.
- Rollback viết sẵn (không tự chạy): `backend/docs/B1.4_SESSION_REMEMBER_FAMILY_ROLLBACK.sql.txt`.

| File | Nội dung | Kết quả |
|---|---|---|
| `01_dien_tap_migration_rollback_pg_tam.txt` | PostgreSQL 18 **tạm cách ly** (cổng 55441, dữ liệu giả, đã xoá): migrate deploy → tách role + V3 → VERIFY/VERIFY_AUTH → kiểm cột/chỉ mục/quyền → drift `schema.prisma` → ROLLBACK → VERIFY → áp lại → VERIFY | **PASS** toàn bộ (VERIFY 73, VERIFY_AUTH 33 ở cả 3 lượt; drift 0) |

Test: backend unit **554 / 554** (mới 4 ca khối "Câu 3" trong `auth.remember.spec.ts`; 1 ca cũ "QA 3b Important-A" chỉnh để chỉ xét lời gọi REPLAY — hành vi nó kiểm không đổi). Tích hợp `test/auth.int-spec.ts` (4 ca mới: ghi cột khi khôi phục, DELETE một thiết bị, revoke-all, thiết bị người khác) chạy trong CI trên PostgreSQL tạm.

## Sau QA độc lập (2 Critical, 0 Important, 5 Minor)
- Critical 1 (đã sửa): diễn tập rollback trong CI chưa gỡ migration mới trước — thêm  đứng đầu cả hai chuỗi rollback (bằng  khi chưa tách role, bằng  sau tách role) ⇒ CI nay kiểm cả script rollback mới.
- Critical 2 (đã sửa): test tích hợp cũ "QA lần 3 Important-1" kỳ vọng phiên khôi phục vẫn 200 sau revoke-all — đổi thành 401 (đúng hành vi mới owner duyệt); bước REPLAY sau đó giữ nguyên.
- Minor (đã sửa): đăng xuất kèm cookie ghi nhớ và đăng nhập không tích trên thiết bị còn cookie cũ (LOGIN_NO_REMEMBER) cũng thu hồi phiên đã khôi phục từ thiết bị đó (kịch bản kẻ trộm khôi phục trước, nạn nhân đăng xuất). Test unit 2 ca + tích hợp 1 ca.
- Minor ghi nhận (không sửa): thiết bị bị hệ thống tự thu hồi do vượt 5 thiết bị (FAMILY_REVOKED) không kéo theo phiên — phiên tự hết hạn ≤ 8–12 giờ; cột  chưa có trigger chống sửa (chỉ role  có quyền UPDATE — nếu bị chiếm thì đã mất toàn quyền); thu hồi phiên đang gửi yêu cầu không trả tín hiệu riêng cho giao diện (yêu cầu kế tiếp nhận 401 và về màn hình đăng nhập).
- Backend unit sau sửa: **556 / 556**.

**Chưa áp** lên database thật, DB demo 55433 hay `siscom_crm_dev`. Áp lên DB nào cũng cần owner duyệt riêng; DB đã tách role: `demo-split -Step migrate` (migrate bằng `siscom_migrator` rồi chạy lại V3 + VERIFY).
