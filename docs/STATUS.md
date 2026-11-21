# Hiện trạng SISCOM CRM (đọc đầu mỗi phiên)

Cập nhật 10/11/2026 tại `main` = `2268b53` (PR #223). File này cố ý ngắn: chỉ ghi điều ổn định. **Trạng thái sống** (PR đang mở, CI) xem bằng `gh pr list` và trang Actions, không ghi ở đây.

## Đã có trên `main`
- **Backend** (`backend/`, NestJS + Prisma 7 + PostgreSQL 18), 4 module: `customers` (khách hàng, liên hệ, tìm kiếm), `auth` (đăng nhập phiên cookie phía máy chủ, CSRF, khoá tạm, ghi nhớ thiết bị, đổi mật khẩu), `activities` (hoạt động chăm sóc, công việc, chuyển giao), `lookups`.
- **Database:** 12 migration trong `backend/prisma/migrations/`. Ba role tách quyền: `siscom_migrator` (chủ sở hữu, chạy migration), `siscom_app` (nghiệp vụ), `siscom_auth` (xác thực). Bộ quyền hiện hành: `backend/docs/B1.3_S1_APP_GRANTS_V4.sql.txt`. Chi tiết: `backend/docs/DB_SECURITY.md`.
- **Frontend chính thức:** `frontend/siscom-crm-web` (React + Vite). Có chế độ demo (localStorage) và chế độ API (cờ `VITE_CRM_AUTH_ENABLED`, `VITE_CRM_API_ENABLED`, `VITE_CRM_API_BASE`).
- **CI:** 4 job + cổng `CI gate` (`.github/workflows/ci.yml`); integration chạy trên PostgreSQL tạm cách ly.

## Quy tắc và quy trình
- An toàn dữ liệu: [AGENTS.md](../AGENTS.md). Đóng góp: [CONTRIBUTING.md](../CONTRIBUTING.md).
- Phối hợp AI, vòng review, lệnh phê duyệt của Owner: [QUY_TRINH_PHOI_HOP_AI.md](QUY_TRINH_PHOI_HOP_AI.md) (bản 1.1).

## Tài liệu chỉ đọc khi đụng đúng hạng mục
- Hiệu năng/công thức tìm kiếm khách hàng và các baseline đã khoá (B1.2.3): [PROGRESS_B1.2.3-B2.md](PROGRESS_B1.2.3-B2.md) — nhật ký tới 20/10/2026, **không còn là trạng thái dự án**.
- Thiết kế hoạt động chăm sóc (B3): [B3_ACTIVITIES_DESIGN.md](B3_ACTIVITIES_DESIGN.md).
- Chạy demo trên Windows/LAN: [B1.4_DEMO_WINDOWS_RUNBOOK.md](B1.4_DEMO_WINDOWS_RUNBOOK.md), [B1.5_DEMO_LAN_RUNBOOK.md](B1.5_DEMO_LAN_RUNBOOK.md).

## Khi nào sửa file này
Chỉ khi PR thêm/bỏ module, đổi bộ quyền DB hiện hành, đổi frontend chính thức hoặc đổi cấu trúc CI. Giữ dưới 40 dòng.
