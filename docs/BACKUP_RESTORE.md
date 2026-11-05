# Sao lưu và khôi phục PostgreSQL

Thư mục sao lưu chính thức: **`D:\SISCOM-CRM\db-backups`** (nằm cạnh `backend\`, ngoài Git). Đổi bằng `backup-db.bat -BackupDir "E:\Sao-luu"`.

## Sao lưu
Nhấp đúp `D:\SISCOM-CRM\backend\scripts\windows\backup-db.bat`. Script:
1. Đọc kết nối từ `.env` (không in mật khẩu), từ chối nếu dùng tài khoản `postgres`.
2. Kiểm tra `pg_dump` không cũ hơn máy chủ PostgreSQL.
3. `pg_dump -Fc` vào file `.partial`, kiểm tra đọc lại được bằng `pg_restore -l`, rồi mới đổi tên thành `siscom_crm_dev_YYYYMMDD_HHMMSS.dump`; ghi kèm `.sha256`. **Không ghi đè** file cũ; lỗi thì không để lại file nửa vời.
Script chỉ **đọc** database.
**Kết quả đúng:** các dòng `[OK]`, "Đã sao lưu: D:\SISCOM-CRM\db-backups\siscom_crm_dev_….dump", có SHA-256 và "Có dữ liệu bảng app_meta".

## Thử khôi phục (bắt buộc làm ít nhất một lần)
Nhấp đúp `scripts\windows\restore-test.bat`. Script dùng file `.dump` mới nhất, kiểm tra SHA-256, nhập mật khẩu `postgres` (ẩn, chỉ để tạo database thử), tạo database **mới** `siscom_crm_restore_<ngày_giờ>` rồi `pg_restore` vào đó. **Không đụng `siscom_crm_dev`.**
**Kết quả đúng:** "THÀNH CÔNG", `schema_baseline = b1.1`, số bảng ≥ 1.
Database thử được giữ lại; khi không cần, xoá **thủ công** đúng database thử đó (lệnh được in ở cuối script). Script không có lệnh xoá.

## Khôi phục thật (chỉ khi sự cố)
Không tự động. Dừng backend → sao lưu lại trạng thái hiện tại → khôi phục vào database mới → kiểm tra → đổi `DATABASE_URL` sang database đó. Không khôi phục đè lên database đang dùng.

## Lịch
Trước mỗi `db:migrate` (bắt buộc cho B1.2), cuối ngày có dữ liệu quan trọng. File sao lưu có thể chứa dữ liệu thật: giữ ngoài Git, không đồng bộ lên đám mây công cộng.

## Cụm demo (PostgreSQL riêng, mặc định cổng 55433) — 05/11/2026
`backup-db.bat` / `restore-test.bat` **đọc `backend/.env` và cố định cổng 5432** ⇒ **không dùng** cho cụm demo (`demo-pg.bat`). Dùng hai script riêng, mặc định cổng **55433**, **từ chối 5432** không có ngoại lệ, mật khẩu `postgres` của cụm demo lấy từ `D:\SISCOM-CRM-demo-pg\private\pg-<port>.secrets` (không hỏi, không in), kiểm `cluster_name = siscom_demo` trước khi làm gì:
- **Sao lưu:** `scripts\windows\demo-backup.bat [-DatabaseName <siscom_crm_test_…>] [-PgPort 55433] [-BackupDir D:\SISCOM-CRM-demo-pg\backups]` — mặc định DB trong `private\current-<port>.txt`; chỉ đọc; `pg_dump -Fc` vào `.partial`, kiểm `pg_restore -l`, đổi tên `<db>_YYYYMMDD_HHMMSS.dump`, ghi `<file>.sha256`; không ghi đè.
- **Thử khôi phục (bắt buộc trước mỗi `demo-split.bat -Step migrate`):** `scripts\windows\demo-restore-test.bat [-DumpFile …]` — kiểm SHA-256, tạo DB **mới** `siscom_crm_restore_<ngày-giờ>` trên cụm demo (OWNER `siscom_migrator` nếu đã tách role), `pg_restore --exit-on-error`, so số dòng 6 bảng (`customer`, `contact`, `employee`, `activity`, `audit_log`, `_prisma_migrations`) với DB nguồn, ghi `<dump>.restore-ok.txt`. Không DROP; DB thử **giữ lại** làm bản sao để diễn tập migration/rollback (`demo-split.bat -Step migrate -DatabaseName siscom_crm_restore_…`).
- **Snapshot cả cụm (khi cụm đang dừng, phục hồi nhanh nhất):** `robocopy D:\SISCOM-CRM-demo-pg\data D:\SISCOM-CRM-demo-pg\snapshot_<stamp>\data /E /COPY:DAT`; phục hồi = dừng cụm, đổi tên thư mục.
- Thứ tự an toàn trước migration demo: dừng cụm → snapshot → khởi động → `demo-backup` → `demo-restore-test` → diễn tập migrate + rollback trên DB `siscom_crm_restore_…` → mới `demo-split -Step migrate` trên DB demo thật.

## Dữ liệu frontend (localStorage)
Backend chưa chứa dữ liệu khách hàng. Dữ liệu trong trình duyệt sao lưu bằng nút "Xuất sao lưu" của frontend; lưu file JSON vào `D:\SISCOM-CRM\backups\`.
