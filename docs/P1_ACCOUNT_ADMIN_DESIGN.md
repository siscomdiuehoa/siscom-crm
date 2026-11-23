# P1 — Màn hình quản lý tài khoản (thiết kế)

- **Trạng thái:** Owner duyệt thiết kế 23/11/2026. Đã có mã (migration #18, role `siscom_acct`, API `/accounts`, trang Tài khoản) — **chưa bật trên máy chủ**; cách bật: `docs/VPS_RUNBOOK.md` mục 13.
- **Ngày:** 23/11/2026. **Nền:** `main` = `695d0be` (production đang chạy `5d9dbf5`, 17 migration).
- **Liên quan:** `docs/PRODUCTION_GO_LIVE_PLAN.md` (D1, mục 2.3), `docs/FV5_ACCOUNT_ADMIN.md`, `backend/docs/B1.3.1_FINAL_DESIGN.md`.

## 1. Mục đích

Owner tự quản lý tài khoản nhân viên **trên giao diện**, không cần chạy lệnh trên máy chủ:

- thêm nhân viên mới và cho họ đăng nhập;
- sửa họ tên / email / phòng ban / chức danh — trước hết để đổi 5 tài khoản đang đặt tên theo vai trò (`sysadmin@`, `admin@`, `sale@`, `kythuat@`, `ketoan@`) thành người thật, **trên cùng bản ghi** (giữ mã nhân viên, lịch sử, quyền sở hữu khách hàng);
- đổi vai trò; cấp lại mật khẩu; khoá tài khoản người nghỉ, mở lại khi cần.

Vì sao bây giờ: CRM đã mở từ 21/11 với đúng 5 tài khoản; chưa có P1 thì không thêm được người và mỗi tài khoản đang mang tên vai trò chứ không phải tên người.

## 2. Quyết định của Owner (23/11/2026)

1. **Một người thao tác.** Owner không muốn mỗi thay đổi phải có hai người đăng nhập. Người thao tác là tài khoản **Quản trị CRM** (`admin@`). Quyết định này **thay** quyết định 10/11 và 20/11 ("phải có hai người thật, không chấp nhận một người làm thay hai người") cho các thao tác trong phạm vi P1.
2. **Cách 1 — một lần bấm, giữ nguyên cơ chế trong database.** Không gỡ ràng buộc hai người của database; máy chủ tự đóng vai "người gửi yêu cầu" bằng tài khoản hệ thống.

Owner đã được báo cái giá: nếu `admin@` bị lộ mật khẩu hoặc bấm nhầm thì một mình tài khoản đó tạo được tài khoản và cấp được vai trò. Bù lại: mọi thao tác ghi nhật ký, và bản kiểm mỗi sáng liệt kê thay đổi tài khoản trong 24 giờ (mục 7).

## 3. Mục tiêu, ngoài phạm vi, điều phải tránh

**Mục tiêu**
- Một trang "Tài khoản" chỉ Quản trị CRM thấy: danh sách + 6 thao tác (thêm, sửa thông tin, đổi vai trò, cấp lại mật khẩu, khoá, mở lại).
- Mỗi thao tác là **một lần bấm** của Quản trị CRM, có hiệu lực ngay.
- Mọi thao tác để lại dấu trong `audit_log`, biết ai bấm, lúc nào, đổi gì.
- Các lớp chặn sẵn có của database vẫn nguyên: không tự sửa quyền của chính mình, không gỡ / khoá quản trị viên cuối cùng hay người duyệt cuối cùng, một người không giữ cả quyền gửi yêu cầu lẫn quyền duyệt.

**Ngoài phạm vi (đợt này)**
- Sửa ma trận quyền của vai trò (`ROLE_PERMISSION_CHANGE`), tạo vai trò mới, quản lý phòng ban.
- Tự phục hồi mật khẩu qua email ("quên mật khẩu").
- Xoá nhân viên. Người nghỉ thì **khoá**, không xoá.
- Cấp vai trò **Quản trị hệ thống (kỹ thuật)** (`admin`) qua giao diện.
- Xem nhật ký thay đổi trên giao diện (đợt này chỉ ghi; xem qua bản kiểm sáng).

**Điều phải tránh**
- Sửa tay database thật để làm việc của P1.
- Ghi hoặc trả ra mật khẩu, mã đặt lại mật khẩu ở bất kỳ nhật ký / phản hồi API nào.
- Làm yếu các ràng buộc, trigger, bộ VERIFY của phần đăng nhập đang chạy thật.
- Tạo-mới-rồi-xoá để "đổi tên" tài khoản (mất lịch sử).

## 4. Các cách đã cân nhắc

| | Cách 1 (chọn) | Cách 2 | Cách 0 (đã bỏ) |
|---|---|---|---|
| Mô tả | Giao diện một lần bấm; máy chủ tạo yêu cầu dưới tên tài khoản hệ thống rồi người bấm duyệt ngay, cùng một transaction | Gỡ / nới cơ chế hai người trong database (CHECK, trigger, phân tách quyền) | Hai người thật, mỗi người đăng nhập và bấm |
| Khối lượng | Nhỏ: API + trang + 1 migration cộng thêm | Lớn: đụng lõi bảo mật đã qua nhiều vòng review | Vừa: thêm hàng chờ duyệt |
| Rủi ro | Thấp: lớp chặn database còn nguyên | Cao: dễ hỏng đăng nhập đang chạy | Thấp |
| Quay lại hai người | Dễ: tắt bước tự tạo yêu cầu | Phải làm lại | — |
| Lý do | Đúng ý Owner (một người), ít đụng nhất | Rủi ro không tương xứng | Owner không muốn (23/11) |

## 5. Hiện trạng dùng lại

- Bảng `employee`, `employee_credential`, `employee_role`, `role`, `privileged_change_request`, `password_reset_token`, `audit_log` và các trigger bảo vệ (migration `b1_2_crm_core`, `b1_3_auth_core`, `…_m1_1_guards`, `…_m1_2_priv_api`).
- Các hàm `fn_auth_api_*` (SECURITY DEFINER, chủ `siscom_migrator`): `request_create`, `request_decide`, `role_grant`, `role_revoke`, `reset_token_issue`, `reset_password`, `credential_create`, `credential_disable`. Hiện **không** role ứng dụng nào được gọi (trừ `change_own_password` cho `siscom_auth`).
- Vai trò: `admin` = nhóm **gửi yêu cầu** (REQUEST), `crm_admin` = nhóm **duyệt** (APPROVE). `sysadmin@` giữ `admin`; `admin@` giữ `crm_admin`.
- Luồng tham chiếu: `backend/src/modules/auth/account-admin.ts` (lệnh FV-5, chỉ chạy trên database thử) — thứ tự gọi hàm khi thêm tài khoản / cấp lại mật khẩu.
- Giao diện: `GET /auth/me` trả `permissions`; trang đăng ký trong `App.jsx` (`parseRoute`, `NAV`); màn hình buộc đổi mật khẩu khi `mustChangePassword`.
- Chưa có: API quản trị, trang quản trị, hàm database để tạo / sửa `employee`, hàm bật lại `must_change_password`.

## 6. Thiết kế

### 6.1 Ai được làm gì

- Trang và mọi API của P1 yêu cầu quyền **`access.approve`** — quyền `crm_admin` đang có sẵn và cũng là quyền database đòi ở bước duyệt. *(Lựa chọn của người thiết kế, sau khi soát: **không** thêm mã quyền mới. Sau khi đóng khởi tạo, gán quyền mới cho vai trò phải đi qua yêu cầu `ROLE_PERMISSION_CHANGE` hai người (M1:426-428) — việc nằm ngoài phạm vi đợt này; và người bấm đằng nào cũng cần `access.approve`.)* Dưới đây "người quản lý tài khoản" = người có `access.approve`.
- **Tài khoản hệ thống:** nhân viên đang giữ vai trò `admin` (`sysadmin@`) trở thành danh tính "người gửi yêu cầu" do máy chủ dùng. Máy chủ tìm nó lúc chạy: đúng **một** nhân viên ACTIVE, credential ACTIVE, có vai trò `admin`; không có hoặc có hơn một ⇒ mọi thao tác P1 trả lỗi `SYSTEM_REQUESTER_UNAVAILABLE` (không đoán).
  - Trên trang, tài khoản này hiện nhãn "Tài khoản hệ thống" và **không** có nút thao tác nào (không sửa, không khoá, không đổi vai trò, không cấp lại mật khẩu).
  - Việc ai còn giữ mật khẩu `sysadmin@` là việc vận hành của Owner (khuyến nghị: không ai dùng để đăng nhập hằng ngày); thiết kế này không phụ thuộc vào đó.

### 6.2 Luồng một lần bấm

Mỗi thao tác cần phê duyệt chạy trong **một transaction** trên kết nối riêng của P1 (mục 6.5):

1. kiểm người bấm: phiên hợp lệ, có `access.approve`;
2. `fn_auth_api_request_create(<tài khoản hệ thống>, <loại>, <nhân viên>, <vai trò>, payload, ttl)` — payload ghi `{"source":"p1-account-admin","clickedBy":<người bấm>}`;
3. `fn_auth_api_request_decide(<người bấm>, <yêu cầu>, true)` — bước **duy nhất** gọi với danh tính người bấm;
4. hàm thực thi tương ứng (`role_grant`, `role_revoke`, `reset_token_issue` + `reset_password`, `credential_create`, `credential_disable`) — gọi với danh tính **tài khoản hệ thống** (database đòi nhóm REQUEST ở các hàm này);
5. ghi **một dòng nhật ký của P1** mang danh tính người bấm (hàm mới ở mục 6.4) — vì các hàm ở bước 4 ghi nhật ký dưới tên tài khoản hệ thống, và khoá / gỡ vai trò thường không có yêu cầu nào mang tên người bấm;
6. lỗi ở bất kỳ bước nào, hoặc hàm trả mã khác `OK` (ví dụ `reset_password` trả `EMPLOYEE_INACTIVE`) ⇒ rollback toàn bộ, không để lại yêu cầu treo.

Database tự chặn người bấm thao tác trên **chính mình** và trên **tài khoản hệ thống** ở các thao tác có yêu cầu (đổi vai trò, cấp lại mật khẩu, mở lại). Riêng **khoá** không có kiểm đó trong database, nên **máy chủ tự chặn**: không khoá chính mình, không khoá tài khoản hệ thống (database vẫn chặn khoá quản trị viên / người duyệt cuối cùng). Quên mật khẩu `admin@` ⇒ cần một Quản trị CRM thứ hai, hoặc xử lý trên máy chủ có duyệt riêng. Thiết kế **cho phép** cấp vai trò `crm_admin` cho người khác để Owner có người dự phòng.

### 6.3 Sáu thao tác

| Thao tác | Dữ liệu nhập | Bên dưới | Ghi chú |
|---|---|---|---|
| Thêm nhân viên | họ tên*, email*, phòng ban, chức danh, vai trò* (một trong `sales`, `technician`, `accountant`, `crm_admin`), mật khẩu tạm* | hàm mới `fn_acct_api_employee_create` → `credential_create` → ROLE_GRANT → PASSWORD_RESET + bật buộc đổi mật khẩu | Mã nhân viên tự sinh. Email trùng (không phân biệt hoa/thường) ⇒ 409 |
| Sửa thông tin | họ tên, email, phòng ban, chức danh | hàm mới `fn_acct_api_employee_update` (có khoá lạc quan theo `updated_at`) | Không qua yêu cầu phê duyệt (database chưa có loại yêu cầu này; không thêm loại mới). Ghi nhật ký giá trị cũ → mới. Sửa được cả bản ghi của chính mình (chỉ họ tên / email / phòng ban / chức danh) |
| Đổi vai trò | vai trò mới | ROLE_GRANT vai trò mới rồi `role_revoke` vai trò cũ, cùng transaction (thứ tự này không bị phân tách quyền chặn). Gỡ vai trò nghiệp vụ: không cần yêu cầu (`p_request` NULL). Gỡ `crm_admin`: thêm một yêu cầu `ROLE_REVOKE_CRITICAL` tạo–duyệt như mục 6.2; nếu là người duyệt cuối cùng ⇒ 409 `LAST_APPROVER` | Đợt này mỗi nhân viên **một** vai trò trên giao diện. Nhân viên đang có nhiều vai trò ⇒ hiện chỉ đọc, báo cần xử lý riêng |
| Cấp lại mật khẩu | mật khẩu tạm* | PASSWORD_RESET: `reset_token_issue` (mã ngẫu nhiên sinh trong máy chủ, không rời máy chủ) → `reset_password` → bật buộc đổi mật khẩu | Thu hồi mọi phiên và thiết bị ghi nhớ của người đó (sẵn có khi `token_version` tăng) |
| Khoá | lý do | `fn_auth_api_credential_disable` | Người đó bị đăng xuất ngay. Chỉ khoá đăng nhập: `employee.status` và bản ghi nhân viên **không đổi** |
| Mở lại | mật khẩu tạm* | giống cấp lại mật khẩu (database chỉ cho DISABLED → ACTIVE kèm mật khẩu mới) | |

**Mật khẩu tạm** *(lựa chọn của người thiết kế)*: Quản trị CRM tự gõ mật khẩu tạm (≥ 12 ký tự, cùng quy tắc với đổi mật khẩu), đưa trực tiếp cho nhân viên; lần đăng nhập đầu hệ thống **buộc đổi**. Lý do: không có hạ tầng gửi email; mã đặt lại của database sống tối đa 30 phút, không hợp để trao tay. Máy chủ băm bằng argon2 như luồng đổi mật khẩu; mật khẩu tạm không ghi vào đâu ngoài bản băm.

### 6.4 Database — một migration cộng thêm (#18)

Không sửa bảng, CHECK hay trigger hiện có. Thêm:

1. `fn_acct_api_account_audit(p_actor, p_action, p_employee, p_changes jsonb) → void` — SECURITY DEFINER; kiểm `p_actor` hoạt động và thuộc nhóm APPROVE; ghi một dòng `audit_log` dưới tên người bấm (`ACCOUNT_CREATE`, `ACCOUNT_ROLE_CHANGE`, `ACCOUNT_PASSWORD_RESET`, `ACCOUNT_DISABLE`, `ACCOUNT_ENABLE`). Không nhận và không ghi mật khẩu. **Không** thêm mã quyền, không sửa `fn_auth_perm_class`, không đụng `role_permission`.
2. `fn_acct_api_employee_create(p_actor, p_full_name, p_email, p_department, p_position) → uuid` — SECURITY DEFINER; kiểm `p_actor` hoạt động và thuộc nhóm APPROVE; INSERT `employee` (status ACTIVE); ghi nhật ký.
3. `fn_acct_api_employee_update(p_actor, p_employee, p_expected_updated_at, p_full_name, p_email, p_department, p_position) → timestamptz` — như trên; từ chối tài khoản hệ thống; sai `updated_at` ⇒ lỗi xung đột; nhật ký ghi cũ → mới.
4. `fn_acct_api_must_change_set(p_actor, p_employee, p_expected_token_version) → void` — bật `must_change_password = true` cho credential ACTIVE đúng `token_version` vừa đặt lại; thay cho câu UPDATE trực tiếp của FV-5 (thứ Owner đã không cho dùng trên production). Đã soát: `fn_cred_secret_guard` (M1.2:38-52) và `fn_cred_before_update` (M1:513-522) cho phép cập nhật chỉ đổi `must_change_password` trên credential ACTIVE.
5. Role database mới **`siscom_acct`** (LOGIN, không superuser / createdb / createrole, không sở hữu gì), được: CONNECT; SELECT trên `employee`, `employee_role`, `role`, `department`, `employee_credential` (**trừ** cột `password_hash`, `password_params`); EXECUTE đúng các hàm `fn_auth_api_*` mà P1 dùng (mục 5 + bốn hàm mới). `siscom_app` và `siscom_auth` **giữ nguyên** — vẫn không gọi được hàm đặc quyền nào.
6. Cập nhật `APP_GRANTS` (bản V6) và hai tệp VERIFY: thêm nhóm kiểm cho `siscom_acct` (được đúng những gì ở trên, không hơn); các kiểm hiện có cho app / auth không đổi kết quả.
7. Rollback viết sẵn cho migration này (gỡ bốn hàm, role), cùng kiểu các rollback hiện có.

**Điểm bảo mật cần Owner biết:** sau P1, tiến trình ứng dụng (qua `siscom_acct`) gọi được các hàm đặc quyền với danh tính do nó truyền vào. Trước đây chỉ người vận hành trên máy chủ làm được. Nghĩa là nếu **máy chủ ứng dụng** bị chiếm thì kẻ đó tự cấp được tài khoản — cơ chế hai người trong database không còn chặn được trường hợp này. Đây là hệ quả tất yếu của việc quản lý tài khoản trên giao diện với một người bấm; role riêng `siscom_acct` chỉ thu hẹp phạm vi (lỗi ở phần nghiệp vụ dùng `siscom_app` vẫn không chạm được).

### 6.5 Backend

- Module mới `accounts`, kết nối thứ ba `AcctPrismaService` (`ACCT_DATABASE_URL`, role `siscom_acct`); thiếu biến này ⇒ module trả 503 `ACCOUNT_ADMIN_UNAVAILABLE`, phần còn lại của ứng dụng chạy bình thường. Kiểm lúc khởi động như hai kết nối kia (không chạy bằng role chủ).
- API (tiền tố `/api/v1/accounts`, tất cả cần đăng nhập + `access.approve`):
  - `GET /` — danh sách: mã, họ tên, email, phòng ban, chức danh, vai trò, trạng thái đăng nhập (đang dùng / đã khoá / chưa có mật khẩu), có phải tài khoản hệ thống, có phải chính mình, `updatedAt`. Phân trang như các danh sách khác.
  - `POST /` thêm; `PATCH /:id` sửa thông tin; `POST /:id/role`; `POST /:id/reset-password`; `POST /:id/disable`; `POST /:id/enable`.
  - `GET /roles`, `GET /departments` cho ô chọn.
- Lỗi theo bảng của `B1.3.1_FINAL_DESIGN.md`: 403 `SELF_MODIFICATION`, 409 `LAST_ADMIN` / `LAST_APPROVER` / `EMAIL_TAKEN` / `VERSION_CONFLICT`, 400 lỗi nhập, 503 như trên. Thông báo tiếng Việt, không lộ chi tiết database.
- Giới hạn tần suất riêng cho các API ghi của P1 (cùng cơ chế giới hạn đăng nhập hiện có).
- Biến môi trường mới trên máy chủ: `ACCT_DATABASE_URL` trong `backend.env`; `create-db.sh` / `provision.sh` tạo role và mật khẩu của nó theo đúng cách đang làm với `siscom_auth`.

### 6.6 Giao diện

Mục menu "Tài khoản" (thay chỗ giữ chỗ "Nhân sự"), chỉ hiện khi có `access.approve`. Một trang:

```
Tài khoản                                              [+ Thêm nhân viên]
┌────────┬──────────────────┬───────────────────┬──────────────┬───────────┬─────┐
│ Mã     │ Họ tên           │ Email             │ Vai trò      │ Đăng nhập │     │
├────────┼──────────────────┼───────────────────┼──────────────┼───────────┼─────┤
│ NV-0001│ Quản trị hệ thống│ sysadmin@…        │ Hệ thống     │ Đang dùng │  —  │  ← tài khoản hệ thống
│ NV-0002│ Quản trị CRM     │ admin@…  (bạn)    │ Quản trị CRM │ Đang dùng │ Sửa │
│ NV-0003│ Nhân viên KD     │ sale@…            │ Kinh doanh   │ Đang dùng │  ⋯  │
│ NV-0006│ Trần Thị B       │ b@…               │ Kế toán      │ Đã khoá   │  ⋯  │
└────────┴──────────────────┴───────────────────┴──────────────┴───────────┴─────┘
 ⋯ = Sửa thông tin · Đổi vai trò · Cấp lại mật khẩu · Khoá / Mở lại
```

- Mỗi thao tác mở một hộp thoại nhỏ; thao tác đổi quyền / mật khẩu / khoá có dòng xác nhận nói rõ hậu quả ("người này sẽ bị đăng xuất ngay").
- Dùng các thành phần giao diện sẵn có (bảng, hộp thoại, thông báo lỗi của trang Cơ hội); điện thoại: bảng thành thẻ như các trang khác.
- Sau "Thêm nhân viên" / "Cấp lại mật khẩu": nhắc "đưa mật khẩu tạm trực tiếp cho nhân viên; họ sẽ phải đổi khi đăng nhập lần đầu". Không hiện lại mật khẩu.

## 7. Theo dõi sau khi bật

- `daily-check.sh` thêm một mục chỉ đọc: liệt kê các dòng `audit_log` về tài khoản trong 24 giờ (thêm, sửa, đổi vai trò, đặt lại mật khẩu, khoá) — chỉ loại thao tác, mã nhân viên bị tác động, người bấm, giờ. Bản báo sáng nêu số thay đổi; có thay đổi thì liệt kê.

## 8. Kiểm thử

- Unit: phần kiểm nhập, ánh xạ lỗi, tìm tài khoản hệ thống (0 / 1 / nhiều).
- Tích hợp trên PostgreSQL tạm đã tách role (CI): cả 6 thao tác; các nhánh từ chối — tự thao tác trên mình, tài khoản hệ thống, quản trị viên / người duyệt cuối cùng, email trùng, xung đột phiên bản, không có `access.approve` (4 vai trò còn lại ⇒ 403); sau "thêm" thì người mới đăng nhập được và bị buộc đổi mật khẩu; sau "khoá" thì phiên cũ chết; không có yêu cầu PENDING nào sót lại sau lỗi.
- SQL: bài kiểm migration (cấu trúc, quyền `siscom_acct` đúng và đủ, app / auth không đổi), rollback, áp lại; nối vào CI như các migration trước.
- Kiểm tĩnh: module `accounts` không dùng `PrismaService` / `AuthPrismaService` để ghi; không log mật khẩu.
- Giao diện: test thành phần cho trang và 6 hộp thoại; thử tay trên môi trường thử cách ly trước khi lên production.

## 9. Thứ tự triển khai (mỗi bước Owner duyệt riêng)

1. PR Draft thiết kế này → review → Owner duyệt.
2. PR mã (có thể tách: database + backend, rồi giao diện) → CI → review → Owner duyệt merge.
3. Lên production: cần `OWNER_APPROVED_MIGRATION siscom_crm_prod` (migration #18), tạo role `siscom_acct` và thêm `ACCT_DATABASE_URL` vào `backend.env` (thay đổi cấu hình VPS — duyệt riêng), `deploy.sh --migrate`. Sao lưu trước, kiểm sau như các lần trước.
4. Việc đầu tiên sau khi bật: Owner đổi họ tên / email 4 tài khoản theo vai trò thành người thật và thêm nhân viên mới.

## 10. Phần để người làm quyết

- Tên tệp, cách chia PR, chi tiết mã của ba hàm SQL, bố cục chính xác của hộp thoại.
- Có tách `GET /roles`, `/departments` hay dùng lại API danh mục sẵn có.
- Ngưỡng giới hạn tần suất.

## 11. Đã soát và còn chưa kiểm chứng

Đã soát bằng cách đọc migration (23/11, người đọc độc lập):
- Duyệt ngay trong cùng transaction sau khi tạo yêu cầu: được (M1:341-350); luồng FV-5 đã làm vậy.
- Bật `must_change_password` riêng lẻ: trigger cho phép (mục 6.4 điểm 4).
- Cấp-rồi-gỡ vai trò giữa nhóm nghiệp vụ và `crm_admin`: không bị chặn (M1:412); chỉ `admin` ↔ `crm_admin` mới phải gỡ trước — nằm ngoài phạm vi vì giao diện không cấp `admin`.
- Thêm mã quyền mới cho vai trò sau khi đóng khởi tạo cần yêu cầu hai người ⇒ thiết kế bỏ `access.approve`, dùng `access.approve` (mục 6.1).

Chưa kiểm chứng (kiểm khi lập kế hoạch làm):
- Trạng thái "chưa có mật khẩu" có xuất hiện trên production không (5 tài khoản hiện đều có credential ACTIVE).
- Toàn bộ luồng chưa chạy thử lần nào với role `siscom_acct`; các kết luận trên là đọc mã, chưa phải chạy.
