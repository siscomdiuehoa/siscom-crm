# Hướng dẫn cài đặt và chạy Backend trên Windows

Dành cho người không chuyên lập trình. Làm lần lượt từng bước; mỗi bước có "Kết quả đúng".
**Không bao giờ** gửi mật khẩu cho ai hoặc dán vào chat/Git. File `check-env-result.txt` không chứa mật khẩu nên có thể gửi.

## Bước 0 — Đặt thư mục đúng chỗ
Giải nén thư mục `backend` vào **ngoài Dropbox/OneDrive**, ví dụ `D:\SISCOM-CRM\backend`. (Dropbox từng làm hỏng `node_modules`, và file `.env` chứa mật khẩu không nên đồng bộ lên đám mây.)

## Bước 1 — Cài Node.js 24 LTS
1. Vào https://nodejs.org → tải bản **LTS** (24.x, từ 24.11 trở lên) → cài mặc định.
2. Đóng và mở lại cửa sổ lệnh. Gõ `node -v` và `npm -v`.
**Kết quả đúng:** `v24.x.x` và `11.6` trở lên. Nếu npm cũ hơn: `npm install --global npm@11`.

## Bước 2 — Cài PostgreSQL 18.6 (hoặc 17.11 nếu 18 lỗi)
1. Vào https://www.postgresql.org/download/windows/ → "Download the installer" (EDB) → chọn **18.x** cho Windows x86-64.
2. Chạy với quyền Administrator. Giữ cổng **5432**. Giữ "PostgreSQL Server" và "Command Line Tools"; bỏ chọn "Stack Builder"; pgAdmin tuỳ chọn.
3. Khi hỏi mật khẩu cho `postgres`: **tự đặt mật khẩu mạnh, lưu vào trình quản lý mật khẩu.** Chỉ dùng ở Bước 4.
4. Nếu bộ cài 18 báo lỗi (khởi tạo cluster, không tải được…): gỡ phần cài dở, cài **17.11**. Không ảnh hưởng gì đến CRM.
5. Không mở cổng 5432 trong Windows Firewall.

## Bước 3 — Kiểm tra môi trường
Nhấp đúp `scripts\windows\check-env.bat`. Gửi file `check-env-result.txt` nếu có dòng `[THIEU]` hoặc `[CANH BAO]`.
**Kết quả đúng:** Node 24.x, npm ≥ 11.6, thấy PostgreSQL, dịch vụ `Running`, không cảnh báo Dropbox.

## Bước 4 — Tạo database và tài khoản riêng cho CRM
**4a. Kiểm tra cú pháp script (không chạy gì):** mở Command Prompt trong thư mục backend:
```bat
powershell -NoProfile -Command "$e=$null; [void][System.Management.Automation.Language.Parser]::ParseFile('scripts\windows\setup-db.ps1',[ref]$null,[ref]$e); if($e){$e}else{'Cu phap OK'}"
```
Kết quả đúng: `Cu phap OK`. Nếu in lỗi, gửi lại nguyên văn.

**4b. Chạy thử ở chế độ chỉ đọc:** `scripts\windows\setup-db.bat -Check` — chỉ cho biết script SẼ làm gì, không thay đổi gì.

**4c. Chạy thật:** nhấp đúp `scripts\windows\setup-db.bat`.
- Nhập mật khẩu `postgres` (gõ ẩn).
- Khi hỏi mật khẩu cho `siscom_app`: **nhấn Enter** để máy tự sinh mật khẩu mạnh (khuyến nghị).
- Script chỉ **tạo mới** những gì chưa có. Nếu `siscom_app` hoặc database đã tồn tại, script **không tự đổi** mật khẩu/quyền; muốn đổi phải dùng `-ResetAppPassword` và gõ đúng cụm từ xác nhận được hiển thị (`DOI MAT KHAU`, `GHI DE ENV`, `THU HOI PUBLIC`).
- Script kiểm tra bảo vệ được file `.env` (chỉ tài khoản Windows của bạn) **trước** khi chạm vào database; nếu không bảo vệ được sẽ dừng và không ghi mật khẩu ra đĩa.
**Kết quả đúng:** các dòng `[OK]`: kết nối PostgreSQL, `listen_addresses` chỉ localhost, tạo `siscom_app`, tạo hai database, mã hoá `UTF8`, ghi `.env` và xác minh quyền, đăng nhập bằng tài khoản ứng dụng với `superuser=false`.
Script **không có** lệnh xoá nào (DROP/TRUNCATE/DELETE/RESET) và chạy lại được an toàn.

## Bước 5 — Cài thư viện, tạo bảng, build
Mở Command Prompt trong thư mục backend (gõ `cmd` vào thanh địa chỉ của File Explorer):
```bat
npm install
npm run db:migrate
npm run build
```
- `npm install` tạo `package-lock.json` — **giữ file này** (lần sau dùng `npm ci` để cài đúng phiên bản).
- `npm run db:migrate` chỉ **tạo** bảng kỹ thuật `app_meta`; không xoá dữ liệu.
**Kết quả đúng:** `1 migration ... applied` (hoặc "No pending migrations"), và `npm run build` kết thúc không có chữ `error`.
Nếu lỗi: chép nguyên khối lỗi gửi lại (không chứa mật khẩu).

## Bước 6 — Chạy backend
Nhấp đúp `scripts\windows\start-backend.bat` (hoặc `npm run start:dev`). Để cửa sổ mở.
**Kết quả đúng:** dòng `SISCOM CRM backend đang chạy tại http://127.0.0.1:3000/api/v1`.

## Bước 7 — Kiểm tra Health Check
Mở trình duyệt:
- http://127.0.0.1:3000/api/v1/health → `{"status":"ok", ...}`
- http://127.0.0.1:3000/api/v1/health/database → `{"status":"ok","database":"up", ... "schema":{"migrated":true,"baseline":"b1.1"}}`
Hoặc trong cmd: `curl http://127.0.0.1:3000/api/v1/health/database`

## Bước 8 — Thử khi database bị ngắt (có thể bỏ qua nếu ngại)
1. Mở `services.msc` (Run as administrator) → tìm `postgresql-x64-18` → Stop.
2. Tải lại `/api/v1/health/database` → **phải** ra mã 503 và `"database":"down"`, thông báo chung chung, **không** có tên máy/mật khẩu/mã lỗi. Backend không được tắt. `/api/v1/health` vẫn ok.
3. Start lại dịch vụ → tải lại → trở về `up`.

## Bước 9 — Frontend vẫn chạy bình thường
Trong thư mục frontend: `npm run dev` → mở http://localhost:5173 → thử vài thao tác; mở hai trang kiểm thử (`/tests/b0-repository.test.html` phải 50/0, `/tests/customer-optional-fields.test.html` phải 64/0). Dữ liệu cũ trong trình duyệt không bị ảnh hưởng (backend không đọc/ghi nó).

## Sao lưu
Xem `docs\BACKUP_RESTORE.md`. Thư mục sao lưu: `D:\SISCOM-CRM\db-backups`. Chạy `scripts\windows\backup-db.bat`, sau đó `scripts\windows\restore-test.bat` để thử khôi phục vào database mới.

## Sự cố thường gặp
| Hiện tượng | Cách xử lý |
|---|---|
| `node` không nhận diện | Mở lại cửa sổ lệnh sau khi cài; cài lại Node tick "Add to PATH" |
| `npm install` báo `EBADENGINE` | Node/npm sai phiên bản → cài Node 24 LTS mới nhất, `npm i -g npm@11` |
| `npm install` lỗi `EBUSY`/file bị khoá | Thư mục đang trong Dropbox → chuyển ra `D:\SISCOM-CRM` |
| PowerShell chặn script | Dùng file `.bat` (đã bỏ qua chặn cho riêng script đó) |
| `[LOI] ... psql bao loi` | Sai mật khẩu postgres, hoặc dịch vụ PostgreSQL chưa chạy (`services.msc`) |
| `Database dung ma hoa WIN1252/…` | Cluster không UTF8. Cài lại PostgreSQL và chọn locale mặc định của Windows với mã hoá UTF8, hoặc hỏi hỗ trợ — không dùng tiếp vì mất dấu tiếng Việt |
| Cổng 3000 bị chiếm | Sửa `PORT=3001` trong `.env` (và thêm vào kết quả kiểm tra) |
| Backend báo `Cau hinh khong hop le` | Thông báo nêu **tên** biến sai (không in giá trị); sửa `.env` hoặc chạy lại `setup-db.bat` |
| `DATABASE_URL` mật khẩu có ký tự đặc biệt | Dùng mật khẩu tự sinh; nếu tự đặt, phải mã hoá URL (script đã làm) |
| Lỗi `Environment variable not found: DATABASE_URL` khi chạy `prisma` | Chưa có `.env` hoặc đang đứng sai thư mục |
| `npm run build` xong nhưng thiếu `dist\main.js`, `start:dev` báo `MODULE_NOT_FOUND` | Do bộ nhớ đệm biên dịch (`*.tsbuildinfo`) cũ. Xoá các file `*.tsbuildinfo` ở thư mục backend và thư mục `dist` (không phải dữ liệu), rồi `npm run build`. Bản hiện tại đã tắt `incremental` và `build` tự báo lỗi nếu thiếu `dist\main.js` |
