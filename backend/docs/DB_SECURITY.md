# Bảo mật PostgreSQL và backend (B1.1)

- **Tài khoản:** `postgres` (superuser) chỉ dùng một lần trong `setup-db`. CRM chạy bằng `siscom_app`: `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`. Backend **từ chối khởi động** nếu `DATABASE_URL` dùng `postgres` hoặc còn mật khẩu mẫu `CHANGE_ME`.
- **Mật khẩu:** nhập ẩn / tự sinh 32 ký tự ngẫu nhiên; chỉ nằm trong `.env` (ACL chỉ tài khoản Windows hiện tại; `.gitignore` chặn). Không có trong mã, `.env.example`, log, báo cáo. Backend không in `DATABASE_URL`.
- **Mạng:** PostgreSQL nghe `localhost`; không mở cổng 5432 trên Firewall; backend nghe `127.0.0.1`. Kiểm tra `pg_hba.conf` chỉ có dòng `127.0.0.1/32` và `::1/128` (không `0.0.0.0/0`).
- **Phân quyền DB:** `REVOKE ALL ... FROM PUBLIC`, chỉ `siscom_app` được `CONNECT`.
- **CORS:** danh sách cho phép từ `CORS_ORIGINS`; `*` bị từ chối khi khởi động; production bắt buộc khai báo.
- **Lỗi:** 5xx và lỗi database trả thông báo chung; chi tiết chỉ ghi log máy chủ (kèm `X-Request-Id`). Log không ghi query string, header, body.
- **Header bảo mật:** `helmet`.
- **Lưu ý:** nếu bật `log_statement = all` trong PostgreSQL, câu lệnh đặt mật khẩu lúc `setup-db` sẽ nằm trong log của PostgreSQL — mặc định là `none`, đừng bật khi chạy setup.
- **Chưa có (B1.2+):** đăng nhập, phân quyền, giới hạn tốc độ, audit người dùng. Vì vậy **không** mở backend ra Internet ở giai đoạn này.
- **Production (VPS):** tách role migrate (DDL) và role ứng dụng (chỉ DML); xem `VPS_LINUX_NOTES.md`.
