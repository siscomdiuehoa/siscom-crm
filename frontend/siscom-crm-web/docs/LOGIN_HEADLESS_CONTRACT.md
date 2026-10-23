# Hợp đồng đăng nhập HEADLESS (chưa nối UI)

Trạng thái: **mã nguồn + test offline**. Không đổi giao diện, không nối vào `App.jsx`, không thêm dependency.

## Đã xác minh từ kho
- Hợp đồng HTTP A4 (PR #31, `backend/src/common/auth/http/auth-http.contract.ts`): login `{login,password}` → `{token,expiresAt}`;
  logout/me dùng `Authorization: Bearer sid_<43>`; me → `{employeeId}`. Lỗi: 400 `REQUEST_INVALID`, 401 `LOGIN_INVALID`/`AUTH_REQUIRED`, 503 `AUTH_UNAVAILABLE`.
- Định dạng danh tính (PR #36/#38): email hoặc `NV-[0-9]{4,}`; giới hạn 254 ký tự (login), 1024 (mật khẩu).
- 429 `LOGIN_THROTTLED` từ chính sách chống lạm dụng (PR #39, DRAFT).
- Trên `origin/main` **không có AuthController/route xác thực nào** (chỉ health, customers, contacts, lookups).

## Chưa chốt / cần duyệt
- Đường dẫn `/auth/login|logout|me` là **giả định**; phải đối chiếu khi AuthController được duyệt.
- Hình dạng thân lỗi (`{error:{code}}`) theo quy ước của API khách hàng; chưa có route thật để kiểm chứng.

## Thiết kế
- `src/auth/loginIdentifier.js` — kiểm tra hình dạng sớm (thuần).
- `src/auth/authClient.js` — client HTTP, **mặc định TẮT** (`VITE_CRM_AUTH_ENABLED==='true'` và `VITE_CRM_API_BASE`). `credentials:'omit'`.
- `src/auth/loginSession.js` — máy trạng thái `UNAVAILABLE|IDLE|LOADING|AUTHENTICATED|ERROR`. Token chỉ ở bộ nhớ (closure); state không chứa token/mật khẩu;
  `employeeId` lấy từ `/me`; không gán vai trò/actor ở client; cờ tắt ⇒ `UNAVAILABLE`, không bao giờ rơi về demo/đăng nhập giả.

## Chạy test
`cd frontend/siscom-crm-web && node --test tests/loginSession.test.mjs`

## Vỏ giao diện đăng nhập (cô lập, chưa nối)
- `src/features/auth/LoginScreen.jsx` — vỏ tối thiểu dùng `Input`/`Button` của design system hiện có; **chưa import vào `App.jsx`** (thay bằng thiết kế hoàn chỉnh của chủ sở hữu sau). `enabled` mặc định `false` => không render.
- `src/auth/loginScreenModel.js` — logic thuần (validation, trạng thái nút/lỗi/loading). Cờ giao diện `VITE_CRM_LOGIN_UI_ENABLED==='true'` (mặc định TẮT) chỉ hiện giao diện; đăng nhập thật vẫn UNAVAILABLE khi `VITE_CRM_AUTH_ENABLED` tắt hoặc backend chưa có route.
- Không lưu token/mật khẩu, không đụng DenyAll/Customers API/localStorage demo; chế độ remote không rơi về demo.
- Test: `node --test tests/loginSession.test.mjs tests/loginScreenModel.test.mjs` (bộ điều khiển giả). **Chưa kiểm chứng**: render React thật và `vite build` (chưa có `node_modules`, không cài dependency theo quy định).
