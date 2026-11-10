# FV-4A — Xuất CSV khách hàng: việc cần làm khi triển khai

Áp dụng cho `POST /api/v1/customers/export`. Tài liệu này chỉ mô tả; không tự chạy bước nào trên DB demo / DB thật khi chưa có Owner duyệt riêng cho từng DB (D-E7).

## 1. Biến môi trường `EXPORT_GAP_LOG_DIR` (bắt buộc ở production)

Chức năng xuất ghi nhật ký vào `audit_log`. Những lần từ chối vượt hạn mức ghi (không ghi vào DB) được đếm và ghi bền ra file JSONL trong thư mục này, để không mất dấu.

| Môi trường | Thiếu biến | Thư mục không tạo được | Thư mục có nhưng **không ghi được** |
|---|---|---|---|
| `NODE_ENV=production` | **Backend từ chối khởi động** (lỗi `Thiếu EXPORT_GAP_LOG_DIR…`) | **Backend từ chối khởi động** | **Backend từ chối khởi động** (lỗi `EXPORT_GAP_LOG_DIR không ghi được (<mã lỗi>)…`) |
| development / test | Dùng `<thư mục tạm của hệ điều hành>/siscom-export-gap` | Backend từ chối khởi động | Backend từ chối khởi động |

Khi khởi động, backend ghi và `fsync` một dòng `"event":"startup"` vào file của ngày; không ghi được (thiếu quyền, ổ đầy, đường dẫn bị chiếm) thì dừng ngay (FV4A-R1-FIX). File của ngày đã đạt trần dung lượng **không** chặn khởi động.

Đây là hành vi cố ý (fail-closed). Hệ quả: bản backend có FV-4A **không khởi động được ở production nếu chưa đặt biến này**, kể cả khi chưa ai dùng chức năng xuất. Phải đặt biến **trước** khi cập nhật backend.

Cách đặt:
1. Tạo thư mục ngoài thư mục mã nguồn và ngoài thư mục web, ví dụ `D:\SISCOM-CRM-logs\export-gap` (Linux: `/var/log/siscom-crm/export-gap`).
2. Cấp quyền tạo / ghi cho đúng tài khoản chạy backend; không cấp cho người dùng khác. (Backend tự tạo thư mục nếu chưa có, với quyền `0700` trên Linux.)
3. Thêm vào `.env` của dịch vụ: `EXPORT_GAP_LOG_DIR=<đường dẫn tuyệt đối>`.
4. Khởi động lại backend; kiểm tra trong thư mục có file `export-audit-gap-<ngày>.jsonl` với một dòng `"event":"startup"`.

Vận hành:
- File theo ngày: `export-audit-gap-<ngày>.jsonl`. Đưa thư mục vào sao lưu.
- Dòng `abnormal_stop_detected` khi khởi động nghĩa là lần chạy trước dừng không bình thường.
- File chứa mã nhân viên và lý do từ chối; không chứa dữ liệu khách hàng, mật khẩu hay token. Vẫn coi là nhật ký nội bộ.

## 2. Quyền `customer.export`

- DB mới bootstrap: `crm_admin` có sẵn `customer.export` (ALL). Các vai trò khác không có ⇒ không thấy nút Xuất.
- DB đã bootstrap trước FV-4A: cấp bằng `FV4_EXPORT_PERMISSION.sql.txt` (yêu cầu đặc quyền 2 người, chạy bằng `siscom_migrator`). Gỡ: `FV4_EXPORT_PERMISSION_REMOVE.sql.txt`. Diễn tập: `FV4_EXPORT_PERMISSION_TEST.sql.txt` (chạy trong transaction rồi ROLLBACK).
- Cần PostgreSQL ≥ 17 (dùng `transaction_timeout`).

## 3. Giới hạn cố định

5.000 dòng mỗi lần xuất · 10 lần xuất thành công mỗi giờ mỗi người · mỗi lệnh truy vấn tối đa 15 giây, cả transaction tối đa 20 giây.
