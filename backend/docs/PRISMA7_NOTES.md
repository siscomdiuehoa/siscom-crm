# Prisma 7 trong dự án này — cấu hình và điểm cần kiểm chứng

## Đã áp dụng theo tài liệu Prisma 7 (tra cứu 11/10/2026)
- Ghim **chính xác** `prisma@7.10.1`, `@prisma/client@7.10.1`, `@prisma/adapter-pg@7.10.1` (Prisma 8 đang ở RC; không dùng `latest`/RC). Dùng `.npmrc` `save-exact=true`, `engine-strict=true` và `package-lock.json`.
- **`prisma.config.ts`** chứa URL kết nối (`datasource.url = env('DATABASE_URL')`) + đường dẫn migrations; `schema.prisma` không còn `url`.
- **Driver adapter bắt buộc:** `PrismaService` tạo `PrismaClient({ adapter: new PrismaPg({...}) })`.
- **Generator mới `prisma-client`**, đầu ra `src/generated/prisma` (không còn trong `node_modules`, đã `.gitignore`), **`moduleFormat = "cjs"`** để khớp NestJS 11 CommonJS. Import: `../generated/prisma/client`.
- **Node không tự đọc `.env`:** `prisma.config.ts` import `dotenv/config`; Nest dùng `ConfigModule` (cũng đọc `.env`).
- Mọi lệnh `prisma` (kể cả `generate`) cần `DATABASE_URL` có mặt. Khi build CI/Docker không có DB, đặt một giá trị giả cho biến này lúc `prisma generate`.
- Migration khởi tạo `prisma/migrations/20261011000000_init/migration.sql` do **viết tay** (bảng `app_meta` + 1 dòng baseline) để người dùng chỉ cần `prisma migrate deploy` (không cần database bóng/quyền CREATEDB). `SHADOW_DATABASE_URL` đã được chuẩn bị nhưng **chưa dùng** trong B1.1.

## Phải kiểm chứng trên máy bạn (tôi không thể chạy)
1. Các phiên bản ghim (`7.10.1`, `@nestjs/* 11.2.6`) tồn tại trên npm — nếu `npm install` báo `ETARGET`, chạy `npm view prisma@7 version` và `npm view @nestjs/core@11 version`, sửa số phiên bản tương ứng (giữ cùng một số cho cả 3 gói Prisma).
2. `npx prisma generate` tạo được `src/generated/prisma/client.ts`; `npm run build` biên dịch không lỗi (đặc biệt phần import client CJS và `new PrismaPg({...})` nhận `max`, `connectionTimeoutMillis`, `idleTimeoutMillis`).
3. `npx prisma migrate status` báo migration đã áp dụng; nếu sau này `prisma migrate dev` báo "drift" với migration viết tay → báo lại, không tự reset.
4. `@nestjs/config`, `@nestjs/cli`, jest/ts-jest dùng khoảng phiên bản `^` — `package-lock.json` sau lần cài đầu sẽ cố định chúng; hãy lưu file này.

## Khi nâng cấp sau này
- Nest 12 (ESM) và Prisma 8: nâng riêng từng thứ, có sao lưu, chạy lại checklist.
