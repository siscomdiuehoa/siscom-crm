# Báo giá đợt 1 — lập báo giá ngay trên CRM: đặc tả v4 (PR Q1, 24/11/2026)

Trạng thái: **Draft, chờ review và Owner duyệt.** Chưa có mã, chưa có migration. Nối tiếp `docs/SALES_DESIGN.md` (D10, D11, C11).
Nhãn nguồn: **[Owner]** = Owner đã chốt; **[Đề xuất]** = tác giả đề xuất, cần duyệt; **[Mã hiện có]** = đã đối chiếu mã trên `main` @ `15a60be`.
**Lịch sử:** v1 sổ báo giá. v2 lập báo giá trên CRM (QB3). v3 xử lý review R1 (mục 14). **v4: Owner trả lời QO1–QO9 và yêu cầu thêm** — nhiều loại báo giá (mỗi loại vật tư một mẫu), có màn hình điều chỉnh các loại báo giá, xuất PDF một chạm và Excel, VAT 8 / 10 %, bỏ chiết khấu, mỗi nhân viên tự soạn điều khoản (mục 15). Tác giả đã đọc bố cục năm tệp mẫu của công ty để thiết kế; dữ liệu thật của các tệp đó không nằm trong kho mã.

## 0. Tóm tắt cho người không chuyên

- Nhân viên kinh doanh **lập báo giá ngay trong CRM**: chọn **loại báo giá** (ví dụ gas lạnh, ống gió vải, quạt thông gió), nhập từng dòng hàng; CRM tự tính thành tiền, VAT và tổng.
- Mỗi loại báo giá có **tiêu đề, các cột riêng và điều khoản mặc định riêng**. Có màn hình để thêm và sửa các loại báo giá.
- Tải báo giá về bằng **một nút: PDF hoặc Excel**; tên tệp tự đặt theo mẫu Owner yêu cầu.
- Đã gửi khách thì **khoá, không sửa được**; đổi giá thì bấm "Tạo bản mới". Bản đã gửi tải lại lúc nào cũng ra đúng nội dung lúc gửi.
- Giá trị của cơ hội tự đi theo **báo giá đang theo đuổi**, không cộng dồn.
- Chưa làm đợt này: danh mục thiết bị và bảng giá để chọn nhanh, giá vốn và lợi nhuận, chiết khấu, duyệt giá, gửi email cho khách từ CRM.

## 1. Quyết định đã chốt [Owner]

| Mã | Nội dung | Nguồn |
|---|---|---|
| D3, D7 | Không đánh dấu Thắng chỉ vì đã gửi báo giá; giá trị cơ hội là VNĐ, chưa VAT; không cộng dồn các phiên bản | SALES_DESIGN 1.1 |
| — | Trạng thái: Nháp / Đã gửi / Được chấp nhận / Bị từ chối / Hết hiệu lực; tạo bản mới từ bản cũ, không sửa bản đã gửi; giá trị cơ hội theo báo giá đang theo đuổi | SALES_DESIGN mục 3 |
| QB1 | **Kinh doanh tự gửi giá cho khách, không cần ai duyệt trong CRM**. Thay câu "không gửi khách khi chưa duyệt" của D11 | Owner, 24/11/2026 |
| QB2 | Tên tệp theo mẫu `YYYYMMDD_MaBG_TenKhachHang_HangMuc` | Owner, 24/11/2026 |
| QB3 | **Báo giá được lập ngay trên CRM**. Thay câu "đợt đầu giữ mẫu Excel" của D11 | Owner, 24/11/2026 |
| QB4 | Khi "Đánh dấu đã gửi": đóng băng **toàn bộ** nội dung của bản in / tệp xuất, gồm cả bố cục và logo. Đổi logo hay mẫu sau này ⇒ bản cũ vẫn theo mẫu cũ | Owner, 24/11/2026 |
| QB5 | Đã có báo giá đang theo đuổi vẫn **được sửa tay** giá trị cơ hội; hiện nhãn "theo báo giá …" / "đã sửa tay, khác báo giá"; lần gửi / đổi báo giá kế tiếp ghi đè và để lại lịch sử | Owner, 24/11/2026 |
| QB6 | Phiên bản được chấp nhận ⇒ báo giá đó thành "đang theo đuổi" và **cố định**; cần sửa thì lập báo giá mới | Owner, 24/11/2026 |
| QB7 | Mỗi cơ hội **tối đa một** báo giá được chấp nhận; muốn gộp nhiều hạng mục thì lập một báo giá chung | Owner, 24/11/2026 |
| QB8 (QO1) | Mã báo giá `BG-0001`, đánh số liên tục | Owner, 24/11/2026 |
| QB9 (QO2) | Tên khách và hạng mục trong tên tệp: bỏ dấu, viết liền, viết hoa chữ đầu mỗi từ (`CongTyABC_GasLanhDaikin`) | Owner, 24/11/2026 |
| QB10 (QO3) | Báo giá quá hạn hiệu lực vẫn ghi "Được chấp nhận" được, kèm cảnh báo | Owner, 24/11/2026 |
| QB11 (QO4) | VAT: **8 % hoặc 10 %** | Owner, 24/11/2026 |
| QB12 (QO5) | Đơn giá nhập là giá **trước VAT, nguyên đồng**; thành tiền và VAT làm tròn tới đồng | Owner, 24/11/2026 |
| QB13 (QO6) | **Chưa cần chiết khấu** ở đợt này | Owner, 24/11/2026 |
| QB14 (QO7) | Xuất PDF bằng **nút tải một chạm**, chấp nhận thêm thư viện (PR riêng) | Owner, 24/11/2026 |
| QB15 (QO8) | Điều khoản và thông tin tài khoản in trên báo giá: **mỗi nhân viên tự soạn** | Owner, 24/11/2026 |
| QB16 | Có lựa chọn **xuất cả tệp Excel** | Owner, 24/11/2026 |
| QB17 | **Mỗi loại vật tư có mẫu báo giá khác nhau**; có **phần điều chỉnh các loại báo giá** | Owner, 24/11/2026 |

## 2. Quyết định còn chờ Owner

Tác giả không tự ghi APPROVED / ACCEPTED. Cột "Đề xuất" là phương án đang dùng trong tài liệu.

| Mã | Câu hỏi | Đề xuất | Ảnh hưởng nếu đổi |
|---|---|---|---|
| QO9 | Lưu giá vốn (cột ẩn trong mẫu Excel) | Chưa lưu ở đợt này (Owner chưa trả lời câu này) | Thêm cột và quyền xem riêng |
| QO14 | VAT 8 / 10 % áp theo **từng dòng** hay cả báo giá | **Theo từng dòng**, vì mẫu ống gió vải của công ty tính 8 % cho một số dòng và 10 % cho dòng khác. Bản in gộp thành hai dòng "VAT 8 %", "VAT 10 %" | Mục 5, 6 |
| QO15 | Ai được thêm / sửa **loại báo giá** | Quản trị CRM. Phương án khác: mọi nhân viên kinh doanh | Mục 7 |
| QO16 | Mẫu "linh kiện" của công ty ghi **đơn giá đã gồm VAT** | Đợt 1 mọi loại đều nhập giá trước VAT (theo QB12); kiểu "giá đã gồm VAT" để sau | Thêm một cờ trên loại báo giá |
| QO17 | Ai được **tải PDF / Excel** | Quản trị CRM (mọi báo giá) và Kinh doanh (cơ hội mình phụ trách). Kế toán và Kinh doanh chỉ-xem: xem trên màn hình, không tải | Mục 7 |
| QO18 | Tệp Excel xuất ra chứa **giá trị** hay **công thức** | Chỉ giá trị (số và chữ), không công thức — để tệp khớp đúng bản đã khoá và an toàn khi mở | Mục 4.4 |

## 3. Phạm vi

**Làm:** loại báo giá (tiêu đề, cột riêng, điều khoản mặc định) và màn hình quản lý; lập báo giá theo cơ hội với dòng hàng, dòng tiêu đề nhóm, VAT 8 / 10 % theo dòng; phiên bản và năm trạng thái; xem bản in, tải PDF, tải Excel; mặc định cá nhân của từng nhân viên (thông tin liên hệ, thông tin tài khoản); báo giá đang theo đuổi và đồng bộ giá trị cơ hội; trang danh sách; tab Báo giá trong chi tiết cơ hội; nhãn sắp hết hạn.
**Không làm (để sau):** danh mục thiết bị / vật tư và bảng giá; công thức tính giá từ giá vốn, tỷ giá, hệ số (hiện nằm ở cột ẩn của các tệp Excel); giá vốn, lợi nhuận; chiết khấu; duyệt giá; đơn giá đã gồm VAT; gửi email; nhập từ Excel; tự sinh hoạt động / công việc từ báo giá; đưa báo giá vào tìm kiếm chung; Hợp đồng.

## 4. Loại báo giá, bản in và tệp xuất

### 4.1 Loại báo giá [QB17]

Một **loại báo giá** quyết định: tên loại (ví dụ "Gas lạnh Daikin"), dòng tiêu đề in, câu chào, điều khoản mặc định, số ngày hiệu lực mặc định, VAT mặc định, và **tối đa 10 cột riêng** chèn giữa "Nội dung công việc" và "ĐVT". Ví dụ rút từ các tệp mẫu của công ty:

| Loại | Cột riêng |
|---|---|
| Gas lạnh | (không có) |
| Ống gió vải | Đường kính (mm), Chiều dài (m) |
| Quạt thông gió | Nhà sản xuất / Xuất xứ, Model, Lưu lượng (m³/h), ĐK cánh (mm), Độ ồn (dB), Tốc độ (r.p.m), Áp lực (Pa), Điện áp, Công suất (kW) |
| Linh kiện | Mã sản phẩm |

Các cột chung luôn có: TT, Nội dung công việc, ĐVT, SL, Đơn giá, Thành tiền, Ghi chú. Cột riêng chỉ chứa **chữ để hiển thị** (không tham gia tính tiền). Bảng hàng có hai kiểu dòng: **dòng hàng** và **dòng tiêu đề nhóm** (chỉ có chữ, ví dụ "THIẾT BỊ THÔNG GIÓ").

Kho mã chỉ nạp sẵn **một** loại trung tính "Báo giá chung" (không cột riêng, điều khoản rỗng). Các loại của công ty do người có quyền tạo trên màn hình; nội dung của chúng không nằm trong kho mã.

### 4.2 Bố cục bản in

```
[Logo công ty]
Khách hàng / Client: …            Báo giá bởi / Quotation by: …
Dự án / Project: …                Chức vụ / Position: …
Điện thoại / Mobile: …            Điện thoại / Mobile: …
Email: …                          Email: …
Công ty / Company: …              Ngày báo giá / Date: …
Địa chỉ / Address: …              Mã báo giá / Seri no.: BG-0012 (v2)

                    <DÒNG TIÊU ĐỀ CỦA LOẠI BÁO GIÁ>
<câu chào>
TT | Nội dung công việc | <cột riêng…> | ĐVT | SL | Đơn giá | Thành tiền | Ghi chú
   | <dòng tiêu đề nhóm>
 …
                          Tổng giá trị trước VAT     …
                          VAT 8 %  (nếu có)          …
                          VAT 10 % (nếu có)          …
                          Tổng giá trị sau VAT       …
Ghi chú: <các dòng điều khoản>            Hiệu lực đến: dd/mm/yyyy
Thông tin tài khoản: <…>
XÁC NHẬN ĐẶT HÀNG                         XÁC NHẬN CÔNG TY
```

Khổ A4 dọc khi loại có tối đa 3 cột riêng, A4 ngang khi nhiều hơn. Khi báo giá có cả hai mức VAT, bảng hàng thêm cột "VAT %".

### 4.3 Bất biến [QB4]

**Mọi thứ hiện trên bản in và trong tệp xuất đều đọc từ dòng `quote_version` và `quote_line` của chính phiên bản đó**, không đọc trực tiếp từ khách hàng, nhân viên, cơ hội, loại báo giá hay mặc định cá nhân:

| Phần | Nguồn lúc tạo nháp (điền sẵn, sửa được) | Lưu cố định ở |
|---|---|---|
| Khối khách (6 ô) | khách hàng, người liên hệ, cơ hội | `quote_version.client_*`, `project_name` |
| Khối người báo giá (4 ô) | nhân viên lập + mặc định cá nhân | `quote_version.quoter_*` |
| Dòng tiêu đề, danh sách cột riêng, tên loại | loại báo giá | `quote_version.title`, `columns`, `template_name` |
| Hạng mục (trong tên tệp) | `quote.item_name` | `quote_version.item_name` |
| Mã, số phiên bản, ngày, hạn | — | `quote_version.code_snapshot`, `version_no`, `quote_date`, `valid_until` |
| Câu chào, điều khoản | loại báo giá | `quote_version.intro`, `terms` |
| Thông tin tài khoản | mặc định cá nhân của người lập [QB15] | `quote_version.payment_info` |
| Dòng hàng, giá trị cột riêng, các tổng | người lập nhập | `quote_line`, các cột tổng |
| Logo và bố cục | bố cục hiện hành | `quote_version.print_template` (mã bố cục, ví dụ `siscom-v1`) |

- Sửa hoặc ngừng dùng một loại báo giá **không** ảnh hưởng báo giá đã lập: phiên bản giữ bản chép của tiêu đề và danh sách cột.
- Giao diện và máy chủ giữ **mọi** bố cục đã từng dùng: đổi logo hoặc mẫu = thêm bố cục mới với mã mới, **không sửa** bố cục cũ (test chốt mã băm của bố cục đã phát hành).
- Sau khi gửi, trigger R-Q2 chặn sửa tất cả các cột trên.

### 4.4 Xem bản in, tải PDF, tải Excel [QB14, QB16]

- **Xem bản in**: trang trong CRM, dùng để xem trước; nền trắng chữ đen bất kể giao diện sáng hay tối. Bản nháp có chữ "BẢN NHÁP" chìm.
- **Tải PDF** và **Tải Excel**: hai nút; máy chủ dựng tệp từ dữ liệu đã lưu của phiên bản rồi trả về. Mỗi lần tải được kiểm quyền (mục 7) và ghi nhật ký (không ghi số tiền).
- Cùng một phiên bản đã gửi, tải lại bao nhiêu lần cũng ra **cùng nội dung**.
- Tên tệp [QB2, QB8, QB9]: `<YYYYMMDD của quote_date>_<mã>[_v<n>]_<TenKhach>_<HangMuc>.pdf|.xlsx`; chỉ gồm `A–Z a–z 0–9 _ -`; mỗi phần tên tối đa 40 ký tự, cả tên tối đa 120; phần nào rỗng sau khi chuẩn hoá thì thay bằng `KhongTen`. Bản nháp thêm `_NHAP`.
- **PDF**: nhiều trang thì dòng tiêu đề cột lặp lại; một dòng hàng không bị cắt đôi; khối tổng đi cùng ít nhất hai dòng cuối; khối ký và khối tài khoản không bị cắt đôi; phông chữ có đủ dấu tiếng Việt được nhúng trong tệp.
- **Excel** [QO18]: một trang tính theo đúng bố cục 4.2; số tiền và số lượng là ô **số**, mọi ô khác là ô **chữ**; **không có công thức** — nội dung người dùng nhập bắt đầu bằng `=`, `+`, `-`, `@` vẫn được ghi là chữ thuần, không bị Excel hiểu là công thức.
- **Thư viện**: hiện hệ thống chưa có thư viện dựng PDF hay Excel. Mỗi thư viện thêm vào là **một PR riêng** (Q9, Q10) kèm lý do chọn, giấy phép, kích thước, kết quả quét lỗ hổng; không đổi thư viện khác trong cùng PR.
- Mọi ô chữ hiển thị dạng văn bản thuần (không diễn giải HTML).

## 5. Mô hình dữ liệu [Đề xuất] — một migration cộng thêm, không đổi / xoá cột cũ

### 5.1 Bảng

```
quote_template                                           -- loại báo giá
  id uuid PK, code varchar(30) UNIQUE (a-z 0-9 -), name varchar(120) NOT NULL
  title varchar(200) NOT NULL, intro varchar(300) NOT NULL DEFAULT '', default_terms varchar(4000) NOT NULL DEFAULT ''
  default_valid_days smallint NOT NULL DEFAULT 15 CHECK (1..365), default_vat smallint NOT NULL DEFAULT 10 CHECK (IN (8, 10))
  columns jsonb NOT NULL DEFAULT '[]'   -- mảng 0..10 phần tử { key: ^[a-z][a-z0-9_]{0,19}$, label ≤ 40 ký tự, unit ≤ 20 ký tự }, key không trùng
  is_active boolean NOT NULL DEFAULT true, sort_order smallint NOT NULL DEFAULT 0
  version int NOT NULL DEFAULT 1, created_by, created_at, updated_by, updated_at
                                                         -- không xoá cứng; ngừng dùng = is_active false

quote_user_default                                       -- mặc định cá nhân [QB15]; mỗi nhân viên tối đa một dòng
  employee_id uuid PK → employee
  quoter_title varchar(120), quoter_phone varchar(30), quoter_email varchar(254), payment_info varchar(2000) NOT NULL DEFAULT ''
  updated_at

quote
  id uuid PK
  code varchar(20) NOT NULL UNIQUE DEFAULT fn_next_quote_code()      -- BG-0001 [QB8]
  opportunity_id uuid NOT NULL, customer_id uuid NOT NULL
    FK (opportunity_id, customer_id) → opportunity (id, customer_id)  ON DELETE RESTRICT
  template_id uuid NOT NULL → quote_template ON DELETE RESTRICT
  item_name varchar(120) NOT NULL (đã cắt khoảng trắng, không rỗng)
  is_primary boolean NOT NULL DEFAULT false
  created_by uuid NOT NULL → employee, created_at, updated_at, version int NOT NULL DEFAULT 1
  deleted_at, deleted_by → employee, delete_reason varchar(500)       -- cả ba cùng có hoặc cùng trống

quote_version
  id uuid PK, quote_id uuid NOT NULL → quote ON DELETE RESTRICT
  version_no smallint NOT NULL (1..999)                  UNIQUE (quote_id, version_no)
  status quote_version_status NOT NULL DEFAULT 'DRAFT'   -- DRAFT | SENT | ACCEPTED | REJECTED
  code_snapshot varchar(20) NOT NULL, item_name varchar(120) NOT NULL, print_template varchar(30) NOT NULL
  template_name varchar(120) NOT NULL, title varchar(200) NOT NULL, columns jsonb NOT NULL   -- bản chép từ loại báo giá, cùng ràng buộc hình dạng
  quote_date date NULL, valid_until date NULL
  client_name, client_contact, client_company varchar(200); client_phone varchar(30); client_email varchar(254);
  client_address varchar(500); project_name varchar(200)              -- NULL được
  quoter_name varchar(200) NOT NULL; quoter_title varchar(120); quoter_phone varchar(30); quoter_email varchar(254)
  intro varchar(300) NOT NULL DEFAULT '', terms varchar(4000) NOT NULL DEFAULT '', payment_info varchar(2000) NOT NULL DEFAULT ''
  subtotal_vnd, base8_vnd, base10_vnd, vat8_vnd, vat10_vnd, total_vnd   bigint NOT NULL DEFAULT 0
  note varchar(2000) NULL (nội bộ, không in), reject_reason varchar(500) NULL
  created_by NOT NULL, created_at, updated_at, sent_by, sent_at, decided_by, decided_at

quote_line
  id uuid PK, quote_version_id uuid NOT NULL → quote_version ON DELETE RESTRICT
  line_no smallint NOT NULL (1..300)                     UNIQUE (quote_version_id, line_no) DEFERRABLE INITIALLY DEFERRED
  kind quote_line_kind NOT NULL DEFAULT 'ITEM'           -- ITEM | SECTION
  description varchar(500) NOT NULL (không rỗng), unit varchar(30) NOT NULL DEFAULT '', note varchar(200) NULL
  extra jsonb NOT NULL DEFAULT '{}'                      -- { <key của cột riêng>: chữ ≤ 200 ký tự }; tối đa 10 khoá
  quantity numeric(12,3) NULL, unit_price_vnd bigint NULL, vat_percent smallint NULL, amount_vnd bigint NULL
```

`opportunity` **không thêm cột nào**; chỉ thêm chỉ mục `UNIQUE (id, customer_id)` làm đích cho khoá ngoại kép (`main` chưa có chỉ mục này; cùng cách `contact_id_customer_id_key` của S2 [Mã hiện có]). `customer_id` của cơ hội đã bất biến bằng trigger S2 [Mã hiện có].

### 5.2 CHECK và chỉ mục duy nhất

| Mã | Ràng buộc |
|---|---|
| C-1 | `quote_line` kiểu `ITEM`: `0 < quantity ≤ 999999.999`; `0 ≤ unit_price_vnd ≤ 999999999999`; `vat_percent IN (8, 10)`; `amount_vnd = round(quantity * unit_price_vnd)` (`round` của `numeric`: 0,5 ra xa 0) |
| C-1b | `quote_line` kiểu `SECTION`: `quantity`, `unit_price_vnd`, `vat_percent`, `amount_vnd` đều NULL; `unit = ''`; `extra = '{}'` |
| C-2 | `quote_version`: sáu cột tổng ≥ 0; `subtotal_vnd = base8_vnd + base10_vnd`; `subtotal_vnd ≤ 9000000000000000` |
| C-3 | `quote_version`: `vat8_vnd = (base8_vnd * 8 + 50) / 100`; `vat10_vnd = (base10_vnd * 10 + 50) / 100` (chia nguyên `bigint`); `total_vnd = subtotal_vnd + vat8_vnd + vat10_vnd` |
| C-4 | `quote_version`: `status ≠ 'DRAFT'` ⇒ `quote_date`, `valid_until`, `sent_by`, `sent_at` có giá trị và `valid_until ≥ quote_date` |
| C-5 | `quote_version`: `status IN ('ACCEPTED','REJECTED')` ⇔ `decided_by`, `decided_at` có giá trị; `REJECTED` ⇒ `reject_reason` không rỗng; trạng thái khác ⇒ `reject_reason` NULL |
| C-6 | `columns` (ở cả `quote_template` và `quote_version`): là mảng JSON 0..10 phần tử đúng hình dạng 5.1 — kiểm bằng hàm `fn_quote_columns_ok(jsonb)` IMMUTABLE trong CHECK |
| C-7 | `quote_line.extra`: là đối tượng JSON, tối đa 10 khoá, mỗi giá trị là chuỗi ≤ 200 ký tự (hàm IMMUTABLE trong CHECK). Việc "khoá phải thuộc danh sách cột của phiên bản" kiểm ở trigger R-Q10 (cần đọc dòng cha) |
| U-1 | Mỗi báo giá tối đa một nháp: `UNIQUE (quote_id) WHERE status = 'DRAFT'` |
| U-2 | Mỗi báo giá tối đa một bản được chấp nhận: `UNIQUE (quote_id) WHERE status = 'ACCEPTED'` |
| U-3 | Mỗi cơ hội tối đa một báo giá đang theo đuổi: `UNIQUE (opportunity_id) WHERE is_primary AND deleted_at IS NULL` |

### 5.3 Trigger (tên dự kiến; đều `SECURITY INVOKER`, `search_path` cố định)

| Mã | Trigger | Hành vi |
|---|---|---|
| R-Q2a | `quote_version` BEFORE UPDATE | `OLD.status ≠ 'DRAFT'` ⇒ **chỉ** cho đổi `status`, `decided_by`, `decided_at`, `reject_reason`, `updated_at`; cột khác đổi ⇒ lỗi `QUOTE_VERSION_LOCKED`. So sánh `IS DISTINCT FROM` trên **toàn bộ** cột còn lại, liệt kê tường minh (test chốt: thêm cột mà quên đưa vào danh sách thì test đỏ) |
| R-Q2b | `quote_version` BEFORE DELETE | Chỉ xoá được nháp |
| R-Q2c | `quote_line` BEFORE INSERT / UPDATE / DELETE | `SELECT status, columns FROM quote_version WHERE id = … FOR SHARE` (khoá dòng cha) ⇒ khác `DRAFT` thì lỗi `QUOTE_VERSION_LOCKED`. `quote_version_id` bất biến |
| R-Q10 | `quote_line` BEFORE INSERT / UPDATE (cùng hàm với R-Q2c) | Mọi khoá của `extra` phải nằm trong `columns` của phiên bản cha |
| R-Q11 | `quote_version` BEFORE UPDATE khi đổi `columns` (chỉ xảy ra ở nháp) | Không còn dòng hàng nào có khoá `extra` ngoài danh sách cột mới |
| R-Q3 | `quote_version` BEFORE UPDATE | Chuyển trạng thái hợp lệ: `DRAFT → SENT`; `SENT → ACCEPTED \| REJECTED`. Mọi chuyển khác ⇒ lỗi |
| R-Q1 | `quote_version` BEFORE UPDATE khi `NEW.status = 'SENT'` | Khoá mọi dòng của phiên bản `FOR UPDATE`; yêu cầu **≥ 1 dòng kiểu `ITEM`**; tính lại tổng `amount_vnd` theo từng mức VAT và so với `NEW.base8_vnd`, `NEW.base10_vnd`; lệch ⇒ lỗi `QUOTE_TOTAL_MISMATCH`. (C-2, C-3 bảo đảm phần còn lại của chuỗi tổng) |
| R-Q4 | `quote` BEFORE UPDATE | `code`, `opportunity_id`, `customer_id`, `template_id`, `created_by`, `created_at` bất biến |
| R-Q5 | `quote` BEFORE UPDATE khi bật `is_primary` | Phải có ít nhất một phiên bản không phải nháp |
| R-Q7 | `quote_version` BEFORE UPDATE khi `NEW.status = 'ACCEPTED'` [QB6, QB7] | Cơ hội đã có báo giá khác được chấp nhận ⇒ lỗi `QUOTE_ALREADY_ACCEPTED`; báo giá này phải đang là `is_primary` (ứng dụng đặt trong cùng transaction) |
| R-Q8 | `quote` BEFORE UPDATE khi đổi `is_primary` | Cơ hội đã có báo giá được chấp nhận ⇒ không đổi được [QB6] |
| R-Q9 | `quote` xoá mềm | Chỉ khi không có phiên bản nào khác `DRAFT`; app không có quyền DELETE cứng |
| R-Q12 | `quote_template` BEFORE DELETE | Luôn từ chối (ngừng dùng bằng `is_active`) |

**Vì sao không còn khe hở khi chạy đồng thời.** Lệnh gửi là một câu `UPDATE quote_version SET status = 'SENT' …`, giữ khoá ghi trên dòng phiên bản tới hết transaction:
- Một người đang **thêm / sửa / xoá dòng** giữ khoá `FOR SHARE` trên dòng phiên bản (R-Q2c) ⇒ lệnh gửi phải chờ; khi được chạy, R-Q1 đếm và cộng lại trên dữ liệu đã chốt ⇒ thiếu dòng hoặc lệch tổng thì từ chối.
- Ngược lại, lệnh gửi chạy trước ⇒ lệnh sửa dòng chờ, rồi đọc thấy `SENT` ⇒ bị từ chối.
- Hai lệnh đổi trạng thái cùng lúc trên một phiên bản: lệnh sau chờ, rồi R-Q3 xét trên trạng thái mới ⇒ từ chối.
- Hai người cùng tạo nháp cho một báo giá: U-1 từ chối người sau (409 `QUOTE_DRAFT_EXISTS`).
- R-Q7 không tự khoá thêm dòng nào theo thứ tự mới: nó dựa vào khoá `FOR UPDATE` trên **dòng cơ hội** mà mọi thao tác ghi báo giá đã giữ từ đầu transaction (mục 8.1). Lưới chặn cuối ở DB cho trường hợp ghi thẳng không qua ứng dụng: R-Q7 đọc lại bằng `FOR SHARE` trên các `quote` của cơ hội theo thứ tự `id` tăng dần.
- Số phiên bản: ứng dụng khoá dòng `quote` `FOR UPDATE` rồi lấy `max(version_no) + 1`; `UNIQUE (quote_id, version_no)` là lưới chặn cuối.

Bản nháp cho phép tổng tạm lệch dòng hàng **bên trong** một transaction lưu; điểm chốt bắt buộc là R-Q1 lúc gửi. Ứng dụng luôn tính lại tổng ở mỗi lần lưu (mục 6).

**"Hết hiệu lực" không lưu trong DB**: phiên bản `SENT` có `valid_until` < hôm nay (ngày theo giờ Việt Nam). Danh sách và bộ lọc dùng **cùng một biểu thức SQL** ở máy chủ.

## 6. Tính tiền [QB11, QB12, QB13; QO14 chờ]

Đơn vị: **đồng, số nguyên**. Đơn giá là giá **trước VAT**. Không có chiết khấu ở đợt này.

| Bước | Công thức | Làm tròn |
|---|---|---|
| Thành tiền dòng | `quantity × unit_price_vnd` | Tới đồng, **0,5 làm tròn lên** |
| Tiền hàng theo mức thuế (`base8_vnd`, `base10_vnd`) | tổng thành tiền các dòng có cùng mức VAT | — |
| Tổng trước VAT (`subtotal_vnd`) | `base8 + base10` | — |
| VAT 8 % (`vat8_vnd`), VAT 10 % (`vat10_vnd`) | `base × mức thuế / 100`, tính **trên tổng của từng mức**, không tính từng dòng rồi cộng | Tới đồng, **0,5 làm tròn lên** |
| Tổng sau VAT (`total_vnd`) | `subtotal + vat8 + vat10` | — |

- **Số lượng**: tối đa 3 chữ số thập phân, `0 < SL ≤ 999 999,999`. Nhập nhiều hơn 3 chữ số thập phân ⇒ từ chối (không tự làm tròn số lượng).
- **Đơn giá**: số nguyên, `0 ≤ đơn giá ≤ 999 999 999 999`. Đơn giá 0 được phép (hàng tặng kèm).
- **Giới hạn**: `subtotal ≤ 9 000 000 000 000 000`. Tổng sau VAT lớn nhất `9,9 × 10¹⁵` vượt ngưỡng số nguyên an toàn của JavaScript (`9 007 199 254 740 991`) ⇒ **mọi số tiền đi qua API ở dạng chuỗi số**, như `money()` của cơ hội [Mã hiện có]; giao diện chỉ định dạng, không dùng kết quả tự tính làm số chính thức.
- **Máy chủ tính bằng số nguyên chính xác** (`BigInt`): số lượng đổi sang phần nghìn `q = SL × 1000`; thành tiền `= (q × đơn giá + 500) div 1000`; VAT `= (base × p + 50) div 100`. Không dùng số thực ở bất kỳ bước nào. Máy chủ **bỏ qua** mọi tổng do trình duyệt gửi lên.
- **DB kiểm lại** bằng C-1, C-2, C-3 và R-Q1 (hai cách tính độc lập phải ra cùng số).
- **Giá trị đưa sang cơ hội** (D7) = `subtotal_vnd` (chưa VAT).

### 6.1 Bảng ví dụ tính tay (dùng làm test, mục 11 nhóm A)

| Ca | Dòng hàng (SL × đơn giá → thành tiền, mức VAT) | base8 | base10 | vat8 | vat10 | subtotal | total |
|---|---|---|---|---|---|---|---|
| A1 | 5 × 1 636 000 → 8 180 000; 5 × 1 722 000 → 8 610 000; 1 × 636 364 → 636 364; 1 × 1 500 000 → 1 500 000 (đều 10 %) | 0 | 18 926 364 | 0 | 1 892 636 (từ …636,4) | 18 926 364 | 20 819 000 |
| A2 | 2,5 × 333 333 → 833 333 (từ …332,5), 8 %; 1,005 × 999 → 1 004 (từ 1 003,995), 10 %; 237 × 17 000 → 4 029 000, 10 % | 833 333 | 4 030 004 | 66 667 (từ 66 666,64) | 403 000 (từ …000,4) | 4 863 337 | 5 333 004 |
| A3 | 1 × 125 → 125, 10 % | 0 | 125 | 0 | 13 (từ 12,5) | 125 | 138 |
| A4 | 1 × 32 → 32, 8 % | 32 | 0 | 3 (từ 2,56) | 0 | 32 | 35 |
| A5 | ba dòng 1 × 5 → 5, đều 10 % | 0 | 15 | 0 | **2** (từ 1,5; không phải 3 = làm tròn từng dòng) | 15 | 17 |
| A6 | 0,001 × 499 → 0 (từ 0,499); 0,001 × 500 → 1 (từ 0,5); đều 10 % | 0 | 1 | 0 | 0 (từ 0,1) | 1 | 1 |
| A7 | 999 999,999 × 999 999 999 999 → 999 999 998 999 000 000 (từ …000 000,001), 10 % | — | — | — | — | — | **từ chối**: vượt giới hạn subtotal |
| A8 | chỉ có một dòng tiêu đề nhóm, không có dòng hàng | — | — | — | — | — | **không gửi được** (`QUOTE_EMPTY`); lưu nháp được, mọi tổng = 0 |
| A9 | 1 × 100, 10 %, kèm dòng tiêu đề nhóm ở trên | 0 | 100 | 0 | 10 | 100 | 110 (dòng nhóm không ảnh hưởng tổng) |

## 7. Quyền và rò giá

### 7.1 Ma trận [Đề xuất; QO15, QO17 chờ]

Báo giá **đi theo cơ hội**: ai không thấy cơ hội trên **đường đầy đủ** thì không thấy báo giá (ngoài phạm vi trả 404, không trả 403).

| Mã | Quản trị CRM | Kinh doanh | Kỹ thuật | Kế toán | Quản trị hệ thống |
|---|---|---|---|---|---|
| `quote.read` | tất cả | cơ hội mình **thấy được** theo SALES 5.1 | — | tất cả | — |
| `quote.create` / `quote.update` | tất cả | chỉ cơ hội mình **phụ trách** | — | — | — |
| `quote.send` (Đã gửi, chọn đang theo đuổi) | tất cả | chỉ cơ hội mình phụ trách | — | — | — |
| `quote.decide` (Được chấp nhận / Bị từ chối) | tất cả | chỉ cơ hội mình phụ trách | — | — | — |
| `quote.delete` (nháp / báo giá chưa gửi) | tất cả | chỉ cơ hội mình phụ trách | — | — | — |
| `quote.export` (tải PDF / Excel) [QO17] | tất cả | chỉ cơ hội mình phụ trách | — | — | — |
| `quote.template` (thêm / sửa loại báo giá) [QO15] | có | — | — | — | — |

- Đọc danh sách loại báo giá đang dùng (để chọn khi lập) và sửa **mặc định cá nhân của chính mình**: mọi người có `quote.create`.
- Dùng lại RBAC và vị từ phạm vi hiện có: mọi đường đọc báo giá (kể cả tải tệp) đi qua **đúng một hàm** = mã quyền tương ứng **VÀ** vị từ "đường đầy đủ" của cơ hội (`fullReadWhere` [Mã hiện có]). **Không** dùng "đường theo việc" (`taskPathWhere`). Quyền ghi và quyền tải kiểm theo `owner_id` của cơ hội như `opportunity.update`. Mỗi mã cấp riêng.
- `fn_auth_perm_class` xếp thêm tiền tố `quote.` vào nhóm BIZ ⇒ rào SoD của M1 chặn ở DB việc cấp bất kỳ mã `quote.*` nào cho vai trò `admin` (cùng cách S5).
- Cấp quyền trên DB đã bootstrap: script hai người + script gỡ + diễn tập CI (mẫu `SALES_S5_OPPORTUNITY_PERMISSIONS`). Grants cho `siscom_app`: INSERT / UPDATE `quote`, `quote_version`, `quote_template`, `quote_user_default`; INSERT / UPDATE / DELETE `quote_line`; không DELETE trên bốn bảng còn lại. `siscom_auth`, `siscom_acct`: **không có quyền nào** trên năm bảng.

### 7.2 Rà các đường có thể lộ giá gián tiếp

| Đường | Hiện trạng / cách xử lý | Test |
|---|---|---|
| API báo giá (danh sách, chi tiết, theo cơ hội, giá trị điền sẵn) | Hàm kiểm duy nhất ở 7.1 | C1–C3 |
| **Xem bản in** | Trang giao diện dựng từ `GET /quotes/:id`; không quyền ⇒ trang "không có quyền", không gọi API nào | C4 |
| **Tải PDF / Excel** | Tệp do máy chủ dựng theo từng yêu cầu, **không lưu thành tệp tĩnh**, không có đường dẫn công khai; kiểm `quote.export` + phạm vi ở mỗi lần tải; phản hồi kèm `Cache-Control: no-store`; nhật ký `QUOTE_EXPORT` (ai, báo giá nào, định dạng — không có số tiền) | C11 |
| Chi tiết cơ hội của Kỹ thuật | `toOpportunityTechDetail` liệt kê tường minh từng trường, không có giá trị [Mã hiện có]; báo giá **không** được thêm vào đường này (test `TECH_KEYS` hiện có sẽ đỏ nếu ai thêm) | C5 |
| Giá trị cơ hội (sau khi đồng bộ) | Chỉ trả trên đường đầy đủ [Mã hiện có] | C5 |
| Lịch sử thay đổi cơ hội (`/changes`, có dòng `AMOUNT` do đồng bộ sinh ra) | Chỉ đường đầy đủ [Mã hiện có]. Lý do ghi kèm: `Theo báo giá BG-0012 v2` — có mã, không lặp lại số tiền | C6 |
| Tài liệu cơ hội | Đường theo việc chỉ thấy loại `TECHNICAL` [Mã hiện có]. Báo giá **không** sinh dòng `opportunity_document` nào | C7 |
| Tổng theo cột kanban, số đếm, tìm kiếm cơ hội | Chỉ đường đầy đủ [Mã hiện có] | C5 |
| Hoạt động / công việc | Đợt 1 **không tự sinh** hoạt động hay công việc từ báo giá | C8 |
| Tìm kiếm chung | Báo giá không được lập chỉ mục | C8 |
| Loại báo giá, mặc định cá nhân | Không chứa giá của báo giá nào. Loại báo giá chỉ đọc được khi có `quote.create` hoặc `quote.template`; mặc định cá nhân chỉ chủ của nó đọc được | C12 |
| Nhật ký hệ thống (`audit_log`) | Ghi hành động và mã định danh, **không ghi số tiền, không ghi nội dung dòng hàng** | C9 |
| Thông báo lỗi | Lỗi ràng buộc DB đổi thành mã lỗi cố định; không trả nguyên văn lỗi PostgreSQL | C9 |
| Mã `BG-…` liên tục | Lộ **số lượng** báo giá (không lộ giá). Chấp nhận, giống `CH-…`, `KH-…` | — |
| Kết nối DB khác | `siscom_auth`, `siscom_acct` không có quyền trên năm bảng | B8 |

## 8. Quy tắc nghiệp vụ [Đề xuất, trừ chỗ ghi mã QB]

1. **Tạo báo giá** từ một cơ hội đang mở (`OPEN`): chọn loại báo giá (đang dùng), nhập hạng mục ⇒ sinh mã và phiên bản 1 (Nháp); các ô ở 4.3 được điền sẵn. Cơ hội Tạm hoãn / Thắng / Thua: không tạo mới, vẫn xem và tải được.
2. **Soạn nháp**: thêm, sửa, xoá, đổi thứ tự dòng hàng và dòng tiêu đề nhóm; mức VAT từng dòng (mặc định theo loại); giá trị các cột riêng; sửa các ô đầu trang, câu chào, điều khoản, thông tin tài khoản [QB15]. Lưu là **một transaction**, máy chủ tính lại mọi tổng. Loại báo giá của một báo giá **không đổi được** sau khi tạo (cần loại khác thì lập báo giá mới).
3. **Xem bản in / tải PDF / tải Excel**: mọi phiên bản; nháp có chữ chìm và hậu tố `_NHAP`.
4. **Đánh dấu Đã gửi** [QB1]: cần ≥ 1 dòng hàng, ngày báo giá (không ở tương lai), hạn hiệu lực ≥ ngày báo giá. Phiên bản bị khoá (R-Q2).
5. **Tạo bản mới**: chép toàn bộ nội dung phiên bản mới nhất (dòng hàng, các ô đầu trang, tiêu đề và danh sách cột **của phiên bản đó**) thành phiên bản kế tiếp, Nháp; `print_template` lấy bố cục hiện hành. Chỉ khi báo giá chưa có nháp và chưa được chấp nhận.
6. **Kết quả**: "Được chấp nhận" hoặc "Bị từ chối" (bắt buộc lý do) cho phiên bản đã gửi **mới nhất** của báo giá. Quá hạn hiệu lực vẫn ghi "Được chấp nhận" được, kèm cảnh báo [QB10]. Được chấp nhận **không** tự chốt Thắng cơ hội (D3); giao diện hiện lối tắt "Chốt Thắng cơ hội".
7. **Báo giá đang theo đuổi**: báo giá đầu tiên được gửi của một cơ hội tự thành "đang theo đuổi"; người phụ trách đổi sang báo giá khác đã có phiên bản gửi. Khi một phiên bản được chấp nhận ⇒ báo giá đó thành "đang theo đuổi" và cố định [QB6, QB7].
8. **Đồng bộ giá trị cơ hội** (D7) — ở đúng ba sự kiện: (a) gửi một phiên bản của báo giá đang theo đuổi; (b) đổi báo giá đang theo đuổi; (c) chấp nhận một phiên bản. Khi đó `opportunity.expected_amount_vnd` **được gán bằng** `subtotal_vnd` (chưa VAT) của **phiên bản đã gửi mới nhất** của báo giá đang theo đuổi — phép **gán**, không cộng.
   - Cơ hội không ở `OPEN` ⇒ không đồng bộ.
   - Giá trị không đổi ⇒ không ghi lịch sử, không tăng `version`.
   - Giá trị đổi ⇒ thêm dòng `opportunity_change` (`field = AMOUNT`, cũ → mới, lý do `Theo báo giá BG-… v…`, người thực hiện = người bấm) và tăng `opportunity.version` thêm 1.
   - **Sửa tay giá trị cơ hội** [QB5]: vẫn được, theo đường ghi hiện có. Sự kiện (a) / (b) / (c) kế tiếp ghi đè và để lại lịch sử. Nhãn cạnh ô giá trị: "theo báo giá BG-… v…" khi giá trị cơ hội bằng giá trị phiên bản nói trên, "đã sửa tay, khác báo giá" khi khác. Nhãn tính lúc đọc, **không thêm cột** vào `opportunity`.
9. **Xoá**: xoá mềm nháp, hoặc cả báo giá khi chưa có phiên bản nào đã gửi (R-Q9).
10. **Loại báo giá**: thêm, sửa tên / tiêu đề / câu chào / điều khoản mặc định / số ngày / VAT mặc định / danh sách cột; ngừng dùng (không xoá). Sửa loại **không** đổi báo giá đã lập (4.3); nháp đang soạn giữ danh sách cột lúc nó được tạo.
11. **Mặc định cá nhân** [QB15]: mỗi nhân viên tự lưu chức vụ, điện thoại, email và **thông tin tài khoản** của mình để điền sẵn vào báo giá mới; sửa lại được trên từng báo giá.
12. Giới hạn: tối đa 300 dòng mỗi phiên bản, 999 phiên bản mỗi báo giá, 10 cột riêng mỗi loại, 200 loại báo giá.

### 8.1 Khoá và xung đột khi nhiều người thao tác

- **Thứ tự khoá cố định** cho mọi thao tác ghi báo giá: khách `FOR SHARE` → cơ hội `FOR UPDATE` → `quote` `FOR UPDATE` → `quote_version`. Hai bước đầu là đúng khuôn của đường ghi cơ hội [Mã hiện có], nên báo giá và cơ hội không khoá chéo nhau. Loại báo giá và mặc định cá nhân chỉ được **đọc** (không khoá) trong các transaction này.
- Vì mọi thao tác ghi báo giá đều giữ khoá `FOR UPDATE` trên **dòng cơ hội**, hai người cùng gửi, cùng đổi báo giá đang theo đuổi, cùng chấp nhận, hoặc một người gửi trong lúc người khác sửa cơ hội, đều chạy **lần lượt**.
- **Khoá lạc quan**: mọi yêu cầu ghi gửi kèm `version` của `quote`; lệch ⇒ 409 `VERSION_CONFLICT`. Mọi thay đổi trên báo giá đều tăng `quote.version`. Loại báo giá có `version` riêng.
- Người đang mở form sửa cơ hội trong lúc báo giá vừa đồng bộ giá trị ⇒ khi lưu nhận 409 của cơ hội (vì `opportunity.version` đã tăng).

| Tình huống | Kết quả |
|---|---|
| A và B cùng bấm "Đánh dấu đã gửi" một phiên bản | Một người thành công; người kia 409 `VERSION_CONFLICT` |
| A gửi báo giá X, B cùng lúc đổi đang theo đuổi sang Y (cùng cơ hội) | Chạy lần lượt; giá trị cơ hội cuối cùng = phiên bản gửi mới nhất của báo giá đang theo đuổi cuối cùng |
| A lưu nháp, B cùng lúc gửi chính nháp đó | Chạy lần lượt (5.3); người sau 409 hoặc `QUOTE_VERSION_LOCKED` |
| A chấp nhận báo giá X, B cùng lúc chấp nhận báo giá Y (cùng cơ hội) | Một người thành công; người kia `QUOTE_ALREADY_ACCEPTED` |
| A sửa tay giá trị cơ hội, B cùng lúc gửi báo giá đang theo đuổi | Chạy lần lượt trên khoá dòng cơ hội; người lưu sau với `version` cũ nhận 409 |
| Quản trị sửa loại báo giá, A cùng lúc tạo báo giá từ loại đó | A nhận bản chép của loại ở thời điểm transaction của A đọc; không trạng thái lai |

## 9. API [Đề xuất] (`/api/v1`, cookie + Origin + CSRF như hiện nay, bọc `{ data }`)

**Báo giá:** `GET /quotes` (lọc trạng thái gồm "hết hiệu lực" và "sắp hết hạn ≤ 7 ngày", loại, người phụ trách cơ hội, khách; tìm theo mã / hạng mục / tên khách không phân biệt dấu; phân trang) · `GET /opportunities/:id/quotes` · `GET /quotes/:id` (mọi phiên bản, dòng, `suggestedFileName`) · `GET /opportunities/:id/quotes/defaults?templateId=` · `POST /opportunities/:id/quotes` · `PATCH /quotes/:id` (hạng mục; có `version`) · `PUT /quotes/:id/versions/:no` (lưu cả nháp) · `POST /quotes/:id/versions` (tạo bản mới) · `POST /quotes/:id/versions/:no/send` · `…/accept` · `…/reject` · `POST /quotes/:id/primary` · `DELETE /quotes/:id/versions/:no` (nháp) · `DELETE /quotes/:id` (chưa gửi).
**Tệp:** `GET /quotes/:id/versions/:no/export?format=pdf|xlsx` (trả tệp, `Content-Disposition` theo 4.4).
**Loại báo giá:** `GET /quotes/templates` (đang dùng; thêm `?all=1` khi có `quote.template`) · `POST /quotes/templates` · `PATCH /quotes/templates/:id` (có `version`).
**Mặc định cá nhân:** `GET /quotes/my-defaults` · `PUT /quotes/my-defaults`.

Mã lỗi: 400 dữ liệu sai (`AMOUNT_OUT_OF_RANGE`, `QUANTITY_PRECISION`, `VAT_NOT_ALLOWED`, `UNKNOWN_COLUMN`…), 403 thấy được nhưng không có quyền, 404 ngoài phạm vi xem, 409 `VERSION_CONFLICT` / `QUOTE_VERSION_LOCKED` / `QUOTE_DRAFT_EXISTS` / `QUOTE_ALREADY_ACCEPTED` / `QUOTE_PRIMARY_FIXED`, 422 `OPPORTUNITY_NOT_OPEN` / `QUOTE_EMPTY` / `TEMPLATE_INACTIVE`.

## 10. Màn hình

- **Tab "Báo giá" trong chi tiết cơ hội**: mỗi báo giá một khối — mã, loại, hạng mục, nhãn "Đang theo đuổi", bảng phiên bản (số, trạng thái, tổng trước VAT, ngày, hạn). Nút: Thêm báo giá, Soạn, Xem bản in, Tải PDF, Tải Excel, Đánh dấu đã gửi, Tạo bản mới, Kết quả, Chọn đang theo đuổi.
- **Màn hình soạn**: hai khối đầu trang; bảng dòng hàng nhập trực tiếp với các cột riêng của loại (thêm dòng hàng / dòng nhóm, xoá, đổi thứ tự, chọn VAT từng dòng); các dòng tổng; câu chào, điều khoản, thông tin tài khoản. Điện thoại: mỗi dòng một thẻ.
- **Trang "Báo giá"** (mục đã có trên thanh bên): danh sách, lọc, tìm; cột hạn hiệu lực có nhãn "Còn n ngày" / "Hết hiệu lực".
- **Loại báo giá** (người có `quote.template`): danh sách loại; form sửa gồm tên, tiêu đề, câu chào, điều khoản mặc định, số ngày, VAT mặc định và **bảng cột riêng** (thêm, đổi tên, đổi thứ tự, xoá); xem trước bố cục bảng hàng.
- **Mặc định của tôi**: chức vụ, điện thoại, email, thông tin tài khoản.
- Vai trò không có `quote.read`: không có mục "Báo giá", không có tab, gõ thẳng địa chỉ ⇒ trang "không có quyền" và **không gọi API**. Dùng thành phần giao diện hiện có; ô tiền dùng lại `AmountInput`.

## 11. Nghiệm thu

Mỗi ca ghi PASS / FAIL kèm bằng chứng. Ca FAIL chặn merge PR chứa nó.

**A. Tính tiền** (Q5)
- A1–A9: chín ca của bảng 6.1 ra đúng từng số, ở **cả hai** nơi: máy chủ (BigInt) và DB (chèn trực tiếp số sai ⇒ CHECK / trigger từ chối).
- A10: máy chủ bỏ qua tổng do trình duyệt gửi lên. A11: số lượng 4 chữ số thập phân, số âm, đơn giá lẻ, VAT khác 8 / 10, chữ thay số ⇒ 400, không lưu gì.
- A12: tiền trả về ở dạng chuỗi số; giá trị vượt ngưỡng số nguyên an toàn của JavaScript vẫn đúng từng chữ số.

**B. Database và trigger** (Q2; bài kiểm SQL chạy trong CI bằng `siscom_app`)
- B1: phiên bản đã gửi — UPDATE **lần lượt mọi cột** nội dung, DELETE ⇒ từ chối. B2: INSERT / UPDATE / DELETE dòng của phiên bản đã gửi, chuyển dòng sang phiên bản khác ⇒ từ chối.
- B3: gửi phiên bản không có dòng hàng (kể cả chỉ có dòng nhóm) ⇒ từ chối. B4: gửi khi `base8_vnd` / `base10_vnd` lệch tổng dòng ⇒ từ chối.
- B5: mọi chuyển trạng thái ngoài R-Q3 ⇒ từ chối. B6: U-1, U-2, U-3 và khoá ngoại kép ⇒ từ chối.
- B7: các cột bất biến của `quote` (kể cả `template_id`); bật `is_primary` khi chưa có phiên bản gửi; R-Q7, R-Q8.
- B8: `siscom_app` không DELETE được `quote`, `quote_version`, `quote_template`; `siscom_auth`, `siscom_acct` không SELECT được năm bảng; vai trò `admin` không nhận được mã `quote.*` (SoD).
- B9: danh sách cột của R-Q2a khớp `information_schema`.
- B10: `columns` sai hình dạng (11 cột, key trùng, key sai mẫu, nhãn quá dài) ⇒ từ chối; `extra` có khoá ngoài danh sách cột, quá 10 khoá, giá trị không phải chuỗi ⇒ từ chối; đổi `columns` của nháp khi còn dòng dùng khoá bị bỏ ⇒ từ chối; dòng nhóm có số tiền ⇒ từ chối.

**C. Bảo mật** (Q4–Q6, Q9, Q10; ma trận 5 vai trò)
- C1: mỗi endpoint đọc × 5 vai trò × {phụ trách, chỉ xem, ngoài phạm vi} đúng 7.1. C2: mỗi endpoint ghi tương tự.
- C3: Kỹ thuật có công việc đang mở trên cơ hội: **mọi** endpoint báo giá ⇒ 404; chi tiết cơ hội đường theo việc không có khoá nào mới (`TECH_KEYS`).
- C4: xem bản in không quyền ⇒ trang "không có quyền", 0 lời gọi API báo giá (Chrome thật).
- C5: sau khi đồng bộ giá trị, đường theo việc vẫn không có giá trị, tổng cột, số đếm. C6: dòng `AMOUNT` chỉ thấy trên đường đầy đủ.
- C7: không có dòng `opportunity_document` nào do báo giá sinh ra. C8: không có hoạt động / công việc / kết quả tìm kiếm chung nào chứa dữ liệu báo giá.
- C9: `audit_log` không chứa số tiền hay nội dung dòng hàng; lỗi DB trả mã cố định.
- C10: thu hồi `quote.read` hoặc `quote.export` giữa phiên ⇒ lần gọi kế tiếp bị từ chối.
- C11: tải PDF / Excel × 5 vai trò × 3 phạm vi đúng 7.1; phản hồi có `Cache-Control: no-store`; có dòng `QUOTE_EXPORT`; không có tệp nào còn lại trên đĩa máy chủ sau khi tải.
- C12: loại báo giá và mặc định cá nhân: người không có quyền ⇒ 403 / 404; không ai đọc hay sửa được mặc định cá nhân của người khác.
- C13: tệp Excel — ô chữ bắt đầu bằng `=`, `+`, `-`, `@`, và chuỗi dạng `=HYPERLINK(…)` được ghi là **chữ**, mở tệp không có công thức nào (kiểm bằng cách đọc lại tệp).

**D. Đồng thời** (Q5; hai kết nối thật, mẫu `concurrency.int-spec`)
- D1–D6: sáu tình huống của bảng 8.1, mỗi tình huống lặp 20 lần, không có lần nào ra trạng thái sai.
- D7: sau mọi tình huống, giá trị cơ hội = `subtotal_vnd` của phiên bản đã gửi mới nhất của báo giá đang theo đuổi; số dòng lịch sử `AMOUNT` = số lần giá trị thực sự đổi.
- D8: gửi lần lượt v1 (100), v2 (150) ⇒ giá trị cơ hội 150, **không** 250. D9: sửa tay rồi gửi v3 ⇒ bị ghi đè, có lịch sử; nhãn đúng ở từng bước.
- D10: không có khoá chéo (deadlock) trong 200 lượt ghi xen kẽ báo giá và cơ hội.

**E. Bản in và tệp xuất** (Q8–Q10; Chrome thật và đọc lại tệp)
- E1: mỗi loại trong bốn loại ở 4.1 — báo giá 4 dòng vừa một trang, đối chiếu từng khối với tệp mẫu của công ty. E2: 60 dòng ⇒ nhiều trang, tiêu đề cột lặp lại, không dòng nào bị cắt đôi, khối ký và khối tài khoản nguyên vẹn. E3: 300 dòng, 10 cột riêng, nội dung dài ⇒ không tràn ngang (khổ ngang).
- E4: tải lại phiên bản đã gửi sau khi đổi khách hàng, nhân viên, hạng mục, **loại báo giá** (đổi tiêu đề, bỏ cột), mặc định cá nhân, và thêm bố cục in mới ⇒ nội dung **giống hệt** bản trước (so văn bản trích từ PDF và giá trị ô của Excel).
- E5: giao diện nền tối ⇒ bản in vẫn nền trắng. E6: nháp có chữ chìm và `_NHAP`; bản đã gửi không có.
- E7: tên tệp với tên có dấu, `đ/Đ`, ký tự `/ \ : * ? " < > |`, tên rỗng sau chuẩn hoá, tên 300 ký tự, phiên bản 1 và 2 ⇒ đúng 4.4.
- E8: nhập `<script>` và thẻ HTML vào mọi ô chữ ⇒ hiển thị nguyên văn trên màn hình, PDF và Excel.
- E9: PDF có đủ dấu tiếng Việt (trích văn bản ra so được với dữ liệu); tổng trong PDF và trong Excel **bằng** tổng API trả về, từng đồng.
- E10: báo giá có hai mức VAT ⇒ bảng có cột "VAT %", phần tổng có hai dòng VAT; chỉ một mức ⇒ không có cột "VAT %", chỉ một dòng VAT.

**F. Rollback và triển khai** (Q2, Q3, Q11)
- F1: script rollback gỡ sạch cấu trúc khi năm bảng rỗng (trừ dòng nạp sẵn "Báo giá chung"); **từ chối** khi có dữ liệu. F2: áp → gỡ → áp lại trong CI.
- F3: mã bản trước (không có Báo giá) chạy bình thường trên DB đã có migration này. F4: script cấp quyền chạy hai lần cho cùng kết quả; script gỡ quyền trả DB về trạng thái trước.
- F5: nghiệm thu trên máy chủ theo khuôn các lần trước: sao lưu + khôi phục thử trước migration, `--auto-rollback`, các bài VERIFY không có FAIL.
- F6: mỗi PR thêm thư viện (Q9, Q10): `npm audit` không có lỗ hổng mức cao trở lên do thư viện mới; ghi giấy phép và kích thước; lùi PR đó ⇒ phần còn lại của Báo giá vẫn chạy (chỉ mất nút tải tương ứng).

## 12. Kế hoạch PR nhỏ (Draft; ChatGPT review; Owner duyệt merge từng PR)

| PR | Nội dung | Phụ thuộc | PASS khi | Đụng DB? |
|---|---|---|---|---|
| **Q1** | Tài liệu này + chú thích đồng bộ trong `SALES_DESIGN.md` | — | Review không còn điểm chặn; Owner chốt QO9, QO14–QO18 | không |
| Q2 | Migration: 5 bảng, kiểu enum, hàm mã, hàm kiểm JSON, CHECK, trigger, `fn_auth_perm_class`; nạp "Báo giá chung"; rollback; bài kiểm cấu trúc | Q1 | Nhóm B, F1, F2 | chỉ PostgreSQL tạm của CI |
| Q3 | Grants + VERIFY; mã quyền `quote.*`, script hai người / gỡ / kiểm; ma trận `bootstrap.ts` | Q2 | B8, F4; VERIFY hiện có không đổi kết quả | chỉ CI |
| Q4 | Backend đọc: báo giá, loại báo giá, mặc định cá nhân, giá trị điền sẵn, hàm tên tệp | Q3 | C1, C3, C5–C9 (phần đọc), C12, E7 | không |
| Q5 | Backend ghi báo giá + tính tiền + đồng bộ giá trị cơ hội | Q4 | Nhóm A, C2, C10, nhóm D | không |
| Q6 | Backend ghi loại báo giá + mặc định cá nhân | Q4 | C12, B10 (qua API), D6 | không |
| Q7 | Giao diện: tab Báo giá + màn hình soạn (cột riêng, dòng nhóm, VAT theo dòng) | Q5 | Test giao diện; Chrome thật các luồng chính | không |
| Q8 | Giao diện: xem bản in, trang Báo giá, quản lý loại báo giá, mặc định của tôi, điện thoại | Q6, Q7 | E1–E3 (bản in), E5, E6, E8, E10, C4 | không |
| Q9 | Tải PDF: thêm **một** thư viện dựng PDF + phông chữ; endpoint xuất | Q5 | C11, E2–E4, E9 (PDF), F6 | không |
| Q10 | Tải Excel: thêm **một** thư viện dựng Excel; endpoint xuất | Q5 | C11, C13, E4, E9 (Excel), F6 | không |
| Q11 | Lên máy chủ | Q2–Q10 đã merge | F3, F5; Owner nghiệm thu | **Owner duyệt riêng từng bước** |

Mỗi PR tự đứng được: Q2, Q3 không đổi hành vi ứng dụng; Q4–Q6 thêm API chưa ai gọi; Q7, Q8 chỉ hiện với người có `quote.read`; Q9, Q10 độc lập với nhau và với giao diện (thiếu một trong hai thì chỉ thiếu nút tải tương ứng). Có thể lên máy chủ sau Q8 (xem bản in rồi in bằng trình duyệt) nếu Owner muốn dùng sớm trước khi có nút tải. Đường lùi: ưu tiên lùi mã, giữ cấu trúc cộng thêm.

## 13. Rủi ro

| Rủi ro | Xử lý |
|---|---|
| Sai số tiền | Số nguyên đồng; hai nơi tính độc lập; bảng 6.1 là test |
| Sửa được bản đã gửi qua một đường chưa tính tới | Chặn ở DB (5.3); B1, B2, B9 |
| Lộ giá cho vai trò không được xem, kể cả qua tệp tải về | Một hàm kiểm duy nhất; tệp dựng theo yêu cầu, không lưu; bảng 7.2; nhóm C |
| Hai người thao tác cùng lúc làm lệch giá trị cơ hội | Khoá dòng cơ hội theo thứ tự cố định; nhóm D |
| Bản in / tệp xuất lệch mẫu hoặc đổi theo thời gian | Mọi nội dung lưu theo phiên bản; bố cục có mã và không sửa; nhóm E |
| Thư viện mới mang lỗ hổng hoặc làm nặng hệ thống | Mỗi thư viện một PR riêng, có quét lỗ hổng, giấy phép, kích thước; lùi độc lập (F6) |
| Tệp Excel bị chèn công thức độc hại qua nội dung người dùng nhập | Mọi ô chữ ghi kiểu chuỗi, không công thức (4.4); C13 |
| Cột riêng tự do làm bảng quá rộng | Tối đa 10 cột, nhãn ≤ 40 ký tự; tự chuyển khổ ngang; E3 |
| Mẫu của công ty có điểm chưa hỗ trợ (giá đã gồm VAT, công thức tính giá từ giá vốn) | Ghi rõ ở mục 3 và QO16; làm sau |

## 14. Đối chiếu review R1 (24/11/2026, tại `c9cd4ca`) → mục sửa → ca nghiệm thu

| Mã | Nhận xét R1 | Trạng thái | Mục sửa | Ca |
|---|---|---|---|---|
| `PR266-R1-DB-01` | Hoàn thiện mô hình DB: trigger chống sửa sau gửi kể cả khi cập nhật đồng thời; không gửi được báo giá rỗng hoặc lệch tổng; khoá các trường ảnh hưởng bản in; unique, khoá ngoại, tranh chấp | **FIXED** | 5.1–5.3, 4.3 | B1–B10 |
| `PR266-R1-MONEY-01` | Chốt công thức, làm tròn 0,5 đồng, số lượng lẻ, giới hạn; số học chính xác; CHECK; bảng ví dụ và test | **FIXED** | 6, 6.1, C-1…C-3 | A1–A12 |
| `PR266-R1-SEC-01` | Kỹ thuật và Quản trị hệ thống không đọc được báo giá ở mọi đường, kể cả gián tiếp; dùng lại RBAC và phạm vi cơ hội | **FIXED** | 7.1, 7.2 | C1–C13, B8 |
| `PR266-R1-SYNC-01` | Chống hai người gửi / đổi đang theo đuổi cùng lúc; khoá, optimistic version, 409, lịch sử; không cộng dồn; sửa tay giá trị cơ hội | **FIXED** (Owner đã chốt QB5–QB7) | 8 (quy tắc 7, 8), 8.1 | D1–D10 |
| `PR266-R1-PRINT-01` | Lưu cố định dữ liệu in theo phiên bản; in lại không đổi; phân trang A4, bản dài, tên tệp | **FIXED** (Owner đã chốt QB4) | 4.3, 4.4 | E1–E10 |
| `PR266-R1-TEST-01` | Bổ sung test bảo mật, đồng thời, tiền, trigger, rollback, bản in; PR nhỏ, độc lập, có PASS/FAIL; đồng bộ `SALES_DESIGN.md` | **FIXED** | 11, 12; chú thích trong `SALES_DESIGN.md` | A–F |
| `PR266-R1-OWNER-01` | Giữ các điểm QO chờ Owner; đề xuất rõ quyết định mới; không tự ghi APPROVED / ACCEPTED | **FIXED** | 1, 2 | — |

## 15. Thay đổi ở v4 so với v3 (sau khi Owner trả lời ngày 24/11/2026)

| Trả lời / yêu cầu của Owner | Thay đổi trong tài liệu |
|---|---|
| QO1, QO2, QO3, QO5 theo đề xuất | Chuyển thành QB8, QB9, QB10, QB12 |
| QO4: VAT 8 hoặc 10 % | QB11. Bỏ mức 0 và 5 %. Vì mẫu ống gió vải của công ty dùng **cả hai mức trong một báo giá**, VAT chuyển từ "một mức cho cả báo giá" sang **theo từng dòng** (QO14 chờ Owner xác nhận); các cột tổng đổi thành `base8/base10/vat8/vat10`; bảng 6.1 viết lại |
| QO6: chưa cần chiết khấu | QB13. Bỏ cột `discount_vnd` và mọi quy tắc chiết khấu |
| QO7: nút tải PDF một chạm, chấp nhận thư viện | QB14. Thêm 4.4, endpoint xuất, `quote.export`, PR Q9; "xem bản in" giữ lại làm xem trước |
| QO8: mỗi nhân viên tự soạn | QB15. Bỏ bảng `quote_setting` (mẫu chung do Quản trị soạn); thêm `quote_user_default`; điều khoản mặc định đi theo loại báo giá, nhân viên sửa trên từng báo giá |
| Xuất được cả Excel | QB16. 4.4, PR Q10, ca C13 (chống chèn công thức), QO18 |
| Mỗi loại vật tư một mẫu; có phần điều chỉnh các loại báo giá | QB17. Thêm bảng `quote_template` (tiêu đề, cột riêng, điều khoản mặc định), bản chép vào phiên bản, `quote_line.extra`, dòng tiêu đề nhóm, màn hình quản lý, quyền `quote.template`, PR Q6; QO15 |
| (Tác giả phát hiện khi đọc các tệp mẫu) | Mẫu "linh kiện" ghi giá đã gồm VAT ⇒ QO16; các tệp có công thức tính giá từ giá vốn / tỷ giá ở cột ẩn ⇒ ghi rõ ngoài phạm vi (mục 3) |
| QO9 (giá vốn) | Owner chưa trả lời; giữ đề xuất "chưa lưu" |
