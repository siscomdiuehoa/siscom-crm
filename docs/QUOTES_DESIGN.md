# Báo giá đợt 1 — lập báo giá ngay trên CRM: đặc tả v2 (PR Q1, 24/11/2026)

Trạng thái: **Draft, chờ review và Owner duyệt.** Chưa có mã, chưa có migration. Nối tiếp `docs/SALES_DESIGN.md` (D10, D11, C11).
Nhãn nguồn: **[Owner]** = Owner đã chốt; **[Đề xuất]** = tác giả đề xuất, cần duyệt.
**Khác v1:** v1 chỉ là sổ báo giá (tệp Excel trên Drive, theo D11). Owner đổi hướng ngày 24/11/2026: **lập báo giá trực tiếp trên CRM** và gửi một tệp báo giá mẫu của công ty. Tài liệu này bám bố cục mẫu đó; không chép dữ liệu thật của mẫu vào kho mã.

## 0. Tóm tắt cho người không chuyên

- Nhân viên kinh doanh **lập báo giá ngay trong CRM**: nhập từng dòng hàng, CRM tự tính thành tiền, chiết khấu, VAT và tổng.
- Bấm "Xem bản in" ra trang A4 **đúng bố cục mẫu báo giá của công ty**; lưu thành PDF bằng chức năng in của trình duyệt, tên tệp tự điền theo mẫu Owner yêu cầu.
- Đã gửi khách thì **khoá, không sửa được**; đổi giá thì bấm "Tạo bản mới" (phiên bản 2, 3…). Bản đã gửi in lại lúc nào cũng ra đúng nội dung lúc gửi.
- Giá trị của cơ hội tự đi theo **báo giá đang theo đuổi**, không cộng dồn các phiên bản.
- Chưa làm đợt này: danh mục thiết bị / vật tư để chọn nhanh, giá vốn và lợi nhuận, duyệt giá, gửi email cho khách từ CRM.

## 1. Quyết định đã chốt [Owner]

| Mã | Nội dung | Nguồn |
|---|---|---|
| D3, D7 | Không đánh dấu Thắng chỉ vì đã gửi báo giá; giá trị cơ hội là VNĐ, chưa VAT, sau chiết khấu; không cộng dồn các phiên bản | SALES_DESIGN 1.1 |
| — | Trạng thái: Nháp / Đã gửi / Được chấp nhận / Bị từ chối / Hết hiệu lực; tạo bản mới từ bản cũ, không sửa bản đã gửi; giá trị cơ hội theo báo giá đang theo đuổi | SALES_DESIGN mục 3 |
| QB1 | **Kinh doanh tự gửi giá cho khách, không cần ai duyệt trong CRM** (mỗi người đã có khung giá) | Owner, 24/11/2026 |
| QB2 | Tên tệp theo mẫu `YYYYMMDD_MaBG_TenKhachHang_HangMuc` (`.pdf` hoặc tệp Excel) | Owner, 24/11/2026 |
| QB3 | **Báo giá được lập ngay trên CRM** (thay phần "giữ mẫu Excel" của D11); bố cục theo tệp mẫu Owner cung cấp | Owner, 24/11/2026 |

## 2. Việc còn mở (cần Owner xác nhận khi duyệt đặc tả)

| Mã | Câu hỏi | Đề xuất |
|---|---|---|
| QO1 | Dạng `MaBG` | CRM tự sinh `BG-0001`, đánh số liên tục (cùng cách `CH-0001`, `NV-0001`). Tên tệp: `20261124_BG-0012_CongTyABC_GasLanhDaikin.pdf`; từ phiên bản 2 thêm `_v2` |
| QO2 | Tên khách và hạng mục trong tên tệp | Bỏ dấu, bỏ khoảng trắng và ký tự đặc biệt, viết hoa chữ đầu mỗi từ; tối đa 40 ký tự mỗi phần |
| QO3 | Báo giá quá hạn hiệu lực có được ghi "Được chấp nhận" không | Được, kèm cảnh báo |
| QO4 | Thuế suất VAT | Chọn theo từng báo giá: 0 / 5 / 8 / 10 %, mặc định 10 % (mẫu đang dùng 10 %) |
| QO5 | Làm tròn | Đơn giá nhập **nguyên đồng**, là giá trước VAT. Thành tiền = SL × đơn giá, làm tròn tới đồng; VAT làm tròn tới đồng. (Mẫu Excel có dòng lẻ thập phân do chia 1,1 — CRM không giữ số lẻ) |
| QO6 | Chiết khấu | Một ô "Chiết khấu" bằng tiền cho cả báo giá, tuỳ chọn; có thì hiện một dòng riêng trước dòng "Tổng trước VAT". Chiết khấu theo từng dòng: để sau |
| QO7 | Xuất PDF | Trang "Xem bản in" A4; người dùng bấm In → "Lưu thành PDF" của trình duyệt. **Không thêm thư viện mới** vào hệ thống. Muốn nút tải PDF một chạm thì cần thêm thư viện, duyệt riêng |
| QO8 | Điều khoản và thông tin thanh toán in trên báo giá | Quản trị CRM soạn sẵn **mẫu mặc định** (ghi chú điều khoản, thông tin tài khoản, số ngày hiệu lực mặc định) trong phần cài đặt; mỗi báo giá sửa lại được phần ghi chú trước khi gửi |
| QO9 | Cột giá vốn (trong mẫu nằm ngoài vùng in) | Không lưu ở đợt này (D11: giá vốn / lợi nhuận phân quyền riêng, làm sau) |

## 3. Phạm vi

**Làm:** lập báo giá theo cơ hội với dòng hàng, chiết khấu, VAT, tổng; phiên bản và năm trạng thái; bản in A4 theo mẫu công ty + tên tệp gợi ý; mẫu mặc định cho điều khoản và thông tin thanh toán; chọn báo giá đang theo đuổi và đồng bộ giá trị cơ hội; trang danh sách báo giá; tab Báo giá trong chi tiết cơ hội; nhãn sắp hết hạn.
**Không làm (để sau):** danh mục thiết bị / vật tư và bảng giá; giá vốn, lợi nhuận; duyệt giá; chiết khấu theo dòng; nhóm / mục con trong bảng hàng; gửi email cho khách; nhập từ Excel; xuất dữ liệu báo giá; Hợp đồng.

## 4. Bố cục bản in (theo mẫu của công ty)

```
[Logo công ty]
Khách hàng / Client: …            Báo giá bởi / Quotation by: …
Dự án / Project: …                Chức vụ / Position: …
Điện thoại / Mobile: …            Điện thoại / Mobile: …
Email: …                          Email: …
Công ty / Company: …              Ngày báo giá / Date: …
Địa chỉ / Address: …              Mã báo giá / Seri no.: BG-0012 (v2)

            QUOTATION / BẢNG BÁO GIÁ <HẠNG MỤC>
<câu chào mặc định>
TT | Nội dung công việc | ĐVT | SL | Đơn giá | Thành tiền | Ghi chú
 …
                          Chiết khấu (nếu có)        …
                          Tổng giá trị trước VAT     …
                          VAT n %                    …
                          Tổng giá trị sau VAT       …
Ghi chú: <các dòng điều khoản>            Hiệu lực đến: dd/mm/yyyy
Thông tin tài khoản: <theo mẫu mặc định>
XÁC NHẬN ĐẶT HÀNG                         XÁC NHẬN CÔNG TY
```

Khối bên trái lấy từ khách hàng, người liên hệ và cơ hội; khối bên phải lấy từ nhân viên lập báo giá. Người lập sửa được các ô này trên bản nháp.

## 5. Mô hình dữ liệu [Đề xuất] — một migration cộng thêm, không đổi / xoá cột cũ

```
quote                                   (một báo giá)
  id, code BG-0001 (hàm fn_next_quote_code)
  opportunity_id → opportunity (bắt buộc)
  customer_id → customer (bắt buộc; phải trùng khách của cơ hội — khoá ngoại kép)
  item_name varchar(120) (hạng mục; là phần sau chữ "BẢNG BÁO GIÁ" và nằm trong tên tệp)
  is_primary boolean NOT NULL DEFAULT false   ("đang theo đuổi"; mỗi cơ hội tối đa MỘT — unique riêng phần)
  created_by, created_at, updated_at, version int (khoá lạc quan)
  deleted_at, deleted_by, delete_reason       (xoá mềm; chỉ khi chưa có phiên bản nào đã gửi)

quote_version                           (một phiên bản)
  id, quote_id → quote, version_no smallint ≥ 1 (unique theo quote)
  status: DRAFT | SENT | ACCEPTED | REJECTED
  quote_date date, valid_until date
  header jsonb   (khối khách + khối người báo giá như mục 4; khoá kiểu / độ dài từng ô ở ứng dụng và CHECK kích thước)
  intro varchar(300), terms text (ghi chú điều khoản), payment_info text
  discount_vnd bigint NOT NULL DEFAULT 0 (≥ 0), vat_percent smallint (0|5|8|10)
  subtotal_vnd, amount_vnd (= subtotal − discount, chưa VAT), vat_vnd, total_vnd   bigint — máy chủ tính, CHECK khớp công thức
  note text NULL (ghi chú nội bộ, không in)     reject_reason varchar(500) NULL (bắt buộc khi REJECTED)
  file_url varchar(1000) NULL (tuỳ chọn: đường dẫn bản PDF đã lưu trên Drive; chỉ https)
  created_by, created_at, sent_by, sent_at, decided_by, decided_at

quote_line                              (một dòng hàng)
  id, quote_version_id → quote_version, line_no smallint (unique theo phiên bản)
  description varchar(500), unit varchar(30), quantity numeric(14,3) > 0
  unit_price_vnd bigint ≥ 0, amount_vnd bigint (= round(quantity × unit_price_vnd)), note varchar(200) NULL

quote_setting                           (MỘT dòng; mẫu mặc định do Quản trị CRM soạn)
  intro, terms, payment_info, default_valid_days smallint, updated_by, updated_at
```

Ràng buộc ở DB (không chỉ ở ứng dụng):
- R-Q1: `status ≠ DRAFT` ⇒ có ít nhất một dòng hàng, có `quote_date`, `valid_until ≥ quote_date`, các tổng khác NULL.
- R-Q2: **bất biến sau khi gửi** — trigger chặn UPDATE mọi cột nội dung của `quote_version` có `status ≠ DRAFT` và chặn INSERT / UPDATE / DELETE `quote_line` của phiên bản đó. Chỉ cho đổi `status` theo R-Q3, các cột `decided_*`, `reject_reason`, `file_url`.
- R-Q3: chuyển trạng thái hợp lệ: `DRAFT → SENT`; `SENT → ACCEPTED | REJECTED`. Không đi lùi.
- R-Q4: mỗi báo giá tối đa một phiên bản `DRAFT` và tối đa một phiên bản `ACCEPTED`.
- R-Q5: `is_primary` chỉ đặt được khi báo giá có ít nhất một phiên bản đã gửi.
- R-Q6: các tổng do **máy chủ** tính lại từ dòng hàng ở mọi lần ghi; không nhận tổng từ trình duyệt.

**"Hết hiệu lực" không lưu trong DB**: là trạng thái hiển thị của phiên bản `SENT` có `valid_until` < hôm nay (giờ Việt Nam). Danh sách và bộ lọc tính cùng một biểu thức ở máy chủ.

## 6. Quyền [Đề xuất]

Báo giá **đi theo cơ hội**: ai không thấy cơ hội thì không thấy báo giá của nó (ngoài phạm vi trả 404).

| Mã | Quản trị CRM | Kinh doanh | Kỹ thuật | Kế toán |
|---|---|---|---|---|
| `quote.read` | tất cả | báo giá của cơ hội mình **thấy được** theo SALES 5.1 | — | tất cả |
| `quote.create` / `quote.update` | tất cả | chỉ cơ hội mình **phụ trách** | — | — |
| `quote.send` (đánh dấu Đã gửi, chọn "đang theo đuổi") | tất cả | chỉ cơ hội mình phụ trách | — | — |
| `quote.decide` (Được chấp nhận / Bị từ chối) | tất cả | chỉ cơ hội mình phụ trách | — | — |
| `quote.delete` (xoá nháp / báo giá chưa gửi) | tất cả | chỉ cơ hội mình phụ trách | — | — |
| `quote.settings` (sửa mẫu mặc định) | có | — | — | — |

- Kỹ thuật (đường theo việc) **không thấy báo giá** — giữ C7 "Kỹ thuật không thấy giá trị".
- Quản trị hệ thống không có mã nào: `fn_auth_perm_class` xếp thêm tiền tố `quote.` vào nhóm BIZ (cùng cách S5 của Sales).
- Mỗi mã cấp riêng, service kiểm đúng mã của thao tác; dùng lại vị từ phạm vi cơ hội hiện có, không viết đường đọc thứ hai.
- Cấp quyền trên DB đã bootstrap: script hai người + script gỡ + diễn tập CI (mẫu `SALES_S5_OPPORTUNITY_PERMISSIONS`); grants cho `siscom_app`: INSERT / UPDATE `quote`, `quote_version`; INSERT / UPDATE / DELETE `quote_line` (chỉ có hiệu lực với nháp do R-Q2); UPDATE `quote_setting`.

## 7. Quy tắc nghiệp vụ [Đề xuất]

1. **Tạo báo giá** từ một cơ hội đang mở (`OPEN`): nhập hạng mục ⇒ sinh mã `BG-…` và phiên bản 1 ở trạng thái Nháp. Khối khách, khối người báo giá, câu chào, điều khoản, thông tin thanh toán, hạn hiệu lực được **điền sẵn** từ khách hàng / người liên hệ / cơ hội / nhân viên / mẫu mặc định. Cơ hội Tạm hoãn / Thắng / Thua: không tạo mới, vẫn xem và in được.
2. **Soạn nháp**: thêm, sửa, xoá, đổi thứ tự dòng hàng; nhập chiết khấu, chọn VAT; sửa các ô đầu trang và ghi chú. Tổng cập nhật ngay trên màn hình và được máy chủ tính lại khi lưu.
3. **Xem bản in**: dùng được cho mọi phiên bản; bản nháp có chữ "BẢN NHÁP" chìm trên trang.
4. **Đánh dấu Đã gửi** [QB1 — không qua bước duyệt]: bắt buộc có dòng hàng, ngày báo giá (không ở tương lai), hạn hiệu lực. Sau bước này phiên bản bị khoá.
5. **Tạo bản mới**: chép toàn bộ nội dung phiên bản mới nhất (kể cả dòng hàng) thành phiên bản kế tiếp ở trạng thái Nháp. Chỉ khi chưa có nháp nào và báo giá chưa được chấp nhận.
6. **Kết quả**: "Được chấp nhận" hoặc "Bị từ chối" (bắt buộc lý do) cho phiên bản đã gửi. Được chấp nhận **không** tự chốt Thắng cơ hội (D3): giao diện hiện lối tắt "Chốt Thắng cơ hội".
7. **Báo giá đang theo đuổi**: báo giá đầu tiên được gửi của một cơ hội tự thành "đang theo đuổi"; người phụ trách đổi sang báo giá khác được.
8. **Đồng bộ giá trị cơ hội** (D7): khi phiên bản của báo giá đang theo đuổi được gửi, hoặc khi đổi báo giá đang theo đuổi ⇒ `opportunity.expected_amount_vnd` = `amount_vnd` (chưa VAT, sau chiết khấu) của phiên bản đã gửi mới nhất, **trong cùng một transaction**, đi qua đường ghi hiện có của cơ hội để có dòng lịch sử. Sửa tay giá trị cơ hội vẫn được; lần gửi kế tiếp ghi đè và để lại lịch sử. Cơ hội không ở `OPEN` thì không đồng bộ.
9. **Xoá**: chỉ xoá mềm nháp, hoặc cả báo giá khi chưa có phiên bản nào đã gửi.
10. Hai người thao tác cùng lúc: khoá lạc quan bằng `version`, xung đột trả 409 như cơ hội.
11. Giới hạn: tối đa 200 dòng hàng mỗi phiên bản; số tiền mỗi ô trong phạm vi an toàn của số nguyên JavaScript (kiểm ở máy chủ).

## 8. API [Đề xuất] (`/api/v1`, cookie + Origin + CSRF như hiện nay, bọc `{ data }`)

`GET /quotes` (lọc trạng thái gồm "hết hiệu lực" và "sắp hết hạn ≤ 7 ngày", người phụ trách cơ hội, khách; tìm theo mã / hạng mục / tên khách không phân biệt dấu; phân trang) · `GET /opportunities/:id/quotes` · `GET /quotes/:id` (mọi phiên bản, dòng hàng, `suggestedFileName`) · `GET /opportunities/:id/quotes/defaults` (giá trị điền sẵn) · `POST /opportunities/:id/quotes` · `PATCH /quotes/:id` (hạng mục; có `version`) · `PUT /quotes/:id/versions/:no` (lưu cả nháp gồm dòng hàng, một transaction) · `POST /quotes/:id/versions` (tạo bản mới) · `POST /quotes/:id/versions/:no/send` · `…/accept` · `…/reject` · `PATCH /quotes/:id/versions/:no/file` (gắn đường dẫn PDF) · `POST /quotes/:id/primary` · `DELETE /quotes/:id/versions/:no` (nháp) · `DELETE /quotes/:id` (chưa gửi) · `GET /quotes/settings` · `PUT /quotes/settings`.

Mã lỗi theo khuôn hiện có: 400 dữ liệu sai, 403 thấy được nhưng không có quyền ghi, 404 ngoài phạm vi xem, 409 `VERSION_CONFLICT` / `QUOTE_VERSION_LOCKED` / `QUOTE_DRAFT_EXISTS`, 422 `OPPORTUNITY_NOT_OPEN`.

## 9. Màn hình

- **Tab "Báo giá" trong chi tiết cơ hội**: mỗi báo giá một khối — mã, hạng mục, nhãn "Đang theo đuổi", bảng phiên bản (số, trạng thái, tổng trước VAT, ngày báo giá, hạn hiệu lực). Nút: Thêm báo giá, Soạn, Xem bản in, Đánh dấu đã gửi, Tạo bản mới, Kết quả, Chọn đang theo đuổi.
- **Màn hình soạn báo giá**: hai khối đầu trang; bảng dòng hàng nhập trực tiếp (Enter xuống dòng mới, nút thêm / xoá / kéo đổi thứ tự); ô chiết khấu, chọn VAT; ba dòng tổng cập nhật ngay; ghi chú điều khoản. Trên điện thoại mỗi dòng hàng là một thẻ.
- **Bản in** (mục 4): trang riêng, CSS khổ A4 dọc, logo công ty, không có thanh điều hướng; tiêu đề trang = tên tệp gợi ý để hộp "Lưu thành PDF" tự điền tên (QB2).
- **Trang "Báo giá"** (mục đã có trên thanh bên): danh sách mọi báo giá mình thấy được; lọc trạng thái, người phụ trách, khách; tìm kiếm; cột hạn hiệu lực có nhãn "Còn n ngày" / "Hết hiệu lực".
- **Cài đặt mẫu báo giá** (chỉ Quản trị CRM): câu chào, điều khoản, thông tin thanh toán, số ngày hiệu lực mặc định.
- Vai trò không có `quote.read`: không có mục "Báo giá", không có tab. Dùng thành phần giao diện hiện có; ô tiền dùng lại `AmountInput`.

## 10. Kế hoạch PR nhỏ (Draft; ChatGPT review; Owner duyệt merge từng PR)

| PR | Nội dung | Đụng DB? |
|---|---|---|
| **Q1** | **Tài liệu này** | không |
| Q2 | Migration cộng thêm: 4 bảng, hàm mã, CHECK, trigger bất biến, `fn_auth_perm_class` thêm `quote.`; rollback + bài kiểm cấu trúc + diễn tập CI | chỉ PostgreSQL tạm của CI |
| Q3 | Grants cho `siscom_app` + VERIFY; mã quyền `quote.*` + script hai người / gỡ / kiểm; ma trận `bootstrap.ts` khớp | chỉ CI |
| Q4 | Backend đọc: danh sách, theo cơ hội, chi tiết, giá trị điền sẵn, tên tệp gợi ý, cài đặt; ma trận quyền | không |
| Q5 | Backend ghi: tạo, lưu nháp (tính tổng ở máy chủ), gửi, bản mới, kết quả, đang theo đuổi + đồng bộ giá trị cơ hội, xoá, sửa cài đặt | không |
| Q6 | Giao diện: tab Báo giá trong cơ hội + màn hình soạn báo giá | không |
| Q7 | Giao diện: bản in A4 theo mẫu + tên tệp; trang Báo giá; cài đặt mẫu; điện thoại | không |
| Q8 | Lên máy chủ: sao lưu → `deploy.sh --migrate` → grants → cấp quyền hai người → nghiệm thu mục 11 | **Owner duyệt riêng từng bước** |

Đường lùi: ưu tiên lùi mã ứng dụng, giữ cấu trúc cộng thêm (mã cũ không dùng tới các bảng mới). Gỡ cấu trúc chỉ khi các bảng còn rỗng và được duyệt riêng.

## 11. Tiêu chí nghiệm thu

1. Kinh doanh lập báo giá cho cơ hội mình phụ trách; không lập được cho cơ hội chỉ xem; Kỹ thuật và Quản trị hệ thống không thấy báo giá ở mọi đường đọc.
2. Tổng trước VAT, chiết khấu, VAT, tổng sau VAT đúng với phép tính tay trên bộ số mẫu (kể cả số lượng lẻ, VAT 0 / 5 / 8 / 10 %, chiết khấu lớn hơn tổng bị từ chối); máy chủ bỏ qua tổng do trình duyệt gửi lên.
3. Phiên bản đã gửi: API sửa bị từ chối **và** UPDATE / INSERT / DELETE trực tiếp ở DB bằng `siscom_app` (phiên bản và dòng hàng) cũng bị từ chối.
4. Tạo bản mới chép đủ dòng hàng, giữ nguyên bản cũ; mỗi báo giá không có hai nháp cùng lúc.
5. Gửi phiên bản của báo giá đang theo đuổi ⇒ giá trị cơ hội = giá trị chưa VAT sau chiết khấu, có dòng lịch sử; đổi báo giá đang theo đuổi ⇒ giá trị đổi theo; không bao giờ cộng dồn.
6. Bản in A4: một báo giá 4 dòng vừa một trang; 60 dòng tự sang trang, tiêu đề cột lặp lại, khối ký không bị cắt đôi; nền sáng bất kể giao diện đang ở chế độ tối; tên tệp gợi ý đúng QB2 với tên có dấu, ký tự đặc biệt và tên rất dài.
7. In lại một phiên bản đã gửi sau khi đã sửa khách hàng / nhân viên / mẫu mặc định: nội dung **không đổi**.
8. "Hết hiệu lực" hiện đúng theo ngày Việt Nam; bộ lọc và nhãn dùng cùng kết quả. Được chấp nhận không tự đổi trạng thái cơ hội.
9. Hai người sửa cùng lúc: người sau nhận 409, không mất dữ liệu của người trước.
10. Lùi mã về bản trước khi có Báo giá: ứng dụng chạy bình thường với DB đã có các bảng mới.

## 12. Rủi ro

| Rủi ro | Xử lý |
|---|---|
| Sai số tiền do làm tròn hoặc tính ở trình duyệt | Chỉ dùng số nguyên đồng; máy chủ là nơi tính duy nhất; CHECK ở DB khớp công thức; bộ số mẫu trong test |
| Bản in lệch mẫu công ty hoặc vỡ trang | Đối chiếu trực tiếp với tệp mẫu khi nghiệm thu; thử 1 trang và nhiều trang trên Chrome thật |
| Lộ giá cho vai trò không được xem | Một vị từ phạm vi duy nhất dùng lại của cơ hội; ma trận kiểm thử cho mọi đường đọc, kể cả bản in |
| Giá trị cơ hội bị ghi đè ngoài ý muốn | Chỉ ghi đè khi gửi / đổi báo giá đang theo đuổi; luôn có lịch sử; có nhãn "theo báo giá BG-…" cạnh giá trị |
| Thông tin thanh toán in sai | Chỉ Quản trị CRM sửa mẫu mặc định; mọi lần sửa ghi nhật ký; bản đã gửi giữ nội dung cũ |
| Nhập nội dung có mã độc vào ô chữ | Mọi ô hiển thị dạng văn bản thuần (không HTML), kể cả trên bản in |
