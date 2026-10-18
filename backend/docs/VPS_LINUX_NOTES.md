# Chuẩn bị triển khai VPS Linux (chưa thực hiện trong B1.1)

Thiết kế hiện tại đã theo 12-factor nên chuyển lên Linux không cần sửa mã:
- **Cấu hình qua biến môi trường** (`HOST`, `PORT`, `DATABASE_URL`, `CORS_ORIGINS`, `LOG_LEVEL`, `NODE_ENV=production`). Không đường dẫn Windows trong mã.
- **Quy trình:** `npm ci` → `npm run build` → `npx prisma migrate deploy` → `node dist/main.js`.
- **Node 24 LTS** (NodeSource/nvm) + **PostgreSQL 18** (kho PGDG) cài bằng apt; PostgreSQL `listen_addresses='localhost'`.
- **Tách role (bắt buộc ở production):** `siscom_migrator` (sở hữu schema, chạy `migrate deploy`) và `siscom_app` (chỉ SELECT/INSERT/UPDATE/DELETE + USAGE sequences, không DDL). Backend chạy bằng `siscom_app`; CI/bước triển khai dùng `siscom_migrator` qua `DATABASE_URL` tạm thời. Cần tách cấu hình URL trong `prisma.config.ts` khi làm bước này.
- **Chạy dịch vụ:** systemd, user không phải root, `EnvironmentFile=/etc/siscom-crm/backend.env` (quyền 600), `Restart=on-failure`.
- **Reverse proxy:** Nginx/Caddy nhận HTTPS (80/443) → `127.0.0.1:3000`; backend không mở trực tiếp. Frontend là file tĩnh từ `npm run build` của Vite (`dist/`), `CORS_ORIGINS` = domain thật.
- **Tường lửa:** chỉ SSH, 80, 443. Không mở 5432/3000.
- **Sao lưu:** `pg_dump -Fc` theo cron hằng đêm + sao chép ra ngoài máy chủ; thử khôi phục định kỳ.
- **Chưa có (B1.2+):** xác thực, phân quyền, giới hạn tốc độ — **bắt buộc xong trước khi mở Internet**.
- Có thể đóng gói Docker sau (Prisma 7 không cần engine Rust nên image nhẹ); cần đặt `DATABASE_URL` giả khi `prisma generate` trong bước build.
