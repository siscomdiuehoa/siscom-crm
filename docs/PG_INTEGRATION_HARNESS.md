# Harness tích hợp backend + PostgreSQL disposable — BẢN NHÁP

**Trạng thái:** NHÁP (source/scripts/docs). **DB, migration, seed, reset, Prisma: NOT_RUN.** Task SISCOM-FOLLOWUP-C-06-PG-INTEGRATION-HARNESS-DRAFT. Dựa trên `docs/PG_ISOLATED_ACCEPTANCE_PLAN.md` (PR #100) và guard C-05 (`backend/scripts/guards/pg-dryrun-guard.mjs`, PR #108; nhánh này xếp chồng lên nhánh C-05).

## File mới (đích: `D:\SISCOM-CRM\…`; không có file chép đè)
| File | Vai trò |
|---|---|
| `backend/scripts/pg-harness/harness.mjs` | CLI + hàm thuần: kế hoạch, cổng thực thi fail-closed, kiểm fixture |
| `backend/scripts/pg-harness/test-catalog.mjs` | Danh mục 22 ca customer CRUD / đồng thời / deny-by-default (mọi ca `NOT_RUN`) |
| `backend/scripts/pg-harness/fixtures.synthetic.json` | Fixture tổng hợp (4 khách, 2 liên hệ, 3 actor); `isDemo`, email `example.invalid`, MST `9999xxxxxx`, SĐT `0900xxxxxx` |
| `backend/scripts/pg-harness/harness.test.mjs` | 11 test thuần mock |

Không đụng: `package.json`, workflow, migration, `schema.prisma`, `test-db.ts`, `*.int-spec.ts`, `.env`, Runner.

## Cách dùng
- Mặc định (DRY_RUN, không cần biến môi trường): `node backend/scripts/pg-harness/harness.mjs [--list-catalog]` → in kế hoạch 10 bước, exit 0.
- Test: `node --test backend/scripts/guards/pg-dryrun-guard.test.mjs backend/scripts/pg-harness/harness.test.mjs`.
- `--execute` **chỉ** qua cổng fail-closed (exit 2 nếu thiếu bất kỳ điều kiện): `SISCOM_PG_APPROVAL_REF` (tham chiếu phê duyệt văn bản), `SISCOM_PG_OWNER_GRANTED_DB=1`, và toàn bộ guard C-05 (`SISCOM_PG_TEST_URL`, `SISCOM_PG_EXPECTED_PORT`, `SISCOM_PG_LABEL`, `SISCOM_PG_CONFIRM_DB`, `SISCOM_PG_CONFIRM_CODE`, TTY; từ chối nếu có `DATABASE_URL`/`PG*`). Cờ `--force/--yes/--skip*…` → exit 64.
- Kể cả khi qua cổng, bản nháp **dừng ở exit 3 `NOT_IMPLEMENTED`**: chưa có bộ thực thi DB, không import Prisma/pg/child_process, không đọc `.env`, không in URL/mật khẩu.

## Việc còn lại (cần chủ sở hữu duyệt riêng — BLOCKED cho tới lúc đó)
1. Chủ sở hữu cấp DB thử riêng + stamp (plan §9).
2. PR code riêng: bộ thực thi bước 1–9 (tạo role/DB, `migrate deploy`, nạp fixture, chạy suite), sửa `test-db.ts` cho user `siscom_t_*`, guard trực tuyến §4.2.6.
3. Ánh xạ danh mục → suite `*.int-spec.ts`; `DENY-01` chưa có ca DB tương ứng.

## Rollback
Xóa 4 file trên và tài liệu này. Không có tác động database.
