# Kế hoạch nghiệm thu PostgreSQL cô lập (DB disposable `siscom_crm_test_*`) — BẢN NHÁP

**Trạng thái:** KẾ HOẠCH. **DB integration: NOT_RUN.** Tài liệu này không thực thi bất kỳ lệnh DB/Prisma/migration/seed/reset nào; không đọc `.env`. Mọi mục "sẽ chạy" cần người dùng duyệt riêng bằng văn bản (AGENTS.md §2).
Task: SISCOM-FOLLOWUP-B-02-PG-ISOLATED-PLAN-RETRY (batch SISCOM-V4-1-FOLLOWUP-20261024-B). Độc lập với kết quả batch A #8/#9 (BLOCKED).

## 1. Căn cứ đã đọc (xác minh từ kho, trên `main` 801e428)
- `docs/BACKUP_RESTORE.md`: backup bằng `pg_dump -Fc` + `.sha256`; `restore-test` tạo DB mới `siscom_crm_restore_<ngày_giờ>`, không đụng `siscom_crm_dev`, không có lệnh xóa (xóa thủ công).
- `CONTRIBUTING.md` §4–5: integration chỉ trên `siscom_crm_restore_*`/`siscom_crm_test_*`; chỉ `prisma migrate deploy`; migration đã áp dụng bất biến.
- `backend/scripts/windows/run-customers-tests.ps1`, `run-audit-tests.ps1`: tên DB phải khớp `^siscom_crm_(restore|test)_\d{8}_\d{6}$`, gõ lại tên để xác nhận, kiểm `current_database()`, chủ sở hữu, bảng B1.2 và dòng `_prisma_migrations`; truyền `TEST_DATABASE_URL`, xóa `DATABASE_URL` khỏi tiến trình con.
- `backend/test/helpers/test-db.ts`: guard phía Jest (regex tên, host `127.0.0.1`, user `siscom_app`, từ chối `siscom_crm_dev`).
- Trên nhánh xếp chồng `db/b1.3.2-b-m1-2-s1s3` (chưa vào `main`): `B1.3_S1_ROLE_SPLIT / APP_GRANTS / PRIVILEGE_TESTS / ROLLBACK .sql.txt`, `auth-s1s3-verify.ps1` (mô hình `siscom_migrator` chủ sở hữu + `siscom_app` DML + nhóm `siscom_auth_rt`). Kế hoạch này **tái dùng**, không thay thế chúng.

## 2. Khoảng trống cần xử lý (phát hiện từ mã hiện có)
1. Mật khẩu `siscom_app` hiện lấy từ `DATABASE_URL` của `siscom_crm_dev` trong `.env` → role dev dùng lại cho DB thử. Kế hoạch mới dùng **mật khẩu riêng, sinh ngẫu nhiên, dùng một lần** cho DB thử, không đọc `.env`.
2. `test-db.ts` chỉ chấp nhận user `siscom_app` (chủ sở hữu DB ở mô hình hiện tại → quyền rộng). Với role ít quyền cần cho phép thêm đúng một user thử (xem §4); đây là thay đổi code có chủ đích, làm ở PR riêng sau khi duyệt, **không làm trong PR này**.
3. Regex `\d{8}_\d{6}` không bắt buộc ngày giờ hợp lệ và không phân biệt DB do nghiệm thu này tạo hay DB cũ trùng tên → cần nhãn sở hữu (§4.3).
4. `auth-s1s3-verify.ps1` hoạt động trên bản sao `make-stats-clone` có nhãn; kế hoạch này là đường **DB trống dựng từ migration** (không chứa dữ liệu khách thật), bổ sung chứ không thay.

## 3. Nguyên tắc cô lập
- DB đích: `siscom_crm_test_YYYYMMDD_HHMMSS`, **tạo mới**, chưa tồn tại trước đó; không dùng lại, không `TEMPLATE` từ `siscom_crm_dev` hay DB khóa baseline (`siscom_crm_restore_20261014_214105`, `siscom_crm_restore_20261015_214948`).
- Dữ liệu: chỉ fixture tổng hợp (§5). Không restore từ dump thật, không sao chép dữ liệu khách.
- Cụm PostgreSQL: cục bộ `127.0.0.1:5432` (theo `DB_SECURITY.md`). Nếu muốn cô lập mạnh hơn: một cụm/container tạm riêng (cổng khác, `initdb` mới) — **phương án ưu tiên khi có thể**, vì khi đó không có tài khoản/DB dev nào cùng cụm. Cần người dùng quyết (§9).
- Tài khoản `postgres` chỉ dùng bước tạo role/DB (mật khẩu nhập ẩn, không lưu); không dùng trong test.

## 4. Role ít quyền và guard `DATABASE_URL`
### 4.1 Role (đặt tên theo DB để không đụng role dev)
| Role | Thuộc tính | Dùng cho |
|---|---|---|
| `siscom_t_owner_<stamp>` | LOGIN, NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; chủ sở hữu DB thử | chỉ `prisma migrate deploy` |
| `siscom_t_app_<stamp>` | như trên; chỉ CONNECT + DML theo mô hình `B1.3_S1_APP_GRANTS` (audit_log chỉ SELECT/INSERT; RBAC chỉ SELECT) | chạy suite integration |
Mật khẩu: sinh ngẫu nhiên ≥ 32 ký tự khi chạy, giữ trong biến môi trường tiến trình con, xóa sau khi xong; không ghi log/PR.

### 4.2 Guard bắt buộc (mọi điều kiện phải đúng, sai một → exit ≠ 0, không kết nối thêm)
Áp dụng cho cả `TEST_DATABASE_URL` và URL dùng cho `migrate deploy`:
1. Giao thức `postgresql://`; host chính xác `127.0.0.1` (so khớp chuỗi tuyệt đối; **từ chối** `localhost`, `::1`, tên miền, IP LAN, socket Unix để không giải tên sang đích khác); cổng khớp cụm thử đã khai báo (nếu dùng container tạm: cổng khác 5432 và khác cổng cụm dev).
2. Tên DB khớp `^siscom_crm_test_\d{8}_\d{6}$` (chỉ `test`, **không** chấp nhận `restore` ở đường này) và khác danh sách cấm: `siscom_crm_dev`, 2 DB baseline, `postgres`, `template0/1`.
3. User khớp `^siscom_t_(owner|app)_\d{8}_\d{6}$` và stamp trùng stamp trong tên DB; từ chối `postgres`, `siscom_app`, `siscom_migrator`.
4. Không có tham số URL lạ làm đổi đích (`host=`, `dbname=`, `options=`, `service=`); không có nhiều host. Kiểm cả biến môi trường libpq có thể đổi đích ngầm: `PGHOST`, `PGHOSTADDR`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGSERVICE`, `PGSERVICEFILE`, `PGPASSFILE`, `PGOPTIONS` — phải không đặt trong tiến trình con; không dùng `.pgpass`/`pg_service.conf` (mật khẩu chỉ qua biến tiến trình con).
5. `DATABASE_URL` **không được đặt** trong tiến trình con (xóa trước khi chạy; chỉ truyền biến thử). Không đọc `.env`; dotenv của Prisma phải bị vô hiệu bằng cách chạy từ thư mục không có `.env` hoặc truyền `--schema`/biến tường minh (cần xác minh khi duyệt — chưa kiểm chứng).
6. Sau khi nối (chỉ đọc): `current_database()` = tên mong đợi; `current_user` đúng vai; `rolsuper/rolcreaterole/rolcreatedb/rolbypassrls/rolreplication` đều `false`; owner DB = `siscom_t_owner_<stamp>`; không có dòng dữ liệu `is_demo = false` trong bảng nghiệp vụ.
7. Nhãn sở hữu: `COMMENT ON DATABASE` = `SISCOM_DISPOSABLE_TEST:<stamp>:<ISO8601>` do bước tạo đặt; guard từ chối DB thiếu nhãn.
8. Xác nhận người (confirmation stamp): bước tạo (§6 bước 1) in ra một **mã xác nhận một lần** gắn chặt `<tên DB>|<stamp>|127.0.0.1:<cổng>|<thời điểm tạo>`; người dùng gõ lại **đúng tên DB và mã** (không có tham số `-Force`/`-Yes`/chế độ không tương tác để bỏ qua). Mã hết hạn sau 2 giờ kể từ lúc tạo và chỉ dùng cho đúng DB đó; nhãn §4.2.7 phải khớp. Mã/tên sai, hết hạn hoặc không có TTY → dừng, exit ≠ 0, không kết nối.
9. Chống dùng lại DB cũ: DB đích phải do bước tạo của chính đợt này sinh ra (nhãn có thời điểm trong 2 giờ gần nhất); DB đã tồn tại từ trước hoặc nhãn cũ hơn bị từ chối.

### 4.3 Kiểm thử guard (offline, không cần DB) — đề xuất cho PR code sau
Bảng ca âm/dương cho hàm thuần `assertDisposableTestUrl(url)`: dev DB, DB baseline, host `0.0.0.0`/tên miền, cổng sai, user `postgres`/`siscom_app`, stamp lệch, `restore_*`, thiếu mật khẩu, URL có `?host=`, URL rác, `DATABASE_URL` đang đặt. Chạy bằng `npm run test:unit` (không DB).

## 5. Fixture
- Nguồn: migration trong `backend/prisma/migrations` qua `prisma migrate deploy` trên DB trống (không dump).
- Dữ liệu tổng hợp: dùng helper `backend/test/helpers/fixtures.ts` hiện có; các test tự tạo/dọn dữ liệu của mình. Dữ liệu mẫu đánh dấu `is_demo` theo CONTRIBUTING §5; tên/điện thoại/email giả (miền `example.invalid`, số dải giả).
- Kích thước: nhỏ (≤ vài trăm dòng), **không** dùng quy mô benchmark 20–50 nghìn khách (benchmark không thuộc nghiệm thu này).
- Không seed bằng `prisma db seed`; không có mật khẩu/credential thật; hash credential nếu cần là giá trị giả cố định trong test.

## 6. Trình tự nghiệm thu (SAU KHI được duyệt; hiện NOT_RUN)
| # | Bước | Công cụ | Chạy bằng | Ghi |
|---|---|---|---|---|
| 0 | Tiền kiểm guard offline | `npm run test:unit` (guard §4.3) | — | không DB |
| 1 | Tạo role + DB mới + nhãn | `psql -f` script mới (PR riêng) | `postgres` (nhập ẩn) | `CREATE DATABASE … OWNER siscom_t_owner_<stamp>`; chỉ khi chưa tồn tại |
| 2 | Guard §4.2 (chỉ đọc) | script mới | owner | dừng nếu sai |
| 3 | `prisma migrate deploy` | Prisma | owner | duy nhất lệnh Prisma được phép; không `dev/reset/push/execute` |
| 4 | Cấp quyền ít quyền | `B1.3_S1_APP_GRANTS` điều chỉnh tên role | owner | fail-closed nếu có bảng chưa phân loại |
| 5 | Kiểm quyền | `B1.3_S1_PRIVILEGE_TESTS` (tự `ROLLBACK`) | superuser | kỳ vọng 0 FAIL; kết nối thẳng `-d siscom_crm_test_<stamp>`, không `-d postgres`/DB dev |
| 6 | Constraint tests M1/M1.1/M1.2 | các `*_CONSTRAINT_TESTS.sql.txt` | owner | mỗi file tự rollback |
| 7 | Integration | script mới (PR riêng) + `audit.int-spec`; **KHÔNG** chạy nguyên trạng `run-customers-tests.ps1`/`run-audit-tests.ps1` | `siscom_t_app_<stamp>` | chỉ suite liên quan; không benchmark. Hai script hiện có đọc mật khẩu `siscom_app` từ `.env` và chấp nhận `restore_*` → trái nguyên tắc §3 |
| 8 | Drift | `prisma migrate status` (+ `migrate diff` chỉ đọc) | owner | không có drift |
| 9 | Rollback/dọn | §7 | `postgres` | sau khi lưu log |

## 7. Rollback / dọn dẹp
- Mọi thay đổi nằm trong DB `siscom_crm_test_<stamp>` và 2 role cùng stamp → hoàn tác = xóa **đúng** DB + role đó, sau khi guard xác nhận nhãn và tên. Script không tự `DROP`; in lệnh để người dùng chạy thủ công (như `restore-test`):
  `DROP DATABASE siscom_crm_test_<stamp>;` rồi `DROP ROLE siscom_t_app_<stamp>; DROP ROLE siscom_t_owner_<stamp>;`
- Rollback migration (M1.2 → M1.1 → M1) dùng các `*_ROLLBACK.sql.txt` đã có, chỉ trên DB thử, để kiểm đường lùi; không chạy trên DB khác.
- Nếu giữa chừng lỗi: dừng, giữ DB để điều tra, không tự sửa/dọn; chỉ xóa sau khi có log.
- Không chạm `siscom_crm_dev`, không `REASSIGN OWNED` (ảnh hưởng DB khác).

### 7.1 Hủy an toàn (abort)
- Hủy bất kỳ lúc nào (Ctrl+C, guard sai, mã hết hạn, người dùng từ chối): script **không** tự `DROP`/`REASSIGN`, không kết nối sang DB khác, xóa biến mật khẩu/URL khỏi tiến trình, đóng phiên psql.
- Trước bước 1 (chưa tạo gì): hủy = không có gì cần dọn.
- Sau bước 1: in tên DB/role đã tạo và lệnh dọn (§7) để người dùng quyết; lệnh `DROP` chỉ được in sau khi chạy lại guard §4.2.2/§4.2.7 trên tên đó (tên không khớp `siscom_crm_test_*`, thiếu nhãn hoặc thuộc danh sách cấm → không in).
- `DROP ROLE` chỉ cho role đúng stamp; nếu role còn sở hữu đối tượng ở DB khác thì dừng và báo, không `REASSIGN OWNED`.

## 8. Tiêu chí hoàn thành (exit criteria)
Tất cả phải có **bằng chứng chạy thật** (log + mã thoát); thiếu một mục = không đạt:
1. Guard offline: tất cả ca âm bị từ chối, ca dương qua (`test:unit`, exit 0).
2. Guard trực tuyến (bước 2): đúng DB, đúng role, role không đặc quyền, đúng nhãn.
3. `migrate deploy` thoát 0; `_prisma_migrations` đủ 5 migration hiện có, không dòng `rolled_back_at`/lỗi; `migrate status` sạch.
4. Role ít quyền: `B1.3_S1_PRIVILEGE_TESTS` 0 FAIL; `siscom_t_app` không DDL, không ghi RBAC/audit ngoài INSERT, không đọc credential.
5. Constraint tests M1/M1.1/M1.2: toàn bộ PASS; đường rollback chạy được và `migrate deploy` áp lại được.
6. Integration suite liên quan: số ca đạt/tổng ghi rõ, 0 fail; không chạm DB khác (kiểm `pg_stat_activity` chỉ có DB thử trong phiên test).
7. Không rò rỉ: log/PR không chứa mật khẩu, URL kết nối, dữ liệu thật; `git status` sạch bí mật.
8. Dọn: DB + 2 role thử đã xóa thủ công (hoặc ghi lý do giữ), `siscom_crm_dev` và 2 DB baseline không đổi (không kết nối vào chúng; xác nhận bằng việc phiên test chỉ thấy DB thử).

## 9. Cần người dùng quyết trước khi chạy (BLOCKED nếu thiếu)
1. Cụm PostgreSQL: dùng cụm cục bộ hiện có (chung với dev) hay cụm/container tạm riêng?
2. Duyệt viết script tạo role/DB (§6 bước 1–2) và sửa `test-db.ts` cho user thử (PR code riêng).
3. Phiên bản PostgreSQL mục tiêu của môi trường thử (khớp production/VPS).
4. Cho phép chạy bước 1–9 trên DB `siscom_crm_test_<stamp>` cụ thể (cung cấp stamp).

## 10. Kết quả rà soát bảo mật (task SISCOM-FOLLOWUP-C-04; chỉ đọc kho + sửa tài liệu)
**Đã xác minh từ kho:**
- Tài liệu này **không** dùng `.env` thật làm nguồn mật khẩu/URL và **không** dùng `siscom_app` làm đích (chỉ nhắc ở §2/§4.2 như khoảng trống và tên bị cấm). Role mới `siscom_t_*_<stamp>`, mật khẩu sinh ngẫu nhiên.
- `run-customers-tests.ps1`/`run-audit-tests.ps1` (đọc `.env`, ép user `siscom_app`, regex `(restore|test)`) và `test-db.ts` (ép `siscom_app`) **trái** kế hoạch này → đã ghi rõ không dùng nguyên trạng (§6 bước 7).

**Thiếu điều kiện then chốt đã bổ sung:** (a) từ chối `localhost`/`::1`, kiểm biến `PG*`, `.pgpass` (§4.2.1, §4.2.4); (b) mã xác nhận một lần có hạn, không có cờ bỏ qua (§4.2.8); (c) cấm dùng lại DB trùng tên cũ (§4.2.9); (d) quy trình hủy an toàn (§7.1); (e) bước 5 phải trỏ đúng DB thử.

**Chưa kiểm chứng (NOT_RUN):** hành vi dotenv của Prisma khi không có `.env`; các guard mới chỉ là đặc tả, chưa có mã; không kết nối PostgreSQL nào.

### 10.1 Checklist kiểm soát (mỗi mục cần bằng chứng trước khi chạy bất kỳ lệnh DB nào)
| # | Hạng mục | Điều kiện đạt | Tham chiếu |
|---|---|---|---|
| 1 | Guard 1 – host/cổng | `127.0.0.1` đúng chuỗi, cổng cụm thử; không `localhost`/`::1` | §4.2.1 |
| 2 | Guard 2 – tên DB | `^siscom_crm_test_\d{8}_\d{6}$`, không thuộc danh sách cấm | §4.2.2 |
| 3 | Guard 3 – role | `siscom_t_(owner/app)_<stamp>` khớp stamp; không `postgres`/`siscom_app`/`siscom_migrator` | §4.2.3 |
| 4 | Guard 4 – đổi đích ngầm | không `host=`/`service=`/`options=`; không `PG*`, `.pgpass`, `pg_service.conf` | §4.2.4 |
| 5 | Guard 5 – `.env` | không đọc `.env`; `DATABASE_URL` không đặt; Prisma không nạp dotenv | §4.2.5 |
| 6 | Guard 6 – xác minh sau nối | `current_database()`, `current_user`, 5 cờ đặc quyền = false, owner đúng | §4.2.6 |
| 7 | Guard 7 – nhãn | `COMMENT ON DATABASE` đúng mẫu, trong thời hạn | §4.2.7, §4.2.9 |
| 8 | Guard 8 – xác nhận | gõ tên DB + mã một lần, không cờ bỏ qua, có TTY | §4.2.8 |
| 9 | Role không đặc quyền | NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOREPLICATION/NOBYPASSRLS | §4.1 |
| 10 | Cụm cô lập | ưu tiên container/cụm tạm riêng; nếu dùng cụm chung: rủi ro được duyệt rõ | §3, §9.1 |
| 11 | Không dùng script cũ nguyên trạng | không chạy `run-*-tests.ps1` hiện có trên DB thử | §6 bước 7 |
| 12 | Hủy an toàn | không tự DROP; lệnh dọn chỉ in sau guard | §7.1 |
| 13 | Phê duyệt văn bản | có comment chủ sở hữu cho stamp cụ thể | §9.4 |

## 11. Phạm vi KHÔNG làm trong PR này
Không code, không test mới, không đổi `package.json`, workflow, migration, `schema.prisma`, `test-db.ts`; không bật AuthController, không nới DenyAll/CSRF/CORS/guard; không quyết Bearer/JWT/refresh/CSRF production.
