# S03 — Bổ sung OVN04 (#142): sửa assertion nhóm E và làm rõ nền

Nền: `cd31e82` (PR #142, base #140). Nhánh bổ sung: `test/s03-ovn04-group-e-behavior`. DRAFT, KHÔNG MERGE.

## Thay đổi riêng của bổ sung này (1 file test)
- `backend/src/modules/customers/fe-be-customer-api.smoke.spec.ts`: nhóm E thay hai assertion `Function.toString()` (đọc mã nguồn, dễ vỡ, không chứng minh hành vi)
  bằng kiểm hành vi: ca đối chứng (có phiên hợp lệ → 200, không phiên → 401 và không có `Authorization`) và ca tham số hoá cho
  `createCustomerRepository` / `createCustomerApiUi` truyền `auth`: hoặc gửi đúng `Bearer` của phiên và thành công, hoặc (nền chưa có cầu nối) 401 fail-closed, không hủy phiên.
- **S05 siết nhóm E (thay phiên bản S03 "chấp nhận cả hai trạng thái")**: bỏ `run(...).catch(() => undefined)` và nhánh `if (header !== undefined)`.
  Nền này (#142, `cd31e82`) CHƯA có #149 nên kỳ vọng LEGACY được khẳng định cứng:
  - `createCustomerRepository({ auth })` -> `CustomerRepoError` `kind=unauthenticated`, `status=401`, `code=UNAUTHENTICATED`; đúng 1 yêu cầu mạng, KHÔNG có `Authorization`
    (backend chỉ thấy header rỗng), `service.list` không chạy, `local.*` không được gọi, phiên không bị hủy.
  - `createCustomerApiUi({ auth })` -> `list.status='error'`, `items=[]`, `paging=null`, `error` khớp `kind/status/code`, `denied=true`, `retryable=false`; cùng các ràng buộc trên.
  - Ca đối chứng gọi thẳng `createCustomerApi` có phiên hợp lệ: assert payload thành công (`items/page/pageSize/total/totalPages`), header đúng `Bearer tok-e-me`, backend chỉ thấy đúng header đó.
  Khi nền có #149 (`38001cd`), kỳ vọng LEGACY phải được thay bằng "200 + đúng Bearer" trong MỘT thay đổi riêng; không viết test chấp nhận mất cầu nối auth.
- Bằng chứng đột biến (worktree cô lập, đã khôi phục, không còn diff production): (M1) bọc 401 thành kind lạ -> test cũ nhóm E vẫn PASS (nuốt lỗi), test mới FAIL 2 ca LEGACY;
  (M2) repository bắt đầu truyền `auth` -> test cũ 18/18 PASS (chấp nhận cả hai), test mới FAIL ca repository; (M3) 401 -> kind `forbidden` -> test mới FAIL 2 ca LEGACY.
- Ghi chú xác minh regex (byte thô tại `cd31e82`, đo bằng `od -An -tx1` và `eval` regex): hai dòng khác nhau.
  - Dòng 268 (repository): `/\bauth\b/` — byte `5c 62` (một dấu gạch chéo ngược + chữ b), `regex.source = \bauth\b`, là word boundary thật; khớp `{ auth }`.
  - Dòng 267 (UI): `/auth/` nhìn thấy được nhưng thực chất là `/[U+0008]auth[U+0008]/` — byte `2f 08 61 75 74 68 08 2f`, tức ký tự điều khiển BACKSPACE (U+0008) thật chứ không phải `\b`.
    `regex.source` chứa hai U+0008 nên KHÔNG khớp `auth`/`{ auth }`; `.not.toMatch` luôn đúng (assertion rỗng, không bảo vệ gì). Đây là hậu quả của escape JSON/patch (`\b` -> 0x08).
  - Hai ký tự 0x08 là TOÀN BỘ số byte 0x08 trong cả cây tệp `.ts/.js/.mjs/.md/.json/.yml` tại `cd31e82`; tại `238568c` bằng 0 (vì cả hai assertion `toString` đã được thay).
  - Điểm yếu của cách `toString` vẫn đúng như đã nêu (khớp cả chú thích, đổi tên/minify, không chứng minh header được gửi) — nhưng tại `cd31e82` riêng phía UI còn là assertion rỗng.

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
