# Owner smoke OFFLINE (mock) — cách chạy và giới hạn

Một lệnh, chạy trên Windows/Node ≥ 18, không cài thêm gói, không mạng, không database, không đọc `.env`:

```
cd D:\SISCOM-CRM
node tools\qa\owner-smoke.mjs                 # frontend + backend (cần node_modules của cả hai và backend\src\generated)
node tools\qa\owner-smoke.mjs --frontend-only # chỉ frontend; kết quả ghi rõ PARTIAL-PASS
```

Mã thoát: `0` mọi bước đã chạy và đạt · `1` có bước FAIL · `2` BLOCKED (thiếu tiền đề, bước không chạy được).
Một bước chỉ đạt khi `fail=0`, `skipped=0`, `todo=0` **và** số test đạt ≥ ngưỡng tối thiểu (test bị xoá/bỏ qua => FAIL, không xanh giả).
Tiến trình con bị bỏ các biến môi trường dạng `DATABASE*`, `PG*`, `SECRET`, `JWT`, `PASSWORD`, `TOKEN`, `VITE_*`.

## Script chạy gì (tất cả OFFLINE, dữ liệu tổng hợp)

| Bước | Nội dung | Liên kết hợp đồng / cờ |
|---|---|---|
| FE-journey-mock (`tests/ownerAcceptanceSmoke.test.mjs`, mới) | Cờ mặc định TẮT; đăng nhập sai/đúng/logout; list/create/get/update khách hàng có Bearer; token bị thu hồi => 401; UI API hiện tại khi máy chủ fail-closed; đăng nhập xem thử không bao giờ thành công | `VITE_CRM_API_ENABLED`, `VITE_CRM_AUTH_ENABLED`, `VITE_CRM_API_BASE` |
| FE-customer-matrix | Ma trận 400/401/403/404/409/5xx/mạng cho mọi thao tác | `customerApiClient`, `customerRepository` |
| FE-demo-isolation | API bật không lộ dữ liệu demo/localStorage; API tắt giữ nguyên demo | `<App>` thật, fetch giả |
| FE-login-preview | Phiên xem thử luôn từ chối | `VITE_CRM_LOGIN_PREVIEW_ENABLED` |
| BE-health-customers (`backend/src/health/health.spec.ts`, mới + `customers.http.spec.ts`) | `/health` không chạm DB; `/health/database` lỗi => 503 thông báo chung; mọi route Customers/Lookups cấu hình thật (DenyAll) => 401 `UNAUTHENTICATED`, Prisma giả không bị gọi | `backend/docs/B1.2.3_API_CONTRACT.md` |

Chạy riêng: `cd frontend\siscom-crm-web && node --test tests\ownerAcceptanceSmoke.test.mjs`; `cd backend && npx jest --config ./test/jest-unit.json --runInBand src/health`.

## OFFLINE ≠ THẬT

Mọi thứ trên là **mô phỏng** (fetch giả, Prisma giả). `PASS (offline/mock)` **không** chứng minh đăng nhập nhân viên thật hay lưu PostgreSQL hoạt động.

## Chặn (blocker) để có đăng nhập nhân viên thật + lưu PostgreSQL

Đã xác minh từ mã nguồn nhánh này:

1. **Backend chưa có AuthController/route `/auth/*`**; `ACTOR_PROVIDER` mặc định là `DenyAll` nên mọi route Customers trả 401. Các đường dẫn `/auth/login|me|logout` trong frontend là giả định chưa chốt.
2. **Frontend chưa nối phiên đăng nhập vào khách hàng**: `createLoginSession` không được `App`/`customerRepository` dùng; `createCustomerRepository` gọi `createCustomerApi` không có `auth`, nên chế độ API bật hiện **không gửi Authorization** (SMOKE-5 ghi nhận KNOWN GAP). Màn đăng nhập chỉ là bản xem thử, không bao giờ đăng nhập được.
3. **Cơ chế phiên chưa chốt** (bearer trong bộ nhớ hay cookie HttpOnly + CSRF) — cần quyết định hợp đồng rồi chỉnh `credentials`/header.
4. **PostgreSQL**: cần cơ sở dữ liệu thử `siscom_crm_test_*`/`siscom_crm_restore_*`, migration B1.3.2-B được duyệt và áp dụng, có nhân viên + credential hash tổng hợp; hiện migration chưa áp DB. `AuditLog` phải sẵn sàng (hiện thao tác ghi trả 500 chung khi chưa có).
5. **Integration/E2E thật** chạy bằng `backend\scripts\windows\run-customers-tests.bat` (DB thử) và `frontend\siscom-crm-web\tests\browser\README.md` (Chrome/Edge, API giả) — không thuộc script này và chưa được chạy trong PR này.
