# FV-5 — Công cụ quản lý tài khoản nhân viên (account-admin)

Dành cho **Owner / quản trị kỹ thuật**. Công cụ dòng lệnh để **thêm nhân viên**, **đặt lại mật khẩu**, **khoá đăng nhập** và **liệt kê** tài khoản **sau khi** `auth:bootstrap` đã chạy. Bootstrap chỉ chạy được một lần cho mỗi database.

> ⚠️ **TRẠNG THÁI (08/11/2026): CHỈ DÙNG TRÊN DATABASE THỬ.**
> - **Chưa** dùng trên database thật hoặc DB demo 55433. Việc cấp tài khoản thật cần Owner **duyệt riêng** bằng văn bản, và nên chờ có cơ chế phê duyệt hai người thật (thiết kế A1 + A3, đang chờ duyệt).
> - **Tạm cấm** cấp vai trò `crm_admin` (vai trò xem toàn bộ khách hàng và là người duyệt). Vai trò kỹ thuật `admin` cũng không cấp được qua công cụ này.

---

## 1. Công cụ làm gì

| Lệnh | Kết quả |
|---|---|
| `add` | Tạo nhân viên mới (họ tên, email, phòng ban, SĐT/chức danh tuỳ chọn) và tài khoản đăng nhập; gán **một** vai trò `sales`, `technician` hoặc `accountant`. Mật khẩu tạm sinh ngẫu nhiên; **lần đăng nhập đầu bắt buộc đổi mật khẩu**. |
| `reset-password` | Đặt mật khẩu tạm mới (bắt buộc đổi ở lần đăng nhập sau). Mật khẩu cũ hết hiệu lực, mọi phiên đăng nhập bị thu hồi. Lệnh này cũng **mở lại** tài khoản đang bị khoá. |
| `disable` | Khoá đăng nhập: mọi phiên đang mở bị thu hồi ngay. Database không cho khoá admin hoặc người duyệt **cuối cùng**. |
| `list` | Liệt kê nhân viên: mã, tên, email, phòng, vai trò, trạng thái, tình trạng đăng nhập. Không hiện mật khẩu hay hash. |

Mọi thay đổi đi qua **các hàm đặc quyền có sẵn trong database** (luồng hai người M1.2). Không có migration mới, không đổi phân quyền. Mỗi lệnh chạy trong **một transaction**: lỗi ở bất kỳ bước nào thì database trở lại nguyên trạng.

## 2. Cảnh báo bảo mật — đọc trước khi dùng

1. **Quyền chủ sở hữu database.** Công cụ chạy bằng `siscom_migrator`, là chủ sở hữu DB. Ai có mật khẩu này có thể làm mọi thứ trên DB. **Chỉ Owner giữ mật khẩu này**; không gửi qua chat, email hay GitHub.
2. **Phê duyệt hai người hiện chỉ là khai báo.** `--requester` và `--approver` là mã nhân viên do **người chạy lệnh gõ vào**. Database kiểm:
   - hai người khác nhau;
   - đúng nhóm quyền (người yêu cầu là quản trị kỹ thuật, người duyệt có quyền duyệt);
   - cả hai đang hoạt động.

   Database **không biết** hai người đó có thật sự đồng ý hay không. Nhật ký sẽ ghi tên cả hai. Vì vậy **phải có phê duyệt bằng văn bản** của người duyệt **trước khi** chạy (mục 4), và không bao giờ khai tên người chưa đồng ý.
3. **Mật khẩu tạm** chỉ nằm trong file `--out`:
   - không in ra màn hình, không ghi log;
   - file luôn tạo **mới** (không ghi đè) và **chỉ người chạy lệnh** đọc được;
   - giao trực tiếp cho nhân viên rồi **xoá file ngay**;
   - không chụp màn hình, không dán vào chat/email/GitHub.
4. **Chỉ database được phép.** Mặc định chỉ nhận DB thử (`siscom_crm_test_YYYYMMDD_HHMMSS` hoặc `siscom_crm_restore_…`).
   - Database khác chỉ khi có `--allow-db <đúng tên DB>`, mà cờ này **chỉ dùng khi Owner đã duyệt riêng**.
   - Cổng 5432 (cụm PostgreSQL chính) cần thêm cờ riêng.
   - `siscom_crm_dev` và các baseline đã khoá luôn bị từ chối.
5. **Xác nhận trước khi ghi.** Mỗi lệnh ghi yêu cầu **gõ lại tên database**. `--yes` (bỏ bước gõ lại) chỉ dùng trong kịch bản đã được duyệt.

## 3. Chuẩn bị

1. Node.js **24** (dự án dùng bản portable `D:\tools\node-v24.22.2-win-x64`).
2. Build backend: trong `D:\SISCOM-CRM\backend` chạy `npm run build`. Tạo ra `dist\cli\account-admin.js`.
3. Database đã migrate đủ, **đã tách role** (`demo-split.bat -Step split`) và **đã bootstrap** (`auth:bootstrap`).
4. Hai nhân viên làm người yêu cầu và người duyệt:
   - **Người yêu cầu (`--requester`):** tài khoản quản trị kỹ thuật (vai trò `admin`, ví dụ tài khoản `sysadmin` khi bootstrap).
   - **Người duyệt (`--approver`):** tài khoản có quyền duyệt (vai trò `crm_admin`).
   - Phải là **hai người khác nhau**, đều đang hoạt động.

## 4. Quy trình vận hành (bắt buộc)

1. **Người yêu cầu** lập phiếu (issue GitHub riêng tư hoặc tin nhắn nội bộ có lưu vết). Phiếu ghi: thao tác (`add` / `reset-password` / `disable`), họ tên và email nhân viên, phòng ban, vai trò, lý do, **database đích**.
2. **Người duyệt** trả lời đồng ý **bằng văn bản** trên chính phiếu đó, kèm mã nhân viên của mình.
3. **Owner** chạy lệnh (mục 5) với đúng thông tin trên phiếu. Ghi lại thời gian chạy và **mã nhân viên** in ra màn hình. **Không** ghi mật khẩu vào phiếu.
4. Giao file `--out` cho nhân viên **trực tiếp**, rồi **xoá file**.
5. **Đối soát sau khi chạy** (người duyệt xem lại): chạy `list` và gửi kết quả cho người duyệt xác nhận khớp với phiếu. Nếu không khớp thì khoá ngay (`disable`) và báo Owner như một sự cố.
6. Đóng phiếu.

## 5. Cách dùng

### Qua wrapper Windows (khuyến nghị)
`backend\scripts\windows\account-admin.bat` (hoặc `.ps1`):
- Kiểm Node 24 và tên database.
- Từ chối cổng 5432 nếu không có `-AllowMainCluster`.
- Mật khẩu `siscom_migrator` lấy từ biến môi trường `MIGRATE_DATABASE_URL` nếu đã đặt; nếu không, đọc từ `D:\SISCOM-CRM-demo-pg\private\roles-<cổng>.secrets` (file do `demo-split` tạo, chỉ Owner đọc được). Không in mật khẩu.

```bat
:: Liệt kê
account-admin.bat -Command list -DatabaseName siscom_crm_test_20261108_122026

:: Thêm nhân viên kinh doanh
account-admin.bat -Command add -DatabaseName siscom_crm_test_20261108_122026 -Requester NV-0001 -Approver NV-0002 ^
  -Email nguyenvana@siscom.vn -FullName "Nguyễn Văn A" -Department KD -Role sales -Out D:\SISCOM-CRM-demo-pg\private\NV-moi.txt

:: Đặt lại mật khẩu
account-admin.bat -Command reset-password -DatabaseName siscom_crm_test_20261108_122026 -Requester NV-0001 -Approver NV-0002 ^
  -Employee NV-0012 -Out D:\SISCOM-CRM-demo-pg\private\NV-0012-reset.txt

:: Khoá đăng nhập (chỉ cần người yêu cầu)
account-admin.bat -Command disable -DatabaseName siscom_crm_test_20261108_122026 -Requester NV-0001 -Employee NV-0012 -Reason "Nghỉ việc"
```

`-Out` nên trỏ vào một thư mục chỉ Owner truy cập được, **ngoài** thư mục mã nguồn.

### Gọi trực tiếp CLI
```
node dist\cli\account-admin.js <add|reset-password|disable|list> [tham số]
```
Biến môi trường bắt buộc: `MIGRATE_DATABASE_URL` (kết nối bằng `siscom_migrator`). Tham số:

| Tham số | Dùng cho | Ghi chú |
|---|---|---|
| `--requester <mã NV/email>` | add, reset-password, disable | Quản trị kỹ thuật |
| `--approver <mã NV/email>` | add, reset-password | Người duyệt, khác người yêu cầu |
| `--email`, `--full-name`, `--department <mã phòng>`, `--role` | add | Vai trò: `sales` / `technician` / `accountant` |
| `--phone`, `--title` | add (tuỳ chọn) | |
| `--employee <mã NV/email>` | reset-password, disable | |
| `--reason` | disable | Ghi vào nhật ký (tối đa 200 ký tự) |
| `--out <đường dẫn>` | add, reset-password | File bàn giao mới, không ghi đè |
| `--allow-db <tên>` | mọi lệnh | **Chỉ khi Owner duyệt riêng** cho DB không phải DB thử |
| `--yes` | lệnh ghi | Bỏ bước gõ lại tên DB (chỉ cho kịch bản đã duyệt) |
| `--demo` | add | Đánh dấu nhân viên là dữ liệu demo |

Không có tham số nhập mật khẩu: mật khẩu luôn do công cụ sinh ra.

## 6. Nhân viên đăng nhập lần đầu
1. Mở CRM, đăng nhập bằng **email hoặc mã nhân viên** và mật khẩu tạm.
2. Hệ thống **bắt buộc đổi mật khẩu**; chưa đổi thì mọi chức năng khác bị chặn.
3. Mật khẩu mới phải đạt chính sách:
   - 12–128 ký tự, đủ 3 trong 4 nhóm (chữ thường, chữ hoa, số, ký tự khác);
   - không chứa email hay mã nhân viên;
   - không lặp một ký tự quá 3 lần;
   - không thuộc danh sách mật khẩu phổ biến.

## 7. Rollback / sự cố
- **Tạo nhầm tài khoản:** `disable` (khoá đăng nhập, thu hồi phiên). Database **không cho xoá** nhân viên; muốn ẩn hẳn thì làm việc riêng với Owner.
- **Lộ file mật khẩu tạm:** chạy `reset-password` ngay (mật khẩu cũ hết hiệu lực, phiên bị thu hồi) rồi giao file mới.
- **Lệnh báo lỗi:** database không thay đổi gì (một transaction). Đọc mã lỗi:

| Mã lỗi | Ý nghĩa |
|---|---|
| `DB_REFUSED` | Sai database / cổng / thiếu `--allow-db` |
| `NOT_OWNER` | Không chạy bằng `siscom_migrator` |
| `BOOTSTRAP_OPEN` | DB chưa bootstrap (dùng `auth:bootstrap`) |
| `TWO_PERSON` | Người yêu cầu trùng người duyệt |
| `APPROVAL_REQUIRED` (từ DB) | Sai nhóm quyền, hoặc người yêu cầu/duyệt không hoạt động |
| `DUPLICATE` | Email đã có nhân viên |
| `NOT_FOUND` | Không tìm thấy đúng một nhân viên |
| `OUT_EXISTS` / `OUT_ACL` | File `--out` đã tồn tại / không đặt được quyền riêng tư |
| `CONFIRM` | Gõ lại tên DB sai, hoặc chạy không có bàn phím mà thiếu `--yes` |
| `RESET_FAILED` / `MUST_CHANGE_FAILED` | Đặt mật khẩu hoặc bật cờ buộc đổi không đúng lần reset; đã huỷ toàn bộ |
| `LAST_ADMIN` / `LAST_APPROVER` (từ DB) | Không được khoá admin hoặc người duyệt cuối cùng |

## 8. Chi tiết kỹ thuật (cho review)
- **`add`**, theo thứ tự:
  1. INSERT `employee` (chủ sở hữu; ứng dụng không có quyền INSERT).
  2. `fn_auth_api_credential_create`: tạo tài khoản đăng nhập giữ chỗ, chưa đăng nhập được.
  3. Gán vai trò qua yêu cầu `ROLE_GRANT`: `request_create` (requester) → `request_decide` (approver) → `role_grant`.
  4. Đặt mật khẩu qua yêu cầu `PASSWORD_RESET`: `request_create` → `request_decide` → `reset_token_issue` (database chỉ nhận SHA-256 của mã reset) → `reset_password` (database tự băm mã gốc và so khớp).
  5. Bật cờ buộc đổi mật khẩu.
- **Bật cờ buộc đổi mật khẩu:** `fn_auth_api_reset_password` luôn tắt cờ này, và chưa có hàm DB để bật lại. Công cụ cập nhật trực tiếp (bằng chủ sở hữu) với điều kiện khớp **chính xác lần đặt lại vừa xong**:
  - đúng nhân viên, đang ACTIVE;
  - `token_version` đúng bằng giá trị cũ cộng 1 (dòng tài khoản đã khoá `FOR UPDATE` từ trước);
  - **đúng hash vừa đặt**, và cờ đang tắt.

  Khác đúng 1 dòng thì huỷ toàn bộ. Có nhật ký `PASSWORD_MUST_CHANGE_SET`.
- **Nhật ký** (`audit_log`) ghi đủ các bước: `EMPLOYEE_CREATE`, `CREDENTIAL_CREATE`, `PRIV_REQUEST_CREATE` / `APPROVE`, `ROLE_GRANT`, `PASSWORD_RESET_ISSUE` / `DONE`, `PASSWORD_MUST_CHANGE_SET`, `CREDENTIAL_DISABLE`. Không chứa mật khẩu.
- **Kiểm thử:** `src/modules/auth/account-admin.spec.ts` (unit) và khối "FV-5" trong `test/auth.int-spec.ts`. Khối integration chạy trên DB thử và kiểm bằng đăng nhập thật.
