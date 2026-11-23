# Báo giá đợt 1 — sổ báo giá theo cơ hội: đặc tả v1 (PR Q1, 24/11/2026)

Trạng thái: **Draft, chờ review và Owner duyệt.** Chưa có mã, chưa có migration. Nối tiếp `docs/SALES_DESIGN.md` (D10, D11, C11, mục 3).
Nhãn nguồn: **[Owner]** = Owner đã chốt; **[Đề xuất]** = tác giả đề xuất, cần duyệt.

## 0. Tóm tắt cho người không chuyên

- Nhân viên kinh doanh **vẫn lập báo giá bằng mẫu Excel hiện có** và để tệp trên Google Drive.
- CRM giữ **sổ báo giá**: mỗi báo giá thuộc một cơ hội, có mã, hạng mục, các phiên bản, giá trị chưa VAT, ngày gửi, hạn hiệu lực, đường dẫn tệp.
- Đã gửi khách thì **không sửa được nữa**; muốn đổi giá thì bấm "Tạo bản mới" (phiên bản 2, 3…).
- Giá trị của cơ hội tự đi theo **báo giá đang theo đuổi**, không cộng dồn các phiên bản.
- Chưa làm trong đợt này: lập báo giá từ danh mục thiết bị, chiết khấu, VAT, duyệt giá, xuất PDF, giá vốn / lợi nhuận.

## 1. Quyết định đã chốt [Owner]

| Mã | Nội dung | Nguồn |
|---|---|---|
| D11 | CRM quản lý mã, khách, cơ hội, phiên bản, giá trị chưa VAT, ngày gửi, hạn hiệu lực, tệp Excel/PDF trên Google Drive; tạo bản mới từ bản cũ, không ghi đè bản đã gửi | SALES_DESIGN 1.1 |
| C11 | Báo giá đợt 1 là gói riêng ngay sau Sales | SALES_DESIGN 1.2 |
| — | Trạng thái: Nháp / Đã gửi / Được chấp nhận / Bị từ chối / Hết hiệu lực; giá trị cơ hội theo báo giá đang theo đuổi | SALES_DESIGN mục 3 |
| D3, D7 | Không đánh dấu Thắng chỉ vì đã gửi báo giá; giá trị là VNĐ, chưa VAT, sau chiết khấu; không cộng dồn các phiên bản | SALES_DESIGN 1.1 |
| QB1 | **Kinh doanh tự gửi giá cho khách, không cần ai duyệt trong CRM** (mỗi người đã có khung giá) | Owner, 24/11/2026 |
| QB2 | Tên tệp theo mẫu `YYYYMMDD_MaBG_TenKhachHang_HangMuc` (`.pdf` hoặc tệp Excel) | Owner, 24/11/2026 |

## 2. Việc còn mở (cần Owner xác nhận khi duyệt đặc tả)

| Mã | Câu hỏi | Đề xuất |
|---|---|---|
| QO1 | `MaBG` trong tên tệp có dạng nào | CRM tự sinh `BG-0001`, đánh số liên tục (cùng cách `CH-0001`, `NV-0001`). Tên tệp gợi ý: `20261124_BG-0012_CongTyABC_DieuHoaTrungTam.pdf`; từ phiên bản 2 thêm `_v2` trước phần mở rộng |
| QO2 | Tên khách và hạng mục trong tên tệp | Bỏ dấu tiếng Việt, bỏ khoảng trắng và ký tự đặc biệt, viết hoa chữ đầu mỗi từ; cắt còn tối đa 40 ký tự mỗi phần |
| QO3 | Báo giá đã quá hạn hiệu lực có được ghi "Được chấp nhận" không | Được, kèm cảnh báo (khách có thể đồng ý muộn); muốn chặt hơn thì bắt tạo bản mới |

## 3. Phạm vi

**Làm:** sổ báo giá theo cơ hội; phiên bản; năm trạng thái; đường dẫn Drive; tên tệp gợi ý; tạo bản mới từ bản cũ; chọn báo giá đang theo đuổi và đồng bộ giá trị cơ hội; trang danh sách báo giá; tab Báo giá trong chi tiết cơ hội; nhắc sắp hết hạn trên danh sách.
**Không làm (để sau):** dòng hàng / danh mục thiết bị, chiết khấu, VAT, duyệt giá, xuất PDF, giá vốn và lợi nhuận, gửi email cho khách, kho tệp trong CRM, xuất dữ liệu báo giá, Hợp đồng.

## 4. Mô hình dữ liệu [Đề xuất] — một migration cộng thêm, không đổi / xoá cột cũ

```
quote                                   (một dòng = một báo giá trong sổ)
  id, code BG-0001 (hàm fn_next_quote_code, cùng cách với cơ hội)
  opportunity_id → opportunity (bắt buộc)
  customer_id → customer (bắt buộc; phải trùng khách của cơ hội — khoá ngoại kép)
  item_name varchar(120) (hạng mục, bắt buộc; dùng trong tên tệp)
  is_primary boolean NOT NULL DEFAULT false   ("đang theo đuổi"; mỗi cơ hội tối đa MỘT — unique riêng phần)
  created_by → employee, created_at, updated_at, version int (khoá lạc quan)
  deleted_at, deleted_by, delete_reason       (xoá mềm; chỉ khi chưa có phiên bản nào đã gửi)

quote_version                           (một dòng = một phiên bản)
  id, quote_id → quote, version_no smallint ≥ 1 (unique theo quote)
  status: DRAFT | SENT | ACCEPTED | REJECTED
  amount_vnd bigint NULL (≥ 0; chưa VAT, sau chiết khấu)
  valid_until date NULL          sent_on date NULL
  file_url varchar(1000) NULL (chỉ https, cùng quy tắc ck_od_url)   file_name varchar(255) NULL
  note text NULL                 reject_reason varchar(500) NULL (bắt buộc khi REJECTED)
  created_by, created_at, sent_by, sent_at, decided_by, decided_at
```

Ràng buộc ở DB (không chỉ ở ứng dụng):
- R-Q1: `status ≠ DRAFT` ⇒ `amount_vnd`, `valid_until`, `sent_on`, `file_url`, `file_name` đều có giá trị (CHECK).
- R-Q2: **bất biến sau khi gửi** — trigger chặn UPDATE mọi cột nội dung của dòng có `status ≠ DRAFT`; chỉ cho đổi `status` theo R-Q3 cùng các cột `decided_*`, `reject_reason`. Không DELETE.
- R-Q3: chuyển trạng thái hợp lệ: `DRAFT → SENT`; `SENT → ACCEPTED | REJECTED`. Không đi lùi.
- R-Q4: mỗi báo giá tối đa một phiên bản `DRAFT` và tối đa một phiên bản `ACCEPTED` (unique riêng phần).
- R-Q5: `is_primary` chỉ đặt được khi báo giá có ít nhất một phiên bản đã gửi.

**"Hết hiệu lực" không lưu trong DB**: là trạng thái hiển thị của phiên bản `SENT` có `valid_until` < hôm nay (giờ Việt Nam). Không cần tác vụ chạy nền; danh sách và bộ lọc tính cùng một biểu thức ở máy chủ.

## 5. Quyền [Đề xuất]

Báo giá **đi theo cơ hội**: ai không thấy cơ hội thì không thấy báo giá của nó (ngoài phạm vi trả 404).

| Mã | Quản trị CRM | Kinh doanh | Kỹ thuật | Kế toán |
|---|---|---|---|---|
| `quote.read` | tất cả | báo giá của cơ hội mình **thấy được** theo SALES 5.1 | — | tất cả |
| `quote.create` / `quote.update` | tất cả | chỉ cơ hội mình **phụ trách** | — | — |
| `quote.send` (đánh dấu Đã gửi, chọn "đang theo đuổi") | tất cả | chỉ cơ hội mình phụ trách | — | — |
| `quote.decide` (Được chấp nhận / Bị từ chối) | tất cả | chỉ cơ hội mình phụ trách | — | — |
| `quote.delete` (xoá nháp / báo giá chưa gửi) | tất cả | chỉ cơ hội mình phụ trách | — | — |

- Kỹ thuật (đường theo việc) **không thấy báo giá** — giữ C7 "Kỹ thuật không thấy giá trị".
- Quản trị hệ thống không có mã nào: `fn_auth_perm_class` xếp thêm tiền tố `quote.` vào nhóm BIZ (cùng cách S5 của Sales).
- Mỗi mã cấp riêng, service kiểm đúng mã của thao tác; dùng lại vị từ phạm vi cơ hội hiện có, không viết đường đọc thứ hai.
- Cấp quyền trên DB đã bootstrap: script hai người + script gỡ + diễn tập CI (mẫu `SALES_S5_OPPORTUNITY_PERMISSIONS`); grants cho `siscom_app`: INSERT/UPDATE `quote`, `quote_version`, không DELETE.

## 6. Quy tắc nghiệp vụ [Đề xuất]

1. **Tạo báo giá** từ một cơ hội đang mở (`OPEN`): nhập hạng mục ⇒ sinh mã `BG-…` và phiên bản 1 ở trạng thái Nháp. Cơ hội Tạm hoãn / Thắng / Thua: không tạo mới, vẫn xem được.
2. **Sửa nháp**: giá trị, hạn hiệu lực, đường dẫn tệp, tên tệp, ghi chú. Hệ thống hiện **tên tệp gợi ý** theo QB2 kèm nút chép.
3. **Đánh dấu Đã gửi** [QB1 — không qua bước duyệt]: bắt buộc giá trị, hạn hiệu lực (không trước ngày gửi), ngày gửi (mặc định hôm nay, không ở tương lai), đường dẫn tệp. Sau bước này phiên bản bị khoá.
4. **Tạo bản mới**: chép nội dung phiên bản mới nhất thành phiên bản kế tiếp ở trạng thái Nháp. Chỉ khi chưa có nháp nào và báo giá chưa được chấp nhận.
5. **Kết quả**: "Được chấp nhận" hoặc "Bị từ chối" (bắt buộc lý do) cho phiên bản đã gửi. Được chấp nhận **không** tự chốt Thắng cơ hội (D3): giao diện hiện lối tắt "Chốt Thắng cơ hội".
6. **Báo giá đang theo đuổi**: báo giá đầu tiên được gửi của một cơ hội tự thành "đang theo đuổi"; người phụ trách đổi sang báo giá khác được.
7. **Đồng bộ giá trị cơ hội** (D7): khi phiên bản của báo giá đang theo đuổi được gửi, hoặc khi đổi báo giá đang theo đuổi ⇒ `opportunity.expected_amount_vnd` = giá trị phiên bản đã gửi mới nhất của báo giá đó, **trong cùng một transaction**, đi qua đường ghi hiện có của cơ hội để có dòng lịch sử. Sửa tay giá trị cơ hội vẫn được; lần gửi kế tiếp ghi đè và để lại lịch sử. Cơ hội không ở `OPEN` thì không đồng bộ.
8. **Xoá**: chỉ xoá mềm nháp, hoặc cả báo giá khi chưa có phiên bản nào đã gửi. Bản đã gửi không xoá được.
9. Hai người thao tác cùng lúc: khoá lạc quan bằng `version`, xung đột trả 409 như cơ hội.

## 7. API [Đề xuất] (`/api/v1`, cookie + Origin + CSRF như hiện nay, bọc `{ data }`)

`GET /quotes` (lọc trạng thái gồm "hết hiệu lực" và "sắp hết hạn ≤ 7 ngày", người phụ trách cơ hội, khách, tìm theo mã / hạng mục / tên khách không phân biệt dấu; phân trang) · `GET /opportunities/:id/quotes` · `GET /quotes/:id` (kèm mọi phiên bản và `suggestedFileName`) · `POST /opportunities/:id/quotes` · `PATCH /quotes/:id` (hạng mục; có `version`) · `PATCH /quotes/:id/versions/:no` (chỉ nháp) · `POST /quotes/:id/versions` (tạo bản mới) · `POST /quotes/:id/versions/:no/send` · `POST /quotes/:id/versions/:no/accept` · `POST /quotes/:id/versions/:no/reject` · `POST /quotes/:id/primary` · `DELETE /quotes/:id/versions/:no` (nháp) · `DELETE /quotes/:id` (chưa gửi).

Mã lỗi theo khuôn hiện có: 400 dữ liệu sai, 403 thấy được nhưng không có quyền ghi, 404 ngoài phạm vi xem, 409 `VERSION_CONFLICT` / `QUOTE_VERSION_LOCKED` / `QUOTE_DRAFT_EXISTS`, 422 `OPPORTUNITY_NOT_OPEN`.

## 8. Màn hình

- **Tab "Báo giá" trong chi tiết cơ hội**: mỗi báo giá một khối — mã, hạng mục, nhãn "Đang theo đuổi", bảng phiên bản (số, trạng thái, giá trị, ngày gửi, hạn hiệu lực, tệp). Nút: Thêm báo giá, Sửa nháp, Đánh dấu đã gửi, Tạo bản mới, Kết quả, Chọn đang theo đuổi.
- **Trang "Báo giá"** (mục đã có trên thanh bên): danh sách mọi báo giá mình thấy được; lọc trạng thái, người phụ trách, khách; tìm kiếm; cột hạn hiệu lực có nhãn "Còn n ngày" / "Hết hiệu lực". Bấm dòng mở cơ hội ở tab Báo giá.
- **Hộp thoại**: tạo / sửa nháp (có tên tệp gợi ý và nút chép), đánh dấu đã gửi (tóm tắt + cảnh báo "sau khi gửi không sửa được"), kết quả (lý do bắt buộc khi từ chối).
- Điện thoại: danh sách dạng thẻ; hộp thoại vừa khung 375 px. Dùng thành phần giao diện hiện có, ô nhập tiền dùng lại `AmountInput`.
- Vai trò không có `quote.read`: không có mục "Báo giá", không có tab.

## 9. Kế hoạch PR nhỏ (Draft; ChatGPT review; Owner duyệt merge từng PR)

| PR | Nội dung | Đụng DB? |
|---|---|---|
| **Q1** | **Tài liệu này** | không |
| Q2 | Migration cộng thêm: 2 bảng, hàm mã, CHECK, trigger bất biến, `fn_auth_perm_class` thêm `quote.`; rollback + bài kiểm cấu trúc + diễn tập CI | chỉ PostgreSQL tạm của CI |
| Q3 | Grants cho `siscom_app` + VERIFY; mã quyền `quote.*` + script hai người / gỡ / kiểm; ma trận `bootstrap.ts` khớp | chỉ CI |
| Q4 | Backend đọc: danh sách, theo cơ hội, chi tiết, tên tệp gợi ý; ma trận quyền | không |
| Q5 | Backend ghi: tạo, sửa nháp, gửi, bản mới, kết quả, đang theo đuổi + đồng bộ giá trị cơ hội, xoá | không |
| Q6 | Giao diện: tab Báo giá trong cơ hội + các hộp thoại | không |
| Q7 | Giao diện: trang Báo giá, điện thoại | không |
| Q8 | Lên máy chủ: sao lưu → `deploy.sh --migrate` → grants → cấp quyền hai người → nghiệm thu mục 10 | **Owner duyệt riêng từng bước** |

Đường lùi: ưu tiên lùi mã ứng dụng, giữ cấu trúc cộng thêm (mã cũ không dùng tới hai bảng mới). Gỡ cấu trúc chỉ khi hai bảng còn rỗng và được duyệt riêng.

## 10. Tiêu chí nghiệm thu

1. Kinh doanh tạo báo giá cho cơ hội mình phụ trách; không tạo được cho cơ hội chỉ xem; Kỹ thuật và Quản trị hệ thống không thấy báo giá ở mọi đường đọc (danh sách, chi tiết, theo cơ hội, tìm kiếm).
2. Phiên bản đã gửi: API sửa bị từ chối **và** UPDATE trực tiếp ở DB bằng `siscom_app` cũng bị từ chối.
3. Tạo bản mới giữ nguyên bản cũ; mỗi báo giá không có hai nháp cùng lúc.
4. Gửi phiên bản của báo giá đang theo đuổi ⇒ giá trị cơ hội đổi theo và có dòng lịch sử; đổi báo giá đang theo đuổi ⇒ giá trị đổi theo; không bao giờ cộng dồn.
5. "Hết hiệu lực" hiện đúng theo ngày Việt Nam, kể cả lúc nửa đêm; bộ lọc và nhãn dùng cùng kết quả.
6. Được chấp nhận không tự đổi trạng thái cơ hội.
7. Tên tệp gợi ý đúng mẫu QB2 với tên có dấu, ký tự đặc biệt và tên rất dài.
8. Hai người sửa cùng lúc: người sau nhận 409, không mất dữ liệu của người trước.
9. Lùi mã về bản trước khi có Báo giá: ứng dụng chạy bình thường với DB đã có hai bảng mới.

## 11. Rủi ro

| Rủi ro | Xử lý |
|---|---|
| Đường dẫn Drive hỏng hoặc người xem không có quyền mở tệp | CRM chỉ giữ đường dẫn; quyền tệp do Drive quản lý. Ghi rõ trong hướng dẫn sử dụng |
| Giá trị cơ hội bị ghi đè ngoài ý muốn | Chỉ ghi đè khi gửi / đổi báo giá đang theo đuổi; luôn có lịch sử; có nhãn "theo báo giá BG-…" cạnh giá trị |
| Lộ giá cho vai trò không được xem | Một vị từ phạm vi duy nhất dùng lại của cơ hội; ma trận kiểm thử cho mọi đường đọc |
| Nhân viên quên cập nhật kết quả | Nhãn "Hết hiệu lực" và bộ lọc "sắp hết hạn" trên danh sách; nhắc việc tự động để đợt sau |
