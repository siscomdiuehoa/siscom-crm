# Chuẩn bị kết nối backend / PostgreSQL (thiết kế — chưa triển khai)

## Ranh giới hiện tại
`UI (pages) → ui.api.* (App.jsx, commit) → Ops.* (data/repository/mutations.js, thuần, có kiểm tra quyền + quy tắc) → storage (data/repository/storage.js) → localStorage`
- **Quy tắc nghiệp vụ** (trùng MST, chặn xoá khi còn ràng buộc, quyền, nhật ký) nằm trong `mutations.js`, không nằm trong giao diện.
- **Lưu trữ** nằm sau `storage.js` + `schema.js` (phiên bản, migration, sao lưu).

## Cách thay bằng backend (không đổi giao diện trang)
1. Tạo `data/repository/httpClient.js` với cùng các thao tác: `saveCustomer, deleteCustomers, importCustomers, saveContact, deleteContact, addInteraction, decideApproval, list*`.
2. Trong `App.jsx`, hàm `commit(fn)` hiện chạy đồng bộ; khi có API đổi thành bất đồng bộ (optimistic update + rollback khi lỗi). Giá trị trả về `{ ok, error }` đã là hợp đồng mà các trang dùng.
3. Chuyển các quy tắc trong `mutations.js` sang **server** (nguồn sự thật). Bản trong frontend chỉ còn để báo lỗi sớm.
4. Thay `can()` bằng quyền từ token/phiên đăng nhập; `DEMO_USERS` → người dùng thật. Quyền "own" thực thi bằng RLS/điều kiện `owner_id`.
5. Dữ liệu hiện có: dùng "Xuất sao lưu" (JSON v2) → script nhập vào PostgreSQL theo `postgres-schema.sql`. Bản ghi `isDemo` không nhập.

## API đề xuất (REST, JSON, tiếng Việt cho thông báo lỗi)
| Phương thức | Đường dẫn | Ghi chú |
|---|---|---|
| GET/POST | /api/customers | phân trang, tìm kiếm, lọc phía máy chủ |
| GET/PUT/DELETE | /api/customers/{code} | DELETE = xoá mềm; 409 + lý do nếu còn ràng buộc |
| POST | /api/customers/import | kiểm tra trùng MST, trả báo cáo từng dòng |
| GET/POST | /api/customers/{code}/contacts · /interactions | |
| PUT/DELETE | /api/contacts/{code} | |
| GET | /api/quotes · /contracts · /projects · /opportunities | |
| POST | /api/approvals/{quoteCode}/decision | `{ approve: bool, reason }` |
| GET | /api/audit-log | lọc theo entity |
| POST | /api/auth/login · /logout | cookie HttpOnly hoặc token |

## Việc cần quyết định (chưa làm)
Công nghệ backend, xác thực (SSO/AD?), hosting, chính sách lưu trữ nhật ký, quy tắc phê duyệt thực tế, danh sách vai trò thật.
