# Adapter khách hàng UI ↔ Customers API (chưa nối vào giao diện)

Trạng thái: **mã mới, độc lập, mặc định TẮT**. Ứng dụng vẫn chạy 100% trên localStorage. **Chưa** có đăng nhập, **chưa** có lưu PostgreSQL đầu–cuối.

## File mới
- `src/data/api/customerAdapter.js` — hàm thuần `toApiCustomer` / `fromApiCustomer` / `buildLookupMaps`.
- `src/data/api/customerApiClient.js` — `readApiConfig`, `createCustomerApi` (list/get/create/update, lookups). Không token, không cookie (`credentials:'omit'`), không đăng nhập; 401 của backend được ném nguyên dạng (`ApiError`).
- `tests/customerAdapter.test.mjs` — 14 test (`node:test`, không thêm dependency, không mạng, không DB).

Không sửa file nào có sẵn; không đổi `package.json`.

## Quy tắc ánh xạ (theo DTO backend B1.2.3)
| UI | API | Ghi chú |
|---|---|---|
| `name`, `phone` | `name`, `phone` | bắt buộc, trim |
| `short` | `shortName` | |
| `city` | `province` | mã lookup |
| `tier`, `status`, `industry`, `source` | cùng tên | UI giữ nhãn tiếng Việt; đổi nhãn↔mã qua `GET /lookups`. Nhãn lạ ⇒ `AdapterError`, không đoán |
| `owner` | — | **không gửi** (backend lấy từ actor); đọc về từ `owner.fullName` |
| `id` | `id` (uuid) | id ổn định; mã nghiệp vụ `KH-xxxxx` ở trường `code` |
| trường tuỳ chọn rỗng | tạo: bỏ; sửa: `null` | `tier`/`status` rỗng không gửi (NOT NULL) |
| — | `version` | bắt buộc khi sửa (khoá lạc quan) |

## Chạy test
```
cd D:\SISCOM-CRM\frontend\siscom-crm-web
node --test tests/customerAdapter.test.mjs
```

## Hướng dẫn demo
1. **Chế độ mặc định (demo localStorage):** `start-crm.bat` — không đổi gì, không gọi API.
2. **Thử client API (chỉ khi backend + đăng nhập đã có; hiện chưa có):** tạo `.env.local` (không commit) với
   `VITE_CRM_API_ENABLED=true` và `VITE_CRM_API_BASE=http://127.0.0.1:<PORT>/api/v1`.
   Hiện backend `main` trả **401** cho mọi route khách hàng (default-deny) — đó là hành vi đúng, adapter không và sẽ không vượt qua.
3. Giao diện **chưa** dùng client này; bước nối là lát tiếp theo bên dưới.

## Lát nhỏ kế tiếp
Nối `createCustomerApi` vào repository **sau cờ** (đọc danh sách + tạo khách qua API khi cờ bật, mặc định vẫn localStorage), kèm test với fetch giả. Chỉ chạy thật được khi có route đăng nhập (stack auth chưa hợp `main`).
