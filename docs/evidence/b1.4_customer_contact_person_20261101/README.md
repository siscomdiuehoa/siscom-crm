# Bằng chứng B1.4 — Người liên hệ của khách hàng doanh nghiệp (2026-11-01)

Nhánh `feat/b1.4-customer-contact-person` (gốc `main` 765d30c). Chỉ đổi **frontend** + test; backend, database, migration, hợp đồng API: **không đổi**.
Môi trường: máy owner (Windows 11), bản demo trên cụm PostgreSQL demo **riêng** `127.0.0.1:55433` (`cluster_name = siscom_demo`), DB `siscom_crm_test_20261101_103435` (đã tách role, 2 pool); backend 3100 (mã như `main`), web 4173 = bản build của nhánh này. **Không** chạm PostgreSQL cổng 5432 / `siscom_crm_dev`.
Tên người dùng Windows được che (`<WINUSER>`); không có mật khẩu trong các file (đã quét).

## Thiết kế đã duyệt
- Dùng bảng `contact` + API có sẵn: `GET /customers/:id/contacts`, `POST /customers/:id/contacts` (`isPrimary: true` tự gỡ cờ người chính cũ).
- Mỗi khách hiển thị **một** người liên hệ (người chính). Không có ô SĐT riêng: khi lưu, `contact.phone` = **SĐT công ty** (thoả ràng buộc `ck_contact_reach`); trang chi tiết hiển thị SĐT công ty.
- Đổi tên = tạo người chính mới (bản cũ gỡ cờ, không xoá — API chưa có sửa/xoá liên hệ). Để trống khi sửa = giữ nguyên.
- Phân quyền: dòng "Người liên hệ" chỉ khi server cấp `contact.read`; ô nhập chỉ khi có `contact.create` (server kiểm thêm `customer.update` + phạm vi OWN/DEPARTMENT/ALL).
- Khách đã lưu mà người liên hệ lỗi: cảnh báo "Đã lưu khách hàng, chưa lưu người liên hệ", không tự thử lại.

| File | Nội dung | Kết quả |
|---|---|---|
| `01_chrome_nguoi_lien_he_4_vai_tro.txt/.json` + `01_contactChrome.mjs` (kịch bản chạy tay) | Chrome thật: crm_admin tạo khách + người liên hệ qua biểu mẫu, chi tiết hiển thị tên + SĐT công ty, sửa tên; sales tạo khách của mình + người liên hệ, không xem/không thêm được cho khách người khác (404); accountant xem được, không sửa (nút khoá), POST 403; technician khách ngoài phạm vi 404, POST 403 | **PASS 18 / FAIL 0** |
| `02_chrome_hoi_quy_4_vai_tro.txt/.json` | Harness có sẵn `sessionRolesChrome.mjs` trên bản build mới (hồi quy đăng nhập, ma trận quyền, khách hàng, CSRF, đổi mật khẩu) | **PASS 91 / FAIL 0 / KNOWN 0** |
| `03_contact_*.png` | Ảnh chụp: chi tiết khách (admin) trước/sau đổi tên, chi tiết (accountant) | — |

Test tự động (chạy trên máy owner):
- Frontend `node --test tests/*.test.mjs`: **488 / 488 PASS** (mới: `customerContactPerson.test.mjs` 15 ca — controller/API; `customerContactPersonUi.test.mjs` 12 ca — React thật + miniDom). `customerContactPerson.test.mjs` được thêm vào danh sách test FE của CI.
- `tests/helpers/miniDom.mjs`: sửa nút chữ để `nodeValue` và `data` là một (React cập nhật chữ qua `nodeValue`; trước đây DOM giả giữ chữ cũ). Toàn bộ test cũ vẫn đạt.
- Backend (không đổi mã): `jest --config test/jest-unit.json customers.contacts.service customers.http` **37 / 37 PASS**.

## Sau QA độc lập (0 Critical / 3 Important / 5 Minor)
Đã sửa (mỗi sửa có test thấy ĐỎ trước, XANH sau):
- **I-1** mở form sửa trước khi người liên hệ tải xong => tên về muộn khởi tạo lại form, mất bản nháp: nút "Sửa thông tin" khoá tới khi người liên hệ tải xong (ready/error) nếu có `contact.read`. Đã kiểm test thấy đỏ khi tắt sửa.
- **I-2** `update` đọc người liên hệ hiện tại SAU PATCH, có thể bỏ tên mới mà vẫn báo thành công: chụp trước PATCH; không biết người liên hệ hiện tại của chính khách này => không POST và trả cảnh báo "chưa được lưu".
- **M-4** SĐT công ty cũ sai định dạng + tên người liên hệ mới => lỗi ngay tại ô, không gửi gì.
- **M-5** chỉ hiển thị người có `isPrimary` (không coi người thường là người liên hệ).
- **M-6** lưu người liên hệ của khách A xong khi đang xem khách B => không ghi đè trạng thái của B.
- **M-8** thêm test: người liên hệ đang tải là của khách khác => không POST.
Ghi nhận, không sửa: **I-3** `customerContactPersonUi.test.mjs` (React + vite) chưa nằm trong CI — giống các test miniDom có sẵn khác (khoảng trống CI cũ); chạy tay: đạt. **M-7** đổi tên nhiều lần để lại bản ghi cũ (đúng thiết kế đã duyệt).
Sau sửa: FE `node --test tests/*.test.mjs` **494 / 494**; `04_chrome_nguoi_lien_he_sau_QA.txt/.json` Chrome thật **18 / 0** (bản build sau sửa). Hồi quy 91 ca (file 02) chạy trên bản trước sửa QA.

## Chỉnh theo ghi chú owner (ảnh khoanh đỏ, 2026-11-01)
Mục "Người liên hệ" chuyển lên ngay sau "Thông tin doanh nghiệp", trước "Địa chỉ & liên hệ"; gợi ý ô đổi thành "dùng số điện thoại công ty (mục Địa chỉ & liên hệ)". Test thứ tự mục (UI) + FE **495 / 495**; Chrome thật: `05_chrome_thu_tu_muc.txt` PASS, ảnh `05_form_thu_tu_muc_nguoi_lien_he.png`.

Chưa kiểm chứng: khách nhập từ dữ liệu cũ có SĐT công ty không hợp lệ (người liên hệ sẽ bị server từ chối, giao diện báo cảnh báo — có test giả lập, chưa có dữ liệu thật); trình duyệt khác Chrome.
Dữ liệu thử để lại trên DB demo: 2 khách `Cty LH Admin …`, `Cty LH Sale …` và 3 người liên hệ.
