# Củng cố guard DB của 4 script xác minh legacy (OFFLINE, DRAFT)

Ngày: 2026-10-22. Nhánh: `fix/legacy-db-guards-hardening` (tách từ `91989af` = đầu PR #21). Không database, không `.env` thật, không chạy script đích.

## Kết luận kiểm chứng (PowerShell 5.1.26100, mẫu giả)
`auth-m1-verify.ps1`, `auth-m11-verify.ps1`, `auth-s1s3-verify.ps1`, `fold-verify.ps1` có **khác biệt khai thác được** (cùng lỗi đã sửa ở `auth-m13-verify.ps1`/`run-auth-int-tests.ps1` trong 91989af). Chạy thật trên mã chưa sửa, các mẫu sau **lọt** guard:

| Mẫu | Nguyên nhân |
|---|---|
| `SISCOM_CRM_RESTORE_20261022_101500`, `Siscom_crm_restore_…`, TemplateDb viết hoa | `-notmatch`/`-eq` không phân biệt hoa/thường |
| `…_101500` + `LF` cuối (target và TemplateDb) | `$` khớp trước ký tự xuống dòng cuối |
| chữ số Arabic-Indic / Fullwidth / Devanagari | `\d` .NET khớp chữ số Unicode |
| `.env`: user `SISCOM_APP`, nguồn `SISCOM_CRM_DEV` | `-ne` không phân biệt hoa/thường |
| kết quả `current_database()/current_user/chủ sở hữu/nhãn SISCOM_STATS_CLONE_OF` khác hoa/thường | `-ne` |

## Thay đổi (chỉ các dòng guard, 4 file chép đè; BOM + CRLF giữ nguyên, số dòng không đổi)
- `$pat`: `\d{8}_\d{6}$` → `[0-9]{8}_[0-9]{6}\z`.
- `-notmatch`/`-eq`/`-ne` → `-cnotmatch`/`-ceq`/`-cne` cho: `DatabaseName`, `TemplateDb`(+so với `DatabaseName`), user/host/nguồn `.env`, `$info[0..3]`, và (s1s3) `$owner`.
- **Giữ nguyên:** `$deny -contains` (không phân biệt hoa/thường = chặt hơn), mọi câu hỏi xác nhận (`Read-Host`, `COMMIT-FIXTURES`, `SPLIT-ROLES`), hành vi với tên hợp lệ.

## Không đổi (đã xét, không khai thác được / ngoài phạm vi)
- `Read-Host … -ne $DatabaseName`: so với tên đã qua allowlist chữ thường nên không mở rộng quyền (cũng không đổi ở m13).
- Các regex lọc **đầu ra** (`$stateRe`, `'f_vn_fold:i'`, `'empty migration'`, `(?m)^0\|0\|0$`) và `-notcontains $M1` (tên thư mục): dữ liệu do chính script/DB tạo, không phải đầu vào người dùng.
- `^\s*DATABASE_URL\s*=` đọc dòng `.env`: không phải guard.
- **Còn tồn đọng (chưa sửa, cần PR riêng):** cùng mẫu `\d`/`$`/`-notmatch`/`-ne` ở `run-customers-tests.ps1`, `run-audit-tests.ps1`, `run-search-bench.ps1`, `rehearse-b122.ps1`, `release-b122.ps1`, `lock-p1-baseline.ps1`, `make-stats-clone.ps1` (PR #22 sửa riêng phần clone). Không có file helper dùng chung; mỗi script tự lặp đoạn guard.

## Test
`backend\scripts\windows\tests\legacy-db-guards.tests.ps1` (+ `.bat`): trích nguyên văn guard bằng AST, chạy với tên/`.env` giả. Mã cũ (chưa sửa): 88 FAIL; mã mới: 349 PASS / 0 FAIL; `auth-db-guard-case.tests.ps1` vẫn 100 PASS. Mỗi mẫu "lọt" có phép chứng minh hồi quy (chạy lại bằng toán tử/regex cũ phải lọt).

## Chép file (Windows)
- File **mới**: `D:\SISCOM-CRM\backend\scripts\windows\tests\legacy-db-guards.tests.ps1`, `…\tests\legacy-db-guards.tests.bat`, `D:\SISCOM-CRM\backend\docs\LEGACY_DB_GUARDS_HARDENING.md`.
- File **chép đè**: `D:\SISCOM-CRM\backend\scripts\windows\{auth-m1-verify,auth-m11-verify,auth-s1s3-verify,fold-verify}.ps1` (sao lưu bản cũ trước).
- Không đụng: migration, `schema.prisma`, `.env`, `package*.json`, `runner.mjs`, các script còn lại.
- Rollback: chép lại 4 file đã sao lưu (hoặc `git revert` commit này).

## Thứ tự phụ thuộc
PR này xếp chồng trên **PR #21** (đầu `91989af`), tức chuỗi #15 → #17 → #18 → #19 → #20 → #21 → PR này (#16 và #22 độc lập). Merge theo thứ tự; không merge trước khi #21 vào. Cần người duyệt khác tác giả (thay đổi bảo mật).

## Chưa kiểm chứng
Chạy thật 4 script trên bản sao DB (cần mật khẩu PostgreSQL tương tác + bản sao do người có thẩm quyền tạo); `tsc`/unit/build không chạy vì không đổi mã TypeScript/frontend.
