# Bàn giao chuẩn bị test tích hợp PostgreSQL cô lập (E-03) — BẢN NHÁP

**Task:** SISCOM-E03-POSTGRES-DISPOSABLE-PREP (batch SISCOM-20261024-CI-PG-RECOVERY-E). **Kết luận: `BLOCKED` — chưa đủ điều kiện yêu cầu DB cô lập thật** (lý do §5). Chưa có kết nối PostgreSQL, role/DB, Prisma, seed, `.env` nào được chạm. Mọi ca DB: `NOT_RUN`.

Nguồn tái dùng (không làm lại): kế hoạch #100 `docs/PG_ISOLATED_ACCEPTANCE_PLAN.md` (+ rà soát bảo mật #107, §10.1 có 13 mục kiểm soát), guard C-05 #108 `backend/scripts/guards/pg-dryrun-guard.mjs`, harness C-06 #109 `backend/scripts/pg-harness/`. Nhánh này xếp chồng lên #109 (kéo theo #108). Hai tài liệu #100/#107 nằm ở nhánh khác nên chỉ được tham chiếu, không chép lại.

## 1. Checklist bàn giao (chủ sở hữu điền; thiếu một mục = không chạy)
| # | Hạng mục | Yêu cầu | Bằng chứng cần nộp | Kiểm soát bằng mã hiện có |
|---|---|---|---|---|
| 1 | Cụm PG | Loopback `127.0.0.1` đúng chuỗi, cổng khai báo; ưu tiên container/cụm tạm riêng (cổng ≠ 5432, ≠ cổng dev). Cổng 5432 chỉ khi chủ duyệt riêng rủi ro cụm chung | Chủ chọn phương án; số cổng; phiên bản PG | Guard `HOST_NOT_ALLOWED`, `PORT_MISMATCH`, `PORT_SHARED_CLUSTER` |
| 2 | Tên DB | Chỉ `siscom_crm_test_YYYYMMDD_HHMMSS` (ngày giờ hợp lệ), tạo mới, chưa tồn tại; mẫu: `siscom_crm_test_20261024_120000`. Không `restore_*`, không `TEMPLATE` từ dev | Stamp cụ thể do chủ cấp | Guard `DB_NAME_INVALID` (cấm `siscom_crm_dev`, 2 DB baseline, `postgres`, `template0/1`) |
| 3 | Role | `siscom_t_owner_<stamp>` (chỉ `migrate deploy`) và `siscom_t_app_<stamp>` (DML ít quyền): LOGIN, NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS. **Không** dùng `siscom_app`, `siscom_migrator`, `postgres` | Chủ xác nhận 2 role non-superuser | Guard `ROLE_INVALID`, `STAMP_MISMATCH`; xác minh thuộc tính sau khi nối: **chưa có mã** (§4 bước E) |
| 4 | Credentials | Mật khẩu sinh ngẫu nhiên ≥ 32 ký tự khi chạy, chỉ trong biến môi trường tiến trình con; không commit, không log, không PR, không `.env`/`.pgpass`/`pg_service.conf`. `DATABASE_URL` và `PG*` không được đặt | Cam kết của chủ; không gửi giá trị qua issue/PR | Guard `ENV_DATABASE_URL_SET`, `ENV_REDIRECT`; test khẳng định đầu ra không chứa mật khẩu |
| 5 | Phê duyệt | Comment `OWNER_APPROVED` riêng, nêu **stamp cụ thể** và task ID; mã tham chiếu vào `SISCOM_PG_APPROVAL_REF` | Link comment | Cổng `APPROVAL_MISSING`, `OWNER_DB_NOT_GRANTED` (mới kiểm định dạng, chưa kiểm comment thật) |
| 6 | Nhãn + mã xác nhận | Bước tạo đặt `COMMENT ON DATABASE` = `SISCOM_DISPOSABLE_TEST:<stamp>:<ISO8601Z>` (hiệu lực 2 giờ) và in mã một lần gắn `<db>\|<stamp>\|127.0.0.1:<cổng>\|<thời điểm tạo>`; người gõ lại tên DB + mã trong TTY. Không có cờ bỏ qua | Mã do người nhập tại chỗ | Guard `LABEL_*`, `CONFIRMATION_*`; CLI `--force/--yes/...` → exit 64 |
| 7 | Chặn dev/prod | Danh sách cấm cố định + tên DB/role/host chỉ khớp allow-list; không `--execute` vào bất kỳ đích nào ngoài mẫu | — | Guard (28 test) + 12 ca CLI mới |
| 8 | Guard định danh **trước** mọi migration | Bước 2 (guard trực tuyến chỉ đọc: `current_database()`, `current_user`, 5 cờ đặc quyền, owner, nhãn) phải đạt trước bước 3 `migrate deploy` | Log bước 2 | Thứ tự kế hoạch được test khóa; **phần trực tuyến chưa có mã** |
| 9 | Rollback/teardown | Chỉ trên DB thử: rollback migration bằng `*_ROLLBACK.sql.txt` (M1.2→M1.1→M1); dọn bằng `DROP DATABASE`/`DROP ROLE` đúng stamp do **người chạy thủ công**, lệnh chỉ in sau khi guard xác nhận tên+nhãn; không `REASSIGN OWNED`; lỗi giữa chừng → giữ DB, không tự dọn | Log; xác nhận dev/baseline không đổi | Harness không có lệnh DROP (test khóa); lệnh dọn chưa có mã |
| 10 | Phạm vi 22 ca | Đúng 9 CRUD + 7 đồng thời + 6 deny-by-default theo `test-catalog.mjs`; không benchmark, không dữ liệu thật, fixture `example.invalid` | — | Test khóa số lượng 22 (9/7/6) |

## 2. Bằng chứng đã chạy (offline, worktree `D:\SISCOM-CRM-wt-e03`, nhánh `test/e03-pg-disposable-prep`)
- Nền tái dùng: `node --test backend/scripts/guards/pg-dryrun-guard.test.mjs backend/scripts/pg-harness/harness.test.mjs` → 28 pass / 0 fail (khớp C-06 #8).
- Mới: `node --test backend/scripts/pg-harness/harness.cli.test.mjs` → 7 test (CLI qua tiến trình con với env tường minh, stdin không TTY): DRY_RUN exit 0; `--execute` không env exit 2; 11 ca thiếu quyền/sai đích (dev DB, `localhost`, `postgres`, cổng 5432, thiếu nhãn, mã sai, `DATABASE_URL`, `PGHOST`…) đều exit 2 và không lộ mật khẩu; không TTY luôn exit 2; cờ bỏ qua exit 64; guard định danh đứng trước migrate; danh mục đúng 22 ca. Kết quả thật ghi trong báo cáo cuối.

## 3. Điều chưa kiểm chứng
- Không có kết nối/chạy PostgreSQL, Prisma, `psql`; hành vi dotenv của Prisma khi không có `.env` (plan §4.2.5).
- `--execute` vẫn dừng `NOT_IMPLEMENTED` (exit 3) khi qua cổng — chỉ được kiểm trong tiến trình (test #109), không qua CLI vì CLI luôn thiếu TTY trong test.
- Cổng phê duyệt mới kiểm định dạng chuỗi tham chiếu; chưa đối chiếu comment `OWNER_APPROVED` thật.

## 4. Kế hoạch triển khai bộ thực thi (PR code riêng, chưa làm — cần chủ duyệt, xem §5)
Giữ `harness.mjs` là cổng thuần; thêm lớp tiêm phụ thuộc để test offline bằng adapter mô phỏng, adapter thật chỉ nạp sau cổng:
- **A. Interface** `DbExecutor { createRoleAndDb, readIdentity, migrateDeploy, grant, runSql, status }` + `FakeExecutor` (ghi lại lời gọi, không I/O) trong `test/`. Test: thứ tự bước 1→9, dừng ở bước đầu thất bại, mọi lời gọi mang đúng tên DB/role, **không** có lời gọi nào trước khi `evaluateExecutionGate` ok, `migrateDeploy` bị từ chối nếu `readIdentity` sai.
- **B.** Guard trực tuyến §4.2.6 thuần: nhận kết quả `readIdentity` (current_database/current_user/5 cờ/owner/nhãn) → ok/lý do; test dương/âm offline.
- **C.** Lệnh dọn: hàm thuần chỉ in `DROP` sau khi chạy lại guard tên + nhãn; test không in cho tên dev/baseline/thiếu nhãn.
- **D.** Adapter thật (`psql`/Prisma qua `child_process`, env tường minh, xóa `DATABASE_URL`, chạy từ thư mục không có `.env`): **chỉ viết sau khi chủ duyệt**; PR riêng, không tự chạy.
- **E.** Sửa `test-db.ts` cho user `siscom_t_*` và script integration mới (không dùng `run-*-tests.ps1` nguyên trạng — plan §6 bước 7); ánh xạ 22 ca → `*.int-spec.ts`; `DENY-01` chưa có ca DB.

## 5. Phán quyết: BLOCKED — cần từ chủ sở hữu trước khi yêu cầu DB thật
1. Quyết cụm: container/cụm tạm riêng (ưu tiên) hay cụm cục bộ chung; cổng; phiên bản PostgreSQL (plan §9.1, 9.3).
2. Duyệt PR code cho §4 D–E (script tạo role/DB, guard trực tuyến, sửa `test-db.ts`) (plan §9.2). Hiện `--execute` là `NOT_IMPLEMENTED` nên **chưa thể chạy** dù có DB.
3. Cấp stamp cụ thể và comment `OWNER_APPROVED` riêng (nêu stamp + task ID) (plan §9.4).
4. Xác nhận 2 role non-superuser và cách cấp mật khẩu (chỉ qua kênh ngoài kho; không gửi giá trị trong issue/PR).
5. Cam kết người gõ mã xác nhận tại TTY và dọn DB thủ công sau khi lưu log.
`READY_FOR_ISOLATED_DB_REQUEST` chỉ có thể đặt sau khi 1–5 có văn bản **và** PR §4 D–E được duyệt.

## 6. Giao file (Windows) và rollback
File mới (không chép đè): `D:\SISCOM-CRM\docs\PG_DISPOSABLE_HANDOFF_E03.md`, `D:\SISCOM-CRM\backend\scripts\pg-harness\harness.cli.test.mjs`. Không đụng: `harness.mjs`, guard, `package.json`, workflow, migration, `schema.prisma`, `test-db.ts`, `.env`, runner. Sao lưu: không cần (chỉ file mới). Rollback: xóa 2 file; không tác động database.
