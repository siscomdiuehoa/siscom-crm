# Báo giá đợt 1 — lập báo giá ngay trên CRM: đặc tả v3 (PR Q1, 24/11/2026)

Trạng thái: **Draft, chờ review R2 và Owner duyệt.** Chưa có mã, chưa có migration. Nối tiếp `docs/SALES_DESIGN.md` (D10, D11, C11).
Nhãn nguồn: **[Owner]** = Owner đã chốt; **[Đề xuất]** = tác giả đề xuất, cần duyệt; **[Mã hiện có]** = đã đối chiếu mã trên `main` @ `15a60be`.
**Lịch sử:** v1 sổ báo giá (tệp Excel trên Drive). v2 lập báo giá trên CRM (Owner đổi hướng, QB3). **v3 xử lý review R1** (mục 14): mô hình DB và trigger, công thức tiền, rà rò giá, khoá đồng thời, bản in bất biến, kế hoạch nghiệm thu, tách quyết định của Owner.

## 0. Tóm tắt cho người không chuyên

- Nhân viên kinh doanh **lập báo giá ngay trong CRM**: nhập từng dòng hàng, CRM tự tính thành tiền, chiết khấu, VAT và tổng.
- Bấm "Xem bản in" ra trang A4 **đúng bố cục mẫu báo giá của công ty**; lưu thành PDF bằng chức năng in của trình duyệt, tên tệp tự điền theo mẫu Owner yêu cầu.
- Đã gửi khách thì **khoá, không sửa được**; đổi giá thì bấm "Tạo bản mới". Bản đã gửi in lại lúc nào cũng ra đúng nội dung lúc gửi.
- Giá trị của cơ hội tự đi theo **báo giá đang theo đuổi**, không cộng dồn các phiên bản.
- Chưa làm đợt này: danh mục thiết bị / vật tư, giá vốn và lợi nhuận, duyệt giá, gửi email cho khách từ CRM.

## 1. Quyết định đã chốt [Owner]

| Mã | Nội dung | Nguồn |
|---|---|---|
| D3, D7 | Không đánh dấu Thắng chỉ vì đã gửi báo giá; giá trị cơ hội là VNĐ, chưa VAT, sau chiết khấu; không cộng dồn các phiên bản | SALES_DESIGN 1.1 |
| — | Trạng thái: Nháp / Đã gửi / Được chấp nhận / Bị từ chối / Hết hiệu lực; tạo bản mới từ bản cũ, không sửa bản đã gửi; giá trị cơ hội theo báo giá đang theo đuổi | SALES_DESIGN mục 3 |
| QB1 | **Kinh doanh tự gửi giá cho khách, không cần ai duyệt trong CRM** (mỗi người đã có khung giá). Thay câu "không gửi khách khi chưa duyệt" của D11 | Owner, 24/11/2026 |
| QB2 | Tên tệp theo mẫu `YYYYMMDD_MaBG_TenKhachHang_HangMuc` (`.pdf` hoặc tệp Excel) | Owner, 24/11/2026 |
| QB3 | **Báo giá được lập ngay trên CRM**; bố cục theo tệp mẫu Owner cung cấp. Thay câu "đợt đầu giữ mẫu Excel" của D11 | Owner, 24/11/2026 |

## 2. Quyết định còn chờ Owner

Tác giả không tự ghi APPROVED / ACCEPTED. Cột "Đề xuất" là phương án đang dùng trong tài liệu để review; Owner đổi thì sửa mục liên quan.

| Mã | Câu hỏi | Đề xuất | Ảnh hưởng nếu đổi |
|---|---|---|---|
| QO1 | Dạng `MaBG` | CRM tự sinh `BG-0001`, liên tục. Tên tệp: `20261124_BG-0012_CongTyABC_GasLanhDaikin.pdf`; từ phiên bản 2 thêm `_v2` | Hàm sinh mã (Q2) |
| QO2 | Tên khách, hạng mục trong tên tệp | Bỏ dấu (kể cả đ/Đ), chỉ giữ chữ và số, viết hoa chữ đầu mỗi từ, tối đa 40 ký tự mỗi phần | Chỉ hàm tạo tên (Q4) |
| QO3 | Báo giá quá hạn có được ghi "Được chấp nhận" | Được, kèm cảnh báo | Một điều kiện ở Q5 |
| QO4 | Thuế suất VAT | Theo từng báo giá: 0 / 5 / 8 / 10 %, mặc định 10 % | CHECK ở Q2 |
| QO5 | Làm tròn | Mục 6 | Công thức và CHECK |
| QO6 | Chiết khấu | Một ô bằng tiền cho cả báo giá | Thêm cột nếu cần theo dòng |
| QO7 | Xuất PDF | In của trình duyệt, không thêm thư viện | Thêm thư viện = PR riêng |
| QO8 | Điều khoản, thông tin thanh toán | Quản trị CRM soạn mẫu mặc định; mỗi báo giá sửa được phần ghi chú | Bảng `quote_setting` |
| QO9 | Cột giá vốn | Không lưu đợt này | — |
| **QO10** | **Đóng băng bản in tới mức nào** | Khi "Đánh dấu đã gửi": đóng băng **toàn bộ** nội dung in, gồm cả mã bố cục / logo đang dùng. Công ty đổi logo hay mẫu sau này ⇒ bản cũ in lại **vẫn theo mẫu cũ** | Mục 4, 5.3 |
| **QO11** | **Sửa tay giá trị cơ hội khi đã có báo giá đang theo đuổi** | Vẫn cho sửa tay; cạnh ô giá trị hiện nhãn "theo báo giá BG-… v…" hoặc "đã sửa tay, khác báo giá"; lần gửi / đổi báo giá kế tiếp ghi đè và để lại lịch sử. Phương án chặt hơn: khoá ô giá trị khi đã có báo giá đang theo đuổi | Mục 8 |
| **QO12** | **Đổi báo giá đang theo đuổi sau khi khách đã chấp nhận** | Phiên bản được chấp nhận ⇒ báo giá đó tự thành "đang theo đuổi" và **cố định**: không đổi sang báo giá khác, không tạo bản mới cho báo giá đó. Cần sửa sau đó ⇒ lập báo giá mới | Mục 8, R-Q7 |
| **QO13** | **Một cơ hội có nhiều báo giá khác hạng mục cùng được chấp nhận** | Đợt 1: mỗi cơ hội **tối đa một** báo giá được chấp nhận; giá trị cơ hội = báo giá đó. Muốn gộp nhiều hạng mục ⇒ lập một báo giá chung. Phương án khác: cho nhiều báo giá được chấp nhận và cộng giá trị (đổi quy tắc D7, cần duyệt riêng) | R-Q7, mục 8 |

## 3. Phạm vi

**Làm:** lập báo giá theo cơ hội với dòng hàng, chiết khấu, VAT, tổng; phiên bản và năm trạng thái; bản in A4 theo mẫu công ty + tên tệp gợi ý; mẫu mặc định cho điều khoản và thông tin thanh toán; báo giá đang theo đuổi và đồng bộ giá trị cơ hội; trang danh sách; tab Báo giá trong chi tiết cơ hội; nhãn sắp hết hạn.
**Không làm (để sau):** danh mục thiết bị / vật tư và bảng giá; giá vốn, lợi nhuận; duyệt giá; chiết khấu theo dòng; nhóm / mục con trong bảng hàng; gửi email; nhập từ Excel; xuất dữ liệu báo giá; tự sinh hoạt động / công việc từ báo giá; đưa báo giá vào ô tìm kiếm chung; Hợp đồng.

## 4. Bản in

### 4.1 Bố cục (theo mẫu của công ty)

```
[Logo công ty]
Khách hàng / Client: …            Báo giá bởi / Quotation by: …
Dự án / Project: …                Chức vụ / Position: …
Điện thoại / Mobile: …            Điện thoại / Mobile: …
Email: …                          Email: …
Công ty / Company: …              Ngày báo giá / Date: …
Địa chỉ / Address: …              Mã báo giá / Seri no.: BG-0012 (v2)

            QUOTATION / BẢNG BÁO GIÁ <HẠNG MỤC>
<câu chào>
TT | Nội dung công việc | ĐVT | SL | Đơn giá | Thành tiền | Ghi chú
 …
                          Chiết khấu (nếu có)        …
                          Tổng giá trị trước VAT     …
                          VAT n %                    …
                          Tổng giá trị sau VAT       …
Ghi chú: <các dòng điều khoản>            Hiệu lực đến: dd/mm/yyyy
Thông tin tài khoản: <…>
XÁC NHẬN ĐẶT HÀNG                         XÁC NHẬN CÔNG TY
```

### 4.2 Bất biến của bản in [QO10]

**Mọi thứ hiện trên bản in đều đọc từ dòng `quote_version` và `quote_line` của chính phiên bản đó**, không đọc trực tiếp từ khách hàng, nhân viên, cơ hội, `quote.item_name` hay `quote_setting`:

| Phần trên bản in | Nguồn lúc tạo nháp (điền sẵn, sửa được) | Lưu cố định ở |
|---|---|---|
| Khối khách (6 ô) | khách hàng, người liên hệ, cơ hội | `quote_version.client_*`, `project_name` |
| Khối người báo giá (4 ô) | nhân viên lập | `quote_version.quoter_*` |
| Hạng mục trong tiêu đề | `quote.item_name` | `quote_version.item_name` |
| Mã, số phiên bản, ngày, hạn | — | `quote_version.code_snapshot`, `version_no`, `quote_date`, `valid_until` |
| Câu chào, điều khoản, thông tin tài khoản | `quote_setting` | `quote_version.intro`, `terms`, `payment_info` |
| Dòng hàng và các tổng | người lập nhập | `quote_line`, các cột tổng |
| Logo và bố cục | bố cục hiện hành | `quote_version.print_template` (mã bố cục, ví dụ `siscom-v1`) |

- Giao diện giữ **mọi** bố cục đã từng dùng: đổi logo hoặc mẫu = thêm bố cục mới với mã mới, **không sửa** bố cục cũ. Test chốt: tệp của bố cục đã phát hành không đổi nội dung (so mã băm trong test).
- Sau khi gửi, trigger R-Q2 chặn sửa tất cả các cột trên.

### 4.3 In và tên tệp

- Trang riêng, khổ A4 dọc, lề 15 mm, nền trắng chữ đen bất kể giao diện đang sáng hay tối, không có thanh điều hướng.
- Nhiều trang: dòng tiêu đề cột lặp lại ở đầu mỗi trang; một dòng hàng không bị cắt đôi; khối tổng đi cùng ít nhất hai dòng hàng cuối; khối ký và khối tài khoản không bị cắt đôi.
- Bản nháp có chữ "BẢN NHÁP" chìm trên mọi trang. Bản đã gửi không có.
- Tiêu đề trang = tên tệp gợi ý ⇒ hộp "Lưu thành PDF" tự điền tên [QB2]. Tên tệp: `<YYYYMMDD của quote_date>_<mã>[_v<n>]_<TenKhach>_<HangMuc>`, chỉ gồm `A–Z a–z 0–9 _ -`, tối đa 120 ký tự; phần nào rỗng sau khi chuẩn hoá thì thay bằng `KhongTen`.
- Mọi ô chữ hiển thị dạng văn bản thuần (không diễn giải HTML).

## 5. Mô hình dữ liệu [Đề xuất] — một migration cộng thêm, không đổi / xoá cột cũ

### 5.1 Bảng

```
quote
  id uuid PK
  code varchar(20) NOT NULL UNIQUE DEFAULT fn_next_quote_code()      -- BG-0001
  opportunity_id uuid NOT NULL, customer_id uuid NOT NULL
    FK (opportunity_id, customer_id) → opportunity (id, customer_id)  ON DELETE RESTRICT   -- khách phải trùng khách của cơ hội
  item_name varchar(120) NOT NULL (đã cắt khoảng trắng, không rỗng)
  is_primary boolean NOT NULL DEFAULT false
  created_by uuid NOT NULL → employee, created_at, updated_at, version int NOT NULL DEFAULT 1
  deleted_at, deleted_by → employee, delete_reason varchar(500)       -- cả ba cùng có hoặc cùng trống

quote_version
  id uuid PK, quote_id uuid NOT NULL → quote ON DELETE RESTRICT
  version_no smallint NOT NULL (1..999)                  UNIQUE (quote_id, version_no)
  status quote_version_status NOT NULL DEFAULT 'DRAFT'   -- DRAFT | SENT | ACCEPTED | REJECTED
  code_snapshot varchar(20) NOT NULL, item_name varchar(120) NOT NULL, print_template varchar(30) NOT NULL
  quote_date date NULL, valid_until date NULL
  client_name, client_contact, client_company varchar(200); client_phone varchar(30); client_email varchar(254);
  client_address varchar(500); project_name varchar(200)              -- NULL được
  quoter_name varchar(200) NOT NULL; quoter_title varchar(120); quoter_phone varchar(30); quoter_email varchar(254)
  intro varchar(300) NOT NULL DEFAULT '', terms varchar(4000) NOT NULL DEFAULT '', payment_info varchar(2000) NOT NULL DEFAULT ''
  vat_percent smallint NOT NULL DEFAULT 10 CHECK (vat_percent IN (0, 5, 8, 10))
  subtotal_vnd bigint NOT NULL DEFAULT 0, discount_vnd bigint NOT NULL DEFAULT 0,
  amount_vnd bigint NOT NULL DEFAULT 0, vat_vnd bigint NOT NULL DEFAULT 0, total_vnd bigint NOT NULL DEFAULT 0
  note varchar(2000) NULL (nội bộ, không in), reject_reason varchar(500) NULL, file_url varchar(1000) NULL (chỉ https)
  created_by NOT NULL, created_at, updated_at, sent_by, sent_at, decided_by, decided_at

quote_line
  id uuid PK, quote_version_id uuid NOT NULL → quote_version ON DELETE RESTRICT
  line_no smallint NOT NULL (1..200)                     UNIQUE (quote_version_id, line_no) DEFERRABLE INITIALLY DEFERRED
  description varchar(500) NOT NULL (không rỗng), unit varchar(30) NOT NULL DEFAULT ''
  quantity numeric(12,3) NOT NULL, unit_price_vnd bigint NOT NULL, amount_vnd bigint NOT NULL, note varchar(200) NULL

quote_setting                                            -- đúng MỘT dòng
  id boolean PK DEFAULT true CHECK (id), intro, terms, payment_info (cùng giới hạn như trên),
  default_valid_days smallint NOT NULL DEFAULT 15 CHECK (1..365), updated_by, updated_at
```

`opportunity` **không thêm cột nào**; chỉ thêm chỉ mục `UNIQUE (id, customer_id)` để làm đích cho khoá ngoại kép (`main` chưa có chỉ mục này; cùng cách `contact_id_customer_id_key` của S2 [Mã hiện có]). `customer_id` của cơ hội đã bất biến bằng trigger S2 [Mã hiện có].

### 5.2 CHECK và chỉ mục duy nhất

| Mã | Ràng buộc |
|---|---|
| C-1 | `quote_line`: `0 < quantity ≤ 999999.999`; `0 ≤ unit_price_vnd ≤ 999999999999`; `amount_vnd = round(quantity * unit_price_vnd)` (`round` kiểu `numeric` của PostgreSQL: 0,5 làm tròn ra xa 0) |
| C-2 | `quote_version`: `0 ≤ discount_vnd ≤ subtotal_vnd ≤ 9000000000000000`; `amount_vnd = subtotal_vnd − discount_vnd` |
| C-3 | `quote_version`: `vat_vnd = (amount_vnd * vat_percent + 50) / 100` (chia nguyên của `bigint`); `total_vnd = amount_vnd + vat_vnd` |
| C-4 | `quote_version`: `status ≠ 'DRAFT'` ⇒ `quote_date`, `valid_until`, `sent_by`, `sent_at` có giá trị và `valid_until ≥ quote_date` |
| C-5 | `quote_version`: `status IN ('ACCEPTED','REJECTED')` ⇔ `decided_by`, `decided_at` có giá trị; `REJECTED` ⇒ `reject_reason` không rỗng; trạng thái khác ⇒ `reject_reason` NULL |
| C-6 | `file_url`: bắt đầu `https://`, không khoảng trắng (cùng quy tắc `ck_od_url` [Mã hiện có]) |
| U-1 | Mỗi báo giá tối đa một nháp: `UNIQUE (quote_id) WHERE status = 'DRAFT'` |
| U-2 | Mỗi báo giá tối đa một bản được chấp nhận: `UNIQUE (quote_id) WHERE status = 'ACCEPTED'` |
| U-3 | Mỗi cơ hội tối đa một báo giá đang theo đuổi: `UNIQUE (opportunity_id) WHERE is_primary AND deleted_at IS NULL` |

### 5.3 Trigger (tên dự kiến; đều `SECURITY INVOKER`, `search_path` cố định)

| Mã | Trigger | Hành vi |
|---|---|---|
| R-Q2a | `quote_version` BEFORE UPDATE | `OLD.status ≠ 'DRAFT'` ⇒ **chỉ** cho đổi `status`, `decided_by`, `decided_at`, `reject_reason`, `file_url`, `updated_at`; cột khác đổi ⇒ lỗi `QUOTE_VERSION_LOCKED`. So sánh bằng `IS DISTINCT FROM` trên **toàn bộ** cột còn lại (liệt kê tường minh; test chốt: thêm cột mới mà quên đưa vào danh sách thì test đỏ) |
| R-Q2b | `quote_version` BEFORE DELETE | Chỉ xoá được nháp; còn lại ⇒ lỗi |
| R-Q2c | `quote_line` BEFORE INSERT / UPDATE / DELETE | `SELECT status FROM quote_version WHERE id = … FOR SHARE` (khoá dòng cha) ⇒ khác `DRAFT` thì lỗi `QUOTE_VERSION_LOCKED`. Chặn cả việc chuyển dòng sang phiên bản khác (`quote_version_id` bất biến) |
| R-Q3 | `quote_version` BEFORE UPDATE | Chuyển trạng thái hợp lệ: `DRAFT → SENT`; `SENT → ACCEPTED \| REJECTED`. Mọi chuyển khác (kể cả đi lùi, `ACCEPTED → REJECTED`) ⇒ lỗi |
| R-Q1 | `quote_version` BEFORE UPDATE khi `NEW.status = 'SENT'` | Khoá mọi dòng hàng của phiên bản `FOR UPDATE`; yêu cầu **≥ 1 dòng**; tính lại `sum(amount_vnd)` và so với `NEW.subtotal_vnd`; lệch ⇒ lỗi `QUOTE_TOTAL_MISMATCH`. (C-2, C-3 bảo đảm phần còn lại của chuỗi tổng) |
| R-Q4 | `quote` BEFORE UPDATE | `code`, `opportunity_id`, `customer_id`, `created_by`, `created_at` bất biến |
| R-Q5 | `quote` BEFORE UPDATE khi bật `is_primary` | Phải có ít nhất một phiên bản không phải nháp |
| R-Q7 | `quote_version` BEFORE UPDATE khi `NEW.status = 'ACCEPTED'` [QO12, QO13] | Khoá mọi `quote` của cùng cơ hội; cơ hội đã có báo giá khác được chấp nhận ⇒ lỗi `QUOTE_ALREADY_ACCEPTED`; báo giá này phải đang là `is_primary` (ứng dụng đặt trong cùng transaction) |
| R-Q8 | `quote` BEFORE UPDATE khi đổi `is_primary` | Cơ hội đã có báo giá được chấp nhận ⇒ không đổi được (cố định theo QO12) |
| R-Q9 | `quote` xoá mềm | Chỉ khi không có phiên bản nào khác `DRAFT`; không có lệnh DELETE cứng (app không có quyền DELETE) |

**Vì sao không còn khe hở khi chạy đồng thời.** Lệnh gửi là một câu `UPDATE quote_version SET status = 'SENT' …`, giữ khoá ghi trên dòng phiên bản tới hết transaction:
- Một người đang **thêm / sửa / xoá dòng hàng** giữ khoá `FOR SHARE` trên dòng phiên bản (R-Q2c) ⇒ lệnh gửi phải chờ; khi được chạy, R-Q1 đếm và cộng lại trên dữ liệu đã chốt ⇒ thiếu dòng hoặc lệch tổng thì từ chối.
- Ngược lại, lệnh gửi chạy trước ⇒ lệnh sửa dòng hàng chờ, rồi đọc thấy `SENT` ⇒ bị từ chối.
- Hai lệnh đổi trạng thái cùng lúc trên một phiên bản: lệnh sau chờ, rồi R-Q3 xét trên trạng thái mới ⇒ từ chối.
- Hai người cùng tạo nháp cho một báo giá: U-1 từ chối người sau (ứng dụng đổi thành 409 `QUOTE_DRAFT_EXISTS`).
- Số phiên bản: ứng dụng khoá dòng `quote` `FOR UPDATE` rồi lấy `max(version_no) + 1`; `UNIQUE (quote_id, version_no)` là lưới chặn cuối.

Bản nháp cho phép tổng tạm lệch dòng hàng **bên trong** một transaction lưu (ứng dụng ghi dòng hàng rồi ghi tổng); điểm chốt bắt buộc là R-Q1 lúc gửi. Ngoài ra ứng dụng luôn tính lại tổng ở mỗi lần lưu (mục 6).

**"Hết hiệu lực" không lưu trong DB**: phiên bản `SENT` có `valid_until` < hôm nay (ngày theo giờ Việt Nam). Danh sách và bộ lọc dùng **cùng một biểu thức SQL** ở máy chủ.

## 6. Tính tiền [Đề xuất — QO4, QO5, QO6]

Đơn vị: **đồng, số nguyên**. Đơn giá là giá **trước VAT**.

| Bước | Công thức | Làm tròn |
|---|---|---|
| Thành tiền dòng | `quantity × unit_price_vnd` | Tới đồng, **0,5 làm tròn lên** |
| Tổng dòng hàng (`subtotal_vnd`) | tổng thành tiền các dòng | — |
| Chiết khấu (`discount_vnd`) | số tiền nhập, `0 ≤ chiết khấu ≤ subtotal` | số nguyên |
| Tổng trước VAT (`amount_vnd`) | `subtotal − chiết khấu` | — |
| VAT (`vat_vnd`) | `amount × vat_percent / 100` | Tới đồng, **0,5 làm tròn lên** |
| Tổng sau VAT (`total_vnd`) | `amount + vat` | — |

- **Số lượng**: tối đa 3 chữ số thập phân, `0 < SL ≤ 999 999,999`. Nhập nhiều hơn 3 chữ số thập phân ⇒ từ chối (không tự làm tròn số lượng).
- **Đơn giá**: số nguyên, `0 ≤ đơn giá ≤ 999 999 999 999`. Đơn giá 0 được phép (hàng tặng kèm).
- **Giới hạn**: `subtotal ≤ 9 000 000 000 000 000` (dưới ngưỡng số nguyên an toàn của JavaScript `9 007 199 254 740 991`, còn dư cho VAT 10 %: tổng sau VAT lớn nhất `9,9 × 10¹⁵` vượt ngưỡng ⇒ **trả tiền qua API ở dạng chuỗi số** như cách `money()` của cơ hội đang làm [Mã hiện có]; giao diện chỉ định dạng, không tính).
- **Máy chủ tính bằng số nguyên chính xác** (`BigInt`): số lượng đổi sang phần nghìn `q = SL × 1000` (số nguyên); thành tiền `= (q × đơn giá + 500) div 1000`; VAT `= (amount × p + 50) div 100`. Không dùng số thực ở bất kỳ bước nào. Máy chủ **bỏ qua** mọi tổng do trình duyệt gửi lên.
- **DB kiểm lại** bằng C-1, C-2, C-3 và R-Q1 (hai cách tính độc lập phải ra cùng số: `BigInt` ở máy chủ và `numeric` / `bigint` ở PostgreSQL).
- Giao diện hiển thị tổng tạm tính khi đang gõ, bằng cùng công thức số nguyên; số chính thức là số máy chủ trả về sau khi lưu.

### 6.1 Bảng ví dụ tính tay (dùng làm test, mục 11 nhóm A)

| Ca | Dòng hàng (SL × đơn giá → thành tiền) | Chiết khấu | VAT | subtotal | amount | vat | total |
|---|---|---|---|---|---|---|---|
| A1 | 5 × 1 636 000 → 8 180 000; 5 × 1 722 000 → 8 610 000; 1 × 636 364 → 636 364; 1 × 1 500 000 → 1 500 000 | 0 | 10 % | 18 926 364 | 18 926 364 | 1 892 636 (từ …636,4) | 20 819 000 |
| A2 | 2,5 × 333 333 → 833 333 (từ …332,5); 1,005 × 999 → 1 004 (từ 1 003,995) | 33 333 | 8 % | 834 337 | 801 004 | 64 080 (từ …080,32) | 865 084 |
| A3 | 1 × 125 → 125 | 0 | 10 % | 125 | 125 | 13 (từ 12,5) | 138 |
| A4 | 1 × 250 → 250 | 0 | 5 % | 250 | 250 | 13 (từ 12,5) | 263 |
| A5 | 3 × 1 000 → 3 000 | 3 000 | 10 % | 3 000 | 0 | 0 | 0 |
| A6 | 0,001 × 499 → 0 (từ 0,499); 0,001 × 500 → 1 (từ 0,5) | 0 | 0 % | 1 | 1 | 0 | 1 |
| A7 | 999 999,999 × 999 999 999 999 → 999 999 998 999 000 000 (từ …000 000,001) | 0 | 10 % | 999 999 998 999 000 000 | — | — | **từ chối**: vượt giới hạn subtotal |
| A8 | 1 × 100 → 100 | 101 | 10 % | 100 | — | — | **từ chối**: chiết khấu lớn hơn tổng |

## 7. Quyền và rò giá

### 7.1 Ma trận [Đề xuất]

Báo giá **đi theo cơ hội**: ai không thấy cơ hội trên **đường đầy đủ** thì không thấy báo giá (ngoài phạm vi trả 404, không trả 403 để khỏi lộ sự tồn tại).

| Mã | Quản trị CRM | Kinh doanh | Kỹ thuật | Kế toán | Quản trị hệ thống |
|---|---|---|---|---|---|
| `quote.read` | tất cả | cơ hội mình **thấy được** theo SALES 5.1 | — | tất cả | — |
| `quote.create` / `quote.update` | tất cả | chỉ cơ hội mình **phụ trách** | — | — | — |
| `quote.send` (Đã gửi, chọn đang theo đuổi) | tất cả | chỉ cơ hội mình phụ trách | — | — | — |
| `quote.decide` (Được chấp nhận / Bị từ chối) | tất cả | chỉ cơ hội mình phụ trách | — | — | — |
| `quote.delete` (nháp / báo giá chưa gửi) | tất cả | chỉ cơ hội mình phụ trách | — | — | — |
| `quote.settings` | có | — | — | — | — |

- Dùng lại RBAC và vị từ phạm vi hiện có: mọi đường đọc báo giá đi qua **đúng một hàm** = `quote.read` **VÀ** vị từ "đường đầy đủ" của cơ hội (`fullReadWhere` [Mã hiện có]). **Không** dùng "đường theo việc" (`taskPathWhere`). Quyền ghi kiểm theo `owner_id` của cơ hội như `opportunity.update`. Mỗi mã cấp riêng, không suy mã này từ mã khác.
- `fn_auth_perm_class` xếp thêm tiền tố `quote.` vào nhóm BIZ ⇒ rào SoD của M1 chặn ở DB việc cấp bất kỳ mã `quote.*` nào (kể cả `quote.settings`) cho vai trò `admin` (cùng cách S5).
- Cấp quyền trên DB đã bootstrap: script hai người + script gỡ + diễn tập CI (mẫu `SALES_S5_OPPORTUNITY_PERMISSIONS`). Grants cho `siscom_app`: INSERT / UPDATE `quote`, `quote_version`; INSERT / UPDATE / DELETE `quote_line`; SELECT / UPDATE `quote_setting`; không DELETE trên `quote`, `quote_version`. `siscom_auth`, `siscom_acct`: **không có quyền nào** trên bốn bảng.

### 7.2 Rà các đường có thể lộ giá gián tiếp

| Đường | Hiện trạng / cách xử lý | Test |
|---|---|---|
| API báo giá (danh sách, chi tiết, theo cơ hội, giá trị điền sẵn, cài đặt) | Hàm kiểm duy nhất ở 7.1 | C1–C3 |
| **Bản in** | Là trang giao diện dựng từ `GET /quotes/:id`; không có đường tải riêng, không có tệp tĩnh ⇒ cùng một lần kiểm quyền. Gõ thẳng địa chỉ bản in khi không có quyền ⇒ trang "không có quyền", không gọi thêm API nào | C4 |
| Chi tiết cơ hội của Kỹ thuật | `toOpportunityTechDetail` liệt kê tường minh từng trường, không có giá trị [Mã hiện có]. Báo giá **không** được thêm vào đường này; test `TECH_KEYS` hiện có sẽ đỏ nếu ai thêm | C5 |
| Giá trị cơ hội (sau khi đồng bộ từ báo giá) | Chỉ trả trên đường đầy đủ [Mã hiện có]; không đổi | C5 |
| Lịch sử thay đổi cơ hội (`/changes`, có dòng `AMOUNT` do đồng bộ sinh ra) | Chỉ đường đầy đủ [Mã hiện có]. Lý do ghi kèm: `Theo báo giá BG-0012 v2` — có mã, không lặp lại số tiền ngoài hai cột giá trị cũ / mới vốn đã thuộc đường đầy đủ | C6 |
| Tài liệu cơ hội | Đường theo việc chỉ thấy loại `TECHNICAL` [Mã hiện có]. `file_url` của báo giá **không** được chép sang `opportunity_document` | C7 |
| Tổng theo cột kanban, số đếm, tìm kiếm cơ hội | Chỉ đường đầy đủ [Mã hiện có]; báo giá không thêm số liệu nào vào đó | C5 |
| Hoạt động / công việc (Kỹ thuật đọc được) | Đợt 1 **không tự sinh** hoạt động hay công việc từ báo giá ⇒ không có nội dung giá nào chảy sang | C8 |
| Tìm kiếm chung | Báo giá không được lập chỉ mục trong tìm kiếm chung ở đợt này | C8 |
| Nhật ký hệ thống (`audit_log`) | Ghi hành động và mã định danh, **không ghi số tiền, không ghi nội dung dòng hàng**. Chỉ vai trò có `audit.read` đọc được | C9 |
| Thông báo lỗi | Lỗi ràng buộc DB được đổi thành mã lỗi cố định; không trả nguyên văn lỗi PostgreSQL (có thể chứa số tiền) | C9 |
| Mã `BG-…` liên tục | Lộ **số lượng** báo giá (không lộ giá) cho người thấy được ít nhất hai mã. Chấp nhận, giống `CH-…`, `KH-…` | — |
| Kết nối DB khác | `siscom_auth`, `siscom_acct` không có quyền trên bốn bảng | B8 |

## 8. Quy tắc nghiệp vụ [Đề xuất]

1. **Tạo báo giá** từ một cơ hội đang mở (`OPEN`): nhập hạng mục ⇒ sinh mã và phiên bản 1 (Nháp); các ô ở 4.2 được điền sẵn. Cơ hội Tạm hoãn / Thắng / Thua: không tạo mới, vẫn xem và in được.
2. **Soạn nháp**: thêm, sửa, xoá, đổi thứ tự dòng hàng; chiết khấu, VAT; sửa các ô đầu trang và ghi chú. Lưu là **một transaction**, máy chủ tính lại mọi tổng (mục 6).
3. **Xem bản in**: mọi phiên bản; nháp có chữ chìm.
4. **Đánh dấu Đã gửi** [QB1]: cần ≥ 1 dòng hàng, ngày báo giá (không ở tương lai), hạn hiệu lực ≥ ngày báo giá. Phiên bản bị khoá (R-Q2).
5. **Tạo bản mới**: chép toàn bộ nội dung phiên bản mới nhất (kể cả dòng hàng và các ô đầu trang) thành phiên bản kế tiếp, Nháp; `print_template` lấy bố cục hiện hành. Chỉ khi báo giá chưa có nháp và chưa được chấp nhận.
6. **Kết quả**: "Được chấp nhận" hoặc "Bị từ chối" (bắt buộc lý do) cho phiên bản đã gửi **mới nhất** của báo giá (phiên bản cũ hơn coi như đã bị thay thế, không ghi kết quả được). Được chấp nhận **không** tự chốt Thắng cơ hội (D3); giao diện hiện lối tắt "Chốt Thắng cơ hội".
7. **Báo giá đang theo đuổi**: báo giá đầu tiên được gửi của một cơ hội tự thành "đang theo đuổi"; người phụ trách đổi sang báo giá khác đã có phiên bản gửi. Khi một phiên bản được chấp nhận ⇒ báo giá đó thành "đang theo đuổi" và cố định [QO12, QO13].
8. **Đồng bộ giá trị cơ hội** (D7) — xảy ra ở đúng ba sự kiện: (a) gửi một phiên bản của báo giá đang theo đuổi; (b) đổi báo giá đang theo đuổi; (c) chấp nhận một phiên bản. Khi đó `opportunity.expected_amount_vnd` **được gán bằng** `amount_vnd` (chưa VAT, sau chiết khấu) của **phiên bản đã gửi mới nhất** của báo giá đang theo đuổi — phép **gán**, không cộng.
   - Cơ hội không ở `OPEN` ⇒ không đồng bộ (và theo quy tắc 1, 4 cũng không gửi được).
   - Giá trị không đổi ⇒ không ghi lịch sử, không tăng `version`.
   - Giá trị đổi ⇒ thêm dòng `opportunity_change` (`field = AMOUNT`, cũ → mới, lý do `Theo báo giá BG-… v…`, người thực hiện = người bấm) và tăng `opportunity.version` thêm 1.
   - **Sửa tay giá trị cơ hội** [QO11]: vẫn được, theo đường ghi hiện có. Sự kiện (a) / (b) / (c) kế tiếp ghi đè và để lại lịch sử. Giao diện hiện nhãn cạnh ô giá trị: "theo báo giá BG-… v…" khi giá trị cơ hội bằng giá trị phiên bản nói trên, "đã sửa tay, khác báo giá" khi khác. Nhãn tính lúc đọc, **không thêm cột** vào `opportunity`.
9. **Xoá**: xoá mềm nháp, hoặc cả báo giá khi chưa có phiên bản nào đã gửi (R-Q9). Xoá báo giá đang theo đuổi là không thể (nó đã có phiên bản gửi).
10. Giới hạn: tối đa 200 dòng hàng mỗi phiên bản, 999 phiên bản mỗi báo giá.

### 8.1 Khoá và xung đột khi nhiều người thao tác

- **Thứ tự khoá cố định** cho mọi thao tác ghi báo giá: khách `FOR SHARE` → cơ hội `FOR UPDATE` → `quote` `FOR UPDATE` → `quote_version`. Hai bước đầu là đúng khuôn của đường ghi cơ hội [Mã hiện có], nên báo giá và cơ hội không khoá chéo nhau.
- Vì mọi thao tác ghi báo giá đều giữ khoá `FOR UPDATE` trên **dòng cơ hội**, hai người cùng gửi, cùng đổi báo giá đang theo đuổi, hoặc một người gửi trong lúc người khác sửa cơ hội, đều chạy **lần lượt** — không có hai phép đồng bộ chồng nhau.
- **Khoá lạc quan**: mọi yêu cầu ghi gửi kèm `version` của `quote`; lệch ⇒ 409 `VERSION_CONFLICT` kèm phiên bản hiện tại. Mọi thay đổi trên báo giá (kể cả lưu nháp, đổi trạng thái phiên bản) đều tăng `quote.version`.
- Người đang mở form sửa cơ hội trong lúc báo giá vừa đồng bộ giá trị ⇒ khi lưu nhận 409 của cơ hội (vì `opportunity.version` đã tăng), tải lại rồi lưu — không ghi đè âm thầm giá trị vừa đồng bộ.

| Tình huống | Kết quả |
|---|---|
| A và B cùng bấm "Đánh dấu đã gửi" một phiên bản | Một người thành công; người kia 409 `VERSION_CONFLICT` |
| A gửi báo giá X, B cùng lúc đổi đang theo đuổi sang Y (cùng cơ hội) | Chạy lần lượt; người sau 409 nếu `version` đã cũ, hoặc được áp trên trạng thái mới; giá trị cơ hội cuối cùng = phiên bản gửi mới nhất của báo giá đang theo đuổi cuối cùng |
| A lưu nháp, B cùng lúc gửi chính nháp đó | Chạy lần lượt (5.3); người sau 409 hoặc `QUOTE_VERSION_LOCKED` |
| A chấp nhận báo giá X, B cùng lúc chấp nhận báo giá Y (cùng cơ hội) | Một người thành công; người kia `QUOTE_ALREADY_ACCEPTED` (R-Q7) |
| A sửa tay giá trị cơ hội, B cùng lúc gửi báo giá đang theo đuổi | Chạy lần lượt trên khoá dòng cơ hội; người lưu sau với `version` cũ nhận 409 |

## 9. API [Đề xuất] (`/api/v1`, cookie + Origin + CSRF như hiện nay, bọc `{ data }`)

`GET /quotes` (lọc trạng thái gồm "hết hiệu lực" và "sắp hết hạn ≤ 7 ngày", người phụ trách cơ hội, khách; tìm theo mã / hạng mục / tên khách không phân biệt dấu; phân trang) · `GET /opportunities/:id/quotes` · `GET /quotes/:id` (mọi phiên bản, dòng hàng, `suggestedFileName`) · `GET /opportunities/:id/quotes/defaults` · `POST /opportunities/:id/quotes` · `PATCH /quotes/:id` (hạng mục; có `version`) · `PUT /quotes/:id/versions/:no` (lưu cả nháp gồm dòng hàng) · `POST /quotes/:id/versions` (tạo bản mới) · `POST /quotes/:id/versions/:no/send` · `…/accept` · `…/reject` · `PATCH /quotes/:id/versions/:no/file` · `POST /quotes/:id/primary` · `DELETE /quotes/:id/versions/:no` (nháp) · `DELETE /quotes/:id` (chưa gửi) · `GET /quotes/settings` · `PUT /quotes/settings`.

Mã lỗi: 400 dữ liệu sai (`AMOUNT_OUT_OF_RANGE`, `DISCOUNT_EXCEEDS_SUBTOTAL`, `QUANTITY_PRECISION`…), 403 thấy được nhưng không có quyền ghi, 404 ngoài phạm vi xem, 409 `VERSION_CONFLICT` / `QUOTE_VERSION_LOCKED` / `QUOTE_DRAFT_EXISTS` / `QUOTE_ALREADY_ACCEPTED` / `QUOTE_PRIMARY_FIXED`, 422 `OPPORTUNITY_NOT_OPEN` / `QUOTE_EMPTY`.

## 10. Màn hình

- **Tab "Báo giá" trong chi tiết cơ hội**: mỗi báo giá một khối — mã, hạng mục, nhãn "Đang theo đuổi", bảng phiên bản (số, trạng thái, tổng trước VAT, ngày báo giá, hạn hiệu lực). Nút: Thêm báo giá, Soạn, Xem bản in, Đánh dấu đã gửi, Tạo bản mới, Kết quả, Chọn đang theo đuổi.
- **Màn hình soạn**: hai khối đầu trang; bảng dòng hàng nhập trực tiếp (thêm / xoá / đổi thứ tự); chiết khấu, VAT; ba dòng tổng; ghi chú điều khoản. Điện thoại: mỗi dòng hàng một thẻ.
- **Bản in**: mục 4.
- **Trang "Báo giá"** (mục đã có trên thanh bên): danh sách, lọc, tìm; cột hạn hiệu lực có nhãn "Còn n ngày" / "Hết hiệu lực".
- **Cài đặt mẫu báo giá** (chỉ Quản trị CRM).
- Vai trò không có `quote.read`: không có mục "Báo giá", không có tab, gõ thẳng địa chỉ ⇒ trang "không có quyền" và **không gọi API**. Dùng thành phần giao diện hiện có; ô tiền dùng lại `AmountInput`.

## 11. Nghiệm thu

Mỗi ca ghi PASS / FAIL kèm bằng chứng (tên test hoặc ảnh chụp). Ca FAIL chặn merge PR chứa nó.

**A. Tính tiền** (Q5; unit test + test tích hợp trên PostgreSQL tạm)
- A1–A8: tám ca của bảng 6.1 ra đúng từng số, ở **cả hai** nơi: máy chủ (BigInt) và DB (chèn trực tiếp số sai ⇒ CHECK từ chối).
- A9: máy chủ bỏ qua tổng do trình duyệt gửi lên (gửi tổng sai ⇒ lưu ra tổng đúng).
- A10: số lượng 4 chữ số thập phân, số âm, đơn giá lẻ, chữ thay số ⇒ 400, không lưu gì.
- A11: tiền trả về ở dạng chuỗi số; giá trị vượt ngưỡng số nguyên an toàn của JavaScript vẫn đúng từng chữ số.

**B. Database và trigger** (Q2; bài kiểm SQL chạy trong CI bằng `siscom_app`, mẫu `SALES_S2_STRUCTURE_TESTS`)
- B1: phiên bản đã gửi — UPDATE từng cột nội dung (thử **lần lượt mọi cột**), DELETE ⇒ từ chối. B2: INSERT / UPDATE / DELETE dòng hàng của phiên bản đã gửi, chuyển dòng sang phiên bản khác ⇒ từ chối.
- B3: gửi phiên bản không có dòng hàng ⇒ từ chối. B4: gửi khi `subtotal_vnd` lệch tổng dòng hàng ⇒ từ chối.
- B5: mọi chuyển trạng thái ngoài R-Q3 (9 cặp) ⇒ từ chối. B6: U-1, U-2, U-3 và khoá ngoại kép (khách khác khách của cơ hội) ⇒ từ chối.
- B7: `quote.code`, `opportunity_id`, `customer_id` bất biến; bật `is_primary` khi chưa có phiên bản gửi ⇒ từ chối; R-Q7, R-Q8.
- B8: `siscom_app` không DELETE được `quote`, `quote_version`; `siscom_auth`, `siscom_acct` không SELECT được bốn bảng; vai trò `admin` không nhận được mã `quote.*` (SoD).
- B9: danh sách cột của R-Q2a khớp `information_schema` (thêm cột mà quên cập nhật trigger ⇒ test đỏ).

**C. Bảo mật** (Q4, Q5; test tích hợp theo ma trận 5 vai trò)
- C1: mỗi endpoint đọc × 5 vai trò × {phụ trách, chỉ xem, ngoài phạm vi} đúng 7.1. C2: mỗi endpoint ghi tương tự; Kinh doanh chỉ xem ⇒ 403, ngoài phạm vi ⇒ 404.
- C3: Kỹ thuật có công việc đang mở trên cơ hội: **mọi** endpoint báo giá ⇒ 404; chi tiết cơ hội đường theo việc không có khoá nào mới (so `TECH_KEYS`).
- C4: bản in — không quyền ⇒ trang "không có quyền", 0 lời gọi API báo giá (kiểm trên Chrome thật).
- C5: sau khi đồng bộ giá trị, đường theo việc vẫn không có giá trị, tổng cột, số đếm. C6: `/changes` của Kỹ thuật ⇒ như hiện nay (không đọc được); dòng `AMOUNT` chỉ thấy trên đường đầy đủ.
- C7: `opportunity_document` không có dòng nào do báo giá sinh ra. C8: không có hoạt động / công việc / kết quả tìm kiếm chung nào chứa dữ liệu báo giá.
- C9: `audit_log` của các thao tác báo giá không chứa số tiền hay nội dung dòng hàng; lỗi DB trả về mã cố định, không có nguyên văn PostgreSQL.
- C10: thu hồi `quote.read` giữa phiên ⇒ lần gọi kế tiếp bị từ chối (như test tương ứng của P1).

**D. Đồng thời** (Q5; test tích hợp chạy hai kết nối thật, mẫu `concurrency.int-spec`)
- D1–D5: năm tình huống của bảng 8.1, mỗi tình huống lặp 20 lần, không có lần nào ra trạng thái sai.
- D6: sau mọi tình huống, giá trị cơ hội = `amount_vnd` của phiên bản đã gửi mới nhất của báo giá đang theo đuổi; số dòng lịch sử `AMOUNT` = số lần giá trị thực sự đổi.
- D7: gửi lần lượt v1 (100), v2 (150) của báo giá đang theo đuổi ⇒ giá trị cơ hội 150, **không** 250.
- D8: sửa tay giá trị cơ hội rồi gửi v3 ⇒ bị ghi đè, có lịch sử; nhãn "đã sửa tay" / "theo báo giá" đúng ở từng bước.
- D9: không có khoá chéo (deadlock) trong 200 lượt ghi xen kẽ báo giá và cơ hội.

**E. Bản in** (Q7; Chrome thật)
- E1: báo giá 4 dòng vừa một trang, đối chiếu từng khối với tệp mẫu của công ty. E2: 60 dòng ⇒ nhiều trang, tiêu đề cột lặp lại, không dòng nào bị cắt đôi, khối ký và khối tài khoản nguyên vẹn. E3: 200 dòng, nội dung dài 500 ký tự mỗi dòng ⇒ không tràn ngang.
- E4: in lại phiên bản đã gửi sau khi đổi khách hàng, nhân viên, hạng mục của báo giá, mẫu mặc định, và thêm bố cục in mới ⇒ **giống hệt** bản trước (so văn bản trang).
- E5: giao diện đang ở nền tối ⇒ bản in vẫn nền trắng. E6: nháp có chữ chìm, bản đã gửi không có.
- E7: tên tệp với tên có dấu, có `đ/Đ`, ký tự `/ \ : * ? " < > |`, tên rỗng sau chuẩn hoá, tên 300 ký tự, phiên bản 1 và 2 ⇒ đúng 4.3.
- E8: nhập `<script>`, thẻ HTML vào mọi ô chữ ⇒ hiển thị nguyên văn trên màn hình và bản in.

**F. Rollback và triển khai** (Q2, Q3, Q8)
- F1: script rollback gỡ sạch cấu trúc khi bốn bảng rỗng; **từ chối** khi có dữ liệu (mẫu `SALES_S2_ROLLBACK_REFUSE_TEST`). F2: áp → gỡ → áp lại trong CI.
- F3: mã bản trước (không có Báo giá) chạy bình thường trên DB đã có migration này (test của bản trước xanh trên DB mới). F4: script cấp quyền chạy hai lần cho cùng kết quả; script gỡ quyền trả DB về trạng thái trước.
- F5: nghiệm thu trên máy chủ theo đúng khuôn các lần trước: sao lưu + khôi phục thử trước migration, `--auto-rollback`, ba bài VERIFY không có FAIL.

## 12. Kế hoạch PR nhỏ (Draft; ChatGPT review; Owner duyệt merge từng PR)

| PR | Nội dung | Phụ thuộc | PASS khi | Đụng DB? |
|---|---|---|---|---|
| **Q1** | Tài liệu này + chú thích đồng bộ trong `SALES_DESIGN.md` | — | Review không còn điểm chặn; Owner chốt QO1–QO13 | không |
| Q2 | Migration: 4 bảng, kiểu enum, hàm mã, CHECK, trigger, `fn_auth_perm_class`; rollback; bài kiểm cấu trúc | Q1 | Nhóm B, F1, F2 | chỉ PostgreSQL tạm của CI |
| Q3 | Grants + VERIFY; mã quyền `quote.*`, script hai người / gỡ / kiểm; ma trận `bootstrap.ts` | Q2 | B8, F4; VERIFY hiện có không đổi kết quả | chỉ CI |
| Q4 | Backend đọc + tên tệp gợi ý + cài đặt (đọc) | Q3 | C1, C3, C5–C9 (phần đọc), E7 (hàm tên tệp) | không |
| Q5 | Backend ghi + tính tiền + đồng bộ giá trị cơ hội | Q4 | Nhóm A, C2, C10, nhóm D | không |
| Q6 | Giao diện: tab Báo giá + màn hình soạn | Q5 | Test giao diện; thử Chrome thật các luồng chính | không |
| Q7 | Giao diện: bản in, trang Báo giá, cài đặt mẫu, điện thoại | Q6 | Nhóm E, C4 | không |
| Q8 | Lên máy chủ | Q2–Q7 đã merge | F3, F5; Owner nghiệm thu | **Owner duyệt riêng từng bước** |

Mỗi PR tự đứng được: Q2, Q3 không đổi hành vi ứng dụng; Q4, Q5 thêm API chưa ai gọi; Q6, Q7 chỉ hiện với người có `quote.read` (chưa ai có cho tới khi cấp quyền ở Q8). Đường lùi: ưu tiên lùi mã, giữ cấu trúc cộng thêm; gỡ cấu trúc chỉ khi bốn bảng còn rỗng và được duyệt riêng.

## 13. Rủi ro

| Rủi ro | Xử lý |
|---|---|
| Sai số tiền | Số nguyên đồng; hai nơi tính độc lập (máy chủ, DB); bảng 6.1 là test |
| Sửa được bản đã gửi qua một đường chưa tính tới | Chặn ở DB (5.3), không dựa vào ứng dụng; B1, B2, B9 |
| Lộ giá cho vai trò không được xem | Một hàm kiểm duy nhất; bảng 7.2; nhóm C |
| Hai người thao tác cùng lúc làm lệch giá trị cơ hội | Khoá dòng cơ hội theo thứ tự cố định; nhóm D |
| Bản in lệch mẫu hoặc đổi theo thời gian | Mọi nội dung in lưu theo phiên bản; bố cục có mã và không sửa; nhóm E |
| Thông tin thanh toán in sai | Chỉ Quản trị CRM sửa mẫu mặc định; bản đã gửi giữ nội dung cũ |
| Mẫu báo giá khác của công ty có cột / nhóm hàng khác | Đợt 1 chỉ bám một mẫu; mẫu khác là bố cục mới (mã `print_template` mới), làm sau |

## 14. Đối chiếu review R1 (24/11/2026, tại `c9cd4ca`) → mục sửa → ca nghiệm thu

| Mã | Nhận xét R1 | Trạng thái | Mục sửa | Ca |
|---|---|---|---|---|
| `PR266-R1-DB-01` | Hoàn thiện mô hình DB: trigger chống sửa sau gửi kể cả khi cập nhật đồng thời; không gửi được báo giá rỗng hoặc lệch tổng; khoá các trường ảnh hưởng bản in; unique, khoá ngoại, tranh chấp | **FIXED** | 5.1, 5.2, 5.3, 4.2 | B1–B9 |
| `PR266-R1-MONEY-01` | Chốt công thức, làm tròn 0,5 đồng, số lượng lẻ, giới hạn; số học chính xác; CHECK; bảng ví dụ và test | **FIXED** | 6, 6.1, C-1…C-3 | A1–A11 |
| `PR266-R1-SEC-01` | Kỹ thuật và Quản trị hệ thống không đọc được báo giá ở mọi đường, kể cả gián tiếp; dùng lại RBAC và phạm vi cơ hội | **FIXED** | 7.1, 7.2 | C1–C10, B8 |
| `PR266-R1-SYNC-01` | Chống hai người gửi / đổi đang theo đuổi cùng lúc; khoá, optimistic version, 409, lịch sử; không cộng dồn; sửa tay giá trị cơ hội | **FIXED** (phần sửa tay và sau chấp nhận chờ QO11–QO13) | 8 (quy tắc 7, 8), 8.1 | D1–D9 |
| `PR266-R1-PRINT-01` | Lưu cố định dữ liệu in theo phiên bản; in lại không đổi; phân trang A4, bản dài, tên tệp | **FIXED** (mức đóng băng chờ QO10) | 4.2, 4.3 | E1–E8 |
| `PR266-R1-TEST-01` | Bổ sung test bảo mật, đồng thời, tiền, trigger, rollback, bản in; PR Q2–Q8 nhỏ, độc lập, có PASS/FAIL; đồng bộ `SALES_DESIGN.md` | **FIXED** | 11, 12; chú thích trong `SALES_DESIGN.md` | A–F |
| `PR266-R1-OWNER-01` | Giữ QO1–QO9 chờ Owner; đề xuất rõ quyết định mới về đóng băng bản in, sửa tay giá trị cơ hội, đổi đang theo đuổi sau khi chấp nhận; không tự ghi APPROVED / ACCEPTED | **FIXED** | 2 (QO10–QO13) | — |
