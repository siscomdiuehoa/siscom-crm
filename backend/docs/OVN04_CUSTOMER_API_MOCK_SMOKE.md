# OVN04 — Smoke FE ↔ BE Customers API (offline, mock/fake)

**Phạm vi:** CODE_TEST_DRAFT_ONLY. Chỉ thêm test + tài liệu; không đổi mã nguồn `src`, không đổi mặc định OFF, không bật auth routes (vẫn NOT_IMPLEMENTED).

## File mới
- `backend/src/modules/customers/fe-be-customer-api.smoke.spec.ts` (16 ca Jest)

## Cách chạy (không DB, không mạng, không .env)
`cd backend && npx jest --config ./test/jest-unit.json --runInBand src/modules/customers/fe-be-customer-api.smoke.spec.ts`

Spec nạp module frontend ESM thật (`customerApiClient`, `customerRepository`, `customerApiUi`) bằng `require(esm)` native của Node (cần Node ≥ 22.12), nối qua `fetch` giả vào app Nest thật (ActorGuard, AccessGuard, ValidationPipe, AllExceptionsFilter) với `CustomersService` giả.

## Đã khóa
- A: API BẬT + DenyAll mặc định của BE → 401 `UNAUTHENTICATED` mọi thao tác; không fallback demo/local; BE không chạm service/DB; cờ TẮT/thiếu BASE → 0 request.
- B: POST cần name + phone ở cả hai lớp (FE chặn trước khi gửi; BE 400 `VALIDATION_FAILED`); body không chứa owner/id/code; actor lấy từ token.
- C: 403 thật (không hủy phiên), 500 thật (thông điệp chung, không lộ chi tiết, retryable, không tự thử lại).
- D: stale session A→B: 200 muộn của A bị bỏ (`StaleSessionError`); 401 muộn của A không hủy phiên B.

## Khoảng trống thiết kế (DESIGN GAP — chưa sửa, cần quyết định)
1. `createCustomerRepository`/`createCustomerApiUi` **không nhận tùy chọn `auth`**: với API BẬT, luồng UI tích hợp không gửi Bearer nên luôn 401 trên BE thật. Cơ chế auth chỉ tồn tại ở `createCustomerApi(..., { auth })` và chưa được nối vào repository/UI. Không thể tuyên bố E2E đăng nhập → khách hàng. Nối dây là thay đổi hành vi/auth policy nên nằm ngoài phạm vi.
2. BE không có giới hạn tốc độ cho `/customers`; 429 chỉ được mô phỏng ở tầng fetch (FE xử lý: lỗi, retryable thủ công, không tự thử lại).
3. Không có endpoint đăng nhập (auth routes NOT_IMPLEMENTED) nên chưa có token thật.

## NOT_RUN
Trình duyệt/Chrome, PostgreSQL, integration/benchmark, đăng nhập thật, CI.

## Rollback
Xóa file spec và file doc này (không có thay đổi khác).

## Nền (stacked, không merge main)
Nhánh dựng từ #140 (OVN01, chồng #131) + merge #137 (K05, chồng #130/#125) + #141 (OVN03). Diff so với base chứa các PR đó; phần OVN04 chỉ gồm 2 file nêu trên.
