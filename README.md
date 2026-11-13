# SISCOM CRM

CRM nội bộ của SISCOM: quản lý khách hàng, người liên hệ, danh mục, nhật ký thay đổi; phát triển theo từng giai đoạn nghiệm thu.

> Trạng thái nghiệm thu từng giai đoạn **không** ghi ở đây (để không lỗi thời). Nguồn sự thật: [`docs/PROGRESS_B1.2.3-B2.md`](docs/PROGRESS_B1.2.3-B2.md) và các báo cáo trong [`backend/docs/`](backend/docs/).

## Kiến trúc

Modular Monolith, hai ứng dụng độc lập trong một kho:

| Phần | Công nghệ | Thư mục |
|---|---|---|
| Backend | NestJS 11, Prisma 7, PostgreSQL | [`backend/`](backend/) |
| Frontend | React 18, Vite 5 (giao diện Liquid Glass, dữ liệu mẫu trong `localStorage`) | [`frontend/siscom-crm-web/`](frontend/siscom-crm-web/) |

- **Frontend chính thức là `frontend/siscom-crm-web`.** Frontend hiện chưa nối với API backend.
- Backend phục vụ `http://127.0.0.1:3000/api/v1`; CORS chỉ cho các địa chỉ khai báo trong `CORS_ORIGINS`.
- Customer API mặc định **từ chối mọi yêu cầu (401)** cho tới khi có xác thực; xem [`backend/docs/B1.2.3_SECURITY_DECISIONS.md`](backend/docs/B1.2.3_SECURITY_DECISIONS.md).

### Backend — các module (`backend/src`)

- `modules/customers` — khách hàng và người liên hệ (controller, service, DTO, tìm kiếm, validators).
- `modules/lookups` — danh mục (chỉ đọc).
- `health` — kiểm tra sức khỏe dịch vụ.
- `prisma` — kết nối cơ sở dữ liệu (module toàn cục).
- `common` — hạ tầng dùng chung, không chứa nghiệp vụ: `audit` (ghi `audit_log`), `auth` (hợp đồng danh tính/phạm vi), `errors`, `filters`, `middleware`.
- `config` — kiểm tra biến môi trường lúc khởi động.

Quy tắc mở rộng: mỗi miền nghiệp vụ là một module riêng trong `src/modules/<miền>`; module chỉ dùng module khác qua giao diện được export (NestJS DI), không import chéo vào nội bộ; `common` không chứa nghiệp vụ.

### Cơ sở dữ liệu (`backend/prisma`)

- `schema.prisma` và `migrations/` (Prisma Migrate). Migration chỉ áp dụng bằng `prisma migrate deploy` (`npm run db:migrate`).
- **Migration đã áp dụng là bất biến**: không sửa, không lưu lại bằng trình soạn thảo, không đổi xuống dòng (Prisma kiểm checksum). Thay đổi mới = migration mới.

## Cấu trúc thư mục

```
backend/            NestJS + Prisma (src, test, prisma, scripts/windows, docs)
frontend/
  siscom-crm-web/   React + Vite (src, tests, docs)
docs/               tài liệu cấp dự án, docs/evidence (bằng chứng nghiệm thu)
.github/            mẫu Pull Request
```
Frontend chuẩn là `frontend/siscom-crm-web`. Còn tồn tại tài liệu trùng giữa `docs/` và `backend/docs/` (chưa dọn); khi hai bản khác nhau, bản trong `docs/` mới hơn.

## Chạy trên máy phát triển (Windows)

Yêu cầu: Node.js 24 (backend: `>=24.11 <25`, npm `>=11.6`), PostgreSQL. Hướng dẫn từng bước: [`docs/WINDOWS_SETUP.md`](docs/WINDOWS_SETUP.md).

Backend (`backend/`): `npm run build`, `npm run start:dev`, `npm run db:status`, `npm run db:migrate` (chỉ áp dụng migration có sẵn; xem quy tắc trong [AGENTS.md](AGENTS.md)). Health: `http://127.0.0.1:3000/api/v1/health`.

Frontend (`frontend/siscom-crm-web/`): `npm install`, `npm run dev` (http://localhost:5173), `npm run build`. Chi tiết: [`frontend/siscom-crm-web/README.md`](frontend/siscom-crm-web/README.md).

## Kiểm thử

- Unit (không cần database): `npm run test:unit` trong `backend/`.
- Integration ghi vào database thử, chỉ chạy qua script có kiểm tra tên database: `backend\scripts\windows\run-customers-tests.bat` (và `run-audit-tests.bat`). **Không** trỏ vào `siscom_crm_dev`.
- Benchmark/hiệu năng: `backend/test/perf`, `backend/scripts/windows/run-search-bench.bat`; chỉ chạy khi có yêu cầu rõ ràng, không thuộc kiểm tra thường lệ.

## Tài liệu

| Chủ đề | Tài liệu |
|---|---|
| Cài đặt Windows | [`docs/WINDOWS_SETUP.md`](docs/WINDOWS_SETUP.md) |
| Tiến độ và quyết định kỹ thuật | [`docs/PROGRESS_B1.2.3-B2.md`](docs/PROGRESS_B1.2.3-B2.md) |
| Kế hoạch dữ liệu nghiệp vụ | [`backend/docs/B1.2_PLAN.md`](backend/docs/B1.2_PLAN.md) |
| Hợp đồng Customer API | [`backend/docs/B1.2.3_API_CONTRACT.md`](backend/docs/B1.2.3_API_CONTRACT.md) |
| Bảo mật và quyết định | [`backend/docs/B1.2.3_SECURITY_DECISIONS.md`](backend/docs/B1.2.3_SECURITY_DECISIONS.md), [`backend/docs/DB_SECURITY.md`](backend/docs/DB_SECURITY.md) |
| Authentication/RBAC (thiết kế) | [`backend/docs/B1.3.1_FINAL_DESIGN.md`](backend/docs/B1.3.1_FINAL_DESIGN.md), [`backend/docs/B1.3.2_PLAN.md`](backend/docs/B1.3.2_PLAN.md) |
| Sao lưu và khôi phục | [`docs/BACKUP_RESTORE.md`](docs/BACKUP_RESTORE.md) |
| Prisma 7 | [`backend/docs/PRISMA7_NOTES.md`](backend/docs/PRISMA7_NOTES.md) |

## Đóng góp

Đọc [CONTRIBUTING.md](CONTRIBUTING.md) (nhánh, Pull Request, review, kiểm thử) và [AGENTS.md](AGENTS.md) (quy tắc an toàn cho trợ lý lập trình AI).

## Bảo mật

Không commit `.env`, khóa, mật khẩu, bản sao lưu cơ sở dữ liệu, tệp dump hay dữ liệu khách hàng thật. Phát hiện lộ bí mật: báo ngay cho người quản trị kho, đổi bí mật liên quan.
