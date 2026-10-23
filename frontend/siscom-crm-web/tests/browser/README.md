# Smoke trình duyệt thật (API giả)

Chạy tay, **không** thuộc `node --test` mặc định và không thêm dependency. Dùng Chrome/Edge đã cài sẵn qua Chrome DevTools Protocol (Node >= 22, có `WebSocket` toàn cục).

1. Build 3 biến thể ra thư mục ngoài repo (ví dụ `D:\SISCOM-CRM-qa-out`):
   - `off/`: `npx vite build --outDir <gốc>/off`
   - `login/`: `VITE_CRM_LOGIN_PREVIEW_ENABLED=true`
   - `api/`: `VITE_CRM_API_ENABLED=true` và `VITE_CRM_API_BASE=http://127.0.0.1:4599`
2. `node tests/browser/browserSmoke.mjs <gốc>` (tuỳ chọn `BROWSER_EXE` để chỉ định trình duyệt).

Máy chủ giả chỉ nghe `127.0.0.1` (4599 API, 4600 tĩnh, CDP 9333). Không backend, không DB, không bí mật; đăng nhập preview luôn bị từ chối. Mã thoát 0 = đạt, 1 = có FAIL, 2 = BLOCKED (thiếu trình duyệt/dist). Dòng `KNOWN` = lỗi đã biết có PR sửa riêng.
