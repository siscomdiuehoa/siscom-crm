# P1 — Màn hình quản lý tài khoản: kế hoạch làm

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quản trị CRM tự thêm nhân viên, sửa thông tin, đổi vai trò, cấp lại mật khẩu, khoá / mở lại tài khoản trên giao diện, mỗi thao tác một lần bấm.

**Architecture:** Một migration cộng thêm (4 hàm SECURITY DEFINER) + role database riêng `siscom_acct` chỉ được gọi các hàm tài khoản. Module backend `accounts` dùng kết nối thứ ba; mỗi thao tác chạy trong một transaction: tạo yêu cầu dưới tên tài khoản hệ thống → người bấm duyệt → thực thi → ghi nhật ký người bấm. Trang React "Tài khoản" dùng các thành phần `ds` sẵn có.

**Tech Stack:** PostgreSQL 18, Prisma 7 (`$queryRaw` / `$executeRaw`), NestJS, argon2, React + `node --test`, Jest (unit + int-spec), GitHub Actions.

**Spec:** `docs/P1_ACCOUNT_ADMIN_DESIGN.md` (Owner duyệt 23/11/2026). Người làm đọc cả hai.

## Global Constraints

- Không sửa bảng, CHECK, trigger hay hàm `fn_auth_*` hiện có. Không thêm mã quyền, không đụng `role_permission`, không sửa `fn_auth_perm_class`.
- Quyền gác mọi API và trang: `access.approve`.
- `siscom_app` và `siscom_auth` không được thêm quyền nào; mọi kiểm hiện có trong `B1.3_S1_VERIFY.sql.txt` và `B1.3_S1_VERIFY_AUTH.sql.txt` giữ nguyên kết quả (`PASS|75`, `PASS|33`).
- Mọi hàm SECURITY DEFINER mới: tiêu đề `LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp SET app.actor_employee_id = '' SET app.priv_request_id = ''`; kèm `REVOKE ALL ON FUNCTION … FROM PUBLIC`.
- Mật khẩu tạm: ≥ 12 ký tự, qua `checkPasswordPolicy`; băm bằng `Argon2PasswordHasher`; không xuất hiện trong log, nhật ký, phản hồi API, thông báo lỗi.
- Vai trò cấp được: `sales`, `technician`, `accountant`, `crm_admin`. Không bao giờ `admin`.
- Tài khoản hệ thống = đúng một nhân viên ACTIVE, credential ACTIVE, có vai trò `admin`; 0 hoặc > 1 ⇒ `SYSTEM_REQUESTER_UNAVAILABLE`.
- Thiếu `ACCT_DATABASE_URL` ⇒ chỉ module `accounts` trả 503 `ACCOUNT_ADMIN_UNAVAILABLE`; phần còn lại chạy bình thường.
- Thông báo cho người dùng bằng tiếng Việt; không lộ chi tiết database.
- Không tên người / email thật trong repo; dữ liệu thử dùng `@thu.local` hoặc tên giả.
- Quy trình repo: mỗi PR là Draft → CI 6/6 → review → Owner duyệt merge. Không merge, không deploy, không chạm VPS khi chưa có duyệt riêng. Commit kết thúc bằng dòng `Co-Authored-By` theo cấu hình phiên.

## Review Focus

1. **Mật khẩu tạm trùng email / mã nhân viên hoặc toàn khoảng trắng** — phải bị từ chối 400 như đổi mật khẩu, không tạo tài khoản dở. (Task 5)
2. **Lỗi giữa chừng khi thêm nhân viên** (email trùng do người khác vừa tạo, hoặc `reset_password` trả khác `OK`) — không còn bản ghi `employee`, credential hay yêu cầu PENDING / APPROVED nào sót lại. (Task 5)
3. **Hai Quản trị CRM cùng sửa một nhân viên** — người lưu sau nhận 409 `VERSION_CONFLICT`, dữ liệu người trước không bị ghi đè. (Task 5, Task 6)
4. **Email khác hoa / thường hoặc có khoảng trắng đầu cuối** (`  Ten@Thu.Local `) — được cắt khoảng trắng; trùng không phân biệt hoa thường ⇒ 409 `EMAIL_TAKEN`. (Task 1, Task 5)
5. **Khoá / gỡ quyền người duyệt cuối cùng, tự khoá** — 409 `LAST_APPROVER` hoặc 403 `SELF_MODIFICATION` với câu tiếng Việt rõ nghĩa, không phải 409 chung chung. (Task 3, Task 5)

---

## Cấu trúc tệp

| Tệp | Trách nhiệm |
|---|---|
| `backend/prisma/migrations/20261124000000_p1_account_admin/migration.sql` | 4 hàm mới + REVOKE + COMMENT |
| `backend/docs/P1_ACCOUNT_ADMIN_TESTS.sql.txt`, `…_ROLLBACK.sql.txt` | Bài kiểm SQL và rollback của migration |
| `backend/docs/B1.5_ACCT_ROLE.sql.txt` | Quyền nền cho role `siscom_acct` (CONNECT, USAGE, SET ON PARAMETER) — chạy bằng superuser |
| `backend/docs/B1.3_S1_APP_GRANTS_V6.sql.txt` | V5 + mục 7 cho `siscom_acct`; bước 0 thu hồi cả ba role |
| `backend/docs/B1.5_VERIFY_ACCT.sql.txt` | Kiểm `siscom_acct` được đúng và đủ (nhóm L* được, M* bị từ chối) |
| `backend/scripts/ci/pg-temp-db.sh`, `pg-sql-check.sh`, `.github/workflows/ci.yml` | Role thứ ba trong CI |
| `backend/scripts/linux/create-db.sh`, `lib.sh`, `env/backend.env.example`, `tests/*` | Role thứ ba trên máy chủ |
| `backend/src/prisma/acct-prisma.service.ts`, `config/acct-db-url.ts`, `prisma/db-role-check.ts` | Kết nối thứ ba, kiểm role lúc khởi động |
| `backend/src/common/auth/actor.ts`, `scope-merge.ts`, `common/filters/all-exceptions.filter.ts` | `access.approve` tới ứng dụng; 503 giữ mã |
| `backend/src/modules/accounts/` — `accounts.module.ts`, `.controller.ts`, `.read.service.ts`, `.write.service.ts`, `.flow.ts`, `.errors.ts`, `dto/*.dto.ts`, `*.spec.ts` | API tài khoản |
| `backend/test/accounts.int-spec.ts` (hoặc khối trong `auth.int-spec.ts`, xem Task 5) | Kiểm tích hợp |
| `frontend/siscom-crm-web/src/features/accounts/` — `accountsModel.js`, `accountsUi.js`, `AccountsPage.jsx`, `AccountDialogs.jsx` | Trang Tài khoản |
| `frontend/siscom-crm-web/tests/accounts*.test.mjs` | Kiểm giao diện |
| `docs/VPS_RUNBOOK.md` | Bước bật P1 trên máy chủ |

---

### Task 1: Migration #18 — bốn hàm tài khoản

**Files:**
- Create: `backend/prisma/migrations/20261124000000_p1_account_admin/migration.sql`
- Create: `backend/docs/P1_ACCOUNT_ADMIN_TESTS.sql.txt`, `backend/docs/P1_ACCOUNT_ADMIN_ROLLBACK.sql.txt`
- Modify: `.github/workflows/ci.yml` (ba chỗ đang gọi `SALES_T07_SEARCH_FOLD_*`: thêm dòng P1 theo cùng mẫu; rollback P1 đứng **trước** T07 trong chuỗi lùi vì mới hơn), `backend/docs/SALES_T07_SEARCH_FOLD_ROLLBACK.sql.txt` (từ chối khi migration P1 còn — theo mẫu `SALES_S2_ROLLBACK` từ chối khi T-07 còn)

**Interfaces — Produces:**
- `fn_auth_api_employee_create(p_actor uuid, p_full_name text, p_email text, p_department uuid, p_position text) RETURNS uuid`
- `fn_auth_api_employee_update(p_actor uuid, p_employee uuid, p_expected_updated_at timestamptz, p_full_name text, p_email text, p_department uuid, p_position text) RETURNS timestamptz`
- `fn_auth_api_must_change_set(p_actor uuid, p_employee uuid, p_expected_token_version integer) RETURNS void`
- `fn_auth_api_account_audit(p_actor uuid, p_action text, p_employee uuid, p_changes jsonb) RETURNS void`
- Mã lỗi (tiền tố thông báo, cùng kiểu M1): `EMAIL_TAKEN:` (ERRCODE `unique_violation`), `VERSION_CONFLICT:` (`serialization_failure`), `SYSTEM_ACCOUNT:` và `SELF_MODIFICATION:` (`check_violation`), `INVALID_STATE:` (`check_violation`), `APPROVAL_REQUIRED:` (`insufficient_privilege`, do `fn_auth_api_actor`).

Quy tắc trong hàm:
- Cả bốn: `PERFORM public.fn_auth_api_actor(p_actor, 'APPROVE')` rồi `set_config('app.actor_employee_id', p_actor::text, true)`.
- `employee_create`: `btrim` họ tên / email; họ tên rỗng ⇒ `INVALID_STATE`; email `NULL` hoặc rỗng ⇒ `INVALID_STATE` (P1 bắt buộc email); trùng `lower(email)` với nhân viên chưa xoá ⇒ `EMAIL_TAKEN`; phòng ban (nếu có) phải tồn tại và `is_active`; INSERT `status = 'ACTIVE'`; ghi `audit_log` action `EMPLOYEE_CREATE`.
- `employee_update`: khoá dòng `FOR UPDATE`; nhân viên giữ vai trò `admin` ⇒ `SYSTEM_ACCOUNT`; `updated_at <> p_expected_updated_at` ⇒ `VERSION_CONFLICT`; cùng quy tắc email / phòng ban; cập nhật 4 trường + `updated_at = now()`; `audit_log` action `EMPLOYEE_UPDATE` với `changes = {field: {old, new}}` chỉ các trường đổi; không đổi gì ⇒ trả `updated_at` cũ, không ghi nhật ký.
- `must_change_set`: `p_employee = p_actor` ⇒ `SELF_MODIFICATION`; UPDATE `employee_credential SET must_change_password = true WHERE employee_id = p_employee AND status = 'ACTIVE' AND token_version = p_expected_token_version AND must_change_password = false`; không đúng 1 dòng ⇒ `INVALID_STATE`; `audit_log` action `PASSWORD_MUST_CHANGE_SET`.
- `account_audit`: `p_action` phải thuộc `ACCOUNT_CREATE`, `ACCOUNT_ROLE_CHANGE`, `ACCOUNT_PASSWORD_RESET`, `ACCOUNT_DISABLE`, `ACCOUNT_ENABLE` (khác ⇒ `INVALID_STATE`); `p_changes` có khoá tên chứa `password`, `hash`, `token` (không phân biệt hoa thường) ⇒ `INVALID_STATE`; ghi `audit_log` actor_type `USER`.

- [ ] **Step 1: Viết bài kiểm SQL (đỏ)** — `P1_ACCOUNT_ADMIN_TESTS.sql.txt`, cùng khung với `SALES_T07_SEARCH_FOLD_TESTS.sql.txt` (guard tên DB thử, `ON_ERROR_STOP`, transaction + ROLLBACK cuối). Các khẳng định:
  - bốn hàm tồn tại, `prosecdef = true`, `proconfig` có `search_path=pg_catalog, public, pg_temp`; PUBLIC không có EXECUTE;
  - `employee_create` bằng người có `crm_admin`: trả uuid, dòng `employee` có `code` dạng `NV-%`, `status = 'ACTIVE'`, email đã `btrim`; gọi lại với `'  TEN@thu.local '` khác hoa thường ⇒ lỗi chứa `EMAIL_TAKEN`;
  - `employee_create` bằng người chỉ có `sales` ⇒ lỗi chứa `APPROVAL_REQUIRED`;
  - `employee_update` đúng `updated_at` ⇒ trả mốc mới > cũ, nhật ký `EMPLOYEE_UPDATE` có `changes->'full_name'->>'old'`; sai mốc ⇒ `VERSION_CONFLICT`; đích là người giữ `admin` ⇒ `SYSTEM_ACCOUNT`;
  - `must_change_set`: sai `token_version` ⇒ `INVALID_STATE`; đúng ⇒ `must_change_password = true`; tự đặt cho mình ⇒ `SELF_MODIFICATION`;
  - `account_audit`: action lạ ⇒ `INVALID_STATE`; `p_changes = '{"tempPassword":"x"}'` ⇒ `INVALID_STATE`; hợp lệ ⇒ 1 dòng `audit_log` có `actor_employee_id = p_actor`;
  - áp lại migration trên DB đã có dữ liệu không lỗi (theo mẫu T07).
- [ ] **Step 2: Chạy, xác nhận đỏ** — `cd backend && bash scripts/ci/pg-sql-check.sh docs/P1_ACCOUNT_ADMIN_TESTS.sql.txt ok migrator` trên DB tạm (`scripts/ci/pg-temp-db.sh create` + `prisma migrate deploy` + bootstrap như CI). Kỳ vọng: FAIL "function … does not exist".
- [ ] **Step 3: Viết `migration.sql`** theo Interfaces và quy tắc trên; cuối tệp `REVOKE ALL ON FUNCTION … FROM PUBLIC` cho 4 hàm (đủ chữ ký) và `COMMENT ON FUNCTION`.
- [ ] **Step 4: Chạy xanh** — `npx prisma migrate deploy` rồi lệnh ở Step 2. Kỳ vọng: `PASS`. Thêm: `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` ⇒ 0 (không cần sửa `schema.prisma`).
- [ ] **Step 5: Rollback** — `P1_ACCOUNT_ADMIN_ROLLBACK.sql.txt` theo mẫu `SALES_T07_SEARCH_FOLD_ROLLBACK.sql.txt` (guard chỉ DB `restore|test`; từ chối nếu chưa áp; `DROP FUNCTION` 4 hàm; xoá dòng `_prisma_migrations`; khối kiểm "sạch"). Chạy: `… P1_ACCOUNT_ADMIN_ROLLBACK.sql.txt run migrator`, rồi `migrate deploy`, rồi bài kiểm lại xanh.
- [ ] **Step 6: Nối CI** — thêm các dòng P1 vào đúng ba bước của `ci.yml` (kiểm ràng buộc; diễn tập rollback đầy đủ; rollback bằng migrator). Chạy `bash backend/scripts/linux/tests/test-guards.sh` nếu nó đếm số migration.
- [ ] **Step 7: Commit** — `git add backend/prisma/migrations/20261124000000_p1_account_admin backend/docs/P1_ACCOUNT_ADMIN_* backend/docs/SALES_T07_SEARCH_FOLD_ROLLBACK.sql.txt .github/workflows/ci.yml && git commit -m "feat(accounts): P1 migration #18 — 4 ham tai khoan (employee_create/update, must_change_set, account_audit)"`

### Task 2: Role `siscom_acct`, GRANTS V6, VERIFY_ACCT

**Files:**
- Create: `backend/docs/B1.5_ACCT_ROLE.sql.txt`, `backend/docs/B1.3_S1_APP_GRANTS_V6.sql.txt`, `backend/docs/B1.5_VERIFY_ACCT.sql.txt`
- Modify: `backend/scripts/ci/pg-temp-db.sh`, `backend/scripts/ci/pg-sql-check.sh`, `.github/workflows/ci.yml`, `backend/scripts/linux/create-db.sh`, `backend/scripts/linux/lib.sh`, `backend/scripts/linux/env/backend.env.example`, `backend/scripts/linux/tests/rehearse-pg.sh`, `backend/scripts/linux/tests/test-guards.sh`

**Interfaces:**
- Consumes: 4 hàm của Task 1.
- Produces: role `siscom_acct`; biến `ACCT_DATABASE_URL` (máy chủ), `TEST_ACCT_DATABASE_URL` (CI / test); `pg-sql-check.sh <file> <mode> acct`; `create-db.sh <db> grants` chạy V6 + 3 tệp VERIFY; `create-db.sh <db> acct` (lệnh con mới); đầu ra `PASS|<n>` của `B1.5_VERIFY_ACCT.sql.txt`.

Quyền của `siscom_acct` (đúng và đủ):
- CONNECT database; USAGE schema `public`; `GRANT SET ON PARAMETER app.actor_employee_id, app.priv_request_id`.
- SELECT cả bảng: `employee`, `employee_role`, `role`, `department`. SELECT theo cột trên `employee_credential`: `employee_id, status, must_change_password, token_version, updated_at` (không `password_hash`, `password_params`, `password_algo`).
- EXECUTE: `fn_auth_api_request_create`, `request_decide`, `role_grant`, `role_revoke`, `reset_token_issue`, `reset_password`, `credential_create`, `credential_disable` + 4 hàm Task 1. Không hàm nào khác.
- Không INSERT / UPDATE / DELETE bảng nào, không sequence, không TEMP, không thành viên role nào, `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`.

- [ ] **Step 1: Viết `B1.5_VERIFY_ACCT.sql.txt` (đỏ)** — cùng khung `B1.3_S1_VERIFY_AUTH.sql.txt` (chạy superuser, `SET ROLE siscom_acct`, bảng tạm `s1_result`, `pg_temp.expect_ok` / `expect_denied`, in `PASS|n`, đúng một dòng guard `'^siscom_crm_(restore|test)_[0-9]{8}_[0-9]{6}$'`). Nhóm `L*` (được): L0 chạy bằng `siscom_acct` không superuser; L1 SELECT 4 bảng; L2 SELECT 5 cột credential; L3 EXECUTE đủ 12 hàm (`has_function_privilege`); L4 SET hai tham số. Nhóm `M*` (bị từ chối): M1 SELECT `password_hash`; M2 SELECT `customer`, `opportunity`, `audit_log`, `auth_session`, `password_reset_token`, `privileged_change_request`; M3 INSERT / UPDATE / DELETE `employee`, `employee_role`, `employee_credential`; M4 EXECUTE `fn_auth_api_change_own_password`, `fn_auth_api_role_permission_change`, `fn_auth_bootstrap_close`, `fn_auth_api_audit`; M5 DDL, TEMP, `nextval`; M6 thuộc tính role và không là thành viên role nào; M7 số hàm SECURITY DEFINER mà `siscom_acct` EXECUTE được = đúng 12.
- [ ] **Step 2: Chạy đỏ** — `bash scripts/ci/pg-sql-check.sh docs/B1.5_VERIFY_ACCT.sql.txt res su`. Kỳ vọng: FAIL (role chưa có).
- [ ] **Step 3: `B1.5_ACCT_ROLE.sql.txt`** theo mẫu `B1.3_S1_AUTH_ROLE.sql.txt` (guard `target_db`, kiểm role đã tồn tại và đúng thuộc tính, REVOKE mặc định, CONNECT, USAGE, SET ON PARAMETER); **`B1.3_S1_APP_GRANTS_V6.sql.txt`** = V5 với: bước 0 thu hồi cả `siscom_acct`; mục 7 mới cấp quyền ở trên; khối kiểm đầu tệp đòi `siscom_acct` có CONNECT; dòng tổng kết thêm đếm của `siscom_acct`.
- [ ] **Step 4: CI và script** — `pg-temp-db.sh`: mật khẩu + URL thứ ba, ghi `TEST_ACCT_DATABASE_URL` / `TEST_ACCT_PW` vào `$GITHUB_ENV`, `split` chạy `B1.5_ACCT_ROLE`, `grants v6`; `pg-sql-check.sh`: nhánh `acct`; `ci.yml`: cạnh mỗi dòng `B1.3_S1_VERIFY_AUTH.sql.txt res su` thêm `B1.5_VERIFY_ACCT.sql.txt res su`, mọi `grants v5` hiện hành ⇒ `v6`, thêm diễn tập gỡ role `unacct` theo mẫu `unauth`. `create-db.sh`: `SISCOM_ACCT_PW` trong `db-roles.env` (48 hex, `load_role_passwords`), `ensure_role`, chạy `B1.5_ACCT_ROLE`, `env` ghi thêm `ACCT_DATABASE_URL`, `grants` dùng V6 + `verify_one` thứ ba; lệnh con `acct` (idempotent) cho DB đã có sẵn: chỉ thêm role + mật khẩu + biến, **không** đổi mật khẩu hai role kia, không chạm dữ liệu. `lib.sh`: hằng `ROLE_ACCT`. `backend.env.example`: dòng `ACCT_DATABASE_URL=`. Cập nhật `rehearse-pg.sh`, `test-guards.sh` cho role mới.
- [ ] **Step 5: Chạy xanh** — trên DB tạm: `split` + `grants v6` hai lần, rồi `… B1.3_S1_VERIFY.sql.txt res app` ⇒ `PASS|75`; `… B1.3_S1_VERIFY_AUTH.sql.txt res su` ⇒ `PASS|33`; `… B1.5_VERIFY_ACCT.sql.txt res su` ⇒ `PASS|<n>` (ghi n vào đầu tệp). `shellcheck` các script đã sửa; `test-guards.sh` và `rehearse-pg.sh` xanh.
- [ ] **Step 6: Commit** — `git commit -m "feat(accounts): role siscom_acct, APP_GRANTS_V6, VERIFY_ACCT; CI va create-db cho role thu ba"`

### Task 3: Nền backend — kết nối thứ ba, `access.approve`, mã lỗi

**Files:**
- Create: `backend/src/config/acct-db-url.ts`, `backend/src/prisma/acct-prisma.service.ts`, `backend/src/modules/accounts/accounts.errors.ts` (+ `*.spec.ts` cạnh từng tệp)
- Modify: `backend/src/prisma/prisma.module.ts`, `backend/src/prisma/db-role-check.ts` (+ spec), `backend/src/common/auth/actor.ts`, `backend/src/common/auth/scope-merge.ts`, `backend/src/common/filters/all-exceptions.filter.ts` (+ spec), `backend/test/helpers/test-app.ts`, `backend/test/helpers/test-db.ts`

**Interfaces — Produces:**
- `pickAcctDbUrl(env: NodeJS.ProcessEnv): string | null` — `null` khi thiếu / rỗng.
- `class AcctPrismaService` — `readonly available: boolean`; `client(): PrismaClient` ném `accountErrors.unavailable()` khi không có URL; lúc khởi động gọi `enforceDbRoleAtStartup(..., { pool: 'acct' })`.
- `DbRolePool = 'app' | 'auth' | 'acct'`; với `'acct'`: vi phạm nếu là chủ / superuser, có quyền ghi bảng nào, hoặc EXECUTE được hàm SECURITY DEFINER ngoài danh sách 12 hàm của Task 2.
- `Permission` có thêm `'access.approve'`; `KNOWN` trong `scope-merge.ts` có thêm mã này ⇒ `GET /auth/me` trả `permissions['access.approve'] = 'ALL'` cho Quản trị CRM.
- `accountErrors`: `forbidden()` 403 `FORBIDDEN`; `unavailable()` 503 `ACCOUNT_ADMIN_UNAVAILABLE`; `noSystemRequester()` 503 `SYSTEM_REQUESTER_UNAVAILABLE`; `validation(errs: string[])` 400 `VALIDATION_ERROR`; `notFound()` 404 `NOT_FOUND`; `selfModification()` 403 `SELF_MODIFICATION`; `systemAccount()` 403 `SYSTEM_ACCOUNT`; `lastAdmin()` 409 `LAST_ADMIN`; `lastApprover()` 409 `LAST_APPROVER`; `emailTaken()` 409 `EMAIL_TAKEN`; `versionConflict()` 409 `VERSION_CONFLICT`; `multiRole()` 409 `MULTI_ROLE_UNSUPPORTED`; `rateLimited()` 429 `RATE_LIMITED`.
- `mapAccountDbError(e: unknown): DomainException | null` — đọc tiền tố thông báo lỗi PostgreSQL (`LAST_ADMIN:`, `LAST_APPROVER:`, `SELF_MODIFICATION:`, `SYSTEM_ACCOUNT:`, `EMAIL_TAKEN:`, `VERSION_CONFLICT:`, `APPROVAL_REQUIRED:` ⇒ `forbidden()`), theo mẫu `isStaleTokenVersion` (`auth.service.ts:331-335`); không khớp ⇒ `null`.
- `AllExceptionsFilter`: `DomainException` có status 503 và code thuộc `{ACCOUNT_ADMIN_UNAVAILABLE, SYSTEM_REQUESTER_UNAVAILABLE}` giữ nguyên code + message; mọi 5xx khác vẫn `INTERNAL_ERROR` như cũ.
- Test: `createAcctTestPrisma()` và `acctTestDatabase()` (kiểm user của `TEST_ACCT_DATABASE_URL` là `siscom_acct`); `ALL_PERMS` / `CRM_ADMIN` trong `test-app.ts` có `access.approve`.

- [ ] **Step 1: Test đỏ (unit)**
  - `acct-db-url.spec.ts`: thiếu biến ⇒ `null`; `'  '` ⇒ `null`; URL hợp lệ ⇒ trả nguyên.
  - `db-role-check.spec.ts` thêm: pool `'acct'` với đúng 12 hàm ⇒ không vi phạm; thêm 1 hàm lạ ⇒ vi phạm; có quyền INSERT một bảng ⇒ vi phạm; hai pool cũ không đổi kết quả.
  - `scope-merge.spec.ts` thêm: `mergeScopes([{code:'access.approve',scope:'ALL'}])` giữ mã này.
  - `all-exceptions.filter.spec.ts` thêm: `DomainException(503,'ACCOUNT_ADMIN_UNAVAILABLE', msg)` ⇒ body `code === 'ACCOUNT_ADMIN_UNAVAILABLE'`; `DomainException(503,'KHAC', msg)` và `Error` thường ⇒ `INTERNAL_ERROR`.
  - `accounts.errors.spec.ts`: mỗi tiền tố ⇒ đúng status + code; lỗi `23505` không tiền tố ⇒ `null`; thông báo trả ra không chứa chuỗi SQL gốc.
- [ ] **Step 2: Chạy đỏ** — `cd backend && DATABASE_URL=postgresql://x:x@127.0.0.1:1/x npm run test:unit -- acct-db-url db-role-check scope-merge all-exceptions accounts.errors`. Kỳ vọng: FAIL (chưa có hàm / nhánh).
- [ ] **Step 3: Hiện thực** theo Interfaces. `AcctPrismaService` thêm vào `providers` + `exports` của `PrismaModule`.
- [ ] **Step 4: Chạy xanh** — lệnh Step 2 ⇒ PASS; `npm run test:unit` toàn bộ ⇒ PASS; `npx tsc --noEmit -p tsconfig.json` ⇒ 0 lỗi.
- [ ] **Step 5: Commit** — `git commit -m "feat(accounts): ket noi siscom_acct, access.approve toi ung dung, ma loi tai khoan"`

### Task 4: API đọc — danh sách, vai trò, phòng ban

**Files:**
- Create: `backend/src/modules/accounts/accounts.module.ts`, `accounts.controller.ts`, `accounts.read.service.ts`, `dto/query-accounts.dto.ts`, `accounts.read.service.spec.ts`
- Modify: `backend/src/app.module.ts` (đăng ký `AccountsModule`)

**Interfaces:**
- Consumes: `AcctPrismaService`, `accountErrors`, `ACTOR_PROVIDER.scopeFor(actor, 'access.approve')`, `ActorGuard`, `@CurrentCtx()`.
- Produces:
  - `GET /api/v1/accounts?page&pageSize&q&role&status` ⇒ `{ items: AccountRow[], page, pageSize, total, totalPages }`
  - `AccountRow = { id, code, fullName, email, departmentId, departmentName, positionTitle, roles: string[], login: 'ACTIVE' | 'MUST_CHANGE' | 'DISABLED' | 'NONE', isSystem: boolean, isSelf: boolean, updatedAt: string }`
  - `GET /api/v1/accounts/roles` ⇒ `[{ code, name, grantable: boolean }]`; `GET /api/v1/accounts/departments` ⇒ `[{ id, name }]` (chỉ `is_active`).
  - `AccountsReadService.requireManager(ctx: RequestCtx): void` — không có `access.approve` ⇒ `accountErrors.forbidden()`; dùng lại ở Task 5.
  - `AccountsReadService.rowById(tx, id: string, selfId: string): Promise<AccountRow>` — không thấy / đã xoá ⇒ `notFound()`; dùng lại ở Task 5.
  - `login`: credential ACTIVE + `must_change_password` ⇒ `MUST_CHANGE`; ACTIVE ⇒ `ACTIVE`; DISABLED ⇒ `DISABLED`; không có ⇒ `NONE`. `isSystem` = có vai trò `admin`. Nhân viên `deleted_at` không hiện. Sắp theo `code`. `pageSize` mặc định 50, tối đa 100.

- [ ] **Step 1: Test đỏ (unit, Prisma giả)** — `accounts.read.service.spec.ts`: không có `access.approve` ⇒ ném 403 và **không** gọi database; ánh xạ 4 giá trị `login`; `isSystem` / `isSelf`; `q` cắt khoảng trắng, < 2 ký tự ⇒ 400; `role` ngoài 5 mã ⇒ 400; `AcctPrismaService.available === false` ⇒ 503 `ACCOUNT_ADMIN_UNAVAILABLE`.
- [ ] **Step 2: Chạy đỏ** — `npm run test:unit -- accounts.read`.
- [ ] **Step 3: Hiện thực** — truy vấn chỉ đọc qua `acct.client()`; route tĩnh `roles`, `departments` khai báo trước mọi route `:id` (Task 5).
- [ ] **Step 4: Chạy xanh** + `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `git commit -m "feat(accounts): API doc danh sach tai khoan, vai tro, phong ban"`

### Task 5: API ghi — sáu thao tác

**Files:**
- Create: `backend/src/modules/accounts/accounts.flow.ts`, `accounts.write.service.ts`, `dto/create-account.dto.ts`, `dto/update-account.dto.ts`, `dto/change-role.dto.ts`, `dto/temp-password.dto.ts`, `dto/disable-account.dto.ts`, `accounts.flow.spec.ts`, `accounts.static-guards.spec.ts`
- Modify: `accounts.controller.ts`, `accounts.module.ts`
- Test: `backend/test/accounts.int-spec.ts`. Bootstrap chỉ chạy được một lần mỗi DB thử (`auth.int-spec.ts:58-68`); nếu vì thế tệp riêng không dựng được người dùng đăng nhập thật thì đặt khối `describe('P1 accounts')` trong `auth.int-spec.ts` cạnh khối FV-5 (`:1205+`) và dùng lại `login()` / `session()` ở đó. Quyết định ở Step 1, ghi một dòng lý do trong mô tả PR.

**Interfaces:**
- Consumes: Task 3; Task 4 (`requireManager`, `rowById`); `Argon2PasswordHasher`, `checkPasswordPolicy`, `LoginLimiter`.
- Produces (tất cả cần `access.approve`; trả `AccountRow` sau thao tác):
  - `POST /api/v1/accounts` body `{ fullName, email, departmentId?, positionTitle?, role, tempPassword }` ⇒ 201
  - `PATCH /api/v1/accounts/:id` body `{ updatedAt, fullName, email, departmentId?, positionTitle? }`
  - `POST /api/v1/accounts/:id/role` body `{ role }`
  - `POST /api/v1/accounts/:id/reset-password` body `{ tempPassword }`
  - `POST /api/v1/accounts/:id/disable` body `{ reason }` (1–200 ký tự)
  - `POST /api/v1/accounts/:id/enable` body `{ tempPassword }`
- `accounts.flow.ts` (hàm trên `tx`, không biết HTTP):
  - `findSystemRequester(tx): Promise<string>` — 0 hoặc > 1 ⇒ `noSystemRequester()`.
  - `approved(tx, sys: string, clicker: string, type: 'ROLE_GRANT' | 'ROLE_REVOKE_CRITICAL' | 'PASSWORD_RESET', employeeId: string, roleId: string | null): Promise<string>` — `request_create(sys, …, payload {source:'p1-account-admin', clickedBy}, ttl 5)` rồi `request_decide(clicker, req, true)`; kết quả khác `'APPROVED'` ⇒ ném.
  - `setTempPassword(tx, sys, clicker, employeeId, secret: {hash, algo, params}): Promise<void>` — khoá dòng credential `FOR UPDATE` (chỉ cột được phép); `approved(PASSWORD_RESET)`; `reset_token_issue(sys, req, sha256(token), 5)` với `token = randomBytes(32).toString('base64url')` không rời hàm; `reset_password(employee, token, …)` phải trả `'OK'` (khác ⇒ ném `validation(['Không đặt được mật khẩu cho tài khoản này.'])`); `fn_auth_api_must_change_set(clicker, employee, <token_version mới>)`.
  - `inAcctTx<T>(acct: AcctPrismaService, fn: (tx) => Promise<T>): Promise<T>` — transaction với `SET LOCAL lock_timeout = '5s'`, `statement_timeout = '15s'`; bắt lỗi ⇒ `throw mapAccountDbError(e) ?? e`.
- Thứ tự từng thao tác: đúng bảng mục 6.3 của Spec; bước cuối gọi `fn_auth_api_account_audit(clicker, <ACCOUNT_*>, employee, changes)` (riêng "sửa thông tin" không gọi — `employee_update` đã ghi). Máy chủ tự chặn trước khi vào các hàm đặc quyền: đích là chính mình (trừ PATCH) ⇒ `selfModification()`; đích `isSystem` ⇒ `systemAccount()`; đích có ≠ 1 vai trò khi đổi vai trò ⇒ `multiRole()`; vai trò mới = cũ ⇒ 400; `enable` trên tài khoản không DISABLED / `disable` trên tài khoản không ACTIVE ⇒ 400.
- Giới hạn tần suất: `new LoginLimiter({ windowMs: 60_000, maxPerSource: 30, maxPerIdentifier: 30 })`, khoá theo người bấm; vượt ⇒ `rateLimited()`.

- [ ] **Step 1: Test tích hợp đỏ** — DB thử đã tách role + `TEST_ACCT_DATABASE_URL`, đăng nhập thật bằng tài khoản `crm_admin` của bootstrap (gọi là A). Các ca (tên test tiếng Việt như các int-spec khác):
  - **Thêm:** vai trò `sales` ⇒ 201; `GET /accounts` thấy `login: 'MUST_CHANGE'`; người mới đăng nhập được bằng mật khẩu tạm và `/auth/me` có `mustChangePassword: true`; `audit_log` có `ACCOUNT_CREATE` với `actor_employee_id` = A; không dòng `privileged_change_request` nào còn `PENDING` / `APPROVED`.
  - **Thêm lỗi, không sót gì:** email `'  SALE@thu.local '` (trùng, khác hoa thường) ⇒ 409 `EMAIL_TAKEN`; mật khẩu tạm 11 ký tự / trùng email / toàn khoảng trắng ⇒ 400; `role: 'admin'` ⇒ 400. Sau mỗi ca: số dòng `employee`, `employee_credential`, `employee_role`, `privileged_change_request` bằng trước khi gọi.
  - **Sửa:** đúng `updatedAt` ⇒ 200, `code` không đổi; gửi lại `updatedAt` cũ ⇒ 409 `VERSION_CONFLICT` và tên trong DB vẫn là bản lưu trước; A sửa chính mình ⇒ 200; sửa tài khoản hệ thống ⇒ 403 `SYSTEM_ACCOUNT`.
  - **Đổi vai trò:** `sales` → `accountant` ⇒ `roles: ['accountant']`; → `crm_admin` ⇒ 200 (gọi người này là B); A đổi B về `sales` ⇒ 200 và có yêu cầu `ROLE_REVOKE_CRITICAL` trạng thái `EXECUTED`; A đổi vai trò của chính mình ⇒ 403 `SELF_MODIFICATION`; nhân viên được gán 2 vai trò bằng `withAdmin` ⇒ 409 `MULTI_ROLE_UNSUPPORTED`.
  - **Cấp lại mật khẩu:** phiên cũ của người đó nhận 401; đăng nhập mật khẩu tạm ⇒ `mustChangePassword: true`; A cấp lại cho chính mình ⇒ 403.
  - **Khoá / mở lại:** khoá ⇒ phiên cũ 401, `login: 'DISABLED'`, `employee.status` vẫn `ACTIVE`; A tự khoá ⇒ 403 `SELF_MODIFICATION`; khoá tài khoản hệ thống ⇒ 403 `SYSTEM_ACCOUNT`; mở lại ⇒ `login: 'MUST_CHANGE'`, đăng nhập được; mở lại tài khoản đang dùng ⇒ 400.
  - **Người duyệt cuối cùng:** khi A là người duyệt duy nhất, gọi thẳng `fn_auth_api_credential_disable(<tài khoản hệ thống>, A, 'thu')` qua kết nối `acct` trong `inAcctTx` ⇒ ném `DomainException` 409 `LAST_APPROVER` (đường này không tới được qua HTTP vì tự khoá bị chặn trước; test ghim phần ánh xạ lỗi).
  - **Quyền:** 4 vai trò còn lại gọi từng API ⇒ 403; chưa đăng nhập ⇒ 401.
  - **Chưa bật:** dựng app với `AcctPrismaService` giả `available: false` ⇒ mọi API tài khoản 503 `ACCOUNT_ADMIN_UNAVAILABLE`, `GET /api/v1/health` ⇒ 200.
  - **Không lộ mật khẩu:** thân phản hồi của mọi API ghi và mọi dòng `audit_log` sinh ra trong tệp test không chứa chuỗi mật khẩu tạm đã dùng.
- [ ] **Step 2: Chạy đỏ** — `npm run test:e2e:customers -- accounts` (hoặc `-- auth` nếu đặt trong `auth.int-spec.ts`). Kỳ vọng: FAIL 404.
- [ ] **Step 3: Test unit đỏ** — `accounts.flow.spec.ts` (tx giả ghi lại thứ tự gọi): `approved` gọi `request_create` với `sys` rồi `request_decide` với `clicker`; `setTempPassword` gọi đúng thứ tự 5 bước và dừng (không gọi `must_change_set`) khi `reset_password` trả `'EXPIRED'`; `findSystemRequester` 0 / 2 dòng ⇒ 503. `accounts.static-guards.spec.ts`: thư mục `modules/accounts` không import `PrismaService` / `AuthPrismaService`; không có `$executeRawUnsafe` / `$queryRawUnsafe`; không lệnh log nào nhận biến tên chứa `password`; trong controller các route tĩnh đứng trước `:id`.
- [ ] **Step 4: Hiện thực** `accounts.flow.ts`, `accounts.write.service.ts`, DTO (class-validator như DTO của opportunities), controller.
- [ ] **Step 5: Chạy xanh** — unit toàn bộ; int-spec của Step 2; `npx tsc --noEmit`.
- [ ] **Step 6: Commit** — `git commit -m "feat(accounts): sau thao tac quan ly tai khoan (mot lan bam, tao-duyet-thuc thi trong mot transaction)"`

### Task 6: Giao diện — trang Tài khoản

**Files:**
- Create: `frontend/siscom-crm-web/src/features/accounts/accountsModel.js`, `accountsUi.js`, `AccountsPage.jsx`, `AccountDialogs.jsx`
- Create: `frontend/siscom-crm-web/tests/accountsModel.test.mjs`, `tests/accountsApiUi.test.mjs`
- Modify: `src/data/api/customerApiClient.js` (cổng `accountRequest`, whitelist đường dẫn `/accounts…`), `src/data/api/customerRepository.js` (`repo.accounts`), `src/features/customers/customerApiUi.js` (nối `accounts` như `opportunities` ở `:406`), `src/App.jsx` (`parseRoute`, cổng quyền, thân trang, `NAV`), `src/ds/navigation/Sidebar.jsx:66` (`{ id: 'accounts', label: 'Tài khoản', icon: 'id-card' }` thay mục `hr`), `.github/workflows/ci.yml` (thêm 2 tệp test vào `FILES`)

**Interfaces:**
- Consumes: API Task 4 + 5; `me.permissions['access.approve']`; `DataTable`, `Modal`, `Field`, `Input`, `Select`, `Badge`, `Button`, `Toast`, `EmptyState` từ `src/ds/index.js`; `describeRepoError`.
- Produces:
  - `canManageAccounts(perm: (code) => string | null): boolean`
  - `GRANTABLE_ROLES = ['sales','technician','accountant','crm_admin']`; `LOGIN_LABEL = { ACTIVE: 'Đang dùng', MUST_CHANGE: 'Chờ đổi mật khẩu', DISABLED: 'Đã khoá', NONE: 'Chưa có mật khẩu' }`
  - `rowActions(row): { edit, role, resetPassword, disable, enable }` — mỗi mục `{ enabled: boolean, reason?: string }`; `isSystem` ⇒ tất cả tắt; `isSelf` ⇒ chỉ `edit` bật, lý do: "Không tự đổi vai trò của mình", "Dùng \"Đổi mật khẩu\" của bạn", "Không tự khoá chính mình"; `roles.length !== 1` ⇒ `role` tắt, lý do "Tài khoản có nhiều vai trò, cần xử lý riêng"; `login === 'DISABLED'` ⇒ `enable` bật, `disable` + `resetPassword` tắt; ngược lại `enable` tắt.
  - `validateAccountForm(kind, values): string[]` — cùng quy tắc với máy chủ (họ tên, email, mật khẩu tạm ≥ 12, lý do 1–200).
  - `accountErrorMessage(err): string` — theo mã: `EMAIL_TAKEN` "Email này đã có người dùng."; `VERSION_CONFLICT` "Thông tin vừa được người khác sửa. Tải lại rồi thử lại."; `LAST_APPROVER` "Không thể khoá hoặc gỡ quyền của Quản trị CRM cuối cùng."; `LAST_ADMIN` "Không thể khoá tài khoản hệ thống cuối cùng."; `SELF_MODIFICATION` "Bạn không tự làm thao tác này trên tài khoản của mình được."; `SYSTEM_ACCOUNT` "Không thao tác được trên tài khoản hệ thống."; `MULTI_ROLE_UNSUPPORTED` "Tài khoản có nhiều vai trò, cần xử lý riêng."; `ACCOUNT_ADMIN_UNAVAILABLE` "Chức năng quản lý tài khoản chưa được bật trên máy chủ."; `SYSTEM_REQUESTER_UNAVAILABLE` "Thiếu tài khoản hệ thống, chưa quản lý tài khoản được. Báo người quản trị máy chủ."; `RATE_LIMITED` "Thao tác quá nhanh. Chờ một phút rồi thử lại."; còn lại dùng `describeRepoError`.
  - Route `#/accounts`; trang chỉ hiện khi `API_ON && canManageAccounts(...)`; không có quyền mà gõ thẳng địa chỉ ⇒ trang "không có quyền" như các trang khác.
- Bố cục và chữ: theo bản xem thử Owner đã duyệt 23/11 (ngoài repo: `siscom-tien-do/p1/tai-khoan-xem-thu.html`) — thẻ gồm dòng mô tả, hàng lọc (tìm, vai trò, trạng thái), nút "+ Thêm nhân viên" + số đếm "n / tổng tài khoản", bảng 6 cột (Mã; Nhân viên [ảnh chữ cái + tên + email + nhãn "bạn"]; Phòng ban [+ chức danh]; Vai trò; Đăng nhập; thao tác "⋯"). Dòng hệ thống ghi "Tài khoản hệ thống", không nút. Hộp thoại Khoá dùng nút kiểu nguy hiểm và câu "Người này bị đăng xuất ngay và không đăng nhập được nữa. Khách hàng, cơ hội và lịch sử của họ giữ nguyên. Có thể mở lại sau." Sau thêm / cấp lại / mở lại: Toast "Hãy đưa mật khẩu tạm trực tiếp cho <tên>. Họ sẽ phải đổi khi đăng nhập lần đầu." Ô mật khẩu tạm `type="password" autocomplete="new-password"`, xoá giá trị khỏi state ngay khi hộp thoại đóng.

- [ ] **Step 1: Test đỏ** — `accountsModel.test.mjs`: `rowActions` cho 5 loại dòng (thường, chính mình, hệ thống, đã khoá, nhiều vai trò) với đúng `enabled` + `reason` ở trên; `validateAccountForm` (email sai, mật khẩu 11 ký tự, lý do rỗng); `accountErrorMessage` cho từng mã; `canManageAccounts`. `accountsApiUi.test.mjs` (`miniDom` + fetch giả): mở trang ⇒ gọi `GET /api/v1/accounts`; thêm nhân viên ⇒ `POST` đúng body, danh sách tải lại, Toast có tên người mới, **DOM không còn giá trị mật khẩu**; máy chủ trả 409 `VERSION_CONFLICT` khi sửa ⇒ hộp thoại vẫn mở, hiện đúng câu, bấm "Tải lại" lấy `updatedAt` mới và giữ nội dung người dùng đang gõ; dòng hệ thống không có nút; người không có `access.approve` ⇒ không có mục menu và `#/accounts` hiện trang không có quyền; 503 ⇒ hiện câu "chưa được bật".
- [ ] **Step 2: Chạy đỏ** — `cd frontend/siscom-crm-web && node --test tests/accountsModel.test.mjs tests/accountsApiUi.test.mjs`.
- [ ] **Step 3: Hiện thực** model → cổng API + repo → controller `accountsUi.js` → `AccountsPage.jsx` + `AccountDialogs.jsx` → `App.jsx` + `Sidebar.jsx`.
- [ ] **Step 4: Chạy xanh** — hai tệp trên; toàn bộ danh sách `FILES` của CI (đã thêm 2 tệp) ⇒ PASS; `npm run build` với `VITE_CRM_AUTH_ENABLED=true VITE_CRM_API_ENABLED=true VITE_CRM_API_BASE=/api/v1`.
- [ ] **Step 5: Thử tay trên môi trường thử cách ly** (máy Owner, không phải production): đủ 6 thao tác, máy tính + khung điện thoại, sáng + tối; so với bản xem thử; ghi kết quả vào mô tả PR.
- [ ] **Step 6: Commit** — `git commit -m "feat(accounts): trang Tai khoan (danh sach, 6 thao tac) cho Quan tri CRM"`

### Task 7: Bật trên máy chủ và theo dõi

**Files:**
- Modify: `docs/VPS_RUNBOOK.md` (mục mới "Bật quản lý tài khoản P1"), `docs/P1_ACCOUNT_ADMIN_DESIGN.md` (dòng trạng thái)
- Ngoài repo (máy Owner): `siscom-tien-do/daily-check.sh` — mục 6 "Thay đổi tài khoản 24 giờ"

**Interfaces — Consumes:** `create-db.sh <db> acct` (Task 2), `deploy.sh --migrate`.

- [ ] **Step 1: Runbook** — thứ tự: (1) sao lưu (`deploy.sh` tự làm); (2) `create-db.sh siscom_crm_prod acct` — tạo role, thêm `SISCOM_ACCT_PW`, ghi `ACCT_DATABASE_URL` vào `backend.env`, giữ nguyên mật khẩu các role khác; (3) `deploy.sh --src … --frontend … --migrate --auto-rollback` (migration #18, GRANTS V6, 3 VERIFY); (4) kiểm chỉ đọc: 18 migration, `PASS|75` + `PASS|33` + `PASS|<n>`, `GET /api/v1/accounts` chưa đăng nhập ⇒ 401; (5) lùi: `deploy.sh --rollback` (mã cũ không dùng role mới; role và 4 hàm để lại vô hại), gỡ hẳn theo `P1_ACCOUNT_ADMIN_ROLLBACK` + `unacct` cần duyệt riêng. Ghi rõ ba lời duyệt cần có: `OWNER_APPROVED_MIGRATION siscom_crm_prod`, duyệt đổi cấu hình VPS (role + biến môi trường), duyệt triển khai.
- [ ] **Step 2: `daily-check.sh` mục 6** — truy vấn chỉ đọc `audit_log` 24 giờ với `action IN ('ACCOUNT_CREATE','ACCOUNT_ROLE_CHANGE','ACCOUNT_PASSWORD_RESET','ACCOUNT_DISABLE','ACCOUNT_ENABLE','EMPLOYEE_UPDATE')`: in số dòng và từng dòng `giờ | action | mã NV bị tác động | mã NV người bấm`; truy vấn lỗi ⇒ KHÔNG ĐẠT. Thử: chạy trên VPS trước khi bật P1 ⇒ "0 thay đổi", `KET QUA` không đổi; giả lập truy vấn lỗi ⇒ KHÔNG ĐẠT.
- [ ] **Step 3: Commit** — `git commit -m "docs(accounts): runbook bat P1 tren may chu"`

---

## Thứ tự PR đề xuất

1. PR A — thiết kế + kế hoạch này (chỉ tài liệu).
2. PR B — Task 1 + Task 2 (database, CI). Không đổi hành vi ứng dụng.
3. PR C — Task 3 + 4 + 5 (backend). Chưa có `ACCT_DATABASE_URL` trên production ⇒ API trả 503, không ảnh hưởng gì khác.
4. PR D — Task 6 (giao diện) + Task 7 (runbook).
5. Triển khai production một lần sau khi B, C, D đã merge và Owner thử xong trên môi trường thử.
