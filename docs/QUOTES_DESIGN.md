# Báo giá đợt 1 — lập báo giá ngay trên CRM: đặc tả v7 (PR Q1, 24/11/2026)

Trạng thái: **Draft; đã qua ba vòng review, chờ Owner duyệt.** Chưa có mã, chưa có migration. Nối tiếp `docs/SALES_DESIGN.md` (D10, D11, C11).
Nhãn nguồn: **[Owner]** = Owner đã chốt; **[Đề xuất]** = tác giả đề xuất, cần duyệt; **[Mã hiện có]** = đã đối chiếu mã trên `main` @ `15a60be`.
**Lịch sử:** v1 sổ báo giá. v2 lập báo giá trên CRM (QB3). v3 xử lý review R1 (mục 14). **v4: Owner trả lời QO1–QO9 và yêu cầu thêm** — nhiều loại báo giá (mỗi loại vật tư một mẫu), có màn hình điều chỉnh các loại báo giá, xuất PDF một chạm và Excel, VAT 8 / 10 %, bỏ chiết khấu, mỗi nhân viên tự soạn điều khoản (mục 15). **v5: Owner chốt nốt QO9, QO14–QO18** — VAT một mức cho cả báo giá theo mặc định, loại báo giá nào cần thì bật VAT theo từng dòng; Kế toán được tải tệp; Excel có công thức; lưu giá vốn từng dòng với quyền xem riêng (mục 16). **v6: xử lý review R2** — điểm khoá chung cho R-Q7 / R-Q8 và chỉ mục duy nhất U-4, bảo vệ `created_by`, đường nhập tiền không qua số thực, thêm ca nghiệm thu, đồng bộ `SALES_DESIGN.md` với QB23 (mục 17). **v7: xử lý review R3** — `accepted_opportunity_id` do DB tự xác lập và bất biến (R-Q14, R-Q15, ca B16); bỏ các câu khẳng định tuyệt đối về khoá chéo (mục 18). Tác giả đã đọc bố cục năm tệp mẫu của công ty để thiết kế; dữ liệu thật của các tệp đó không nằm trong kho mã.

## 0. Tóm tắt cho người không chuyên

- Nhân viên kinh doanh **lập báo giá ngay trong CRM**: chọn **loại báo giá** (ví dụ gas lạnh, ống gió vải, quạt thông gió), nhập từng dòng hàng; CRM tự tính thành tiền, VAT và tổng.
- Mỗi loại báo giá có **tiêu đề, các cột riêng và điều khoản mặc định riêng**. Có màn hình để thêm và sửa các loại báo giá.
- Tải báo giá về bằng **một nút: PDF hoặc Excel**; tên tệp tự đặt theo mẫu Owner yêu cầu.
- Đã gửi khách thì **khoá, không sửa được**; đổi giá thì bấm "Tạo bản mới". Bản đã gửi tải lại lúc nào cũng ra đúng nội dung lúc gửi.
- Giá trị của cơ hội tự đi theo **báo giá đang theo đuổi**, không cộng dồn.
- Người lập nhập được **giá vốn** từng dòng để xem lãi gộp; giá vốn chỉ Quản trị CRM và chính người lập thấy, không bao giờ in ra hay xuất ra tệp.
- Chưa làm đợt này: danh mục thiết bị và bảng giá để chọn nhanh, công thức tính giá từ giá vốn và tỷ giá, chiết khấu, duyệt giá, gửi email cho khách từ CRM.

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
| QB6 | Chỉ chấp nhận được phiên bản của báo giá **đang theo đuổi**; khi một phiên bản được chấp nhận, báo giá đang theo đuổi đó được **giữ nguyên và cố định** (thao tác chấp nhận không tự chọn / chuyển báo giá đang theo đuổi — theo R-Q7 bước 3, diễn giải triển khai Owner xác nhận ngày 25/11/2026, xem mục 22 điểm 2); cần sửa thì lập báo giá mới | Owner, 24/11/2026; làm rõ 25/11/2026 |
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
| QB18 (QO14) | VAT **một mức cho cả báo giá** là mặc định; cách tính đi theo loại báo giá, Owner điều chỉnh sau; **có lựa chọn VAT theo từng dòng** cho loại nào cần | Owner, 24/11/2026 |
| QB19 (QO15) | Chỉ **Quản trị CRM** được thêm / sửa loại báo giá | Owner, 24/11/2026 |
| QB20 (QO16) | Đợt 1 mọi loại đều nhập giá **trước VAT**; kiểu "giá đã gồm VAT" để sau | Owner, 24/11/2026 |
| QB21 (QO17) | Được tải PDF / Excel: **Quản trị CRM, Kinh doanh phụ trách cơ hội, Kế toán** | Owner, 24/11/2026 |
| QB22 (QO18) | Tệp Excel **có công thức** ở cột thành tiền và các dòng tổng | Owner, 24/11/2026 |
| QB23 (QO9) | **Có lưu giá vốn từng dòng**; chỉ **Quản trị CRM và người lập** thấy | Owner, 24/11/2026 |

## 2. Quyết định còn chờ Owner

**Không còn điểm nào chờ.** QO1–QO18 đã được Owner trả lời ngày 24/11/2026 và ghi thành QB4–QB23 ở mục 1. Tác giả không tự ghi APPROVED / ACCEPTED cho đặc tả; việc duyệt đặc tả để bắt đầu viết mã vẫn là quyết định riêng của Owner sau review.

Hai chỗ tác giả đã phải diễn giải câu trả lời; **Owner đã xác nhận cả hai ngày 24/11/2026** (bình luận `[OWNER-DECISION]` trên PR #266):
- QB23 "người lập" = người tạo ra bản báo giá gửi cho khách, tức **người tạo phiên bản báo giá đó** (`quote_version.created_by`). Người khác tiếp quản cơ hội rồi tạo bản mới thì không thấy giá vốn của bản cũ (mục 7.3).
- QB22 "có công thức": công thức chỉ ở các ô **do CRM sinh ra** (thành tiền, các dòng tổng); nội dung người dùng nhập vẫn luôn là chữ thuần (mục 4.4).

## 3. Phạm vi

**Làm:** loại báo giá (tiêu đề, cột riêng, điều khoản mặc định, cách tính VAT) và màn hình quản lý; lập báo giá theo cơ hội với dòng hàng, dòng tiêu đề nhóm, VAT 8 / 10 % (một mức cho cả báo giá, hoặc theo dòng với loại bật lựa chọn này); **giá vốn từng dòng** (chỉ Quản trị CRM và người lập thấy) kèm lãi gộp tạm tính; phiên bản và năm trạng thái; xem bản in, tải PDF, tải Excel; mặc định cá nhân của từng nhân viên (thông tin liên hệ, thông tin tài khoản); báo giá đang theo đuổi và đồng bộ giá trị cơ hội; trang danh sách; tab Báo giá trong chi tiết cơ hội; nhãn sắp hết hạn.
**Không làm (để sau):** danh mục thiết bị / vật tư và bảng giá; công thức tính giá từ giá vốn, tỷ giá, hệ số (hiện nằm ở cột ẩn của các tệp Excel); báo cáo lợi nhuận tổng hợp; chiết khấu; duyệt giá; đơn giá đã gồm VAT; gửi email; nhập từ Excel; tự sinh hoạt động / công việc từ báo giá; đưa báo giá vào tìm kiếm chung; Hợp đồng.

## 4. Loại báo giá, bản in và tệp xuất

### 4.1 Loại báo giá [QB17]

Một **loại báo giá** quyết định: tên loại (ví dụ "Gas lạnh Daikin"), dòng tiêu đề in, câu chào, điều khoản mặc định, số ngày hiệu lực mặc định, VAT mặc định, **cách tính VAT** (một mức cho cả báo giá — mặc định; hoặc theo từng dòng) [QB18], và **tối đa 10 cột riêng** chèn giữa "Nội dung công việc" và "ĐVT". Ví dụ rút từ các tệp mẫu của công ty:

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

Khổ A4 dọc khi loại có tối đa 3 cột riêng, A4 ngang khi nhiều hơn. Báo giá thuộc loại "VAT theo từng dòng" và thực sự có cả hai mức thì bảng hàng thêm cột "VAT %". **Giá vốn không bao giờ xuất hiện** trên bản in hay trong tệp xuất.

### 4.3 Bất biến [QB4]

**Mọi thứ hiện trên bản in và trong tệp xuất đều đọc từ dòng `quote_version` và `quote_line` của chính phiên bản đó**, không đọc trực tiếp từ khách hàng, nhân viên, cơ hội, loại báo giá hay mặc định cá nhân:

| Phần | Nguồn lúc tạo nháp (điền sẵn, sửa được) | Lưu cố định ở |
|---|---|---|
| Khối khách (6 ô) | khách hàng, người liên hệ, cơ hội | `quote_version.client_*`, `project_name` |
| Khối người báo giá (4 ô) | nhân viên lập + mặc định cá nhân | `quote_version.quoter_*` |
| Dòng tiêu đề, danh sách cột riêng, tên loại, cách tính VAT | loại báo giá | `quote_version.title`, `columns`, `template_name`, `vat_mode` |
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
- **Excel** [QB22]: một trang tính theo đúng bố cục 4.2. Số lượng và đơn giá là ô **số**. Cột **thành tiền** và các **dòng tổng** là ô **công thức** do CRM sinh ra, kèm sẵn giá trị đã tính: thành tiền `=ROUND(SL*Đơn giá,0)`; tổng trước VAT `=SUM(…)` (theo từng mức thuế bằng `SUMIF` khi VAT theo dòng); VAT `=ROUND(tiền hàng*mức thuế,0)`; tổng sau VAT là phép cộng. `ROUND` của Excel làm tròn 0,5 ra xa 0 — trùng quy tắc mục 6 — nên công thức ra **đúng** số CRM đã lưu (ca E9). Mọi ô chứa nội dung **người dùng nhập** (mô tả, ghi chú, cột riêng, đầu trang, điều khoản) là ô **chữ**: chuỗi bắt đầu bằng `=`, `+`, `-`, `@` vẫn được ghi là chữ thuần, không bao giờ thành công thức. Tệp không có macro, liên kết ngoài hay kết nối dữ liệu. Cuối trang tính có dòng ghi chú: tệp Excel sửa được nên **bản chính thức là bản trong CRM / tệp PDF**.
- **Thư viện**: hiện hệ thống chưa có thư viện dựng PDF hay Excel. Mỗi thư viện thêm vào là **một PR riêng** (Q9, Q10) kèm lý do chọn, giấy phép, kích thước, kết quả quét lỗ hổng; không đổi thư viện khác trong cùng PR.
- Mọi ô chữ hiển thị dạng văn bản thuần (không diễn giải HTML).

## 5. Mô hình dữ liệu [Đề xuất] — một migration cộng thêm, không đổi / xoá cột cũ

### 5.1 Bảng

```
quote_template                                           -- loại báo giá
  id uuid PK, code varchar(30) UNIQUE (a-z 0-9 -), name varchar(120) NOT NULL
  title varchar(200) NOT NULL, intro varchar(300) NOT NULL DEFAULT '', default_terms varchar(4000) NOT NULL DEFAULT ''
  default_valid_days smallint NOT NULL DEFAULT 15 CHECK (1..365), default_vat smallint NOT NULL DEFAULT 10 CHECK (IN (8, 10))
  vat_mode quote_vat_mode NOT NULL DEFAULT 'QUOTE'       -- QUOTE = một mức cho cả báo giá | LINE = theo từng dòng [QB18]
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
  vat_mode quote_vat_mode NOT NULL                       -- bản chép từ loại báo giá
  quote_date date NULL, valid_until date NULL
  client_name, client_contact, client_company varchar(200); client_phone varchar(30); client_email varchar(254);
  client_address varchar(500); project_name varchar(200)              -- NULL được
  quoter_name varchar(200) NOT NULL; quoter_title varchar(120); quoter_phone varchar(30); quoter_email varchar(254)
  intro varchar(300) NOT NULL DEFAULT '', terms varchar(4000) NOT NULL DEFAULT '', payment_info varchar(2000) NOT NULL DEFAULT ''
  subtotal_vnd, base8_vnd, base10_vnd, vat8_vnd, vat10_vnd, total_vnd   bigint NOT NULL DEFAULT 0
  note varchar(2000) NULL (nội bộ, không in), reject_reason varchar(500) NULL
  accepted_opportunity_id uuid NULL → opportunity        -- chỉ có giá trị khi ACCEPTED; do trigger R-Q7 đặt = cơ hội của báo giá (U-4)
  created_by NOT NULL, created_at, updated_at, sent_by, sent_at, decided_by, decided_at

quote_line
  id uuid PK, quote_version_id uuid NOT NULL → quote_version ON DELETE RESTRICT
  line_no smallint NOT NULL (1..300)                     UNIQUE (quote_version_id, line_no) DEFERRABLE INITIALLY DEFERRED
  kind quote_line_kind NOT NULL DEFAULT 'ITEM'           -- ITEM | SECTION
  description varchar(500) NOT NULL (không rỗng), unit varchar(30) NOT NULL DEFAULT '', note varchar(200) NULL
  extra jsonb NOT NULL DEFAULT '{}'                      -- { <key của cột riêng>: chữ ≤ 200 ký tự }; tối đa 10 khoá
  quantity numeric(12,3) NULL, unit_price_vnd bigint NULL, vat_percent smallint NULL, amount_vnd bigint NULL
  cost_price_vnd bigint NULL                             -- giá vốn một đơn vị, trước VAT [QB23]; NULL = chưa nhập; không in, không xuất
```

`opportunity` **không thêm cột nào**; chỉ thêm chỉ mục `UNIQUE (id, customer_id)` làm đích cho khoá ngoại kép (`main` chưa có chỉ mục này; cùng cách `contact_id_customer_id_key` của S2 [Mã hiện có]). `customer_id` của cơ hội đã bất biến bằng trigger S2 [Mã hiện có].

### 5.2 CHECK và chỉ mục duy nhất

| Mã | Ràng buộc |
|---|---|
| C-1 | `quote_line` kiểu `ITEM`: `0 < quantity ≤ 999999.999`; `0 ≤ unit_price_vnd ≤ 999999999999`; `vat_percent IN (8, 10)`; `amount_vnd = round(quantity * unit_price_vnd)` (`round` của `numeric`: 0,5 ra xa 0); `cost_price_vnd` NULL hoặc `0 ≤ cost_price_vnd ≤ 999999999999` |
| C-1b | `quote_line` kiểu `SECTION`: `quantity`, `unit_price_vnd`, `vat_percent`, `amount_vnd`, `cost_price_vnd` đều NULL; `unit = ''`; `extra = '{}'` |
| C-2 | `quote_version`: sáu cột tổng ≥ 0; `subtotal_vnd = base8_vnd + base10_vnd`; `subtotal_vnd ≤ 9000000000000000` |
| C-3 | `quote_version`: `vat8_vnd = (base8_vnd * 8 + 50) / 100`; `vat10_vnd = (base10_vnd * 10 + 50) / 100` (chia nguyên `bigint`); `total_vnd = subtotal_vnd + vat8_vnd + vat10_vnd` |
| C-4 | `quote_version`: `status ≠ 'DRAFT'` ⇒ `quote_date`, `valid_until`, `sent_by`, `sent_at` có giá trị và `valid_until ≥ quote_date` |
| C-5 | `quote_version`: `status IN ('ACCEPTED','REJECTED')` ⇔ `decided_by`, `decided_at` có giá trị; `REJECTED` ⇒ `reject_reason` không rỗng; trạng thái khác ⇒ `reject_reason` NULL |
| C-6 | `columns` (ở cả `quote_template` và `quote_version`): là mảng JSON 0..10 phần tử đúng hình dạng 5.1 — kiểm bằng hàm `fn_quote_columns_ok(jsonb)` IMMUTABLE trong CHECK |
| C-7 | `quote_line.extra`: là đối tượng JSON, tối đa 10 khoá, mỗi giá trị là chuỗi ≤ 200 ký tự (hàm IMMUTABLE trong CHECK). Việc "khoá phải thuộc danh sách cột của phiên bản" kiểm ở trigger R-Q10 (cần đọc dòng cha) |
| U-1 | Mỗi báo giá tối đa một nháp: `UNIQUE (quote_id) WHERE status = 'DRAFT'` |
| U-2 | Mỗi báo giá tối đa một bản được chấp nhận: `UNIQUE (quote_id) WHERE status = 'ACCEPTED'` |
| U-3 | Mỗi cơ hội tối đa một báo giá đang theo đuổi: `UNIQUE (opportunity_id) WHERE is_primary AND deleted_at IS NULL` |
| U-4 | Mỗi **cơ hội** tối đa một phiên bản được chấp nhận [QB7]: `UNIQUE (accepted_opportunity_id) WHERE accepted_opportunity_id IS NOT NULL`. Đây là ràng buộc cứng của chỉ mục, **không phụ thuộc** thứ tự khoá hay việc có đi qua ứng dụng hay không |
| C-8 | `quote_version`: `accepted_opportunity_id IS NOT NULL` ⇔ `status = 'ACCEPTED'` |

### 5.3 Trigger (tên dự kiến; đều `SECURITY INVOKER`, `search_path` cố định)

Mọi quy tắc trên `quote_version` (R-Q1, R-Q2a, R-Q3, R-Q7, R-Q13, R-Q14, R-Q15) nằm trong **một hàm trigger duy nhất** `BEFORE INSERT OR UPDATE` của bảng này, chạy theo đúng thứ tự viết trong hàm ⇒ kết quả không phụ thuộc thứ tự PostgreSQL gọi các trigger khác nhau. Bảng dưới tách từng quy tắc để dễ đối chiếu với ca nghiệm thu.

| Mã | Trigger | Hành vi |
|---|---|---|
| R-Q2a | `quote_version` BEFORE UPDATE | `OLD.status ≠ 'DRAFT'` ⇒ **chỉ** cho đổi `status`, `decided_by`, `decided_at`, `reject_reason`, `accepted_opportunity_id`, `updated_at`; cột khác đổi ⇒ lỗi `QUOTE_VERSION_LOCKED`. So sánh `IS DISTINCT FROM` trên **toàn bộ** cột còn lại, liệt kê tường minh (test chốt: thêm cột mà quên đưa vào danh sách thì test đỏ) |
| R-Q2b | `quote_version` BEFORE DELETE | Chỉ xoá được nháp |
| R-Q2c | `quote_line` BEFORE INSERT / UPDATE / DELETE | `SELECT status, columns FROM quote_version WHERE id = … FOR SHARE` (khoá dòng cha) ⇒ khác `DRAFT` thì lỗi `QUOTE_VERSION_LOCKED`. `quote_version_id` bất biến |
| R-Q10 | `quote_line` BEFORE INSERT / UPDATE (cùng hàm với R-Q2c) | Mọi khoá của `extra` phải nằm trong `columns` của phiên bản cha |
| R-Q11 | `quote_version` BEFORE UPDATE khi đổi `columns` (chỉ xảy ra ở nháp) | Không còn dòng hàng nào có khoá `extra` ngoài danh sách cột mới |
| R-Q3 | `quote_version` BEFORE UPDATE | Chuyển trạng thái hợp lệ: `DRAFT → SENT`; `SENT → ACCEPTED \| REJECTED`. Mọi chuyển khác ⇒ lỗi |
| R-Q1 | `quote_version` BEFORE UPDATE khi `NEW.status = 'SENT'` | Khoá mọi dòng của phiên bản `FOR UPDATE`; yêu cầu **≥ 1 dòng kiểu `ITEM`**; tính lại tổng `amount_vnd` theo từng mức VAT và so với `NEW.base8_vnd`, `NEW.base10_vnd`; lệch ⇒ lỗi `QUOTE_TOTAL_MISMATCH`. `vat_mode = 'QUOTE'` mà các dòng hàng không cùng một mức VAT ⇒ lỗi `QUOTE_VAT_MIXED` [QB18]. (C-2, C-3 bảo đảm phần còn lại của chuỗi tổng) |
| R-Q4 | `quote` BEFORE UPDATE | `code`, `opportunity_id`, `customer_id`, `template_id`, `created_by`, `created_at` bất biến |
| R-Q14 | `quote_version` BEFORE INSERT / UPDATE — **`accepted_opportunity_id` chỉ do DB xác lập** | Ở **mọi** lần INSERT và UPDATE, hàm trigger **tự tính lại** cột này và ghi đè giá trị người gọi truyền vào: `NEW.status = 'ACCEPTED'` ⇒ `NEW.accepted_opportunity_id := (SELECT opportunity_id FROM quote WHERE id = NEW.quote_id)`; trạng thái khác ⇒ `:= NULL`. Trước khi ghi đè, nếu người gọi đã truyền một giá trị **khác** giá trị tính được (đặt giá trị trên bản chưa được chấp nhận; đổi sang cơ hội khác; xoá về NULL trên bản đã chấp nhận) ⇒ **lỗi `QUOTE_ACCEPTED_REF_FORBIDDEN`**, không âm thầm sửa. Ngoại lệ duy nhất không báo lỗi: chính câu lệnh chuyển `SENT → ACCEPTED` không truyền cột này (để NULL) — trigger điền giá trị đúng. Vì `quote_id` bất biến (R-Q13) và `quote.opportunity_id` bất biến (R-Q4), giá trị đã xác lập **không bao giờ lệch** khỏi cơ hội thật của báo giá. C-8 và khoá ngoại tới `opportunity` là lưới chặn thứ hai |
| R-Q15 | `quote_version` BEFORE INSERT | Dòng mới **bắt buộc** `status = 'DRAFT'`; `sent_by`, `sent_at`, `decided_by`, `decided_at`, `reject_reason`, `accepted_opportunity_id` phải NULL ⇒ không thể chèn thẳng một phiên bản đã gửi / đã chấp nhận để vượt R-Q1, R-Q3, R-Q7 |
| R-Q13 | `quote_version` BEFORE UPDATE | `vat_mode`, `created_by`, `quote_id`, `version_no`, `created_at` bất biến ngay cả khi còn là nháp (cách tính VAT cố định từ lúc tạo phiên bản; `created_by` quyết định ai thấy giá vốn — không ai, kể cả ghi thẳng SQL bằng `siscom_app`, đổi được sau khi dòng đã tạo) |
| R-Q5 | `quote` BEFORE UPDATE khi bật `is_primary` | Phải có ít nhất một phiên bản không phải nháp |
| R-Q7 | `quote_version` BEFORE UPDATE khi `NEW.status = 'ACCEPTED'` [QB6, QB7] | (1) Lấy **điểm khoá chung** (5.4): `SELECT 1 FROM opportunity WHERE id = <cơ hội của báo giá> FOR UPDATE`. (2) Giá trị `accepted_opportunity_id` do R-Q14 xác lập (không lấy từ người gọi). (3) Báo giá này phải đang là `is_primary`; nếu không ⇒ lỗi `QUOTE_NOT_PRIMARY`. (4) Cơ hội đã có phiên bản khác được chấp nhận ⇒ lỗi `QUOTE_ALREADY_ACCEPTED` (đọc sau khi đã giữ khoá chung); U-4 là lưới chặn cuối. **Không** khoá thêm dòng `quote` hay `quote_version` nào khác |
| R-Q8 | `quote` BEFORE UPDATE khi đổi `is_primary` (bật hoặc tắt) | (1) Lấy **điểm khoá chung** (5.4) trên dòng cơ hội. (2) Cơ hội đã có phiên bản được chấp nhận (`accepted_opportunity_id` = cơ hội này) ⇒ lỗi `QUOTE_PRIMARY_FIXED` [QB6]. Không khoá thêm dòng nào khác |
| R-Q9 | `quote` xoá mềm | Chỉ khi không có phiên bản nào khác `DRAFT`; app không có quyền DELETE cứng |
| R-Q12 | `quote_template` BEFORE DELETE | Luôn từ chối (ngừng dùng bằng `is_active`) |

**Hành vi khi chạy đồng thời.** Lệnh gửi là một câu `UPDATE quote_version SET status = 'SENT' …`, giữ khoá ghi trên dòng phiên bản tới hết transaction:
- Một người đang **thêm / sửa / xoá dòng** giữ khoá `FOR SHARE` trên dòng phiên bản (R-Q2c) ⇒ lệnh gửi phải chờ; khi được chạy, R-Q1 đếm và cộng lại trên dữ liệu đã chốt ⇒ thiếu dòng hoặc lệch tổng thì từ chối.
- Ngược lại, lệnh gửi chạy trước ⇒ lệnh sửa dòng chờ, rồi đọc thấy `SENT` ⇒ bị từ chối.
- Hai lệnh đổi trạng thái cùng lúc trên một phiên bản: lệnh sau chờ, rồi R-Q3 xét trên trạng thái mới ⇒ từ chối.
- Hai người cùng tạo nháp cho một báo giá: U-1 từ chối người sau (409 `QUOTE_DRAFT_EXISTS`).
- Hai người cùng chấp nhận hai báo giá khác nhau của một cơ hội, hoặc một người chấp nhận trong lúc người khác đổi báo giá đang theo đuổi: xem 5.4.
- Số phiên bản: ứng dụng khoá dòng `quote` `FOR UPDATE` rồi lấy `max(version_no) + 1`; `UNIQUE (quote_id, version_no)` là lưới chặn cuối.

### 5.4 Điểm khoá chung cho ràng buộc theo cơ hội (R-Q7, R-Q8) và phân tích khoá chéo

Hai ràng buộc "mỗi cơ hội tối đa một báo giá được chấp nhận" và "đã chấp nhận thì không đổi báo giá đang theo đuổi" trải trên **nhiều dòng** của `quote` / `quote_version`. Chúng được cưỡng chế ở DB bằng hai lớp, **không dựa vào việc người gọi có đi qua ứng dụng hay không**:

1. **Chỉ mục duy nhất** U-3 và U-4: dù khoá thế nào, không thể tồn tại hai báo giá đang theo đuổi hay hai phiên bản được chấp nhận trên cùng một cơ hội. Hai transaction ghi thẳng SQL cùng chấp nhận hai báo giá khác nhau ⇒ transaction thứ hai chờ ở chỉ mục rồi nhận lỗi trùng khoá.
2. **Một điểm khoá chung duy nhất = dòng `opportunity`** (`FOR UPDATE`). Trigger R-Q7 và R-Q8 tự lấy khoá này trước khi đọc trạng thái của các dòng khác, nên hai thao tác có thể làm lệch nhau (chấp nhận ↔ chấp nhận, chấp nhận ↔ đổi đang theo đuổi) luôn chạy **lần lượt**, và thao tác chạy sau đọc thấy kết quả đã chốt của thao tác trước. Trigger **không** khoá dòng `quote` hay `quote_version` nào ngoài dòng mà chính câu lệnh đang ghi.

**Thứ tự khoá và khả năng khoá chéo (deadlock):**

| Đường ghi | Thứ tự lấy khoá | Kết luận |
|---|---|---|
| Qua ứng dụng (mọi thao tác ghi báo giá) | khách `FOR SHARE` → **cơ hội `FOR UPDATE`** → `quote` → `quote_version` → `quote_line` | Khi trigger R-Q7 / R-Q8 chạy, transaction **đã giữ** khoá dòng cơ hội ⇒ lần lấy khoá trong trigger không phải chờ. Mọi đường ghi của ứng dụng tuân theo cùng một thứ tự khoá ⇒ **không dự kiến** khoá chéo giữa chúng (ca D10 theo dõi điều này; nếu vẫn xảy ra thì PostgreSQL huỷ một bên như dòng cuối bảng) |
| SQL trực tiếp ↔ SQL trực tiếp, hai báo giá khác nhau của một cơ hội | mỗi bên: dòng `quote_version` (hoặc `quote`) của mình → cơ hội (trong trigger) | Bên sau chờ ở dòng cơ hội; bên trước không cần dòng nào của bên sau ⇒ không dự kiến khoá chéo trong kịch bản này; bên sau chạy tiếp và bị R-Q7 / U-4 từ chối. SQL trực tiếp khoá thêm các dòng khác theo thứ tự tuỳ ý thì **vẫn có thể** khoá chéo |
| SQL trực tiếp ↔ ứng dụng, **cùng** một dòng báo giá | trực tiếp: `quote_version` → cơ hội; ứng dụng: cơ hội → `quote_version` | Có thể thành chu trình chờ. PostgreSQL phát hiện và **huỷ một bên** (lỗi `deadlock_detected`); không bên nào ghi được trạng thái sai. Ứng dụng đổi lỗi này thành 409 để người dùng thử lại. Ghi thẳng SQL không phải đường vận hành được hỗ trợ |

**Phạm vi của cam kết** (không khẳng định "không bao giờ khoá chéo"):
- **Khoá chéo vẫn có thể xảy ra** khi có SQL ghi trực tiếp không theo thứ tự khoá của ứng dụng. Đây là rủi ro đã nhận diện, **không phải đã loại bỏ**; cách xử lý là để PostgreSQL phát hiện và huỷ trọn một transaction (không có trạng thái ghi dở), bên bị huỷ thử lại.
- **Tính đúng của dữ liệu không dựa vào khoá**: "tối đa một phiên bản được chấp nhận trên một cơ hội" do chỉ mục U-4 bảo đảm, và U-4 có nghĩa vì `accepted_opportunity_id` **chỉ do trigger R-Q14 xác lập** từ cơ hội thật của báo giá, không nhận từ người gọi, không sửa hay xoá được; "tối đa một báo giá đang theo đuổi" do U-3 bảo đảm. Khoá chung trên dòng cơ hội chỉ để hai thao tác chạy lần lượt và thao tác sau nhận **thông báo lỗi nghiệp vụ rõ ràng** thay vì lỗi trùng chỉ mục.
- Quy tắc "đã chấp nhận thì không đổi báo giá đang theo đuổi" (R-Q8) và "báo giá được chấp nhận phải đang được theo đuổi" (R-Q7 bước 3) được xét **sau khi giữ khoá chung**, nên đúng với mọi cặp thao tác cùng lấy khoá đó — tức mọi UPDATE làm đổi `is_primary` hoặc chuyển sang `ACCEPTED`, dù qua ứng dụng hay SQL trực tiếp (trigger tự lấy khoá).
- Các ca B12–B16 kiểm bằng **hai kết nối PostgreSQL thật** và SQL trực tiếp.

Bản nháp cho phép tổng tạm lệch dòng hàng **bên trong** một transaction lưu; điểm chốt bắt buộc là R-Q1 lúc gửi. Ứng dụng luôn tính lại tổng ở mỗi lần lưu (mục 6).

**"Hết hiệu lực" không lưu trong DB**: phiên bản `SENT` có `valid_until` < hôm nay (ngày theo giờ Việt Nam). Danh sách và bộ lọc dùng **cùng một biểu thức SQL** ở máy chủ.

## 6. Tính tiền [QB11, QB12, QB13, QB18]

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
- **Đường nhập không qua số thực**: API nhận đơn giá, giá vốn ở dạng **chuỗi chữ số** (`^[0-9]{1,12}$`) và số lượng ở dạng chuỗi thập phân (`^[0-9]{1,6}(\.[0-9]{1,3})?$`); máy chủ chuyển thẳng chuỗi → `BigInt` (số lượng: ghép phần nguyên và phần thập phân đã đệm đủ 3 chữ số), **không đi qua kiểu `Number` của JavaScript ở bất kỳ bước nào**. Giá trị gửi lên dưới dạng số JSON, số mũ (`1e3`), có dấu, có khoảng trắng hay dấu phân cách ⇒ 400. Lớp truy cập DB truyền và nhận `bigint` / `numeric` ở dạng `BigInt` / chuỗi.
- **DB kiểm lại** bằng C-1, C-2, C-3 và R-Q1 (hai cách tính độc lập phải ra cùng số).
- **Giá trị đưa sang cơ hội** (D7) = `subtotal_vnd` (chưa VAT).
- **Cách tính VAT** [QB18]: loại báo giá ở chế độ **một mức** (mặc định) ⇒ người lập chọn 8 % hoặc 10 % một lần cho cả báo giá, mọi dòng hàng mang cùng mức đó (một trong hai `base` bằng 0). Loại ở chế độ **theo từng dòng** ⇒ mỗi dòng chọn mức riêng. Cả hai chế độ dùng **cùng** cấu trúc dữ liệu và công thức; chế độ một mức chỉ thêm ràng buộc "mọi dòng cùng mức" (R-Q1).
- **Giá vốn** [QB23]: `cost_price_vnd` là giá vốn **một đơn vị**, số nguyên đồng, trước VAT, không bắt buộc. Giá vốn của dòng `= round(quantity × cost_price_vnd)` (cùng quy tắc làm tròn); **lãi gộp tạm tính** `= thành tiền − giá vốn của dòng`, tổng lãi gộp và tỷ lệ trên tổng trước VAT chỉ tính trên các dòng **đã nhập** giá vốn và ghi rõ có bao nhiêu dòng chưa nhập. Các số này **không lưu**, tính lúc đọc, và chỉ trả cho người được xem giá vốn (7.3). Giá vốn không tham gia bất kỳ tổng nào của báo giá.

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
| A10 | loại **một mức**: 1 × 100, 8 % và 1 × 100, 10 % | — | — | — | — | — | **từ chối** (`QUOTE_VAT_MIXED`); cùng dữ liệu với loại **theo từng dòng** ⇒ base8 100, base10 100, vat8 8, vat10 10, total 218 |
| A11 | giá vốn: 2,5 × 333 333 (thành tiền 833 333), giá vốn đơn vị 300 000 ⇒ giá vốn dòng 750 000, lãi gộp 83 333; dòng thứ hai chưa nhập giá vốn | | | | | | lãi gộp tạm tính 83 333 "trên 1 / 2 dòng"; các tổng của báo giá **không đổi** |

## 7. Quyền và rò giá

### 7.1 Ma trận [QB19, QB21, QB23; phần còn lại là đề xuất]

Báo giá **đi theo cơ hội**: ai không thấy cơ hội trên **đường đầy đủ** thì không thấy báo giá. **Quy ước 403 / 404 cho mọi endpoint báo giá** (Owner chốt 24/11/2026, review `R1-02`): (1) người gọi **không có mã quyền** của thao tác (ví dụ không có `quote.read`) ⇒ **403**, quyết định **trước khi** tra bất kỳ bản ghi nào nên giống hệt nhau với id có thật, id không tồn tại, id đã xoá — không lộ sự tồn tại của báo giá; (2) có mã nhưng báo giá / cơ hội ngoài phạm vi, không tồn tại hoặc đã xoá mềm ⇒ **cùng một 404**, không trả 403; (3) thấy được báo giá nhưng thiếu quyền của thao tác trên chính nó ⇒ 403.

| Mã | Quản trị CRM | Kinh doanh | Kỹ thuật | Kế toán | Quản trị hệ thống |
|---|---|---|---|---|---|
| `quote.read` | tất cả | cơ hội mình **thấy được** theo SALES 5.1 | — | tất cả | — |
| `quote.create` / `quote.update` | tất cả | chỉ cơ hội mình **phụ trách** | — | — | — |
| `quote.send` (Đã gửi, chọn đang theo đuổi) | tất cả | chỉ cơ hội mình phụ trách | — | — | — |
| `quote.decide` (Được chấp nhận / Bị từ chối) | tất cả | chỉ cơ hội mình phụ trách | — | — | — |
| `quote.delete` (nháp / báo giá chưa gửi) | tất cả | chỉ cơ hội mình phụ trách | — | — | — |
| `quote.export` (tải PDF / Excel) [QB21] | tất cả | chỉ cơ hội mình phụ trách | — | tất cả | — |
| `quote.template` (thêm / sửa loại báo giá) [QB19] | có | — | — | — | — |
| `quote.cost` (xem giá vốn của **mọi** báo giá) [QB23] | có | — | — | — | — |

- Đọc danh sách loại báo giá đang dùng (để chọn khi lập) và sửa **mặc định cá nhân của chính mình**: mọi người có `quote.create`.
- Dùng lại RBAC và vị từ phạm vi hiện có: mọi đường đọc báo giá (kể cả tải tệp) đi qua **đúng một hàm** = mã quyền tương ứng **VÀ** vị từ "đường đầy đủ" của cơ hội (`fullReadWhere` [Mã hiện có]). **Không** dùng "đường theo việc" (`taskPathWhere`). Quyền ghi và quyền tải kiểm theo `owner_id` của cơ hội như `opportunity.update`. Mỗi mã cấp riêng.
- `fn_auth_perm_class` xếp thêm tiền tố `quote.` vào nhóm BIZ ⇒ rào SoD của M1 chặn ở DB việc cấp bất kỳ mã `quote.*` nào cho vai trò `admin` (cùng cách S5).
- Cấp quyền trên DB đã bootstrap: script hai người + script gỡ + diễn tập CI (mẫu `SALES_S5_OPPORTUNITY_PERMISSIONS`). Grants cho `siscom_app` (APP_GRANTS_V5 mục 2e): INSERT / UPDATE `quote`, `quote_template`, `quote_user_default` (không DELETE); INSERT / UPDATE / DELETE `quote_version` và `quote_line` — hai bảng duy nhất ứng dụng được DELETE, để xoá **bản nháp** và dòng của nó; trigger R-Q2b / R-Q2c chặn mọi DELETE trên phiên bản đã gửi (xem mục 19, điểm 9). Không TRUNCATE bảng nào. `siscom_auth`, `siscom_acct`: **không có quyền nào** trên năm bảng.

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
| **Giá vốn và lãi gộp** | 7.3: bỏ khoá khỏi phản hồi; không có trong tệp xuất, bản in, danh sách, nhật ký; không chép sang bản mới của người không được xem | C14 |
| Bộ nhớ đệm của trình duyệt và máy trung gian | **Mọi** phản hồi của API báo giá (không chỉ tệp tải) kèm `Cache-Control: no-store`; giao diện không lưu dữ liệu báo giá vào `localStorage` / `sessionStorage` | C15 |
| Thông báo lỗi của endpoint xuất tệp | Lỗi trả về dạng JSON với mã cố định (`QUOTE_EXPORT_FAILED`…), không kèm nội dung báo giá, đường dẫn tệp hay vết lỗi của thư viện; không quyền ⇒ 403 / 404 **trước khi** dựng tệp | C15 |
| Phân trang, lọc, sắp xếp, số đếm | `total`, `totalPages` và mọi số đếm chỉ tính trên các dòng người gọi được xem (cùng vị từ với danh sách). Không cho lọc hay sắp xếp theo giá vốn / lãi gộp. Lọc, sắp xếp theo giá trị báo giá chỉ có tác dụng trên tập đã qua vị từ phạm vi | C15 |
| Kết nối DB khác | `siscom_auth`, `siscom_acct` không có quyền trên năm bảng | B8 |

### 7.3 Giá vốn [QB23]

- **Ai thấy**: người có `quote.cost` (Quản trị CRM), **hoặc** người tạo ra chính phiên bản đó (`quote_version.created_by` = người đang đăng nhập). Điều kiện "là người tạo" **chỉ được xét sau khi** người gọi đã qua kiểm tra chung của 7.1 (`quote.read` + vị từ phạm vi cơ hội): `created_by` **không bao giờ mở rộng phạm vi** — người tạo cũ đã mất quyền xem cơ hội (chuyển người phụ trách, đổi vai trò, bị khoá) thì nhận 404 như mọi người ngoài phạm vi, không thấy cả báo giá lẫn giá vốn.
- **`created_by` do máy chủ đặt** từ phiên đăng nhập khi tạo phiên bản; các DTO tạo / sửa **không có** trường này và máy chủ từ chối (400) mọi thuộc tính lạ trong thân yêu cầu, như các module hiện có. Sau khi tạo, R-Q13 chặn đổi ở DB. Kế toán, Kinh doanh chỉ-xem, người tiếp quản cơ hội về sau: **không thấy**.
- **Ai nhập / sửa**: người đang soạn nháp (chính là người tạo phiên bản) và Quản trị CRM. Sau khi gửi, giá vốn bị khoá cùng phiên bản (R-Q2).
- **Cách che**: API **bỏ hẳn** các khoá giá vốn và lãi gộp khỏi phản hồi của người không được xem (không trả `null`, để không lộ cả việc "đã nhập hay chưa"). Bộ chuyển đổi dữ liệu liệt kê tường minh từng trường cho hai dạng phản hồi "có giá vốn" / "không có giá vốn", theo cách `toOpportunityTechDetail` đang làm [Mã hiện có]; test chốt danh sách khoá của từng dạng.
- **Người khác tạo bản mới** từ phiên bản mình không được xem giá vốn ⇒ giá vốn **không được chép** sang (để trống), tránh lộ qua bản nháp mới. Người được xem ⇒ chép đủ.
- **Lưu nháp bởi người không được xem** (Quản trị CRM luôn được xem; trường hợp này chỉ xảy ra nếu sau này mở rộng quyền sửa): yêu cầu không mang khoá giá vốn ⇒ máy chủ **giữ nguyên** giá vốn đang lưu của các dòng không đổi, không xoá.
- **Không bao giờ** xuất hiện ở: bản in, PDF, Excel, danh sách báo giá, trang cơ hội, lịch sử thay đổi, `audit_log`, thông báo lỗi. Riêng thông báo lỗi: lỗi kiểm dữ liệu của trường giá vốn chỉ nêu **tên trường và số dòng**, không lặp lại giá trị; phản hồi 409 `VERSION_CONFLICT` chỉ trả số phiên bản hiện tại, không kèm nội dung báo giá.
- Giới hạn cần biết: che ở tầng ứng dụng. Kết nối `siscom_app` đọc được cột này (như mọi cột khác của bảng); người có quyền truy cập thẳng database vẫn thấy.

## 8. Quy tắc nghiệp vụ [Đề xuất, trừ chỗ ghi mã QB]

1. **Tạo báo giá** từ một cơ hội đang mở (`OPEN`): chọn loại báo giá (đang dùng), nhập hạng mục ⇒ sinh mã và phiên bản 1 (Nháp); các ô ở 4.3 được điền sẵn. Cơ hội Tạm hoãn / Thắng / Thua: không tạo mới, vẫn xem và tải được.
2. **Soạn nháp**: thêm, sửa, xoá, đổi thứ tự dòng hàng và dòng tiêu đề nhóm; mức VAT (một lần cho cả báo giá, hoặc từng dòng nếu loại bật chế độ đó; mặc định theo loại) [QB18]; giá vốn từng dòng [QB23]; giá trị các cột riêng; sửa các ô đầu trang, câu chào, điều khoản, thông tin tài khoản [QB15]. Lưu là **một transaction**, máy chủ tính lại mọi tổng. Loại báo giá của một báo giá **không đổi được** sau khi tạo (cần loại khác thì lập báo giá mới).
3. **Xem bản in / tải PDF / tải Excel**: mọi phiên bản; nháp có chữ chìm và hậu tố `_NHAP`.
4. **Đánh dấu Đã gửi** [QB1]: cần ≥ 1 dòng hàng, ngày báo giá (không ở tương lai), hạn hiệu lực ≥ ngày báo giá. Phiên bản bị khoá (R-Q2).
5. **Tạo bản mới**: chép toàn bộ nội dung phiên bản mới nhất (dòng hàng, các ô đầu trang, tiêu đề và danh sách cột **của phiên bản đó**) thành phiên bản kế tiếp, Nháp; `print_template` lấy bố cục hiện hành; `vat_mode` giữ như phiên bản nguồn; giá vốn chép theo quy tắc 7.3. Chỉ khi báo giá chưa có nháp và chưa được chấp nhận.
6. **Kết quả**: "Được chấp nhận" hoặc "Bị từ chối" (bắt buộc lý do) cho phiên bản đã gửi **mới nhất** của báo giá. Quá hạn hiệu lực vẫn ghi "Được chấp nhận" được, kèm cảnh báo [QB10]. Được chấp nhận **không** tự chốt Thắng cơ hội (D3); giao diện hiện lối tắt "Chốt Thắng cơ hội".
7. **Báo giá đang theo đuổi**: báo giá đầu tiên được gửi của một cơ hội tự thành "đang theo đuổi"; người phụ trách đổi sang báo giá khác đã có phiên bản gửi. Chỉ chấp nhận được phiên bản của báo giá đang theo đuổi (khác ⇒ `QUOTE_NOT_PRIMARY`, R-Q7); khi một phiên bản được chấp nhận, báo giá đang theo đuổi được giữ nguyên và cố định — thao tác chấp nhận **không** tự chọn hay chuyển báo giá đang theo đuổi (diễn giải triển khai Owner xác nhận ngày 25/11/2026) [QB6, QB7].
8. **Đồng bộ giá trị cơ hội** (D7) — ở đúng ba sự kiện: (a) gửi một phiên bản của báo giá đang theo đuổi; (b) đổi báo giá đang theo đuổi; (c) chấp nhận một phiên bản. Khi đó `opportunity.expected_amount_vnd` **được gán bằng** `subtotal_vnd` (chưa VAT) của **phiên bản đã gửi mới nhất** của báo giá đang theo đuổi — phép **gán**, không cộng.
   - Cơ hội không ở `OPEN` ⇒ không đồng bộ.
   - Giá trị không đổi ⇒ không ghi lịch sử, không tăng `version`.
   - Giá trị đổi ⇒ thêm dòng `opportunity_change` (`field = AMOUNT`, cũ → mới, lý do `Theo báo giá BG-… v…`, người thực hiện = người bấm) và tăng `opportunity.version` thêm 1.
   - **Sửa tay giá trị cơ hội** [QB5]: vẫn được, theo đường ghi hiện có. Sự kiện (a) / (b) / (c) kế tiếp ghi đè và để lại lịch sử. Nhãn cạnh ô giá trị: "theo báo giá BG-… v…" khi giá trị cơ hội bằng giá trị phiên bản nói trên, "đã sửa tay, khác báo giá" khi khác. Nhãn tính lúc đọc, **không thêm cột** vào `opportunity`.
9. **Xoá**: xoá mềm nháp, hoặc cả báo giá khi chưa có phiên bản nào đã gửi (R-Q9).
10. **Loại báo giá** [QB19 — chỉ Quản trị CRM]: thêm, sửa tên / tiêu đề / câu chào / điều khoản mặc định / số ngày / VAT mặc định / cách tính VAT / danh sách cột; ngừng dùng (không xoá). Sửa loại **không** đổi báo giá đã lập (4.3); nháp đang soạn giữ danh sách cột lúc nó được tạo.
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
| A chấp nhận báo giá X, B cùng lúc chấp nhận báo giá Y (cùng cơ hội) | Một người thành công; người kia `QUOTE_ALREADY_ACCEPTED` (5.4: khoá chung trên dòng cơ hội + U-4) |
| A chấp nhận báo giá X, B cùng lúc đổi báo giá đang theo đuổi sang Y | Chạy lần lượt trên khoá chung; nếu A trước ⇒ B nhận `QUOTE_PRIMARY_FIXED`; nếu B trước ⇒ A nhận `QUOTE_NOT_PRIMARY` |
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
- A1–A9: chín ca đầu của bảng 6.1 ra đúng từng số, ở **cả hai** nơi: máy chủ (BigInt) và DB (chèn trực tiếp số sai ⇒ CHECK / trigger từ chối).
- A10: máy chủ bỏ qua tổng do trình duyệt gửi lên. A11: số lượng 4 chữ số thập phân, số âm, đơn giá lẻ, VAT khác 8 / 10, chữ thay số ⇒ 400, không lưu gì.
- A12: tiền trả về ở dạng chuỗi số; giá trị vượt ngưỡng số nguyên an toàn của JavaScript vẫn đúng từng chữ số.
- A13: ca A10, A11 của bảng 6.1 (VAT một mức / theo dòng; giá vốn và lãi gộp tạm tính, kể cả khi một phần dòng chưa nhập giá vốn).
- A14 (đường nhập): đơn giá `999999999999`, số lượng `999999.999`, và một bộ có tổng vượt `2^53` đi trọn vòng **yêu cầu → máy chủ → DB → phản hồi** đúng từng chữ số; cùng giá trị gửi dưới dạng số JSON, `1e3`, `1,000`, `+5`, ` 5` ⇒ 400. Test tĩnh: mã module báo giá không gọi `Number(`, `parseFloat(`, `parseInt(` trên trường tiền / số lượng.

**B. Database và trigger** (Q2; bài kiểm SQL chạy trong CI bằng `siscom_app`)
- B1: phiên bản đã gửi — UPDATE **lần lượt mọi cột** nội dung, DELETE ⇒ từ chối. B2: INSERT / UPDATE / DELETE dòng của phiên bản đã gửi, chuyển dòng sang phiên bản khác ⇒ từ chối.
- B3: gửi phiên bản không có dòng hàng (kể cả chỉ có dòng nhóm) ⇒ từ chối. B4: gửi khi `base8_vnd` / `base10_vnd` lệch tổng dòng ⇒ từ chối.
- B5: mọi chuyển trạng thái ngoài R-Q3 ⇒ từ chối. B6: U-1, U-2, U-3 và khoá ngoại kép ⇒ từ chối.
- B7: các cột bất biến của `quote` (kể cả `template_id`); bật `is_primary` khi chưa có phiên bản gửi; R-Q7, R-Q8.
- B8: `siscom_app` không DELETE được `quote`, `quote_template`, `quote_user_default`, không TRUNCATE bảng nào, và chỉ DELETE được `quote_version` / `quote_line` của **bản nháp** (mục 19, điểm 9); `siscom_auth`, `siscom_acct` không SELECT được năm bảng; vai trò `admin` không nhận được mã `quote.*` (SoD).
- B9: danh sách cột của R-Q2a khớp `information_schema`.
- B10: `columns` sai hình dạng (11 cột, key trùng, key sai mẫu, nhãn quá dài) ⇒ từ chối; `extra` có khoá ngoài danh sách cột, quá 10 khoá, giá trị không phải chuỗi ⇒ từ chối; đổi `columns` của nháp khi còn dòng dùng khoá bị bỏ ⇒ từ chối; dòng nhóm có số tiền hoặc giá vốn ⇒ từ chối.
- B12 (**hai kết nối thật, SQL trực tiếp, không qua API**): hai transaction cùng lúc chấp nhận hai báo giá khác nhau của một cơ hội ⇒ đúng một bên thành công, bên kia `QUOTE_ALREADY_ACCEPTED` hoặc lỗi trùng U-4; lặp 50 lần, không lần nào có hai phiên bản được chấp nhận. Người gọi tự truyền `accepted_opportunity_id` sai ⇒ trigger ghi đè giá trị đúng.
- B13 (thứ tự khoá thực tế): một transaction chấp nhận báo giá X trong lúc transaction khác đổi báo giá đang theo đuổi sang Y — chạy theo cả hai thứ tự xen kẽ và cả kiểu "ứng dụng ↔ SQL trực tiếp" ⇒ kết quả chỉ có thể là: một bên bị từ chối bởi R-Q7 / R-Q8, hoặc một bên bị `deadlock_detected`; **không bao giờ** ra trạng thái "đã chấp nhận X nhưng đang theo đuổi Y". Kiểm `pg_locks` trong lúc chờ để xác nhận điểm chờ là dòng cơ hội.
- B14: SQL trực tiếp bằng `siscom_app` đổi `quote_version.created_by`, `quote.created_by`, `vat_mode`, `quote_id`, `version_no` ⇒ từ chối, kể cả trên bản nháp.
- B15 (hai kết nối thật): transaction A đang thêm / sửa / xoá dòng hàng chưa commit, transaction B gửi chính phiên bản đó ⇒ B chờ; A commit ⇒ B chạy và bị từ chối nếu tổng lệch; đảo thứ tự ⇒ A bị `QUOTE_VERSION_LOCKED`.
- B16 (**bảo vệ `accepted_opportunity_id`, SQL trực tiếp bằng `siscom_app`**): (a) INSERT phiên bản với `status` khác `DRAFT`, hoặc với `accepted_opportunity_id` / `sent_at` / `decided_at` có giá trị ⇒ từ chối; (b) UPDATE đặt `accepted_opportunity_id` trên bản `DRAFT`, `SENT`, `REJECTED` ⇒ từ chối; (c) chuyển `SENT → ACCEPTED` kèm `accepted_opportunity_id` của **cơ hội khác** ⇒ từ chối; không truyền cột này ⇒ thành công và giá trị = cơ hội của báo giá; (d) trên bản đã `ACCEPTED`: đổi sang cơ hội khác, đặt về NULL, đổi `status`, DELETE ⇒ đều từ chối; (e) sau toàn bộ các ca B và D, truy vấn bất biến trả 0 dòng: phiên bản `ACCEPTED` có `accepted_opportunity_id` khác `quote.opportunity_id`, hoặc phiên bản không `ACCEPTED` có giá trị khác NULL; (f) danh sách cột được phép đổi sau khi gửi (R-Q2a) không cho người gọi tự đổi cột này — chỉ giá trị do trigger tính mới qua được.
- B11: `vat_mode = QUOTE` mà gửi với hai mức VAT ⇒ từ chối; đổi `vat_mode` hoặc `created_by` của phiên bản (kể cả nháp) ⇒ từ chối; giá vốn âm hoặc vượt giới hạn ⇒ từ chối; sửa giá vốn của phiên bản đã gửi ⇒ từ chối.

**C. Bảo mật** (Q4–Q6, Q9, Q10; ma trận 5 vai trò)
- C1: mỗi endpoint đọc × 5 vai trò × {phụ trách, chỉ xem, ngoài phạm vi} đúng 7.1. C2: mỗi endpoint ghi tương tự.
- C3: Kỹ thuật có công việc đang mở trên cơ hội (không có mã `quote.read`): **mọi** endpoint báo giá ⇒ **403**, giống hệt nhau với id có thật và id không tồn tại, thân phản hồi không chứa dữ liệu báo giá (quy ước ở 7.1; bản v7 ghi 404); người **có** `quote.read` nhưng chỉ thấy cơ hội theo đường theo việc ⇒ 404; chi tiết cơ hội đường theo việc không có khoá nào mới (`TECH_KEYS`).
- C4: xem bản in không quyền ⇒ trang "không có quyền", 0 lời gọi API báo giá (Chrome thật).
- C5: sau khi đồng bộ giá trị, đường theo việc vẫn không có giá trị, tổng cột, số đếm. C6: dòng `AMOUNT` chỉ thấy trên đường đầy đủ.
- C7: không có dòng `opportunity_document` nào do báo giá sinh ra. C8: không có hoạt động / công việc / kết quả tìm kiếm chung nào chứa dữ liệu báo giá.
- C9: `audit_log` không chứa số tiền hay nội dung dòng hàng; lỗi DB trả mã cố định.
- C10: thu hồi `quote.read` hoặc `quote.export` giữa phiên ⇒ lần gọi kế tiếp bị từ chối.
- C11: tải PDF / Excel × 5 vai trò × 3 phạm vi đúng 7.1 (Kế toán tải được mọi báo giá [QB21]); phản hồi có `Cache-Control: no-store`; có dòng `QUOTE_EXPORT`; không có tệp nào còn lại trên đĩa máy chủ sau khi tải.
- C12: loại báo giá và mặc định cá nhân: người không có quyền ⇒ 403 / 404; không ai đọc hay sửa được mặc định cá nhân của người khác.
- C13: tệp Excel — mọi ô chứa nội dung người dùng nhập, kể cả chuỗi bắt đầu bằng `=`, `+`, `-`, `@` và chuỗi dạng `=HYPERLINK(…)`, `=cmd|…`, được ghi là **chữ**; đọc lại tệp: tập ô có công thức **đúng bằng** tập ô CRM chủ định sinh (thành tiền, các dòng tổng), mọi công thức chỉ dùng `ROUND`, `SUM`, `SUMIF` và phép `+ *`; không có macro, liên kết ngoài, kết nối dữ liệu.
- C14 (giá vốn): ma trận {Quản trị CRM, người tạo phiên bản, Kinh doanh khác đang phụ trách cơ hội, Kinh doanh chỉ-xem, Kế toán} × {chi tiết, danh sách, theo cơ hội, giá trị điền sẵn, tải PDF, tải Excel, xem bản in} — chỉ hai đối tượng đầu nhận được khoá giá vốn / lãi gộp, và chỉ ở API chi tiết; phản hồi của người khác **không có các khoá đó** (so danh sách khoá); PDF, Excel, bản in của **mọi** người đều không có giá vốn (tìm chuỗi số giá vốn trong tệp ⇒ không thấy); người không được xem tạo bản mới ⇒ giá vốn bản mới trống; `audit_log` và lịch sử không có giá vốn. Thêm, đều với dữ liệu **đã có giá vốn** và người gọi **không được xem**: (a) người tạo cũ sau khi mất quyền xem cơ hội ⇒ 404 ở mọi endpoint, không còn thấy giá vốn; (b) gửi kèm `created_by` / `createdBy` trong thân yêu cầu ⇒ 400, và dòng tạo ra luôn mang người đang đăng nhập; (c) phản hồi lỗi kiểm dữ liệu, 409, 422 của mọi endpoint ghi không chứa chuỗi số giá vốn; (d) người không được xem lưu nháp ⇒ giá vốn đang lưu **không bị xoá và không bị lộ**.
- C15: mọi phản hồi API báo giá có `Cache-Control: no-store`; giao diện không ghi dữ liệu báo giá vào bộ nhớ trình duyệt; lỗi của endpoint xuất tệp (không quyền, phiên bản không tồn tại, thư viện ném lỗi giả lập) trả mã cố định, không có nội dung báo giá; `total` / `totalPages` / số đếm của Kinh doanh chỉ gồm báo giá người đó được xem (so với cùng truy vấn của Quản trị CRM); tham số lọc / sắp xếp theo giá vốn ⇒ 400.

**D. Đồng thời** (Q5; hai kết nối thật, mẫu `concurrency.int-spec`)
- D1–D7: bảy tình huống của bảng 8.1, mỗi tình huống lặp 20 lần, không có lần nào ra trạng thái sai.
- D11: sau mọi tình huống, giá trị cơ hội = `subtotal_vnd` của phiên bản đã gửi mới nhất của báo giá đang theo đuổi; số dòng lịch sử `AMOUNT` = số lần giá trị thực sự đổi.
- D8: gửi lần lượt v1 (100), v2 (150) ⇒ giá trị cơ hội 150, **không** 250. D9: sửa tay rồi gửi v3 ⇒ bị ghi đè, có lịch sử; nhãn đúng ở từng bước.
- D10: không có khoá chéo (deadlock) trong 200 lượt ghi xen kẽ báo giá và cơ hội.

**E. Bản in và tệp xuất** (Q8–Q10; Chrome thật và đọc lại tệp)
- E1: mỗi loại trong bốn loại ở 4.1 — báo giá 4 dòng vừa một trang, đối chiếu từng khối với tệp mẫu của công ty. E2: 60 dòng ⇒ nhiều trang, tiêu đề cột lặp lại, không dòng nào bị cắt đôi, khối ký và khối tài khoản nguyên vẹn. E3: 300 dòng, 10 cột riêng, nội dung dài ⇒ không tràn ngang (khổ ngang).
- E4: tải lại phiên bản đã gửi sau khi đổi khách hàng, nhân viên, hạng mục, **loại báo giá** (đổi tiêu đề, bỏ cột), mặc định cá nhân, và thêm bố cục in mới ⇒ nội dung **giống hệt** bản trước (so văn bản trích từ PDF và giá trị ô của Excel).
- E5: giao diện nền tối ⇒ bản in vẫn nền trắng. E6: nháp có chữ chìm và `_NHAP`; bản đã gửi không có.
- E7: tên tệp với tên có dấu, `đ/Đ`, ký tự `/ \ : * ? " < > |`, tên rỗng sau chuẩn hoá, tên 300 ký tự, phiên bản 1 và 2 ⇒ đúng 4.4.
- E8: nhập `<script>` và thẻ HTML vào mọi ô chữ ⇒ hiển thị nguyên văn trên màn hình, PDF và Excel.
- E9: PDF có đủ dấu tiếng Việt (trích văn bản ra so được với dữ liệu); tổng trong PDF **bằng** tổng API trả về, từng đồng. Excel: giá trị kèm sẵn của mọi ô công thức bằng số API trả về, **và** tính lại công thức (bằng một bộ tính công thức trong test) cũng ra đúng số đó trên toàn bộ ca A1–A6, A9, A10.
- E11 (Excel, đọc **cấu trúc tệp thật**): giải nén tệp `.xlsx` và đọc XML của trang tính — kiểu ô (`t="s"` / `inlineStr` cho chữ, số cho SL và đơn giá, `<f>` cho công thức) đúng với 4.4, không chỉ so giá trị hiển thị. Bộ dữ liệu: số tiền gần giới hạn, ô ghi chú / cột riêng để trống, chuỗi Unicode (tiếng Việt có dấu, ký tự gộp, biểu tượng), 300 dòng. Đổi SL và đơn giá trong tệp rồi tính lại bằng bộ tính công thức ⇒ thành tiền, các dòng tổng và VAT đổi theo đúng công thức mục 6.
- E12 (**thủ công, Excel thật**, ghi vào biên bản nghiệm thu Q10): mở tệp bằng Microsoft Excel — không có cảnh báo bảo mật hay hộp thoại sửa tệp; bấm tính lại toàn bộ ⇒ các số không đổi; sửa một SL ⇒ tổng đổi đúng; ô chữ bắt đầu bằng `=` vẫn hiện là chữ.
- E10: báo giá có hai mức VAT ⇒ bảng có cột "VAT %", phần tổng có hai dòng VAT; chỉ một mức ⇒ không có cột "VAT %", chỉ một dòng VAT.

**F. Rollback và triển khai** (Q2, Q3, Q11)
- F1: script rollback gỡ sạch cấu trúc khi năm bảng rỗng (trừ dòng nạp sẵn "Báo giá chung"); **từ chối** khi có dữ liệu. F2: áp → gỡ → áp lại trong CI.
- F3: mã bản trước (không có Báo giá) chạy bình thường trên DB đã có migration này. F4: script cấp quyền chạy hai lần cho cùng kết quả; script gỡ quyền trả DB về trạng thái trước.
- F5: nghiệm thu trên máy chủ theo khuôn các lần trước: sao lưu + khôi phục thử trước migration, `--auto-rollback`, các bài VERIFY không có FAIL.
- F7 (**phân biệt lùi mã và lùi cấu trúc khi đã có dữ liệu thật**): trên DB có báo giá đã gửi — (a) lùi mã về bản trước: ứng dụng chạy bình thường, dữ liệu báo giá còn nguyên, triển khai lại bản mới thì đọc được đủ (đây là đường lùi **duy nhất** được dùng khi đã có dữ liệu); (b) chạy script gỡ cấu trúc ⇒ **từ chối**, không gỡ gì, không mất dòng nào; (c) script gỡ quyền `quote.*` chạy được và không đụng dữ liệu. Tài liệu vận hành ghi rõ: gỡ cấu trúc khi đã có dữ liệu chỉ làm sau khi xuất dữ liệu và có duyệt riêng của Owner.
- F6: mỗi PR thêm thư viện (Q9, Q10): `npm audit` không có lỗ hổng mức cao trở lên do thư viện mới; ghi giấy phép và kích thước; lùi PR đó ⇒ phần còn lại của Báo giá vẫn chạy (chỉ mất nút tải tương ứng).

## 12. Kế hoạch PR nhỏ (Draft; ChatGPT review; Owner duyệt merge từng PR)

| PR | Nội dung | Phụ thuộc | PASS khi | Đụng DB? |
|---|---|---|---|---|
| **Q1** | Tài liệu này + chú thích đồng bộ trong `SALES_DESIGN.md` | — | Review không còn điểm chặn; Owner duyệt đặc tả (các điểm QO đã chốt hết) | không |
| Q2 | Migration: 5 bảng, kiểu enum, hàm mã, hàm kiểm JSON, CHECK, chỉ mục duy nhất (gồm U-4), trigger, `fn_auth_perm_class`; nạp "Báo giá chung"; rollback; bài kiểm cấu trúc và bài kiểm hai kết nối | Q1 | Nhóm B (gồm B12–B16), F1, F2, F7(b) | chỉ PostgreSQL tạm của CI |
| Q3 | Grants + VERIFY; mã quyền `quote.*`, script hai người / gỡ / kiểm; ma trận `bootstrap.ts` | Q2 | B8, F4; VERIFY hiện có không đổi kết quả | chỉ CI |
| Q4 | Backend đọc: báo giá, loại báo giá, mặc định cá nhân, giá trị điền sẵn, hàm tên tệp | Q3 | C1, C3, C5–C9 (phần đọc), C12, E7 | không |
| Q5 | Backend ghi báo giá + tính tiền + giá vốn + đồng bộ giá trị cơ hội | Q4 | Nhóm A (gồm A14), C2, C10, C14 (API), C15, nhóm D | không |
| Q6 | Backend ghi loại báo giá + mặc định cá nhân | Q4 | C12, B10 (qua API), D6 | không |
| Q7 | Giao diện: tab Báo giá + màn hình soạn (cột riêng, dòng nhóm, VAT theo dòng) | Q5 | Test giao diện; Chrome thật các luồng chính | không |
| Q8 | Giao diện: xem bản in, trang Báo giá, quản lý loại báo giá, mặc định của tôi, điện thoại | Q6, Q7 | E1–E3 (bản in), E5, E6, E8, E10, C4 | không |
| Q9 | Tải PDF: thêm **một** thư viện dựng PDF + phông chữ; endpoint xuất | Q5 | C11, C14 (PDF), E2–E4, E9 (PDF), F6 | không |
| Q10 | Tải Excel: thêm **một** thư viện dựng Excel; endpoint xuất | Q5 | C11, C13, C14 (Excel), C15, E4, E9 (Excel), E11, E12, F6 | không |
| Q11 | Lên máy chủ | Q2–Q10 đã merge | F3, F5, F7(a)(c); Owner nghiệm thu | **Owner duyệt riêng từng bước** |

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
| Tệp Excel bị chèn công thức độc hại qua nội dung người dùng nhập | Công thức chỉ ở ô do CRM sinh, từ một danh sách hàm cố định; mọi nội dung người dùng nhập ghi kiểu chuỗi (4.4); C13 |
| Tệp Excel bị sửa rồi gửi khách, lệch bản đã khoá trong CRM | Không ngăn được bằng kỹ thuật (Owner chọn có công thức, QB22). Dòng ghi chú trong tệp; bản chính thức là PDF / bản trong CRM; khuyến nghị gửi khách bằng PDF |
| Lộ giá vốn | Bỏ khoá khỏi phản hồi theo danh sách tường minh; không có trong tệp xuất; không chép sang bản mới của người không được xem (7.3); C14. Người truy cập thẳng database vẫn thấy — đã ghi ở 7.3 |
| Cột riêng tự do làm bảng quá rộng | Tối đa 10 cột, nhãn ≤ 40 ký tự; tự chuyển khổ ngang; E3 |
| Mẫu của công ty có điểm chưa hỗ trợ (giá đã gồm VAT, công thức tính giá từ giá vốn) | Ghi rõ ở mục 3 và QO16; làm sau |

## 14. Đối chiếu review R1 (24/11/2026, tại `c9cd4ca`) → mục sửa → ca nghiệm thu

| Mã | Nhận xét R1 | Trạng thái | Mục sửa | Ca |
|---|---|---|---|---|
| `PR266-R1-DB-01` | Hoàn thiện mô hình DB: trigger chống sửa sau gửi kể cả khi cập nhật đồng thời; không gửi được báo giá rỗng hoặc lệch tổng; khoá các trường ảnh hưởng bản in; unique, khoá ngoại, tranh chấp | **FIXED** (R2 nêu thiếu ở R-Q7, sửa ở v6; R3 nêu thiếu bảo vệ `accepted_opportunity_id`, sửa ở v7) | 5.1–5.4, 4.3 | B1–B16 |
| `PR266-R1-MONEY-01` | Chốt công thức, làm tròn 0,5 đồng, số lượng lẻ, giới hạn; số học chính xác; CHECK; bảng ví dụ và test | **FIXED** | 6, 6.1, C-1…C-3 | A1–A12 |
| `PR266-R1-SEC-01` | Kỹ thuật và Quản trị hệ thống không đọc được báo giá ở mọi đường, kể cả gián tiếp; dùng lại RBAC và phạm vi cơ hội | **FIXED** | 7.1, 7.2 | C1–C13, B8 |
| `PR266-R1-SYNC-01` | Chống hai người gửi / đổi đang theo đuổi cùng lúc; khoá, optimistic version, 409, lịch sử; không cộng dồn; sửa tay giá trị cơ hội | **FIXED** (Owner đã chốt QB5–QB7; R2 nêu thiếu phân tích khoá chéo, sửa ở v6) | 5.4, 8 (quy tắc 7, 8), 8.1 | D1–D11 |
| `PR266-R1-PRINT-01` | Lưu cố định dữ liệu in theo phiên bản; in lại không đổi; phân trang A4, bản dài, tên tệp | **FIXED** (Owner đã chốt QB4) | 4.3, 4.4 | E1–E10 |
| `PR266-R1-TEST-01` | Bổ sung test bảo mật, đồng thời, tiền, trigger, rollback, bản in; PR nhỏ, độc lập, có PASS/FAIL; đồng bộ `SALES_DESIGN.md` | **FIXED** (R2 nêu thiếu ca khoá, hồi quy quyền và mâu thuẫn với `SALES_DESIGN.md`; sửa ở v6) | 11, 12; chú thích trong `SALES_DESIGN.md` | A–F |
| `PR266-R1-OWNER-01` | Giữ các điểm QO chờ Owner; đề xuất rõ quyết định mới; không tự ghi APPROVED / ACCEPTED | **FIXED** | 1, 2 | — |

## 15. Thay đổi ở v4 so với v3 (sau khi Owner trả lời ngày 24/11/2026)

| Trả lời / yêu cầu của Owner | Thay đổi trong tài liệu |
|---|---|
| QO1, QO2, QO3, QO5 theo đề xuất | Chuyển thành QB8, QB9, QB10, QB12 |
| QO4: VAT 8 hoặc 10 % | QB11. Bỏ mức 0 và 5 %. Vì mẫu ống gió vải của công ty dùng **cả hai mức trong một báo giá**, VAT chuyển từ "một mức cho cả báo giá" sang **theo từng dòng** (ở v4 còn chờ QO14; v5 đã chốt lại thành QB18: một mức là mặc định, theo dòng là lựa chọn của loại báo giá); các cột tổng đổi thành `base8/base10/vat8/vat10`; bảng 6.1 viết lại |
| QO6: chưa cần chiết khấu | QB13. Bỏ cột `discount_vnd` và mọi quy tắc chiết khấu |
| QO7: nút tải PDF một chạm, chấp nhận thư viện | QB14. Thêm 4.4, endpoint xuất, `quote.export`, PR Q9; "xem bản in" giữ lại làm xem trước |
| QO8: mỗi nhân viên tự soạn | QB15. Bỏ bảng `quote_setting` (mẫu chung do Quản trị soạn); thêm `quote_user_default`; điều khoản mặc định đi theo loại báo giá, nhân viên sửa trên từng báo giá |
| Xuất được cả Excel | QB16. 4.4, PR Q10, ca C13 (chống chèn công thức), QO18 |
| Mỗi loại vật tư một mẫu; có phần điều chỉnh các loại báo giá | QB17. Thêm bảng `quote_template` (tiêu đề, cột riêng, điều khoản mặc định), bản chép vào phiên bản, `quote_line.extra`, dòng tiêu đề nhóm, màn hình quản lý, quyền `quote.template`, PR Q6; QO15 |
| (Tác giả phát hiện khi đọc các tệp mẫu) | Mẫu "linh kiện" ghi giá đã gồm VAT ⇒ QO16; các tệp có công thức tính giá từ giá vốn / tỷ giá ở cột ẩn ⇒ ghi rõ ngoài phạm vi (mục 3) |
| QO9 (giá vốn) | Owner chưa trả lời; giữ đề xuất "chưa lưu" |

## 16. Thay đổi ở v5 so với v4 (Owner chốt QO9, QO14–QO18 ngày 24/11/2026)

| Trả lời của Owner | Thay đổi trong tài liệu |
|---|---|
| QO14: VAT một mức cho cả báo giá; tuỳ loại báo giá, điều chỉnh sau; có lựa chọn theo từng dòng | QB18. Thêm `vat_mode` (`QUOTE` mặc định / `LINE`) trên loại báo giá và bản chép trên phiên bản; ràng buộc "mọi dòng cùng mức" ở R-Q1; ca A10, B11. Cấu trúc tổng `base8/base10` giữ nguyên cho cả hai chế độ |
| QO15: chỉ Quản trị CRM | QB19 (đúng đề xuất) |
| QO16: mọi loại nhập giá trước VAT | QB20 (đúng đề xuất) |
| QO17: Quản trị CRM, Kinh doanh phụ trách cơ hội, **Kế toán** | QB21. `quote.export` cấp thêm cho Kế toán (mọi báo giá) |
| QO18: Excel **có công thức** | QB22. 4.4 viết lại: công thức chỉ ở ô do CRM sinh, kèm giá trị; nội dung người dùng nhập vẫn là chữ; ca C13, E9 viết lại; thêm rủi ro "tệp bị sửa" |
| QO9: **có lưu giá vốn** từng dòng, chỉ Quản trị CRM và người lập thấy | QB23. Thêm `quote_line.cost_price_vnd`, quyền `quote.cost`, mục 7.3, lãi gộp tạm tính (mục 6), R-Q13, ca A11, B11, C14 |

## 17. Đối chiếu review R2 (24/11/2026, tại `24210c0`) → mục sửa → ca nghiệm thu

Kết luận R2 của reviewer: CẦN BỔ SUNG, hai điều kiện chặn (khoá R-Q7; đồng bộ tài liệu Sales với QB23 + bảo vệ `created_by`). Không có điểm nào buộc Owner quyết lại.

| Mã | Nhận xét R2 | Trạng thái | Đã làm | Mục | Ca |
|---|---|---|---|---|---|
| `PR266-R2-LOCK-01` (**chặn**) | R-Q7 đọc các `quote` bằng `FOR SHARE` khi transaction có thể đã giữ khoá ghi; không thể kết luận hết khe hở chỉ dựa vào việc ứng dụng khoá dòng cơ hội; cần một điểm khoá chung nhất quán và test hai kết nối thật | **FIXED** | Bỏ hẳn việc khoá các dòng `quote` trong R-Q7. Thêm **U-4** (chỉ mục duy nhất theo cơ hội trên `accepted_opportunity_id`) làm ràng buộc cứng không phụ thuộc khoá; R-Q7 và R-Q8 tự lấy **một điểm khoá chung** là dòng `opportunity`; bảng phân tích ba kiểu xen kẽ (ứng dụng, SQL trực tiếp, lẫn hai kiểu) và điều được bảo đảm trong mọi trường hợp | 5.2 (U-4, C-8), 5.3 (R-Q7, R-Q8), **5.4** | B12, B13, B15, D4, D5 |
| `PR266-R2-MONEY-01` | Công thức đúng nhưng cần kiểm đường chuyển dữ liệu đầu vào thành `BigInt`, không qua `Number` | **FIXED** | Quy định dạng chuỗi cho tiền và số lượng, chuyển thẳng chuỗi → `BigInt`; từ chối số JSON / số mũ / dấu phân cách; test tĩnh cấm `Number(` trên trường tiền | 6 | A14 |
| `PR266-R2-COST-01` (**chặn**, phần `created_by`) | `created_by` phải lấy từ phiên đăng nhập; người tạo cũ chỉ xem giá vốn khi vẫn còn `quote.read`; clone, lỗi xác thực, 409, nhật ký, xuất tệp phải kiểm cả khi giá vốn tồn tại mà người gọi không được xem | **FIXED** | `created_by` do máy chủ đặt, DTO không có trường này, R-Q13 chặn đổi ở DB; "là người tạo" chỉ xét **sau** kiểm tra phạm vi, không mở rộng phạm vi; lỗi không lặp lại giá trị giá vốn | 7.3, 5.3 (R-Q13) | B14, C14 (a)–(d) |
| `PR266-R2-XLSX-01` | Test phải đọc cấu trúc XLSX thật, thử Excel thật; thêm số lớn, ô trống, Unicode, đổi SL / đơn giá rồi tính lại | **FIXED** | Ca đọc XML của tệp; ca thủ công mở bằng Excel thật ghi vào biên bản Q10 | 11 nhóm E | E11, E12, C13, E9 |
| `PR266-R2-LEAK-01` | Khi viết mã cần kiểm cache trình duyệt, lỗi của endpoint xuất, phản hồi phân trang / lọc | **FIXED** | Ba dòng mới trong bảng 7.2; `no-store` cho mọi API báo giá; số đếm theo phạm vi; cấm lọc / sắp xếp theo giá vốn | 7.2 | C15 |
| `PR266-R2-TEST-01` | Thêm: hai transaction trực tiếp cùng chấp nhận; thứ tự khoá thực tế của R-Q7, R-Q8; SQL trực tiếp đổi `created_by`; gửi trong lúc transaction khác sửa dòng hàng; rollback khi đã có dữ liệu thật, phân biệt lùi mã với lùi cấu trúc | **FIXED** | Năm ca tương ứng | 11 | B12, B13, B14, B15, F7 |
| `PR266-R2-DOC-01` (**chặn**) | `SALES_DESIGN.md` còn câu "giá vốn để sau", mâu thuẫn QB23 | **FIXED** | Sửa hai chú thích: giá vốn từng dòng thuộc Báo giá đợt 1 (QB23); phần còn để sau là **báo cáo lợi nhuận tổng hợp** | `docs/SALES_DESIGN.md` | — |

Ngoài ra v6 ghi nhận Owner đã xác nhận hai chỗ diễn giải ở mục 2 (bình luận `[OWNER-DECISION]` trên PR, 24/11/2026).

## 18. Đối chiếu review R3 (24/11/2026, tại `d22b1a1`) → mục sửa → ca nghiệm thu

Kết luận R3 của reviewer: CẦN BỔ SUNG, **một** điều kiện chặn hẹp; COST-01, DOC-01, MONEY-01, XLSX-01, LEAK-01, TEST-01 được reviewer đóng ở mức review tài liệu (PASS — nghĩa là đặc tả đã có yêu cầu, chưa phải các ca đã chạy). Không có điểm nào buộc Owner quyết lại.

| Mã | Nhận xét R3 | Trạng thái | Đã làm | Mục | Ca |
|---|---|---|---|---|---|
| `PR266-R3-ACC-01` (**chặn**) | U-4 chỉ bảo đảm tính duy nhất, không tự bảo đảm `accepted_opportunity_id` đúng với cơ hội của báo giá; cần ràng buộc bất biến ở DB: chỉ trigger chuyển trạng thái hợp lệ được đặt giá trị, không có đường SQL trực tiếp (INSERT / UPDATE / xoá giá trị) làm sai, kể cả sau khi đã chấp nhận | **FIXED** | **R-Q14**: ở mọi INSERT / UPDATE, DB tự tính lại cột từ `quote.opportunity_id` theo `status`; người gọi truyền giá trị khác ⇒ lỗi. **R-Q15**: dòng mới bắt buộc là nháp, không chèn thẳng được bản đã gửi / đã chấp nhận. Mọi quy tắc của `quote_version` gom vào một hàm trigger để không phụ thuộc thứ tự gọi. Kết hợp `quote_id` và `quote.opportunity_id` bất biến ⇒ giá trị không thể lệch | 5.3 (R-Q14, R-Q15, câu mở đầu), 5.4 | **B16** (a)–(f) |
| `PR266-R3-WORD-01` | Mục 5.4 không nên khẳng định tuyệt đối "không có deadlock"; SQL trực tiếp vẫn có thể gây deadlock | **FIXED** | Đổi thành "không dự kiến khoá chéo giữa các đường ghi của ứng dụng tuân theo cùng thứ tự khoá"; thêm đoạn "Phạm vi của cam kết": khoá chéo là rủi ro đã nhận diện, không phải đã loại bỏ; tính đúng của dữ liệu dựa vào U-3, U-4 và R-Q14, không dựa vào khoá. Đổi tiêu đề "Vì sao không còn khe hở…" thành "Hành vi khi chạy đồng thời" | 5.3, 5.4 | B12, B13, D10 |
| `PR266-R3-TEST-01` | Bổ sung ca bảo vệ `accepted_opportunity_id` | **FIXED** | Ca B16; Q2 phải đạt B12–B16 | 11, 12 | B16 |

Đây là vòng review thứ ba (tối đa theo quy trình). Sau bản v7, việc duyệt đặc tả và cho bắt đầu Q2 là quyết định của Owner.

## 19. Ghi chú triển khai Q2 (migration `20261125000000_quotes`) — chỗ làm chặt hơn hoặc khác chữ so với mục 5 và 11

Không đổi quyết định QB nào. Các điểm dưới đây phát sinh khi viết migration và bài kiểm; reviewer xét ở PR Q2.

| # | Nội dung | Lý do | Ca kiểm |
|---|---|---|---|
| 1 | **Gửi (R-Q1) và xoá mềm báo giá (R-Q9) cũng lấy điểm khoá chung** (dòng `opportunity` `FOR UPDATE`); gửi phiên bản của báo giá đã xoá mềm ⇒ lỗi `QUOTE_DELETED` | Không có khoá chung thì "xoá mềm báo giá" và "gửi phiên bản của nó" chạy đồng thời có thể cùng thành công, ra báo giá đã xoá nhưng có phiên bản đã gửi. Thứ tự khoá của ứng dụng (8.1) không đổi | X1, X2 (hai kết nối), Q156 |
| 2 | Dòng `quote` mới **không được** tạo sẵn `is_primary = true` hay đã xoá (`QUOTE_INSERT_STATE`) | Cùng lý do với R-Q15: không cho chèn thẳng để vượt R-Q5 / R-Q8 | Q079 |
| 3 | C-4 chặt hơn: phiên bản **nháp** thì `sent_by`, `sent_at` phải NULL | Tránh nháp mang thông tin gửi | Q098 |
| 4 | Thêm CHECK "không rỗng" cho các ô chữ bắt buộc của `quote_version`, `quote_template`, `quote_line.description`; `quote.item_name` phải đã cắt khoảng trắng | Như các bảng hiện có | Q016, Q033, Q080 |
| 5 | Mọi lỗi của trigger mang trường `CONSTRAINT` = mã lỗi cố định (`QUOTE_VERSION_LOCKED`, `QUOTE_ALREADY_ACCEPTED`…); SQLSTATE `23001` cho bất biến / khoá / trạng thái, `23514` cho dữ liệu chưa đủ điều kiện gửi | Để Q5 đổi lỗi DB thành mã lỗi API mà không phải dò chữ trong thông báo (7.2) | mọi ca `expect_err` có mã |
| 6 | **B12 đọc lại cho đúng với U-3 + R-Q7**: hai báo giá *khác nhau* của một cơ hội không bao giờ cùng đủ điều kiện chấp nhận (chỉ một báo giá đang theo đuổi, và chỉ báo giá đó được chấp nhận). Bài kiểm chạy đua hai kiểu: hai phiên bản đã gửi của báo giá đang theo đuổi (bên thua: `QUOTE_ALREADY_ACCEPTED`), và báo giá đang theo đuổi ↔ báo giá khác (bên thua: `QUOTE_NOT_PRIMARY`). Câu "người gọi truyền sai ⇒ trigger ghi đè" của B12 đã được R-Q14 thay bằng **báo lỗi** (B16c) | Làm rõ, không đổi quy tắc | B12a, B12b |
| 7 | Ở Q2 các bài nhóm B chạy bằng **chủ sở hữu bảng** (`siscom_migrator`); **Q3 chạy lại toàn bộ bằng `siscom_app`** (`QUOTES_Q3_APP_TESTS`: đặt `SET ROLE siscom_app` sau khi dựng dữ liệu nền) cùng B8 | Quyền ghi của `siscom_app` thuộc Q3. `siscom_app` không tự chèn được nhân viên / danh mục nên dữ liệu nền do superuser của cụm thử dựng. **Thay đổi `.github/workflows/ci.yml` của Q2 + Q3** (review `R1-03`): chỉ **thêm** bước chạy các bài kiểm báo giá (27 dòng thêm, 0 dòng sửa / xoá; không đụng Gitleaks, Runner, chính sách bảo mật) — **Owner chấp thuận riêng ngày 24/11/2026** | Q3: 167 ca |
| 9 | **(Q3) `siscom_app` được DELETE trên `quote_version`** (ngoài `quote_line`). Bản v7 ghi "không DELETE" cho bảng này nhưng đồng thời yêu cầu xoá được bản nháp (mục 8 điểm 9, API `DELETE /quotes/:id/versions/:no`) và có R-Q2b "chỉ xoá được nháp"; bảng không có cột xoá mềm | Hai yêu cầu trên mâu thuẫn nhau; chọn cách không đổi cấu trúc: cho DELETE, DB chỉ cho xoá nháp (R-Q2b) và phải xoá hết dòng trước (FK RESTRICT). Phương án còn lại (không cấp DELETE, thêm hàm `SECURITY DEFINER` xoá nháp) bị loại vì thêm một hàm chạy quyền chủ sở hữu. **Owner chốt phương án này ngày 24/11/2026** (review `R1-01`); mục 7.1 và ca B8 đã ghi theo quyết định này, thay cho chữ "không DELETE" của bản v7. VERIFY mục B1s chốt: ngoài hai bảng này ứng dụng không DELETE được bảng nào | Q112, Q120, Q149, Q161–Q166, VERIFY B1s / E5s |
| 8 | Số lượng nhập quá 3 chữ số thập phân: cột `numeric(12,3)` của PostgreSQL **tự làm tròn**, không báo lỗi | Việc từ chối thuộc tầng API (mục 6, ca A11 / A14 ở Q5) | — |

## 20. Ghi chú triển khai Q4 (API đọc) — chỗ làm rõ hoặc khác chữ so với mục 7, 9, 11

| # | Nội dung | Lý do | Ca kiểm |
|---|---|---|---|
| 1 | **Không có mã quyền của đường đọc ⇒ 403; có mã nhưng ngoài phạm vi ⇒ 404.** Ca C3 ghi "Kỹ thuật có việc trên cơ hội: mọi endpoint báo giá ⇒ 404"; thực tế Kỹ thuật không có mã `quote.read` nên nhận **403** ở mọi endpoint báo giá | Cùng quy ước với module cơ hội và khách hàng (403 = thiếu mã, không phụ thuộc bản ghi nào nên không lộ sự tồn tại). Mục đích của C3 — đường theo việc không mở ra báo giá, phản hồi không chứa dữ liệu báo giá — vẫn được kiểm. **Owner chốt giữ 403 ngày 24/11/2026** (review `R1-02`); chữ của 7.1 và C3 đã sửa theo; thêm ca "403 giống nhau với id không tồn tại" | `quotes.read.int-spec` (C3), `quotes.read.spec` |
| 2 | Có `quote.read` nhưng không có `opportunity.read` ⇒ không thấy báo giá nào | Báo giá đi theo cơ hội trên đường đầy đủ; mã báo giá không tự mở cơ hội (fail-closed) | `quotes.read.spec` |
| 3 | Bộ lọc trạng thái của danh sách (`state`) tính trên **phiên bản mới nhất** của báo giá: `DRAFT`, `SENT` (đã gửi, còn hiệu lực), `EXPIRED` (đã gửi, quá hạn), `EXPIRING` (còn hiệu lực, hết hạn trong 7 ngày), `ACCEPTED`, `REJECTED`. Bộ lọc này và tìm kiếm không dấu được tính bằng SQL thành danh sách id, **chỉ dùng để thu hẹp thêm sau** vị từ phạm vi | Prisma không biểu diễn được "phiên bản mới nhất"; mốc "hôm nay" (giờ Việt Nam) của bộ lọc và của nhãn lấy từ cùng một biểu thức SQL trong cùng snapshot. Khi số báo giá lớn cần chỉ mục / cột hỗ trợ — ghi nhận, chưa làm. **Giới hạn đã biết** (review `R1-04`, **chưa đo**): bước này chỉ chạy khi có `state` hoặc `q`; khi chạy, nó quét toàn bảng `quote` (kèm phiên bản mới nhất và tên khách) và trả **mọi** id khớp, chưa áp phạm vi và chưa phân trang ⇒ chi phí tăng tuyến tính theo tổng số báo giá chưa xoá, và danh sách id rất dài (cỡ vài chục nghìn) có thể chạm giới hạn số tham số của một câu lệnh. Chấp nhận ở quy mô dự kiến (vài nghìn báo giá mỗi năm); **trước khi** bảng `quote` vượt 10 000 dòng phải chuyển bộ lọc vào chính câu truy vấn có vị từ phạm vi (hoặc thêm cột / chỉ mục hỗ trợ) kèm bài đo — việc riêng, cần Owner duyệt | `quotes.read.int-spec` |
| 4 | Giá vốn chỉ có ở **API chi tiết** (`GET /quotes/:id`), quyết định theo **từng phiên bản**; mỗi phiên bản có cờ `costVisible`. Lãi gộp tạm tính (mục 6) thuộc Q5 cùng bộ tính tiền | Danh sách, theo cơ hội, giá trị điền sẵn không bao giờ có khoá giá vốn | `quotes.read.spec`, `quotes.read.int-spec` (C14) |
| 5 | Giá trị điền sẵn: "Khách hàng" = người liên hệ của cơ hội (không có thì người liên hệ chính của khách), "Công ty" = tên khách; ô `client_contact` để trống (dự phòng). Tên tệp gợi ý dùng "Công ty", không có thì "Khách hàng" | Theo bố cục 4.2 và các tệp mẫu | `quotes.read.int-spec` |
| 6 | Phản hồi kèm cờ `can.*` (tạo, sửa, gửi, kết quả, xoá, tải) để giao diện ẩn / hiện nút; máy chủ vẫn kiểm lại ở từng thao tác | Tránh giao diện tự suy quyền | `quotes.read.int-spec` |

## 21. Ghi chú triển khai Q5a (API ghi báo giá) — chỗ làm rõ hoặc khác chữ so với mục 6, 7.3, 8, 9, 12

Q5 trong mục 12 được tách làm **hai PR** để dễ review: **Q5a** = tạo báo giá, đổi hạng mục, lưu nháp, tạo bản mới, xoá nháp, xoá báo giá, bộ tính tiền, quy tắc giá vốn khi ghi; **Q5b** = gửi, chấp nhận, từ chối, chọn báo giá đang theo đuổi, đồng bộ giá trị cơ hội (mục 8 điểm 8) và nhóm D (bài kiểm đồng thời). Nhóm A, C14 (phần ghi), C15 nằm ở Q5a; C2, C10 chia theo đường ghi của từng PR. Không đổi quyết định QB nào.

| # | Nội dung | Lý do | Ca kiểm |
|---|---|---|---|
| 1 | **Chỉ người tạo phiên bản hoặc người có `quote.cost` sửa được bản nháp** (`PUT …/versions/:no`); người khác có `quote.update` trên cơ hội (ví dụ người tiếp quản cơ hội) nhận 403, giá vốn đang lưu giữ nguyên. Người đó vẫn xoá được bản nháp (`quote.delete`) rồi tạo bản mới | Mục 7.3 ghi "người nhập / sửa = người đang soạn nháp (chính là người tạo phiên bản) và Quản trị CRM". Cách "giữ giá vốn của các dòng không đổi khi người không được xem lưu nháp" cần định danh dòng ổn định qua API — chưa có; chặn sửa là cách đơn giản, không làm mất hay lộ giá vốn | `quotes.write.int-spec` (C14 d) |
| 2 | Tổng do trình duyệt gửi lên (`subtotalVnd`, `amountVnd`…) bị **từ chối 400** (thuộc tính lạ), thay vì "bỏ qua" như chữ của A10 | Cùng mục đích (máy chủ không bao giờ dùng tổng của trình duyệt), chặt hơn và nhất quán với `forbidNonWhitelisted` của mọi module | A10 |
| 3 | Lỗi kiểm dữ liệu trả `VALIDATION_FAILED` kèm danh sách `{ field, code, message }` (mã con: `QUANTITY_PRECISION`, `AMOUNT_OUT_OF_RANGE`, `VAT_NOT_ALLOWED`, `VAT_REQUIRED`, `UNKNOWN_COLUMN`, `INVALID_EXTRA`, `SECTION_HAS_VALUES`, `INVALID_DATE`); riêng tổng vượt giới hạn trả mã gốc `AMOUNT_OUT_OF_RANGE` | Mục 9 liệt kê mã 400 mà không nói cách gói nhiều lỗi một lúc; cách này giữ một mã gốc ổn định và vẫn báo đủ từng dòng. Thông điệp chỉ nêu tên trường và số dòng (7.3) | A11, C14 c |
| 4 | Loại "một mức VAT": mức chung gửi ở `vatPercent` của thân yêu cầu, **bắt buộc** khi có dòng hàng; dòng hàng gửi mức riêng ⇒ 400. Loại "theo từng dòng": ngược lại | Phiên bản không có cột lưu mức chung; mức nằm ở từng dòng (C-1) | A2, A10 |
| 5 | Xoá phiên bản **duy nhất** (v1 nháp) ⇒ 422 `QUOTE_LAST_VERSION`; muốn bỏ thì xoá cả báo giá | Tránh báo giá không còn phiên bản nào | `quotes.write.int-spec` |
| 6 | Mọi thao tác ghi nội dung (lưu nháp, tạo bản mới, đổi hạng mục) cần cơ hội đang **Mở**; xoá nháp / xoá báo giá được ở mọi trạng thái | Mục 8 điểm 1 chỉ nói "không tạo mới"; cơ hội đã Thắng / Thua thì nội dung báo giá cũng nên đứng yên | `quotes.write.int-spec` |
| 7 | Đổi hạng mục (`PATCH /quotes/:id`) đổi cả `item_name` của **bản nháp** đang có; phiên bản đã gửi giữ bản chép | Tên tệp của bản nháp đi theo hạng mục mới; bất biến 4.3 chỉ áp cho bản đã gửi | `quotes.write.int-spec` |
| 8 | Lãi gộp tạm tính trả ở khoá `margin` của phiên bản (chỉ dạng có giá vốn): `{ itemLines, costedLines, costedAmountVnd, costVnd, grossProfitVnd }`; tỷ lệ % do giao diện tính từ `grossProfitVnd / costedAmountVnd` | Không trả số thực qua API (mục 6) | A13, `quotes.read.spec` |
| 9 | **Tạo bản mới: hạng mục lấy từ `quote.item_name`** (hạng mục hiện hành của báo giá), không lấy từ phiên bản nguồn; mọi nội dung khác chép từ phiên bản nguồn | Mục 4.3 ghi nguồn hạng mục *lúc tạo nháp* là `quote.item_name`; mục 8 điểm 5 liệt kê những gì được chép (dòng hàng, ô đầu trang, tiêu đề, danh sách cột) — không có hạng mục. Nếu chép từ bản nguồn thì đổi hạng mục sau khi gửi rồi tạo bản mới sẽ ra bản nháp mang tên cũ, lệch với báo giá và tên tệp. Review R1 (#271) đề nghị chép từ bản nguồn; **Owner đã chốt ngày 25/11/2026: giữ như hiện tại** (lấy từ `quote.item_name`), reviewer chấp nhận ở R2 | `quotes.write.int-spec` (R1) |

## 22. Ghi chú triển khai Q5b (gửi, kết quả, đang theo đuổi, đồng bộ giá trị cơ hội)

| # | Nội dung | Lý do | Ca kiểm |
|---|---|---|---|
| 1 | API: `POST /quotes/:id/versions/:no/send` (có thể gửi kèm `quoteDate`, `validUntil`), `…/accept`, `…/reject` (bắt buộc `reason`), `POST /quotes/:id/primary`; đều kèm `version` của báo giá, trả 200 + chi tiết báo giá; `accept` / `reject` thêm `warnings` (`['EXPIRED']` khi chấp nhận bản quá hạn [QB10]) | Mục 9 | `quotes.send.int-spec` |
| 2 | **Chấp nhận chỉ cho báo giá đang theo đuổi** (409 `QUOTE_NOT_PRIMARY`), không tự chuyển "đang theo đuổi" khi chấp nhận | Theo R-Q7 bước 3 và bảng 8.1 ("nếu B trước ⇒ A nhận `QUOTE_NOT_PRIMARY`"); QB6 đọc là báo giá được chấp nhận *giữ* vai trò đang theo đuổi và cố định — Owner xác nhận diễn giải này ngày 25/11/2026; QB6 (mục 2) và mục 8 điểm 7 đã sửa cho khớp (review R1 #272) | D5 / D7 |
| 3 | Kết quả chỉ ghi cho **phiên bản đã gửi mới nhất** (422 `QUOTE_NOT_LATEST`); ghi kết quả cho bản nháp ⇒ 422 `QUOTE_NOT_SENT`; bản đã có kết quả ⇒ 409 `QUOTE_VERSION_LOCKED` | Mục 8 điểm 6 | `quotes.send.int-spec` |
| 4 | Gửi / kết quả / đổi đang theo đuổi làm được ở **mọi trạng thái** cơ hội (cơ hội đã xoá thì ngoài phạm vi ⇒ 404); chỉ việc đồng bộ giá trị bị bỏ qua khi cơ hội không Mở | Mục 8 điểm 8 ("cơ hội không ở OPEN ⇒ không đồng bộ") ngầm cho phép các thao tác này; ví dụ Kinh doanh chốt Thắng rồi mới ghi báo giá được chấp nhận | `quotes.send.int-spec` (Tạm hoãn) |
| 5 | Báo giá gửi đầu tiên của cơ hội tự thành đang theo đuổi **trừ khi** cơ hội đã có phiên bản được chấp nhận | R-Q8 / QB6 | `quotes.send.int-spec` |
| 6 | Đổi đang theo đuổi: bỏ cờ của báo giá cũ trước rồi bật cờ báo giá mới (U-3); **cả hai** báo giá tăng `version`. Báo giá đã là đang theo đuổi ⇒ trả về không đổi gì | Mục 8.1: mọi thay đổi trên báo giá tăng `quote.version` | D5 / D7 |
| 7 | Nhãn giá trị cơ hội [QB5] trả ở `GET /opportunities/:id/quotes` → `amountSource = { quoteId, code, versionNo, subtotalVnd, matchesOpportunity }` (null khi chưa có báo giá đang theo đuổi đã gửi); giao diện hiện "theo báo giá …" khi `matchesOpportunity`, "đã sửa tay, khác báo giá" khi không | Tính lúc đọc, không thêm cột vào `opportunity`; module cơ hội không phải đọc bảng báo giá | D9 |
| 8 | Bài kiểm nhóm D chạy qua API, song song thật trên pool kết nối, số vòng theo `CONCURRENCY_ROUNDS` (CI đặt 20) | Mẫu `concurrency.int-spec` | D1, D5 / D7, D6, D8, D9, D10, D11 |

## 23. Ghi chú triển khai Q6 (ghi loại báo giá + mặc định cá nhân)

| # | Nội dung | Lý do | Ca kiểm |
|---|---|---|---|
| 1 | API: `POST /quotes/templates`, `PATCH /quotes/templates/:templateId` (kèm `version` riêng của loại), `PUT /quotes/my-defaults`; chỉ người có `quote.template` (Quản trị CRM) ghi loại báo giá [QB19]; mặc định cá nhân luôn của chính người gọi, cần `quote.create` | Mục 7.1, 9 | `quotes.templates.int-spec` (C12) |
| 2 | **Mã loại báo giá đặt một lần lúc thêm, không đổi được** (gửi `code` khi sửa ⇒ 400) | Mã là định danh ổn định cho người quản trị; phiên bản báo giá không chép mã loại nên đổi mã không có lợi gì | `quotes.templates.int-spec` |
| 3 | **Không cho ngừng dùng loại báo giá cuối cùng đang dùng** (422 `TEMPLATE_LAST_ACTIVE`); thêm loại khi đã đủ 200 ⇒ 422 `TEMPLATE_LIMIT`; mã trùng ⇒ 409 `TEMPLATE_CODE_EXISTS`. Hai việc này tuần tự hoá bằng khoá tư vấn trong transaction | Không còn loại nào đang dùng thì không ai lập được báo giá mới; giới hạn 200 ở mục 8 điểm 12 | `quotes.templates.int-spec` |
| 4 | Cột riêng: cùng hình dạng với CHECK C-6 (`fn_quote_columns_ok`); đơn vị không gửi ⇒ `''`; key trùng ⇒ 400 theo vị trí cột; thuộc tính lạ (ví dụ công thức) ⇒ 400 | Báo lỗi rõ ở tầng API thay vì lỗi ràng buộc DB | B10 qua API |
| 5 | Gửi lại đúng giá trị cũ ⇒ không tăng `version`, không ghi nhật ký; so sánh cột không phụ thuộc thứ tự khoá (JSONB tự sắp lại khoá) | Như các module hiện có | `quotes.templates.int-spec` |
| 6 | `PUT /quotes/my-defaults` **thay toàn bộ** (trường không gửi ⇒ để trống); không có `version` (dữ liệu của riêng một người, ghi sau thắng); gửi kèm `employeeId` ⇒ 400 | Không ai đọc / sửa được mặc định của người khác (C12) | `quotes.templates.int-spec` |
| 7 | Nhật ký: loại báo giá ghi mã loại + tên trường đã đổi; mặc định cá nhân ghi "(đã ghi)" — không ghi nội dung (số tài khoản…) | Mục 7.2 | `quotes.templates.int-spec` |

## 24. Ghi chú triển khai Q7 (giao diện: tab Báo giá + màn hình soạn)

| # | Nội dung | Lý do | Ca kiểm |
|---|---|---|---|
| 1 | **Tab "Báo giá"** ở chi tiết cơ hội: chỉ trên đường đầy đủ và khi có `quote.read` (không có mã ⇒ không có tab, không gọi API báo giá). Mỗi báo giá một khối: mã, loại, hạng mục, nhãn "Đang theo đuổi", bảng phiên bản (bản, trạng thái, trước VAT, ngày, hạn, "còn n ngày" khi ≤ 7). Nút theo phiên bản mới nhất: Soạn, Đánh dấu đã gửi, Xoá bản nháp / Xoá báo giá, Ghi kết quả, Tạo bản mới, Chọn đang theo đuổi, Xem. Dòng nhãn giá trị cơ hội [QB5] "theo báo giá … / đã sửa tay, khác báo giá …" lấy từ `amountSource` | Mục 10 | `quotesApiUi.test.mjs` |
| 2 | **Màn hình soạn ở route riêng `#/quotes/:id`** (không phải hộp thoại): bảng 300 dòng với tối đa 10 cột riêng cần cả màn hình. Không có `quote.read` (gõ thẳng địa chỉ) ⇒ trang "không có quyền", không gọi máy chủ. Bản nháp mới nhất + có quyền sửa ⇒ soạn; còn lại ⇒ xem chỉ đọc, chọn được phiên bản cũ | Mục 10, ca C4 (phần giao diện) | `quotesApiUi.test.mjs` |
| 3 | Ô nhập kiểu Việt Nam: số lượng nhận `2,5`, `2.5` hoặc `1.234,5` (khi có dấu phẩy, dấu chấm chỉ được bỏ nếu tách đúng nhóm 3 chữ số — `1.2,5`, `1.2.3,5` bị báo lỗi, không âm thầm thành 12,5 / 123,5; review Q7-R1-01); đơn giá / giá vốn nhận `1.636.000` (bỏ dấu chấm chỉ khi tách đúng nhóm 3 chữ số — `1.5` bị báo lỗi, không âm thầm thành 15). Tiền / số lượng luôn là chuỗi, tính bằng BigInt — kiểm tĩnh: không `Number(` / `parseFloat(` / `parseInt(`, không ghi bộ nhớ trình duyệt | Mục 6, 7.2 (C15) | `quotesModel.test.mjs` |
| 4 | **Tạm tính ngay** khi gõ (cùng công thức với máy chủ, A1 / A2 / A5 / A9 khớp), ghi rõ "Tạm tính — máy chủ tính lại khi lưu"; thanh lưu dính đáy có tổng sau VAT. Số chính thức luôn là số máy chủ trả về sau khi lưu | Mục 6: máy chủ bỏ qua tổng của trình duyệt | `quotesModel.test.mjs`, `quotesApiUi.test.mjs` |
| 5 | "Tạo bản mới" ở tab Báo giá chỉ mở màn hình soạn khi máy chủ trả **thành công**; lỗi (409 / 403 / 500…) hoặc bấm trùng ⇒ ở lại tab và báo lỗi (review Q7-R1-02). Lỗi kiểm dữ liệu hiện ngay dưới ô (khoá `lines[i].field` trùng khoá lỗi của máy chủ); 409 `VERSION_CONFLICT` báo "tải lại" và giữ nguyên nội dung đang gõ | Mục 8.1 | `quotesApiUi.test.mjs` |
| 6 | Cột "Giá vốn / đv" và khối "Lãi gộp tạm tính" chỉ hiện khi máy chủ báo `costVisible` | Mục 7.3 | `quotesApiUi.test.mjs` |
| 7 | Loại "một mức VAT": ô "VAT cho cả báo giá" lấy mức của dòng hàng đầu (bản chép trong phiên bản). **Nháp chưa có dòng hàng ⇒ ô để trống, người soạn phải chọn 8 % / 10 % trước khi lưu dòng hàng**; màn hình soạn không đọc VAT mặc định của loại *hiện tại* (loại có thể đã sửa / ngừng dùng sau khi lập — mục 4.3). Loại "theo từng dòng": ô VAT ở mỗi dòng | QB18; review Q7-R1-03 — phiên bản không lưu VAT mặc định, **Owner chốt ngày 26/11/2026** chọn "để trống, bắt buộc chọn" (không thêm cột / migration) | `quotesModel.test.mjs`, `quotesApiUi.test.mjs` (Q7-R1-03) |
| 8 | Điện thoại: mỗi dòng một thẻ (không có bảng rộng) | Mục 10 | `quotesApiUi.test.mjs` |
| 9 | Bài kiểm FE mới (`quotesModel.test.mjs`, `quotesApiUi.test.mjs`) chạy trong CI qua `import` ở hai tệp đã có trong danh sách (`opportunitiesModel.test.mjs`, `opportunitiesDetailApiUi.test.mjs`) — **không đổi `.github/workflows/ci.yml`** | Đổi workflow cần Owner duyệt riêng | CI FE 476 / 476 |
| 10 | Để sau: xem bản in, trang danh sách Báo giá, quản lý loại báo giá, "Mặc định của tôi" (Q8); tải PDF (Q9), Excel (Q10) | Mục 12 | — |

## 25. Ghi chú triển khai Q8a (giao diện: trang "Báo giá" + xem bản in)

Q8 (mục 12) được tách làm hai PR nhỏ để dễ review: **Q8a** = trang danh sách + xem bản in (PR này); **Q8b** = quản lý loại báo giá + "Mặc định của tôi". Cả hai chỉ là giao diện trên API đã có (Q4, Q6); không migration, không đổi máy chủ.

| # | Nội dung | Lý do | Ca kiểm |
|---|---|---|---|
| 1 | **Trang "Báo giá" `#/quotes`** thay trang chờ: mỗi báo giá một dòng (mã, hạng mục, cơ hội, khách, loại, bản mới nhất, trạng thái, tổng trước VAT, hạn hiệu lực kèm nhãn "Còn n ngày" / "Hết hạn hôm nay" / "Hết hiệu lực"). Lọc trạng thái (gồm "sắp hết hạn trong 7 ngày", "hết hiệu lực"), lọc loại, sắp xếp, tìm theo mã / hạng mục / tên khách (từ khoá dưới 2 ký tự không gửi), "Tải thêm". Mọi lọc / tìm / phân trang do máy chủ làm; giao diện chỉ gửi tham số máy chủ nhận | Mục 9, 10 | `quotesListPrintModel.test.mjs`, `quotesListPrintUi.test.mjs` |
| 2 | Chưa có ô lọc theo **người phụ trách** và theo **khách hàng** (API đã nhận `ownerId`, `customerId`): cần danh sách chọn người / khách; tìm theo tên khách đã dùng được qua ô tìm. Để Q8b hoặc sau | Giữ PR nhỏ | — |
| 3 | Chế độ API mà không có `quote.read`: **thanh bên không có mục "Báo giá"**; gõ thẳng `#/quotes`, `#/quotes/:id`, `#/quotes/:id/print` ⇒ trang "không có quyền", **không gọi máy chủ** | Mục 10, ca C4 | cả hai tệp kiểm |
| 4 | **Xem bản in `#/quotes/:id/print/:no`** (không có `:no` hoặc số sai ⇒ bản mới nhất; số không tồn tại ⇒ báo "không có phiên bản"). Nút "Xem bản in" ở trang danh sách, tab Báo giá của cơ hội và trang một báo giá. Bố cục đúng mục 4.2; mọi chữ đọc từ chính phiên bản (4.3); **không có giá vốn, lãi gộp, ghi chú nội bộ** kể cả khi người xem được thấy giá vốn | Mục 4.2–4.4, 7.3 | `quotesListPrintUi.test.mjs` |
| 5 | Tờ in **nền trắng chữ đen cố định** (không dùng biến màu của giao diện) [E5]; nháp có chữ chìm "BẢN NHÁP" [E6]; có cả hai mức VAT ⇒ cột "VAT %" và hai dòng VAT, một mức ⇒ không có cột [E10]; nội dung người dùng nhập luôn là văn bản thuần, không chèn HTML thô [E8] | Mục 4.4, 11 nhóm E | cả hai tệp kiểm |
| 6 | Khổ giấy `@page`: A4 dọc khi tối đa 3 cột riêng, A4 ngang khi nhiều hơn. Khi in chỉ còn tờ in (ẩn khung ứng dụng); tiêu đề cột lặp lại ở mỗi trang, một dòng hàng / khối ký / khối tài khoản không bị cắt đôi (CSS `break-inside: avoid`). **E1–E3 (nhiều trang, 300 dòng, 10 cột) cần xem bằng Chrome thật** — ghi vào biên bản nghiệm thu, bài kiểm tự động chỉ chốt cấu trúc và quy tắc CSS | Mục 4.2, 11 nhóm E | thủ công + `quotesListPrintUi.test.mjs` |
| 7 | Trong lúc xem bản in, **tiêu đề trang = tên tệp gợi ý của máy chủ** (4.4; nháp có `_NHAP`) để "Lưu dưới dạng PDF" của trình duyệt ra đúng tên; rời trang thì trả lại tiêu đề cũ. Đây là in bằng trình duyệt; nút tải PDF / Excel do máy chủ dựng vẫn là Q9 / Q10 | Mục 4.4, 12 | `quotesListPrintUi.test.mjs` |
| 8 | Bố cục in nằm ở tệp riêng theo mã (`print/siscom-v1.jsx`); phiên bản ghi mã nào thì in bằng bố cục đó, mã chưa biết ⇒ bố cục hiện hành. **Bài kiểm chốt mã băm SHA-256 của tệp**: sau khi phát hành, đổi logo / mẫu = thêm tệp bố cục mới với mã mới, không sửa tệp cũ. Trước khi phát hành (đang review) mã băm được cập nhật cùng lúc với tệp | Mục 4.3 | `quotesListPrintModel.test.mjs` |
| 9 | Hai tệp kiểm mới chạy trong CI qua `import` ở `quotesModel.test.mjs` và `quotesApiUi.test.mjs` (đã nằm trong chuỗi của Q7) — **không đổi `.github/workflows/ci.yml`** | Đổi workflow cần Owner duyệt riêng | CI FE |
