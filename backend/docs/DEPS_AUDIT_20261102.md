# Đánh giá `npm audit --omit=dev` backend — 2026-11-02

| Mục | Giá trị |
|---|---|
| Nguồn | Owner chạy trên máy Windows mới: backend 9 lỗ hổng (7 High, 2 Moderate), frontend 0. Tái hiện trên `main db43479`, Node 24.15.0, npm 11 — cùng kết quả |
| Bản vá | `prisma`, `@prisma/client`, `@prisma/adapter-pg` 7.10.0 → **7.10.1** (bản vá, phát hành 2026-10-15); `overrides.multer` **2.5.0**; lockfile: `body-parser` 2.4.0, `qs` 6.17.1, `fast-uri` 3.1.9 (trong khoảng phiên bản cho phép). **Không** nâng major NestJS (vẫn 11.2.6), **không** `npm audit fix --force` |
| Sau vá | `npm audit --omit=dev`: **0**. Toàn bộ (gồm dev): 0 High/Critical, 19 Moderate + 4 Low chỉ ở công cụ dev (jest, `@nestjs/cli`, glob/minimatch) — ngoài runtime, để việc riêng |

## Từng advisory: đường phụ thuộc và khả năng khai thác trong SISCOM CRM
| Gói (bản cũ → mới) | Advisory | Đường phụ thuộc | Trên đường chạy? | Đánh giá |
|---|---|---|---|---|
| `body-parser` 2.3.0 → 2.4.0 | GHSA-27r3-jxmh-p828 (High 7.5): body nén + byte thừa ⇒ lỗi không bắt ⇒ sập tiến trình; không cần đăng nhập | `@nestjs/platform-express` → `express@5.2.1` → `body-parser` | **Có** — Nest đăng ký JSON/urlencoded parser mặc định (`src/main.ts`, không tắt `inflate`), chạy trước định tuyến, mọi endpoint | **Nghiêm trọng về lý thuyết.** Thử 6 biến thể (gzip/deflate/brotli × 1 lần ghi / tách 2 lần ghi) trên app Nest thật, Node 24.15.0: **không tái hiện** sập (400/200, tiến trình sống). Vẫn vá — rủi ro thấp, trong khoảng `^2.2.1` của Express |
| `multer` 2.4.0 → 2.5.0 | GHSA-q7qp-rjg7-q26m (High): DoS khi `fileFilter` bất đồng bộ còn chờ lúc request bị huỷ | `@nestjs/platform-express@11.2.6` ghim **đúng** `multer@2.4.0` | **Không** — `backend/src` không có `FileInterceptor`/`UploadedFile`/`MulterModule`/multipart; không endpoint upload | Không khai thác được hiện tại. Vá bằng `overrides` (cùng major) để chặn khi sau này thêm upload. Bản npm đề xuất `@nestjs/platform-express@12.3.2` là **major** ⇒ không dùng |
| `mysql2` 3.15.3 → 3.24.4 | GHSA-3f6p-5ww8-9rcr (High): hạ cấp plugin xác thực ⇒ lộ mật khẩu dạng rõ; GHSA-rgwj-5xj2-c3m3 (Moderate): bom giải nén giao thức MySQL | `@prisma/client` → (peer, tuỳ chọn) `prisma` CLI → `mysql2` | **Không** — CRM dùng **PostgreSQL** qua `@prisma/adapter-pg`; `src` và Prisma client đã sinh không import `mysql2`; chỉ Prisma CLI mang theo | Không khai thác được (không bao giờ kết nối MySQL). Gỡ qua `prisma` 7.10.1 |
| `deepmerge-ts` 7.1.5 → 8.0.2 | GHSA-ggr8-5vv4-36mx (High): tràn ngăn xếp khi gộp đồ thị đệ quy | `prisma` → `@prisma/config` → `deepmerge-ts` | **Không** ở runtime — chỉ khi chạy lệnh Prisma CLI đọc `prisma.config.ts` (do mình viết) | Không khai thác được từ ngoài. Gỡ qua `prisma` 7.10.1 |
| `fast-uri` 3.1.8 → 3.1.9 | 4 advisory (Moderate/Low): giả mạo scheme/host, chuẩn hoá đường dẫn | `prisma` → `@prisma/dev` → `@prisma/streams-local` → `ajv` → `fast-uri` | **Không** ở runtime (công cụ dev của Prisma CLI) | Không khai thác được. Cập nhật lockfile trong khoảng |
| `qs` 6.16.0 → 6.17.1 | GHSA-6pq8-jhm2-2vcw (Moderate): `qs.stringify` với `arrayFormat:'comma'` ném lỗi | `express` / `body-parser` → `qs` | Có nạp, nhưng lỗi ở **`stringify`** — mã không gọi `qs.stringify`; Express/body-parser chỉ `parse` | Không khai thác được. Cập nhật lockfile trong khoảng |

**Kết luận khẩn cấp:** không có lỗ hổng nào được chứng minh khai thác trực tiếp trong môi trường dự án. Riêng `body-parser` nằm trên đường chạy, không cần đăng nhập và có CVSS 7.5 ⇒ ưu tiên merge bản vá này trước khi mở demo cho điện thoại trong Wi-Fi. Biện pháp tạm nếu chưa merge: chỉ mở demo LAN khi cần; sau buổi thử dừng Caddy/backend LAN rồi **chỉ vô hiệu hoá quy tắc** `SISCOM demo LAN 8443` (`Disable-NetFirewallRule -DisplayName "SISCOM demo LAN 8443"`, theo `docs/B1.5_DEMO_LAN_RUNBOOK.md` mục 8) — **giữ Windows Firewall bật**, không tắt firewall toàn máy.

## Kiểm thử
- `src/common/http/compressed-body-dos.spec.ts` (mới): (1) app Nest thật trong tiến trình con nhận 6 biến thể body nén + byte thừa ⇒ tiến trình còn sống, không 5xx, request kế tiếp được trả lời; (2) **sàn phiên bản** body-parser ≥ 2.4.0, multer ≥ 2.5.0, qs ≥ 6.17.0, Prisma = 7.10.1 — với lockfile của `main` (2.3.0 / 2.4.0 / 6.16.0 / 7.10.0) ca này **đỏ**.
- Máy làm việc: `prisma validate`, `prisma generate` (7.10.1) OK; `tsc` OK; unit **563/563**; build OK; migration không đổi.
- Integration PostgreSQL + migrate deploy + diff: trên CI.

## Rollback
`git revert` commit (khôi phục `package.json` + `package-lock.json`), `npm ci`, `prisma generate`. Không migration, không dữ liệu.
