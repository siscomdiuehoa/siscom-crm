# Kiểm toán lát cắt dọc: Đăng nhập nhân viên → Khách hàng (tạo/xem/sửa/tìm) → PostgreSQL

Đích: `D:\SISCOM-CRM\backend\docs\CRM_LOGIN_CUSTOMER_VERTICAL_SLICE_PLAN.md` (**file mới**). Ngày 2026-10-23. Nhánh `docs/crm-login-customer-vertical-slice-audit` (từ `origin/main` = `a5de704`).
Phạm vi: **chỉ đọc kho + `gh`**. Không chạy test/build/DB/migration; mọi nhận định dưới đây là từ đọc mã và metadata PR, **chưa chạy thật** trừ khi ghi khác.

## 1. Kết luận ngắn

**Hiện không có lát cắt dọc nào chạy được, kể cả ở mức demo cục bộ.** Ba mảnh tách rời nhau:

1. **Backend trên `main`**: Customers/Lookups API đầy đủ (CRUD, tìm kiếm, liên hệ), nhưng mọi route đi qua `ActorGuard` + `DenyAllActorProvider` ⇒ **luôn 401**. Không có route đăng nhập, không có module auth, không có bảng credential (migration auth chưa nằm trên `main`).
2. **Frontend `frontend/siscom-crm-web`**: SPA React/Vite chạy hoàn toàn trên **localStorage** (`src/data/repository/*`). Không có một lệnh `fetch`, không màn hình đăng nhập; "người dùng" là bộ chọn `DEMO_USERS` (mặc định `u-director`), `permissions.js` ghi rõ "NOT security". Khách hàng đang lưu ở trình duyệt, **không đến PostgreSQL**.
3. **Auth (stack PR #15 → #54)**: là lõi **offline** (hàm thuần/dịch vụ + test giả lập), **chưa gắn route**, chưa có provider thật. Phần lớn chưa hợp vào `main`.

Khoảng trống lớn nhất không phải là UI mà là: (a) hợp nhất stack auth, (b) controller `/auth/login` + provider DB thật, (c) cách tạo tài khoản quản trị đầu tiên, (d) client API cho frontend.

## 2. Hiện trạng `main` vs PR xếp chồng (đã xác minh từ kho/`gh`)

| Hạng mục | `main` (a5de704) | Stack PR | Ghi chú |
|---|---|---|---|
| Customers API (`/api/v1/customers`, `:id`, `restore`, `contacts`, `lookups`) | Có, đủ DTO/validate/search/optimistic-concurrency; test int + unit | — | `customers.controller.ts`, `contacts.controller.ts`, `lookups.controller.ts` |
| Default-deny | `ActorGuard` + `DenyAllActorProvider`; `AuthModule` ghi log "TỪ CHỐI TẤT CẢ" | #25 thêm `AccessGuard` là `APP_GUARD` (route thiếu `@RequirePermissions/@Public` ⇒ 403), `default-deny.http.spec.ts` | #25 vẫn `DenyAll` |
| Đăng nhập email **hoặc mã NV** | Không | #36 `login-identifier.ts` (A9-2), #38 tích hợp `PasswordLoginService`, #28 `argon2.hasher.ts` | Dịch vụ thuần; **không `@Controller`/`@Post('login')` nào** trong cây mã của #54 (chỉ health/customers/lookups) |
| Phiên/JWT/refresh/CSRF | Không | #29–#31, #46–#50 (`session.service`, `access-token.service`, `refresh-cookie.policy`, `csrf-origin.policy`) | Kho phiên là `in-memory-session.store.ts`; `refresh-session-row.ts` là hợp đồng, chưa có store Prisma |
| Bảng credential/session (DB) | Không | Migration `20261020…` – `20261021…` (`b1_3_auth_core`, `m1_1_guards`, `m1_2_priv_api`, `m1_3_reset_revocation`) trong #15/#18/#19/#20 | "chưa áp DB" |
| Provider thật (đọc DB, trả `Actor`) | Không | Không thấy trong #54 (`ACTOR_PROVIDER` vẫn `DenyAll`) | **Khoảng trống chặn** |
| Tạo admin đầu tiên (bootstrap) | Không | Chỉ có trong thiết kế (`B1.3.1_FINAL_DESIGN.md`: `src/cli/bootstrap-admin.ts`); **không có file** trong #20 (kiểm tra `backend/src/cli`, `scripts/` — không có `bootstrap`) | **Khoảng trống chặn** |
| Cột cho mã NV | `employee.code` (unique, `fn_next_employee_code()`), `employee.email` (unique theo lower(email) khi chưa xoá) | — | Đủ cho danh tính đăng nhập |
| Frontend gọi API | Không | Không PR nào chạm `frontend/` (chưa kiểm tra từng PR; #54 không có file frontend) | Khoảng trống |
| CORS | `CORS_ORIGIN_LIST`, `credentials:false`, header `Authorization` | Cookie refresh cần `credentials:true` (thiết kế PA6) | Sửa khi có cookie |
| CI | `ci.yml`: build+tsc+unit, build frontend, gitleaks; trigger `pull_request` **chỉ nhánh đích `main`** | — | PR #15 có CI xanh (đã xem; #16–#18 chưa xem); **PR xếp chồng (#19, #26, #54…) không có kiểm tra CI** vì đích không phải `main` |

Thứ tự phụ thuộc (đáy → đỉnh): `main` ← #15 (`b1.3.2-b-auth-core`, đích main) ← #17 ← #18 ← #19 ← #20 ← #21 ← #25 ← #26 ← #28 ← #29 … #41 ← #42–#50 ← #54. #16, #22, #24, #55, #56 độc lập, đích `main`. Nhánh hiện tại của cây làm việc chính là `db/b1.3.2-b-m1-2-s1s3` (#19).

## 3. Ma trận khoảng trống (tới demo Windows cục bộ)

| # | Khoảng trống | Tệp liên quan | Phụ thuộc PR | Bảo mật? | Rủi ro |
|---|---|---|---|---|---|
| G1 | Stack auth chưa hợp `main`; chuỗi 30+ PR không có CI | cả stack | #15→#54 | Có (review khác tác giả) | Cao: hợp từng PR theo thứ tự, CI chỉ chạy khi đích là `main` |
| G2 | Migration auth chưa áp trên DB thử | `prisma/migrations/20261020…`–`20261021…` | #15,#18,#19,#20 | Có (DB) | Cần duyệt riêng, chỉ bản sao `siscom_crm_test_*`/`restore_*` |
| G3 | Chưa có `AuthController` (`/auth/login`, `/auth/logout`, `/auth/me`, `/auth/refresh`) | mới: `src/modules/auth/` | #30,#31,#36,#38,#46 | Có | Gắn route = bật auth; **cần duyệt** |
| G4 | Chưa có `ActorProvider` DB (Employee + vai trò → `Actor`/`Scope`) | `src/common/auth/actor.ts`, `scope.ts` | G2,G3 | Có | Thay `DenyAll` = mở API; **cần duyệt** |
| G5 | Chưa có store phiên Prisma (chỉ in-memory) | `session/refresh-session-store.ts` | #43,#44 | Có | Mất phiên khi restart nếu dùng in-memory |
| G6 | Chưa có công cụ tạo admin đầu tiên + đặt mật khẩu | thiết kế `bootstrap-admin` | G2 | Có | Không được seed mật khẩu/thông tin thật |
| G7 | Frontend chưa có màn hình đăng nhập | `frontend/siscom-crm-web/src/App.jsx` | G3 | Không (UI) | Thấp |
| G8 | Frontend chưa có client API; kho dữ liệu là localStorage | `src/data/repository/*`, `src/features/customers/CustomerForm.jsx`, `src/pages/CustomerList.jsx` | G3,G4 | Không | Trung bình |
| G9 | Ánh xạ trường UI ↔ API khác tên: UI `short`, `city`, `owner`, `industry/tier/status/source` (tên hiển thị/mã demo `u-…`) so với API `shortName`, `province`, và `industry/tier/status/source/province` là khoá lookup UUID/mã; chủ sở hữu API lấy từ `Actor`, không nhận từ body | `CustomerForm.jsx`, `create-customer.dto.ts`, `customers.mapper.ts`, `docs/B1.2.3_API_CONTRACT.md` | — | Không | Trung bình: viết adapter + dùng `/lookups` |
| G10 | Tìm kiếm/danh sách UI lọc phía client | `CustomerList.jsx` | G8 | Không | Cần chuyển sang `GET /customers?…` (phân trang/`total` đã có) |
| G11 | CORS + cookie (`credentials`, `SameSite`, origin Vite `http://localhost:5173`) | `app.setup.ts`, `env.validation.ts` | G3 | Có | Cấu hình, không đổi mặc định khi chưa duyệt |
| G12 | Chưa có kịch bản smoke-test đầu–cuối / script khởi động cả hai | `scripts/windows/start-backend.bat`, `frontend/siscom-crm-web/start-crm.bat` | G3–G8 | Không | Thấp |
| G13 | CI chưa có job tích hợp (cố ý: không dùng PostgreSQL) | `.github/workflows/ci.yml` | — | Không | Chạy int-test thủ công trên DB thử |

Đề xuất **không** làm: sửa hợp đồng API đã chốt, nới default-deny, mở route bằng cờ môi trường, thêm "nút đăng nhập giả" vào `src`.

## 4. Thứ tự lát cắt nhỏ nhất, an toàn (đề xuất — chưa thực hiện)

| Lát | Nội dung | Loại | Cần duyệt riêng? |
|---|---|---|---|
| S0 | Xác nhận thứ tự hợp stack #15→#54 và bật CI cho PR xếp chồng (vd. đổi trigger sang mọi `pull_request`) | Quy trình/CI | Có (đổi `ci.yml`, PR riêng) |
| S1 | Hợp #15–#18 vào `main` (migration auth đã soạn, chưa áp DB) | Review | Có (người duyệt khác tác giả) |
| S2 | Áp migration lên **bản sao mới** `siscom_crm_test_*` bằng script `auth-m1-verify` (chủ DB chạy) | DB thử | Có (văn bản) |
| S3 | `AuthController` + store phiên Prisma + `ActorProvider` DB, **vẫn ngoài `AppModule` mặc định** cho tới khi duyệt; test Nest offline | Bảo mật | Có |
| S4 | CLI `bootstrap-admin` (nhập mật khẩu tương tác, một lần, `app_meta.auth_bootstrap_done`) | Bảo mật/DB | Có |
| S5 | Frontend: client API + màn hình đăng nhập (email/mã NV) + adapter G9, **sau cờ chế độ** (`VITE_API_BASE`); giữ chế độ demo localStorage làm mặc định | UI | Không bảo mật, nhưng phụ thuộc S3 |
| S6 | Danh sách/tìm kiếm/sửa qua API (`GET /customers?q=`, `PATCH` với phiên bản) | UI/API | Không |
| S7 | Smoke-test cục bộ + tài liệu vận hành | Docs | Không |

Lát độc lập, không bảo mật, không chạm DB (đủ điều kiện làm riêng): **adapter ánh xạ trường UI↔API (G9) có test thuần** (hàm `toApiCustomer/fromApiCustomer`, không gọi mạng) — xem mục 6.

## 5. Hướng dẫn smoke-test (Windows, cục bộ) — chỉ cho trạng thái **hiện có**

Mọi bước dưới đây **chưa chạy** trong lần kiểm toán này.

A. **Frontend demo (localStorage, không backend)** — hoạt động hôm nay:
`cd D:\SISCOM-CRM\frontend\siscom-crm-web` → `start-crm.bat` (hoặc `npm install` rồi `npm run dev`) → mở `http://localhost:5173`. Thêm/sửa/tìm khách hàng lưu trong trình duyệt; đổi "người dùng" bằng bộ chọn demo. Đây **không** phải đăng nhập thật và **không** vào PostgreSQL.

B. **Xác minh default-deny của backend** (chỉ đọc, cần PostgreSQL thử + `.env` do bạn tự cấu hình; không đọc `.env` ở đây): chạy backend trên DB thử (`siscom_crm_test_*`/`restore_*`), `curl http://127.0.0.1:<PORT>/api/v1/customers` ⇒ kỳ vọng **401** `UNAUTHENTICATED`; `GET /api/v1/health` công khai. Test tự động liên quan không cần DB: `cd backend && npm run test:unit` (gồm `static-guards.spec.ts`, `customers.http.spec.ts`).

C. **Tích hợp Customers API trên DB thử** (không thuộc kiểm toán này): `backend\scripts\windows\run-customers-tests.bat` (CONTRIBUTING §4).

Sau khi S1–S6 xong, smoke-test đầu–cuối dự kiến: bootstrap admin (S4) → đăng nhập bằng email, đăng xuất, đăng nhập bằng mã NV → tạo khách (tên + điện thoại) → xem → sửa → tìm theo tên/MST/điện thoại → tải lại trang → dữ liệu còn (kiểm trong DB thử bằng truy vấn **chỉ đọc**).

## 6. Có làm được "sửa nhỏ UI/API" không?

Đánh giá: **không có hợp đồng đang hỏng nào để sửa riêng** — frontend chưa gọi API nên không có lỗi hợp đồng thật; mọi sửa API hiện đều đi qua route đang 401 và không kiểm chứng đầu–cuối được. Adapter G9 là ứng viên hợp lý nhưng sẽ đặt ra quyết định thiết kế chưa chốt (lookup theo UUID hay mã, xử lý `owner`), nên **không** làm lẫn trong PR này. Lần này chỉ có tài liệu; không mở PR mã thứ hai.

## 7. Chưa kiểm chứng / giới hạn

- Không chạy `tsc`, unit, build, int-test, CI cục bộ; không có kết quả PASS nào được tuyên bố cho mã.
- Chỉ xem CI của #15 (xanh) và xác nhận #19/#26/#54 không có check; chưa xem CI từng PR còn lại.
- "Không có `@Controller` login" kết luận từ `git grep` trên đỉnh stack (#54) và đối chiếu danh sách tệp; nhánh khác trong stack không được duyệt từng cái.
- Không đọc `.env`, không kết nối DB, không đụng worktree khác.
