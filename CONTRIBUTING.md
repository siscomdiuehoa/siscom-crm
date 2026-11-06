# Đóng góp cho SISCOM CRM

Áp dụng cho cả người và trợ lý lập trình AI. Nhánh `main` là **baseline được bảo vệ**: mọi thay đổi vào `main` đều qua Pull Request (PR), không đẩy trực tiếp, không force-push.

## 1. Nhánh

Tạo từ `main` mới nhất, sống ngắn, một nhánh = một gói công việc nhỏ.

| Tiền tố | Dùng cho | Ví dụ |
|---|---|---|
| `feat/` | tính năng | `feat/b1.3.2-a-auth-deps` |
| `fix/` | sửa lỗi | `fix/customers-search-total` |
| `db/` | migration / thay đổi cấu trúc dữ liệu | `db/b1.3.2-b-auth-core` |
| `docs/` | tài liệu | `docs/api-contract` |
| `chore/` | cấu hình, công cụ, dọn dẹp | `chore/repo-foundation` |
| `ci/` | quy trình CI | `ci/basic-checks` |

## 2. Commit

Theo Conventional Commits, tiêu đề ngắn, tiếng Việt hoặc tiếng Anh nhất quán trong một PR: `feat(auth): …`, `fix(customers): …`, `db: …`, `docs: …`, `chore(repo): …`. Mỗi commit một mục đích; không trộn thay đổi mã với định dạng hàng loạt.

## 3. Pull Request

1. Mở PR vào `main`, điền đủ [mẫu PR](.github/pull_request_template.md).
2. Một PR = một gói: nêu rõ **phạm vi**, **file mới / file thay đổi**, **tác động database (có/không)**, **kiểm thử đã chạy (kết quả thật)**, **rollback**, **rủi ro**, và những gì **không đụng** (baseline, hợp đồng API).
3. Cần ít nhất 1 người duyệt. Với thay đổi bảo mật (xác thực, phân quyền, audit), migration hoặc dữ liệu nhạy cảm: **người duyệt khác tác giả**. PR do AI viết: review độc lập bởi ChatGPT theo [quy trình phối hợp AI](docs/QUY_TRINH_PHOI_HOP_AI.md) (tối đa 3 vòng, chỉ review diff mới, lỗi gom theo nhóm có ID); Owner quyết định merge sau báo cáo kết luận.
4. Squash merge sau khi được duyệt và kiểm tra bắt buộc đạt; xóa nhánh sau khi hợp nhất. Người viết không tự merge thay đổi của mình khi chưa có review.
5. Không tuyên bố "PASS/đạt" nếu chưa có kết quả chạy thật; môi trường không chạy được thì ghi rõ "chưa kiểm chứng".

## 4. Kiểm thử

Chỉ chạy phần liên quan tới thay đổi; không chạy lại bài đã đạt khi không có thay đổi ảnh hưởng.

- Kiểu: `npx tsc --noEmit -p tsconfig.json` (trong `backend/`).
- Unit: `npm run test:unit` (trong `backend/`, không cần database).
- Frontend: `npm run build` (trong `frontend/siscom-crm-web/`).
- Integration: chỉ trên **database thử** (`siscom_crm_restore_*` hoặc `siscom_crm_test_*`), qua `backend\scripts\windows\run-customers-tests.bat` hoặc `run-audit-tests.bat`. Không bao giờ trỏ vào `siscom_crm_dev`.
- Benchmark/hiệu năng (P1/P2): không thuộc kiểm tra thường lệ; chỉ khi có yêu cầu rõ, không đổi ngưỡng nghiệm thu đã chốt (150/500/1.500 ms).

## 5. Database và migration

- Chỉ áp dụng bằng `prisma migrate deploy` (`npm run db:migrate`). **Cấm** `prisma migrate dev`, `prisma migrate reset`, `prisma db push`, `DROP DATABASE` trên dữ liệu thật.
- Migration **đã áp dụng là bất biến**: không sửa nội dung, không mở-lưu lại bằng trình soạn thảo, không đổi xuống dòng (Prisma kiểm checksum; ký tự UTF-8 phải giữ nguyên byte).
- Thay đổi cấu trúc = **migration mới** (cộng thêm, tương thích ngược), khai báo đồng thời trong `schema.prisma`, có test ràng buộc và kế hoạch rollback.
- Migration chỉ chứa cấu trúc (DDL), ràng buộc, trigger. Không chứa dữ liệu thật, mật khẩu, email, số điện thoại. Dữ liệu mẫu (seed) tách riêng, đánh dấu `is_demo`.
- Mọi migration thử trên bản sao database mới trước; áp dụng lên `siscom_crm_dev` hoặc production cần phê duyệt riêng, có sao lưu và kiểm tra khôi phục.
- Hai Prisma Migration hiện có (`20261011000000_init` và `20261012000000_b1_2_crm_core`) đã được đưa vào Git qua **PR #1**. `.gitignore` cho phép theo dõi `backend/prisma/migrations/**/migration.sql`, còn `.gitattributes` đặt `-text` để giữ nguyên byte của migration. **Không sửa migration đã áp dụng và không dùng `git add -f` để vượt qua quy tắc ignore/bảo mật**.

## 6. Kiến trúc

Giữ Modular Monolith: một miền nghiệp vụ = một module trong `backend/src/modules/<miền>`; giao tiếp qua giao diện được export; `backend/src/common` chỉ chứa hạ tầng. Không phá hợp đồng API đã chốt ([`backend/docs/B1.2.3_API_CONTRACT.md`](backend/docs/B1.2.3_API_CONTRACT.md)) nếu không có PR riêng được duyệt. Không thêm dependency khi chưa được duyệt; PR thêm dependency nêu rõ gói, phiên bản ghim, kết quả kiểm tra peer.

## 7. Bảo mật

Không commit `.env`, khóa, mật khẩu, JWT secret, bản sao lưu/dump, dữ liệu khách hàng thật. Không đưa bí mật vào log, ảnh chụp màn hình, mô tả PR. Phát hiện lộ bí mật: báo ngay và đổi bí mật liên quan.

## 8. Tài liệu đi kèm thay đổi

Cập nhật [`docs/PROGRESS_B1.2.3-B2.md`](docs/PROGRESS_B1.2.3-B2.md) hoặc tài liệu giai đoạn tương ứng khi PR thay đổi trạng thái nghiệm thu, kèm đường dẫn đích rõ ràng của các tệp cần chép/chép đè.
