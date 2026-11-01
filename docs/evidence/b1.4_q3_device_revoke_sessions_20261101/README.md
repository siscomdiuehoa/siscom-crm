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
- Critical 1 (đã sửa): diễn tập rollback trong CI chưa gỡ migration mới trước — thêm `B1.4_SESSION_REMEMBER_FAMILY_ROLLBACK` đứng đầu cả hai chuỗi rollback (bằng `siscom_app` khi chưa tách role, bằng `siscom_migrator` sau tách role) ⇒ CI nay kiểm cả script rollback mới.
- Critical 2 (đã sửa): test tích hợp cũ "QA lần 3 Important-1" kỳ vọng phiên khôi phục vẫn 200 sau revoke-all — đổi thành 401 (đúng hành vi mới owner duyệt); bước REPLAY sau đó giữ nguyên.
- Minor (đã sửa): đăng xuất kèm cookie ghi nhớ và đăng nhập không tích trên thiết bị còn cookie cũ (LOGIN_NO_REMEMBER) cũng thu hồi phiên đã khôi phục từ thiết bị đó (kịch bản kẻ trộm khôi phục trước, nạn nhân đăng xuất). Test: logout — unit 2 ca + tích hợp 1 ca; LOGIN_NO_REMEMBER — unit 1 ca + tích hợp 1 ca (bổ sung sau rà soát độc lập 2026-11-01, xem mục dưới).
- Minor ghi nhận (không sửa): thiết bị bị hệ thống tự thu hồi do vượt 5 thiết bị (FAMILY_REVOKED) không kéo theo phiên — phiên tự hết hạn ≤ 8–12 giờ; cột `remember_family_id` chưa có trigger chống sửa (chỉ role `siscom_auth` có quyền UPDATE — nếu bị chiếm thì đã mất toàn quyền); thu hồi phiên đang gửi yêu cầu không trả tín hiệu riêng cho giao diện (yêu cầu kế tiếp nhận 401 và về màn hình đăng nhập).
- Backend unit sau sửa: **556 / 556**.

## Sau rà soát bảo mật độc lập lần 2 (2026-11-01, trước khi trình merge): 0 Critical, 0 Important, 3 Minor, 3 Note
- Minor 1 (đã sửa): nhánh login không tích (LOGIN_NO_REMEMBER) thu hồi phiên đã khôi phục chưa có assertion — thêm 1 ca unit (kiểm đúng `where {employeeId, rememberFamilyId, revokedAt: null}`; đã xác nhận ca này **đỏ** khi tạm bỏ nhánh thu hồi) + 1 ca tích hợp (kẻ trộm restore trước, nạn nhân đăng nhập không tích ⇒ phiên kẻ trộm 401, lý do `REMEMBER_DEVICE_REVOKED`, phiên mới của nạn nhân 200).
- Minor 2 (ghi nhận, chờ owner): đăng nhập bằng mật khẩu của A trên trình duyệt còn cookie ghi nhớ của B ⇒ family + phiên khôi phục của B bị thu hồi nhưng chỉ có audit `auth.login_ok` của A (hành vi thu hồi token người khác có từ PR #184; nay thêm phiên). Không leo thang quyền (ai cầm token của B đã khôi phục được phiên của B). Phương án: ghi thêm audit cho chủ thiết bị, hoặc chỉ thu hồi token thuộc chính người đăng nhập — cần owner quyết.
- Minor 3 (đã sửa): test "QA lần 3 Important-1" sau khi đổi kỳ vọng 401 không còn chứng minh REPLAY thu hồi phiên (phiên đã chết từ revoke-all) — thêm assertion `revoke_reason = REMEMBER_DEVICE_REVOKED` và sửa chú thích; REPLAY vẫn được chứng minh ở test "QA I-2".
- Note (đã sửa chú thích): khối REPLAY vẫn thu hồi theo phạm vi rộng (`issuedAt <= mốc`), không thu hẹp theo `remember_family_id` — an toàn (tập bao), thu hẹp là quyết định riêng.
- Note (ghi nhận): phiên đang gọi `DELETE /devices/:id` hoặc `revoke-all` nếu chính nó được khôi phục từ family đó thì bị thu hồi, phản hồi vẫn 200 và cookie `siscom_sid` không bị xoá ⇒ yêu cầu kế tiếp 401 (frontend đã xử lý 401 về màn hình đăng nhập).
- Note (ghi nhận, việc sau): cột `remember_family_id` chưa nằm trong danh sách cột bất biến của trigger `fn_sess_before_update` — phòng thủ chiều sâu, cần migration riêng.

## Sau rà soát độc lập lần 3 (phiên AI riêng, 2026-11-01): 0 Critical, 1 Important (quy trình CI), 5 Minor, 5 Note
- I-1 (đã xử lý): CI của PR chạy trước khi PR #191 (RELOGIN) vào `main` ⇒ CI chạy lại trên merge-ref với `main` 0db5deb (5/5) và thêm test tích hợp **kịch bản gộp RELOGIN + câu 3** (trình duyệt giữ phiên khôi phục S2 + cookie ghi nhớ; đăng nhập lại bằng mật khẩu không tích ⇒ S2 `RELOGIN` + audit, phiên khôi phục khác S1 `REMEMBER_DEVICE_REVOKED`, family `LOGIN_NO_REMEMBER`). Test này cần mã RELOGIN của `main`, nên chỉ đạt trên merge-ref CI / cây trộn (đã PASS trên PostgreSQL tạm, 169/169), không đạt khi chạy nhánh này tách rời `main`.
- M-1..M-5 (ghi nhận, PR bổ sung sau theo quyết định owner): audit cho chủ thiết bị khi người khác đăng nhập trên máy còn cookie; DEVICE_LIMIT không kéo theo phiên; audit thiếu số phiên ở logout/login; guard thứ tự rollback cho `B1.4_REMEMBER_ME_ROLLBACK`; trigger bất biến cho `remember_family_id`.

**Chưa áp** lên database thật, DB demo 55433 hay `siscom_crm_dev`. Áp lên DB nào cũng cần owner duyệt riêng; DB đã tách role: `demo-split -Step migrate` (migrate bằng `siscom_migrator` rồi chạy lại V3 + VERIFY).
