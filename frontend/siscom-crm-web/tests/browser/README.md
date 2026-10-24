# Smoke trình duyệt thật (API giả)

Chạy tay, **không** thuộc `node --test` mặc định và không thêm dependency. Dùng Chrome/Edge đã cài sẵn qua Chrome DevTools Protocol (Node >= 22, có `WebSocket` toàn cục).

1. Build 3 biến thể ra thư mục ngoài repo (ví dụ `D:\SISCOM-CRM-qa-out`):
   - `off/`: `npx vite build --outDir <gốc>/off`
   - `login/`: `VITE_CRM_LOGIN_PREVIEW_ENABLED=true`
   - `api/`: `VITE_CRM_API_ENABLED=true` và `VITE_CRM_API_BASE=http://127.0.0.1:4599`
   - `both/`: cả hai cờ cùng lúc (kịch bản D: đăng nhập xem thử + API)
2. `node tests/browser/browserSmoke.mjs <gốc>` (tuỳ chọn `BROWSER_EXE` để chỉ định trình duyệt).

Máy chủ giả chỉ nghe `127.0.0.1` (4599 API, 4600 tĩnh, CDP 9333). Không backend, không DB, không bí mật; đăng nhập preview luôn bị từ chối. Mã thoát 0 = đạt, 1 = có FAIL, 2 = BLOCKED (thiếu trình duyệt/dist). Dòng `KNOWN` = lỗi đã biết có PR sửa riêng.

Kịch bản F (X1–X6) dùng bản build `api/`: cổng 429 của API giả; kiểm tra lỗi "Yêu cầu thất bại (429)", đúng 1 yêu cầu (không tự thử lại), không rơi về demo, không chuyển sang đăng nhập, nút "Thử lại" hoạt động.

## stale-401 actor A→B trên Chrome (mức module) — `stale401ChromeModule.mjs`

`node tests/browser/stale401ChromeModule.mjs` (không cần build/dist; cổng 4611 trang, 4612 API giả, 9344 CDP; `--mutant` kỳ vọng FAIL ở K1.3–K1.5).
Chrome thật nạp **nguyên văn** `loginSession`/`authClient`/`customerApiClient` làm ES module, ghép ở lớp test, gọi `fetch`+CORS thật tới máy chủ giả loopback. **Không phải build ứng dụng**: `App.jsx` chưa nối phiên đăng nhập vào Customer API và `src` không có nguồn actor, nên stale-401 A→B trên UI build vẫn **NOT_RUN** cho tới khi có nguồn actor thật được duyệt.

## Độ tin cậy harness (I05) — `harnessGuard.mjs`

Cả hai harness dùng chung `harnessGuard.mjs`: kiểm tra cổng loopback rảnh trước khi chạy (bị chiếm => `BLOCKED`, mã thoát 2, không đính nhầm Chrome cũ), hạn chót 15 giây cho mỗi lệnh CDP và hạn chót toàn cục (smoke 600 giây, stale-401 120 giây), dọn **cả cây** tiến trình Chrome (Windows: `taskkill /T /F`) kể cả khi lỗi sớm/Ctrl-C/ngoại lệ, và Chrome chạy với cờ chặn mạng nền + `--host-resolver-rules` chỉ cho `127.0.0.1`.
Kiểm tra bản thân helper (không cần Chrome/build): `node --test tests/browser/harnessGuard.test.mjs`.
Chống path traversal của máy chủ tĩnh (K01): `node --test tests/browser/staticGuard.test.mjs`.
