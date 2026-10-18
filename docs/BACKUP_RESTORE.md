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

## Dữ liệu frontend (localStorage)
Backend chưa chứa dữ liệu khách hàng. Dữ liệu trong trình duyệt sao lưu bằng nút "Xuất sao lưu" của frontend; lưu file JSON vào `D:\SISCOM-CRM\backups\`.
