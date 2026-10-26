# S03 — Bổ sung OVN04 (#142): sửa assertion nhóm E và làm rõ nền

Nền: `cd31e82` (PR #142, base #140). Nhánh bổ sung: `test/s03-ovn04-group-e-behavior`. DRAFT, KHÔNG MERGE.

## Thay đổi riêng của bổ sung này (1 file test)
- `backend/src/modules/customers/fe-be-customer-api.smoke.spec.ts`: nhóm E thay hai assertion `Function.toString()` (đọc mã nguồn, dễ vỡ, không chứng minh hành vi)
  bằng kiểm hành vi: ca đối chứng (có phiên hợp lệ → 200, không phiên → 401 và không có `Authorization`) và ca tham số hoá cho
  `createCustomerRepository` / `createCustomerApiUi` truyền `auth`: hoặc gửi đúng `Bearer` của phiên và thành công, hoặc (nền chưa có cầu nối) 401 fail-closed, không hủy phiên.
- Test KHÔNG buộc hệ thống mãi thiếu auth: cầu nối opt-in đã có ở #149 (`38001cd`, base #146), chưa tích hợp vào nền này. Nghiệm thu tích hợp: `BLOCKED_DEPENDENCY`.
- Ghi chú xác minh: tại `cd31e82` regex repository trong tệp là `/\bauth\b/` (một dấu gạch chéo ngược, là word boundary thật). Điểm yếu thực sự là cách kiểm bằng `toString`
  (khớp cả chú thích, đổi tên tham số/minify làm sai lệch, không chứng minh header được gửi), không phải lỗi hai dấu gạch chéo.

## Danh sách thay đổi riêng của #142 so với toàn diff
- #142 hiện gộp: #140 (nền, `1c68944`) + #137 (K05) + #141 (OVN03) + merge preview; so với base #140: 45 commit / 64 file.
- Phần OVN04 riêng chỉ commit `cd31e82`, 2 file: `backend/docs/OVN04_CUSTOMER_API_MOCK_SMOKE.md`, `backend/src/modules/customers/fe-be-customer-api.smoke.spec.ts`.
- Không được mô tả toàn diff #142 là test-only.

## Phương án thu gọn diff (CHỜ nền được duyệt; KHÔNG thực hiện trong lô này)
1. Chờ #137 và #141 (và #140) được duyệt/tích hợp theo kế hoạch #144.
2. Sau đó tạo nhánh mới từ nền đã tích hợp, `cherry-pick cd31e82` (+ commit bổ sung này), mở Draft PR mới có diff 2–3 file; kiểm lại diff/SHA/CI trên SHA mới.
3. Không rebase/retarget/force-push/gộp hàng loạt trong lô này.

## Giới hạn
Fetch/provider/service giả; 429 chỉ mô phỏng ở tầng fetch (không chứng minh rate limiting); không Chrome/PostgreSQL/đăng nhập thật.
