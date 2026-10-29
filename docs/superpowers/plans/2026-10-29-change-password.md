# Đổi mật khẩu của chính mình (PR 8) — Kế hoạch thực thi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Người đã đăng nhập đổi mật khẩu của chính mình qua `POST /auth/change-password` (Argon2id, chính sách, hạn mức 5/15 phút, thu hồi mọi phiên rồi cấp phiên mới) và màn hình Liquid Glass tương ứng (bắt buộc khi `mustChangePassword`).

**Architecture:** Backend thêm hàm chính sách thuần + `AuthService.changePassword` + route trong `AuthController`; DB không đổi (trigger `token_version` sẵn có thu hồi phiên). Frontend thêm policy/model thuần, `cookieAuthClient.changePassword`, `cookieSession.changePassword`, màn hình + hộp thoại, và cổng bắt buộc trong `AuthGate`. Cùng bộ vector kiểm chính sách cho BE và FE.

**Tech Stack:** NestJS 11, Prisma 7, `argon2` (đã ghim), class-validator; React 18, DS `sg-glass-strong`/`Input`/`Button`; jest (BE), `node --test` (FE), harness CDP Chrome.

**Spec:** `backend/docs/B1.3.3_CHANGE_PASSWORD_DESIGN.md` (D16–D19; owner duyệt D18 = A).

## Global Constraints
- Không migration, không dependency mới, không đổi ma trận quyền V2, không đụng `siscom_crm_dev`/baseline (AGENTS.md).
- Argon2id `m=65536 KiB, t=3, p=1` qua `Argon2PasswordHasher` sẵn có; `password_algo = 'argon2id'`.
- Không bao giờ ghi mật khẩu vào log, `audit_log`, thông điệp lỗi, phản hồi; FE không giữ mật khẩu sau khi gửi.
- Mã lỗi đúng D16: 400 `VALIDATION_FAILED` / `PASSWORD_CURRENT_INVALID`, 401 `UNAUTHENTICATED`, 403 `CSRF_FAILED`, 429 `PASSWORD_CHANGE_THROTTLED`.
- Chính sách D17: 12–128 ký tự; ≥ 3/4 nhóm; không chứa phần trước `@` của email hoặc mã NV (≥ 4 ký tự, không phân biệt hoa/thường); không lặp > 3 ký tự liên tiếp; không trong denylist; không khoảng trắng đầu/cuối; khác mật khẩu hiện tại.
- Báo cáo tiếng Việt; mỗi task một commit; không tự merge.

## Review Focus
1. Mật khẩu Unicode (tiếng Việt có dấu, emoji): đếm theo code point, không vỡ độ dài — test trong Task 1 (`'Mậtkhẩu-Rấtmạnh#2026'` hợp lệ; 11 code point bị từ chối).
2. Mật khẩu mới trùng mật khẩu hiện tại nhưng khác hoa/thường: vẫn được phép (khác chuỗi) — Task 2 kiểm `PASSWORD_SAME_AS_CURRENT` chỉ khi Argon2 khớp.
3. Phiên thứ hai của cùng nhân viên (thiết bị khác) phải 401 sau khi đổi; phiên mới trả về phải dùng được ngay — Task 3.
4. Thiếu `X-CSRF-Token` nhưng có cookie ⇒ 403 trước khi so mật khẩu (không tốn Argon2, không ghi nhật ký) — Task 3.
5. Người dùng bị ép đổi (`mustChangePassword`) không có đường vào App ngoài đổi thành công hoặc đăng xuất — Task 7.

---

### Task 1: Chính sách mật khẩu (BE, thuần) + vector dùng chung

**Files:**
- Create: `backend/src/common/auth/login/password-policy.ts`
- Create: `backend/src/common/auth/login/password-policy.vectors.json`
- Test: `backend/src/common/auth/login/password-policy.spec.ts`

**Interfaces:**
- Produces: `PASSWORD_MIN = 12`, `PASSWORD_MAX = 128`, `COMMON_PASSWORDS: readonly string[]` (≈30, chữ thường), `checkPasswordPolicy(password: string, ctx: { email?: string | null; code?: string | null }): string[]` (rỗng = đạt; thông điệp tiếng Việt), `passwordStrength(password: string): 0 | 1 | 2 | 3 | 4`.
- Vector JSON: `{ "cases": [{ "password", "email", "code", "ok": boolean, "strength": number, "note" }] }` — FE Task 4 đọc cùng file.

- [ ] **Step 1: Viết vector** (≥ 14 ca): đạt (`'Siscom@301085x'`, Unicode 12 code point, 128 ký tự); trượt (11 ký tự, 129 ký tự, 2 nhóm, chứa `admin` khi email `admin@siscom.local`, chứa `NV-0003`, `aaaa`, `password123!A`, khoảng trắng đầu/cuối).
- [ ] **Step 2: Viết spec** duyệt từng vector: `expect(checkPasswordPolicy(c.password, c).length === 0).toBe(c.ok)`, `expect(passwordStrength(c.password)).toBe(c.strength)`; thêm ca thông điệp cụ thể cho độ dài/nhóm/chứa định danh.
- [ ] **Step 3: Chạy** `npx jest password-policy` ⇒ FAIL (module chưa có).
- [ ] **Step 4: Cài** `password-policy.ts` theo D17. Độ dài = `[...password].length`. Nhóm: `/\p{Ll}/u`, `/\p{Lu}/u`, `/\p{Nd}/u`, còn lại. Strength: 0 nếu < 12; 1 nếu vi phạm bất kỳ quy tắc; 2 nếu đạt + 3 nhóm; 3 nếu đạt + 4 nhóm hoặc ≥ 16 ký tự; 4 nếu đạt + 4 nhóm + ≥ 16.
- [ ] **Step 5: Chạy** ⇒ PASS. **Commit** `feat(auth): chính sách mật khẩu D17 + vector dùng chung`.

### Task 2: `AuthService.changePassword` + DTO + route (BE)

**Files:**
- Create: `backend/src/modules/auth/dto/change-password.dto.ts`
- Modify: `backend/src/modules/auth/auth.service.ts` (thêm method + limiter thứ hai + hằng lỗi)
- Modify: `backend/src/modules/auth/auth.controller.ts` (route `POST change-password`, sau `logout`)
- Test: `backend/src/modules/auth/auth.change-password.spec.ts` (unit, prisma/hasher giả)

**Interfaces:**
- `ChangePasswordDto { currentPassword: string (1..1024); newPassword: string (1..1024); confirmPassword: string (1..1024) }` — không trim.
- `AuthService.changePassword(s: ResolvedSession, input: { currentPassword; newPassword; confirmPassword; source: string; ip: string | null; userAgent: string | null; requestId?: string }): Promise<LoginResult>` (cùng kiểu trả về với `login` để controller đặt cookie như login).
- Lỗi: `PASSWORD_CURRENT_INVALID()` 400, `PASSWORD_CHANGE_THROTTLED()` 429, `VALIDATION_FAILED` 400 (`details: string[]`; thêm `'Mật khẩu xác nhận không khớp'` và `'Mật khẩu mới phải khác mật khẩu hiện tại'`).
- Thứ tự: limiter (`'cp:' + employeeId`, source) → `confirmPassword === newPassword` → `checkPasswordPolicy(newPassword, { email, code })` → tải credential (ACTIVE, argon2id) → `hasher.verify(hash, currentPassword)` sai ⇒ nhật ký `auth.password_change_failed` (USER) + 400 → `hasher.verify(hash, newPassword)` đúng ⇒ 400 same-as-current → transaction: `employeeCredential.update({ passwordHash, passwordAlgo, passwordParams, passwordChangedAt: now, mustChangePassword: false, failedCount: 0, windowStartedAt: null, lockedUntil: null, lockLevel: 0, tokenVersion: { increment: 1 } })`, `authSession.create` (như login), `auditLog.create({ action: 'auth.password_changed', changes: { sessionsRevoked } })` với `sessionsRevoked` = `authSession.count({ employeeId, revokedAt: null })` **trước** update.

- [ ] **Step 1: Viết unit test** (hasher thật quá chậm ⇒ gán `(svc as any).hasher = { verify: jest.fn(), hash: jest.fn().mockResolvedValue('$argon2id$new') }`): (a) limiter vượt ⇒ 429, không chạm prisma; (b) confirm lệch ⇒ 400 `VALIDATION_FAILED`, không verify; (c) chính sách trượt ⇒ 400 có `details`; (d) hiện tại sai ⇒ 400 `PASSWORD_CURRENT_INVALID` + `auditLog.create` action `auth.password_change_failed`, không `employeeCredential.update`; (e) mới trùng hiện tại ⇒ 400 details chứa `'khác mật khẩu hiện tại'`; (f) thành công ⇒ update có `tokenVersion: { increment: 1 }`, `mustChangePassword: false`, `passwordHash: '$argon2id$new'`, `authSession.create` 1 lần, audit `auth.password_changed`, trả `sessionToken`/`csrfToken` 43 ký tự; (g) `JSON.stringify` mọi lời gọi prisma/audit không chứa mật khẩu.
- [ ] **Step 2: Chạy** `npx jest auth.change-password` ⇒ FAIL.
- [ ] **Step 3: Cài** DTO, service, controller (`@Post('change-password') @HttpCode(200) @UseGuards(ActorGuard)`; lấy `req.authSession`; đặt `Set-Cookie` phiên mới + `Cache-Control: no-store`; trả `{ data: { me, csrfToken } }`). Tách `issueSession(tx, employee, now, ip, ua)` dùng chung với `login`.
- [ ] **Step 4: Chạy** unit + `npx tsc --noEmit` ⇒ PASS, 0 lỗi; `static-guards`/`csrf-origin.guard.spec` vẫn PASS. **Commit** `feat(auth): POST /auth/change-password (D16, D18 A, D19)`.

### Task 3: Integration PostgreSQL (BE)

**Files:**
- Modify: `backend/test/auth.int-spec.ts` (thêm `describe('Đổi mật khẩu của chính mình (B1.3.3)')`, đặt **sau** describe RBAC, dùng `USERS[4]` accountant để không ảnh hưởng bài khác; cuối cùng đổi lại mật khẩu gốc)

**Interfaces:** `w(s)` headers, `session(key)`, `login(email, pw)`, `prisma.employeeCredential`, `prisma.authSession`, `prisma.auditLog`.

- [ ] **Step 1: Viết test**: (1) hai phiên `s1`, `s2` của accountant; POST với `w(s1)` và mật khẩu mới đạt ⇒ 200, `me.mustChangePassword === false`, `csrfToken` mới, cookie mới `cookieOf(res)`; `GET /auth/me` với cookie cũ `s1` ⇒ 401, với `s2` ⇒ 401, với cookie mới ⇒ 200; `authSession.count({ employeeId, revokeReason: 'TOKEN_VERSION' }) >= 2`; `employeeCredential.passwordHash` bắt đầu `$argon2id$` và ≠ hash trước; `auditLog` có `auth.password_changed` với `changes.sessionsRevoked >= 2`; `login(email, mật khẩu cũ)` ⇒ 401, `login(email, mới)` ⇒ 200. (2) sai hiện tại ⇒ 400 `PASSWORD_CURRENT_INVALID`, hash không đổi, audit `auth.password_change_failed`. (3) chính sách yếu ⇒ 400 `VALIDATION_FAILED`; `confirmPassword` lệch ⇒ 400. (4) không cookie ⇒ 401; cookie nhưng thiếu `X-CSRF-Token` ⇒ 403 và **không** có dòng audit mới; thiếu Origin ⇒ 403. (5) 6 lần sai liên tiếp ⇒ lần thứ 6 429 `PASSWORD_CHANGE_THROTTLED` (cfg test `loginMaxPerIdentifier: 1000` ⇒ dùng `overrideProvider(AUTH_CONFIG)` riêng? **Quyết định:** service đọc hạn mức từ `cfg.loginMaxPerIdentifier`; bài 429 chạy trên app thứ hai `appT` với cfg `loginMaxPerIdentifier: 5` tạo trong describe này). (6) Không chuỗi mật khẩu nào xuất hiện trong `audit_log.summary/changes` của nhân viên này. (7) Cuối: đổi lại mật khẩu gốc bằng phiên mới ⇒ 200.
- [ ] **Step 2: Chạy** `npx tsc --noEmit` ⇒ 0 lỗi (không có DB cục bộ; integration chạy trên CI). **Commit** `test(auth): integration đổi mật khẩu`.

### Task 4: Chính sách + model (FE, thuần)

**Files:**
- Create: `frontend/siscom-crm-web/src/auth/passwordPolicy.js`
- Create: `frontend/siscom-crm-web/src/auth/changePasswordModel.js`
- Test: `frontend/siscom-crm-web/tests/changePassword.test.mjs`
- Modify: `.github/workflows/ci.yml` (thêm `tests/changePassword.test.mjs` vào `FILES`)

**Interfaces:**
- `passwordPolicy.js`: `checkPasswordPolicy(password, { email, code }) -> string[]`, `passwordStrength(password) -> 0..4`, `PASSWORD_MIN/MAX`, `COMMON_PASSWORDS` — **cùng quy tắc và thông điệp** Task 1.
- `changePasswordModel.js`: `CHANGE_PASSWORD_UI_TEXT` (title `'Đổi mật khẩu'`, nhãn `'Mật khẩu hiện tại'`, `'Mật khẩu mới'`, `'Xác nhận mật khẩu mới'`, submit `'Đổi mật khẩu'`, success `'Đã đổi mật khẩu. Các thiết bị khác đã bị đăng xuất.'`, forced notice `'Bạn cần đổi mật khẩu trước khi tiếp tục.'`, strength labels 5 mức); `deriveChangePasswordView({ status, error, current, next, confirm, touched, me }) -> { currentError, nextError, confirmError, strength, strengthLabel, bannerError, bannerKind, loading, submitBlocked, inputsDisabled }`; `createChangePasswordSubmitter(session) -> (current, next, confirm) => Promise<{ submitted, ok, reason, error }>` (chặn gửi trùng `IN_FLIGHT`); `describeChangePasswordError(code) -> { kind, message }` (`PASSWORD_CURRENT_INVALID` ⇒ lỗi trường hiện tại; `VALIDATION_FAILED` ⇒ lỗi trường mới; `PASSWORD_CHANGE_THROTTLED` ⇒ banner `'Bạn đã thử quá nhiều lần. Vui lòng thử lại sau 15 phút.'`; `CSRF_FAILED`/`SESSION_EXPIRED` ⇒ banner).

- [ ] **Step 1: Viết test**: đọc `../../../backend/src/common/auth/login/password-policy.vectors.json` và duyệt như Task 1 (parity); view: thiếu hiện tại ⇒ `currentError`; `next` yếu ⇒ `nextError` + strength; `confirm` lệch ⇒ `confirmError`; `submitBlocked` khi loading; `describeChangePasswordError` 4 mã; submitter gọi `session.changePassword` đúng tham số và chặn gửi trùng.
- [ ] **Step 2: Chạy** `node --test tests/changePassword.test.mjs` ⇒ FAIL. **Step 3: Cài.** **Step 4: Chạy** ⇒ PASS. **Commit** `feat(fe): chính sách + model đổi mật khẩu`.

### Task 5: Client + session (FE)

**Files:**
- Modify: `frontend/siscom-crm-web/src/auth/cookieAuthClient.js` (thêm `changePassword`)
- Modify: `frontend/siscom-crm-web/src/auth/cookieSession.js` (thêm `changePassword`)
- Test: `frontend/siscom-crm-web/tests/changePassword.test.mjs` (thêm ca)

**Interfaces:**
- `client.changePassword(currentPassword, newPassword, confirmPassword, csrfToken) -> { me, csrfToken }`: thiếu csrf ⇒ ném `AuthHttpError(403, 'CSRF_FAILED')` không gọi mạng; `POST /auth/change-password` body 3 trường, header `X-CSRF-Token`; kiểm `isMe(d.me)` + `B64URL_256` như `login`.
- `session.changePassword(current, next, confirm) -> { ok: true } | { ok: false, error: { code, details } }`: chỉ khi `AUTHENTICATED`; thành công ⇒ `csrf = r.csrfToken`, `authed(r.me)` (me mới, `mustChangePassword=false`); 401 ⇒ `handleUnauthorized()`; lỗi khác ⇒ **không** đổi trạng thái phiên, trả `{ ok:false, error }` (giữ `error.details` từ `AuthHttpError` — mở rộng `AuthHttpError` nhận `details`).

- [ ] **Step 1: Viết test** với fetch giả: route/method/header/body đúng; 200 ⇒ csrf mới qua `getCsrfToken()`, `me.mustChangePassword` false; 400 ⇒ `{ ok:false, error.code }` và trạng thái vẫn `AUTHENTICATED`; 401 ⇒ trạng thái `ERROR SESSION_EXPIRED`; thiếu csrf ⇒ không fetch.
- [ ] **Step 2–4:** FAIL → cài → PASS. **Commit** `feat(fe): cookieAuthClient/cookieSession.changePassword`.

### Task 6: Màn hình + hộp thoại (FE, Liquid Glass)

**Files:**
- Create: `frontend/siscom-crm-web/src/features/auth/ChangePasswordScreen.jsx` (export `ChangePasswordForm({ session, forced, onDone })` và `CHANGE_PASSWORD_IDS`)
- Create: `frontend/siscom-crm-web/src/features/auth/ChangePasswordDialog.jsx` (overlay `role="dialog" aria-modal aria-label="Đổi mật khẩu"`, Esc đóng, như `CustomerFormDrawer`)
- Modify: `frontend/siscom-crm-web/src/App.jsx:161` (nút `Đổi mật khẩu` icon `key-round` cạnh `Đăng xuất`, mở dialog; toast thành công)
- Test: `frontend/siscom-crm-web/tests/changePasswordScreen.test.mjs` (render jsdom theo mẫu `loginAccessibility.test.mjs`; nếu môi trường không render được thì bỏ qua có ghi rõ như mẫu)

**Interfaces:** `CHANGE_PASSWORD_IDS = { current: 'cp-current', next: 'cp-next', confirm: 'cp-confirm', banner: 'cp-banner', strength: 'cp-strength' }`; 3 `Input type=password` (`autoComplete`: `current-password`, `new-password`, `new-password`), nút hiện/ẩn chung, thanh độ mạnh `role="meter"` `aria-valuenow`, banner `role="alert" data-kind`, lỗi trường `aria-describedby`; sau gửi xoá cả 3 ô; `forced` ⇒ hiện notice + chỉ nút "Đăng xuất" (`session.logout()`), không nút đóng.

- [ ] **Step 1: Viết test render**: 3 ô có nhãn đúng; gửi rỗng ⇒ lỗi trường, không gọi mạng; gửi hợp lệ với session giả thành công ⇒ `onDone` gọi, ô trống; `forced` ⇒ không có nút Đóng, có "Đăng xuất".
- [ ] **Step 2–4:** FAIL → cài → PASS; `vite build` OK. **Commit** `feat(fe): màn hình/hộp thoại đổi mật khẩu (Liquid Glass)`.

### Task 7: Cổng bắt buộc đổi mật khẩu (FE)

**Files:**
- Modify: `frontend/siscom-crm-web/src/features/auth/AuthGate.jsx` (nếu `state.me && state.me.mustChangePassword` ⇒ render `<ChangePasswordForm session forced />` trong `main.login-shell`, **trước** `App`)
- Test: `frontend/siscom-crm-web/tests/changePassword.test.mjs` (hàm thuần `gateDecision(state) -> 'app' | 'forced' | 'login' | 'restoring'` tách ra `src/auth/authGateModel.js` để test không cần React)

- [ ] **Step 1: Test** `gateDecision`: AUTHENTICATED + mustChangePassword ⇒ `forced`; AUTHENTICATED ⇒ `app`; LOADING đang restore ⇒ `restoring`; khác ⇒ `login`.
- [ ] **Step 2–4:** FAIL → cài → PASS. **Commit** `feat(fe): ép đổi mật khẩu khi mustChangePassword`.

### Task 8: Harness S9, tài liệu, Gitleaks, PR

**Files:**
- Modify: `frontend/siscom-crm-web/tests/browser/sessionRolesChrome.mjs` (sau S7 của `sale`: đăng nhập lại `sale`; S9.1 mở hộp thoại "Đổi mật khẩu" ⇒ 3 ô; S9.2 hiện tại sai ⇒ banner/lỗi; S9.3 mới yếu ⇒ lỗi trường; S9.4 đúng ⇒ toast, `GET /auth/me` 200 với cookie mới; lấy `siscom_sid` cũ qua `Network.getCookies` **trước** khi đổi ⇒ `fetch(API + '/api/v1/auth/me', { headers: { cookie: old } })` từ Node ⇒ 401; S9.5 đổi lại mật khẩu gốc ⇒ 200; đăng xuất)
- Modify: `docs/B1.3_DEMO_PACK.md` (mục F10 demo tay + bảng S9 + hạn chế), `backend/docs/B1.3.3_CHANGE_PASSWORD_DESIGN.md` (trạng thái "đã cài"), `frontend/siscom-crm-web/tests/browser/README.md`
- Evidence: `docs/evidence/b1.3_e2e_session_roles_<stamp>.json` sau khi owner bật backend nhánh này.

- [ ] **Step 1:** Cập nhật harness + docs; `node --check`.
- [ ] **Step 2:** `npm run test:unit`, `npx tsc --noEmit`, `npm run build` (BE); `node --test` bộ CI + toàn bộ, `vite build` (FE); Gitleaks local.
- [ ] **Step 3:** Commit, push, mở Draft PR 8, đăng Issue #8; owner bật backend nhánh này ⇒ chạy harness ⇒ commit bằng chứng ⇒ báo cáo.
