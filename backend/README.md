# SISCOM CRM — Backend (B1.1)

NestJS 11 + Prisma 7 + PostgreSQL. Chạy độc lập tại `http://127.0.0.1:3000/api/v1`. **Chưa có** nghiệp vụ, đăng nhập, phân quyền hay dữ liệu khách hàng (B1.2 trở đi). Frontend Vite không bị thay đổi.

## Bắt đầu nhanh (Windows)
Đọc **`docs/WINDOWS_SETUP.md`** (từng bước, dành cho người không chuyên lập trình).

Tóm tắt: cài Node.js 24 LTS + PostgreSQL → đặt thư mục này **ngoài Dropbox** (ví dụ `C:\dev\siscom-crm\backend`) → `scripts\windows\check-env.bat` → `scripts\windows\setup-db.bat` → `npm install` → `npm run db:migrate` → `npm run build` → `npm run start:dev` → mở `http://127.0.0.1:3000/api/v1/health`.

## Tài liệu
| File | Nội dung |
|---|---|
| `docs/WINDOWS_SETUP.md` | Cài đặt và chạy trên Windows |
| `docs/ACCEPTANCE_CHECKLIST.md` | Checklist nghiệm thu B1.1 (ô kết quả để trống cho bạn điền) |
| `docs/DB_SECURITY.md` | Bảo mật PostgreSQL/mật khẩu/CORS |
| `docs/BACKUP_RESTORE.md` | Sao lưu và khôi phục |
| `docs/PRISMA7_NOTES.md` | Cấu hình Prisma 7 + các điểm cần kiểm chứng |
| `docs/VPS_LINUX_NOTES.md` | Chuẩn bị triển khai VPS Linux |
| `docs/FV4_EXPORT_RUNBOOK.md` | FV-4A xuất CSV: biến `EXPORT_GAP_LOG_DIR` (bắt buộc ở production), cấp quyền `customer.export` |

## Lệnh
`npm run build` · `npm run start:dev` · `npm run db:migrate` (prisma migrate deploy, không xoá dữ liệu) · `npm run db:status` · `npm run test:e2e` (cần DB đang chạy)

## Cấm
Không chạy `prisma migrate reset`, `prisma db push --force-reset`, `DROP DATABASE` trên dữ liệu thật. Dự án không có script nào gọi các lệnh này.

## Trạng thái kiểm chứng
Mã nguồn được viết trong môi trường **không có Node/PostgreSQL**; chưa từng được `npm install`, build hay chạy. Kết quả thực tế do bạn điền trong `docs/ACCEPTANCE_CHECKLIST.md`.
