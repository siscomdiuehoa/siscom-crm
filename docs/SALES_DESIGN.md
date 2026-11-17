# Sales — Cơ hội kinh doanh: đặc tả v2 (PR S1, 13/11/2026)

| Mục | Giá trị |
|---|---|
| Trạng thái | Tài liệu đặc tả (S1). **S2 (migration, PR #237) và S3 (quyền DB V5, PR #238) đã có mã**: S2 merge `d45c985`; **S3 đã merge `2a18210`** (16/11/2026). S4 (danh mục) đang review ở PR #239. Chưa áp lên database thật hay VPS (S12). Bản này sửa theo review PR #234 R1 (16/11/2026) và **đối chiếu lại đầy đủ review gốc 14/11/2026** (bảng ở mục 12); 17/11/2026 sửa tiếp theo `[REVIEW-R3-RESULT]` (R3-SEC-01, R3-SEC-02, R3-DESIGN-01; bảng ở mục 12.1) |
| Nguồn quyết định | 8 câu trả lời của Owner (13/11/2026 16:50) + 16 điểm chốt (13/11/2026 17:03, Issue #233) + điều chỉnh 14/11/2026 về lĩnh vực, loại và "chào dự án" (mục 1.3, lời Owner do phiên khác chuyển lại) |
| Nền mã | `main` `d45c985` (có S2) |
| Thay thế | bản nháp `SALES_THIET_KE_MO_DAU` và `SALES_DAC_TA_V1` (thư mục bàn giao của Claude, không nằm trong repo) |
| Quy ước | **[Owner]** = Owner đã quyết. **[Đề xuất]** = Claude đề xuất, chưa được duyệt. **[T…]** = điểm kỹ thuật Claude đề xuất để ChatGPT review (mục 2). Không còn câu hỏi nghiệp vụ chờ Owner |

## 0. Tóm tắt cho người không chuyên
- Luồng: **Khách hàng → Cơ hội → Báo giá → Chốt Thắng/Thua → Bàn giao thực hiện**.
- Một khách có nhiều cơ hội. SISCOM hiện chỉ bán thiết bị, vật tư HVAC và chào dự án HVAC nên **lĩnh vực mặc định là HVAC**, nhân viên không phải chọn. Mỗi cơ hội có **loại** (Cung cấp thiết bị, vật tư / Thi công / Cung cấp và thi công), **tên dự án/công trình** và **phạm vi SISCOM đang chào** (chào dự án có thể chỉ cung cấp hàng, có thể kèm thi công), giai đoạn, giá trị dự kiến (VNĐ, chưa VAT, sau chiết khấu), xác suất, ngày dự kiến chốt và **một người phụ trách chính**.
- **Thắng** chỉ khi có hợp đồng hoặc đơn đặt hàng được xác nhận. **Thua** phải ghi lý do. **Tạm hoãn** là trạng thái riêng, có ngày liên hệ lại, không tính là Thua.
- Mọi thay đổi giai đoạn, người phụ trách, giá trị, xác suất, ngày dự kiến chốt đều lưu lịch sử.
- Kỹ thuật chỉ thấy cơ hội gắn với việc mình được giao (và không thấy giá trị). Kế toán xem tất cả nhưng không sửa.
- Báo giá giai đoạn đầu vẫn làm bằng Excel hiện có; CRM giữ sổ báo giá theo cơ hội (đợt sau, gói riêng).

## 1. Quyết định đã chốt
### 1.1 Từ 8 câu trả lời của Owner [Owner]
| # | Nội dung |
|---|---|
| D1 | Giai đoạn: Tiếp cận 10% → Khảo sát 25% → Báo giá 45% → Đàm phán 70% → Thắng 100% / Thua 0%. Dùng chung cho bán thiết bị và thi công. Được bỏ qua Khảo sát nhưng vẫn phải ghi đủ nhu cầu |
| D2 | Xác suất mặc định theo giai đoạn; nhân viên sửa thì phải ghi lý do và lưu lịch sử |
| D3 | Thắng: có hợp đồng/đơn đặt hàng xác nhận, ghi giá trị chốt; không đánh dấu Thắng chỉ vì đã gửi báo giá hoặc khách hứa miệng. Thua: bắt buộc lý do. Tạm hoãn: ghi trạng thái + ngày liên hệ lại, không tự chuyển thành Thua |
| D4 | Một người phụ trách chính, mặc định là người phụ trách khách hàng lúc tạo. Chuyển người: lưu người chuyển, thời điểm, lý do. Đổi người phụ trách cơ hội **không** đổi người phụ trách khách và ngược lại |
| D5 | Kỹ thuật hỗ trợ (khảo sát, bóc khối lượng, lập phương án) qua **công việc được giao**, không thành người phụ trách; không tự đổi giá trị, giai đoạn, người phụ trách; kết quả cập nhật qua công việc |
| D6 | Kỹ thuật: chỉ đọc cơ hội gắn với việc được giao + thông tin khách cần thiết; xem yêu cầu, phạm vi, bản vẽ, thông số, tiến độ; không xem giá vốn, lợi nhuận, chiết khấu nội bộ. Kế toán: chỉ đọc tất cả. Quản trị CRM: tất cả. Quản trị hệ thống: không xem dữ liệu nghiệp vụ. Quyền xuất dữ liệu cấp riêng. Kinh doanh: cơ hội mình phụ trách hoặc được cấp quyền, không chỉ dựa vào người phụ trách khách. Phân quyền kiểm cả API, giao diện và xuất dữ liệu |
| D7 | Giá trị: VNĐ, chưa VAT, sau chiết khấu. Trống = chưa biết (không dùng 0). Bắt buộc từ giai đoạn Báo giá; không cộng dồn các phiên bản báo giá của cùng cơ hội. Thắng: bắt buộc giá trị chốt theo hợp đồng/đơn. Thua trước Báo giá: được để trống. Mọi thay đổi giá trị lưu lịch sử. Báo cáo tách giá trị dự kiến và giá trị chốt; không coi là tiền đã thu |
| D8 | Không ghi tên đối thủ khi thua |
| D9 | Nhiều cơ hội mỗi khách; có **loại cơ hội**, tách riêng **lĩnh vực/hệ thống** |
| D10 | Thứ tự phân hệ: Sales → Báo giá → Dashboard, Marketing, Dự án |
| D11 | Báo giá đợt đầu giữ mẫu Excel; CRM quản lý mã, khách, cơ hội, phiên bản, giá trị chưa VAT, ngày gửi, hạn hiệu lực, tệp Excel/PDF trên Google Drive; tạo bản mới từ bản cũ, không ghi đè bản đã gửi. Lập báo giá từ danh mục, chiết khấu, VAT, xuất PDF: để sau. Giá vốn/lợi nhuận phân quyền riêng; không tự giảm giá hoặc gửi khách khi chưa duyệt |
| D12 | Dashboard (sau): 9 chỉ số đã chọn; bấm vào ra danh sách và người phụ trách; lọc tháng/quý, nhân viên, loại, lĩnh vực. Tỷ lệ thắng = Thắng / (Thắng + Thua) theo ngày kết thúc trong kỳ, không tính mở hoặc Tạm hoãn. Tạm hoãn và "chưa biết giá trị" hiển thị riêng. Cần lưu lịch sử chuyển giai đoạn ngay từ Sales |
| D13 | Làm theo PR nhỏ; trước khi viết mã phải có đặc tả, màn hình, tiêu chí nghiệm thu, kế hoạch PR. Không tự merge, không tự triển khai VPS, bảo toàn dữ liệu khách hiện có. Thiết kế để bổ sung Báo giá, Dashboard, Dự án, Kho sau mà ít ảnh hưởng phần đã nghiệm thu |

### 1.2 Từ 16 điểm chốt (Issue #233) [Owner]
| Mã | Quyết định | Hệ quả trong đặc tả |
|---|---|---|
| C1 | **3 loại**: Cung cấp thiết bị, vật tư · Thi công · Cung cấp và thi công | Danh mục `opportunity_type` có 3 mục. Owner giữ nguyên 3 loại, chưa mở rộng thành 6 (mục 1.3) |
| C2 | Bỏ lý do "Khách hoãn hoặc huỷ dự án"; giữ "Khách hủy dự án/nhu cầu" | Danh mục lý do thua: mục 4.3 |
| C3 | Tạm hoãn là **trạng thái** riêng (Đang mở / Tạm hoãn / Thắng / Thua); giữ nguyên giai đoạn | Cột `status`; mục 6 quy tắc 4 |
| C4 | Người phụ trách khách thấy mọi cơ hội của khách mình, chỉ đọc với cơ hội không phụ trách | Mục 5.1 |
| C5 | Người phụ trách cơ hội mà không phụ trách khách: thẻ khách tối thiểu (mã, tên, địa chỉ, tỉnh, điện thoại) + người liên hệ của cơ hội | Mục 5.1 |
| C6 | **Quản trị CRM, và người phụ trách cơ hội được chuyển cho người cùng phòng** | Mục 5.2, 6 |
| C7 | Kỹ thuật không xem giá trị cơ hội | Mục 5.1 |
| C8 | Chốt Thắng bắt buộc nhập loại chứng từ, số, ngày, giá trị chốt, đường dẫn Google Drive; hệ thống không tự xác minh | Mục 4.1, 6 |
| C9 | Một cơ hội chọn được nhiều lĩnh vực | **Được điều chỉnh bởi mục 1.3**: đợt đầu chỉ HVAC, mặc định, không bắt chọn; chưa tạo bảng lĩnh vực |
| C10 | Lưu đường dẫn Google Drive + tên tệp, không tải tệp lên CRM | Mục 4.1 |
| C11 | Báo giá đợt 1 là gói riêng ngay sau Sales | Mục 3, 9 |
| C12 | Khi Thắng tự tạo công việc "Bàn giao thực hiện", người phụ trách chọn người nhận | Mục 6 quy tắc 5 |
| C13 | Tạm hoãn: tự tạo công việc nhắc vào ngày liên hệ lại | Mục 6 quy tắc 4 |
| C14 | Đi tới/lùi tự do giữa 4 giai đoạn mở, mọi lần ghi lịch sử; từ Báo giá trở đi phải có giá trị | Mục 6 quy tắc 2 |
| C15 | Một ô "Nhu cầu của khách" bắt buộc trước khi rời Tiếp cận | Cột `need_summary` |
| C16 | Chỉ Quản trị CRM mở lại cơ hội đã Thắng/Thua, bắt buộc lý do | Mục 5.2, 6 |

### 1.3 Điều chỉnh và chốt của Owner (14/11/2026) [Owner]
O1, O2 và C17 ban đầu do một phiên Claude khác chuyển lại; sau đó Owner **xác nhận trực tiếp** ("Anh xác nhận hướng điều chỉnh HVAC và giữ 3 loại là đúng") và chốt O3, O4, O5 ngay trong phiên viết đặc tả.
| Mã | Quyết định | Hệ quả trong đặc tả |
|---|---|---|
| O1 (đã đóng) | SISCOM hiện chỉ bán thiết bị, vật tư HVAC và chào dự án HVAC. **Không** đưa Điện, Cấp thoát nước, PCCC, Phòng sạch vào danh mục riêng. Đợt đầu **mặc định lĩnh vực là HVAC, không bắt nhân viên chọn** | Đợt này **không tạo bảng/danh mục lĩnh vực**, không có ô chọn lĩnh vực. Mọi cơ hội hiểu là HVAC. Khi SISCOM có lĩnh vực thứ hai sẽ thêm bảng mới theo cách cộng thêm và gán HVAC cho dữ liệu cũ (không cần sửa dữ liệu từng dòng). Dashboard chưa có bộ lọc lĩnh vực |
| O2 (đã đóng) | Giữ **3 loại**: Cung cấp thiết bị, vật tư · Thi công · Cung cấp và thi công. Chưa mở rộng thành 6 loại | Bảo trì, sửa chữa/cải tạo, tư vấn/thiết kế chưa có loại riêng; loại là danh mục nên thêm sau không cần sửa mã |
| C17 (đã đóng) | **"Chào dự án"** là cơ hội gắn với một dự án/công trình; có thể chỉ cung cấp hàng hoặc kèm thi công. **Không mặc định** cứ chào dự án là thi công | **Loại cơ hội mô tả phạm vi SISCOM chào, không phải toàn bộ công trình** (ví dụ: chỉ bán FCU cho khách sạn thì chọn "Cung cấp thiết bị, vật tư"). Loại do nhân viên chọn, không suy ra từ việc có tên dự án. **Hướng dẫn này hiện ngay trên biểu mẫu** (mục 8.3) |
| O4 (đã đóng) | Có lựa chọn **"Gắn với dự án/công trình"**. Nếu có: **bắt buộc** tên dự án/công trình và phạm vi SISCOM đang chào, **kể cả khi chỉ cung cấp thiết bị**. Loại **Thi công** hoặc **Cung cấp và thi công**: **bắt buộc** gắn dự án/công trình. Bán hàng không gắn dự án: **không bắt** nhập tên dự án | Cột `is_project_linked`, `project_name`, `offer_scope` (mục 4.1); quy tắc 1 mục 6 |
| O5 (đã đóng) | Bán hàng không gắn dự án **vẫn được tạo cơ hội** để theo dõi nhu cầu, báo giá, chốt đơn. **Không bắt buộc** nhập mọi giao dịch bán lẻ đã hoàn tất thành cơ hội; đợt này **chưa thay thế phần mềm bán hàng/kế toán** | Mục 3 (ngoài phạm vi) |
| O3 (đã đóng) | Chuyển người phụ trách: người phụ trách hiện tại được chuyển cho người **đang hoạt động, cùng phòng và có quyền đảm nhận cơ hội**. Người nhận **không cần có quyền sửa chính cơ hội đó từ trước**; quyền phát sinh sau khi được giao. **Quản trị CRM** được chuyển khác phòng, người nhận vẫn phải hoạt động và đủ quyền. **Chưa xác định phòng** thì chỉ Quản trị CRM được chuyển. Ghi lý do và lịch sử chuyển | Mục 5.2, quy tắc 8 mục 6. "Đủ quyền đảm nhận" xem T1 |

## 2. Việc còn mở
Không còn câu hỏi nghiệp vụ nào chờ Owner. Ba điểm kỹ thuật sau do Claude đề xuất để ChatGPT review (Owner đã dặn không mở thêm câu hỏi nghiệp vụ cho các điểm này):
| Mã | Điểm kỹ thuật | Đề xuất | Chặn |
|---|---|---|---|
| **T1** | "Có quyền đảm nhận cơ hội" (O3) nghĩa là gì khi người nhận chưa có cơ hội đó | **Đã thay bằng mục 5.4** (theo PR234-R1-SEC-01): người nhận phải có **quyền hiệu lực** `opportunity.read` **và** `opportunity.update` (bất kỳ phạm vi), tính bằng đúng cơ chế hợp nhất quyền hiện có, không đếm dòng `role_permission` thô. Quyền trên chính cơ hội phát sinh sau khi `owner_id` đổi | S5 |
| **T2** | Ràng buộc "Thi công / Cung cấp và thi công ⇒ bắt buộc gắn dự án" (O4) nằm ở đâu | CHECK ở DB chỉ làm được phần "gắn dự án ⇒ có tên dự án và phạm vi chào" (CHECK không tham chiếu bảng danh mục). Phần "loại ⇒ gắn dự án" làm ở service + kiểm thử. **Đã chốt (review PR #237 R1, 16/11/2026): service S7, không trigger** — cùng với "từ Báo giá trở đi phải có giá trị" và "rời Tiếp cận phải có nhu cầu" (mục 4.1, R-S1..R-S3) | S2, S7 |
| **T3** | Mở rộng lĩnh vực sau này | Không lưu lĩnh vực đợt này; khi có lĩnh vực thứ hai: thêm bảng danh mục + cột/bảng nối cộng thêm, gán HVAC cho dữ liệu cũ bằng một câu lệnh có kiểm đếm (mục 11) | Sau Sales |

## 3. Phạm vi
**Làm trong đợt Sales:** cơ hội (tạo, sửa, giai đoạn, Tạm hoãn, Thắng, Thua, mở lại, chuyển người phụ trách), lịch sử thay đổi, loại + lựa chọn "Gắn với dự án/công trình" + tên dự án/công trình + phạm vi chào (lĩnh vực mặc định HVAC, chưa có ô chọn), cơ hội không gắn dự án (bán hàng theo dõi nhu cầu, báo giá, chốt đơn), danh sách bảng + kanban, thẻ/tab cơ hội trong chi tiết khách, gắn công việc/hoạt động vào cơ hội, quyền theo người phụ trách và theo việc được giao (kiểm ở API + giao diện), điện thoại.
**Gói Báo giá đợt 1 (ngay sau Sales, thiết kế riêng):** sổ báo giá theo cơ hội, phiên bản, trạng thái (Nháp / Đã gửi / Được chấp nhận / Bị từ chối / Hết hiệu lực), đường dẫn Drive, tạo bản mới từ bản cũ, không sửa bản đã gửi; giá trị cơ hội theo báo giá đang theo đuổi.
**Ngoài phạm vi [O5]:** thay thế phần mềm bán hàng/kế toán; bắt nhập mọi giao dịch bán lẻ đã hoàn tất thành cơ hội (cơ hội chỉ dùng để theo dõi nhu cầu, báo giá, chốt đơn).
**Để sau:** lập báo giá từ danh mục thiết bị/vật tư, chiết khấu, VAT, duyệt giá, xuất PDF; giá vốn và lợi nhuận; Dashboard; xuất dữ liệu cơ hội; Hợp đồng; Dự án; Kho; kho tệp trong CRM; email/thông báo đẩy.

## 4. Mô hình dữ liệu [Đề xuất] — chỉ cộng thêm, không đổi/xoá cột cũ
### 4.1 Bảng
```
opportunity
  id, code CH-0001 (hàm fn_next_opportunity_code, cùng cách với khách hàng)
  customer_id → customer (bắt buộc)      contact_id → contact (tuỳ chọn, cùng khách)
  title (≤200, bắt buộc)                 need_summary text (bắt buộc trước khi rời Tiếp cận)
  type_id → lookup_item 'opportunity_type' (bắt buộc; do nhân viên chọn theo phạm vi chào, không suy ra từ tên dự án)
  is_project_linked boolean NOT NULL     ("Gắn với dự án/công trình"; mặc định false; luôn true khi loại là Thi công / Cung cấp và thi công) [O4]
  project_name varchar(200) NULL         (tên dự án/công trình) — bắt buộc khi is_project_linked, kể cả chỉ cung cấp thiết bị [O4]
  offer_scope text NULL                  (phạm vi SISCOM đang chào, ví dụ "cung cấp 120 FCU", "cung cấp + lắp đặt chiller") — bắt buộc khi is_project_linked [O4]
                                         (không gắn dự án: không bắt nhập tên dự án; phạm vi chào tuỳ chọn)
  stage_id → lookup_item 'opportunity_stage'
  status: OPEN | ON_HOLD | WON | LOST
  expected_amount_vnd bigint NULL (≥0; NULL = chưa biết)
  probability smallint 0..100, probability_overridden boolean
  expected_close_date date NULL
  owner_id → employee (người phụ trách chính, bắt buộc)
  hold_until date NULL, hold_reason text NULL          (bắt buộc cả hai khi ON_HOLD)
  won_amount_vnd bigint NULL, won_doc_type (HOP_DONG | DON_DAT_HANG), won_doc_no, won_doc_date, won_doc_url   (bắt buộc khi WON)
  lost_reason_id → lookup_item 'opportunity_lost_reason' NULL, lost_note text NULL                           (lost_reason bắt buộc khi LOST)
  closed_at timestamptz NULL
  is_demo, version (khoá lạc quan), created_at/by, updated_at/by, deleted_at/by, delete_reason

(Không có bảng lĩnh vực trong đợt này: SISCOM chỉ làm HVAC, mặc định, không bắt chọn. Mục 1.3.)

opportunity_change      (chỉ thêm; không sửa, không xoá)
  id, opportunity_id, field: STAGE | STATUS | OWNER | AMOUNT | PROBABILITY | CLOSE_DATE | HOLD
  old_value, new_value, reason, changed_by, changed_at

activity   + opportunity_id → opportunity NULL    (hoạt động cũ để NULL; cùng khách với cơ hội)
```
CHECK ở mức DB: nhất quán `status` với trường bắt buộc (ON_HOLD cần `hold_until`; WON cần đủ trường chứng từ và `won_amount_vnd`; LOST cần `lost_reason_id`); `expected_amount_vnd` không âm; `is_project_linked` ⇒ `project_name` và `offer_scope` không rỗng (sau khi bỏ khoảng trắng đầu/cuối); `probability` trong 0..100. Người liên hệ cùng khách với cơ hội: khoá ngoại ghép `(contact_id, contact_customer_id) → contact(id, customer_id)` (đúng cả khi ghi đồng thời — PR #237 R1).

**Quy tắc phụ thuộc mã danh mục — kiểm ở service (S7), KHÔNG ở DB** (chốt ở review PR #237 R1, 16/11/2026: CHECK không tham chiếu được `lookup_item`, mã danh mục do lệnh seed S4 nạp; không thêm trigger đọc mã danh mục). Áp dụng cho **mọi đường ghi** (tạo, sửa, đổi giai đoạn, đổi loại, gắn/bỏ gắn dự án, tạm hoãn, mở lại) và kiểm trên **trạng thái SAU khi cập nhật** (giá trị mới gộp với giá trị đang có), không chỉ trên trường được gửi lên; vi phạm ⇒ 400 với lỗi theo trường, không ghi gì. Có kiểm thử API cho từng quy tắc và từng đường ghi:
- R-S1: giai đoạn **từ Báo giá trở đi** (Báo giá, Đàm phán) **và** `status = OPEN` ⇒ `expected_amount_vnd` bắt buộc (không áp dụng khi ON_HOLD/WON/LOST — mở lại về OPEN ở giai đoạn đó thì lại bắt buộc).
- R-S2: giai đoạn **khác Tiếp cận** ⇒ `need_summary` bắt buộc (không rỗng).
- R-S3: loại **Thi công** hoặc **Cung cấp và thi công** ⇒ `is_project_linked = true` (kéo theo bắt buộc `project_name` + `offer_scope` qua CHECK `ck_opp_project`); đổi loại sang một trong hai loại này mà chưa gắn dự án ⇒ từ chối; tắt gắn dự án khi loại là một trong hai ⇒ từ chối.
`customer.revenue_vnd` (số ước tính cũ) **không** tự cập nhật từ cơ hội: tránh hai nguồn doanh thu. Đợt này chưa có cột giá vốn, lợi nhuận, chiết khấu. `opportunity_change.reason` ≤ 500 ký tự và được che trong audit chung như các lý do khác.
Bảng `quote` (gói Báo giá) sẽ trỏ **tới** `opportunity`; `opportunity` không trỏ ngược.

### 4.2 Danh mục (`lookup_item`, nạp bằng lệnh seed; sửa tên/thứ tự không cần sửa mã; mục đã dùng chỉ **ẩn**, không xoá)
- `opportunity_stage` (kèm xác suất mặc định): Tiếp cận 10, Khảo sát 25, Báo giá 45, Đàm phán 70; hai trạng thái cuối không nằm ở danh mục giai đoạn mà ở `status`.
- `opportunity_type`: Cung cấp thiết bị, vật tư · Thi công · Cung cấp và thi công. [C1]
- **Mã (`code`) của danh mục là bất biến** (PR234-R1-DB-01): R-S1..R-S3 và mọi luật khác chỉ tham chiếu `code`, **không** dùng tên hiển thị hay `sort_order`. Đổi tên/đổi thứ tự không đổi luật; lệnh seed không bao giờ đổi `code` của mục đã có.
- Không có danh mục lĩnh vực trong đợt này (mục 1.3).
### 4.3 Lý do thua (`opportunity_lost_reason`) [C2]
Giá cao hơn đối thủ · Khách chọn đối thủ khác · Khách không phản hồi · Khách hủy dự án/nhu cầu · Khách không đủ ngân sách · Không đáp ứng tiến độ giao hàng/thi công · Không thống nhất điều kiện thanh toán/hợp đồng · SISCOM chủ động không tiếp tục theo đuổi · Khác (kèm ghi chú).

### 4.4 Đã triển khai ở S2 (PR #237, merge `d45c985`, 16/11/2026) — chi tiết bổ sung so với 4.1
Migration `20261117000000_sales_opportunity` (chỉ cộng thêm; chưa áp lên DB thật nào). Các điểm cụ thể hơn 4.1, đã qua review PR #237 R1–R2:
- Mã `CH-0001` (sequence + `fn_next_opportunity_code`, tự mở rộng khi quá 9999).
- Người liên hệ cùng khách: cột phụ `contact_customer_id` (DB tự điền = `customer_id` khi có liên hệ) + khoá ngoại ghép `(contact_id, contact_customer_id) → contact(id, customer_id)` `ON UPDATE/DELETE RESTRICT` + chỉ mục unique `contact(id, customer_id)`. Đúng cả khi ghi đồng thời; không đổi được khách của liên hệ đang gắn cơ hội.
- `closed_at` có ⇔ `status` WON/LOST (mở lại phải xoá `closed_at`); `won_doc_url` chỉ nhận `https://`; xoá mềm bắt buộc `deleted_by` + `delete_reason`.
- Danh mục loại / giai đoạn / lý do thua: trigger kiểm đúng `type` và đang hoạt động khi gán mới (dùng chung `fn_assert_lookup`).
- Khách và mã của cơ hội cố định; `opportunity_change` chỉ thêm (chặn UPDATE/DELETE/TRUNCATE); `activity.opportunity_id` NULL, cùng khách với cơ hội.
- Trường tạm hoãn / thắng / thua không bị buộc NULL khi trạng thái khác (giữ dấu vết khi mở lại; service quyết định).
- Rollback viết sẵn `backend/docs/SALES_S2_ROLLBACK.sql.txt`: khoá chống ghi trước khi kiểm, từ chối khi còn dữ liệu, chạy được khi migration áp một phần.
- Quyền: `siscom_app` chỉ SELECT 2 bảng mới (đã thêm vào danh sách cho phép đọc); quyền ghi ở S3 (`APP_GRANTS_V5`).

## 5. Quyền
### 5.1 Ai thấy cơ hội nào (kiểm ở máy chủ, mọi API; ngoài phạm vi trả 404 như khách hàng)
| Vai trò | Thấy | Sửa |
|---|---|---|
| Quản trị CRM | tất cả | tất cả |
| Kinh doanh | (1) cơ hội mình phụ trách; (2) mọi cơ hội của khách mình phụ trách, chỉ đọc nếu không phụ trách [C4] | chỉ cơ hội mình phụ trách |
| Kỹ thuật | chỉ cơ hội gắn với **công việc đang mở được giao cho mình** — "đường theo việc", điều kiện đầy đủ ở 5.5(d) | không sửa cơ hội; cập nhật kết quả qua công việc |
| Kế toán | tất cả | không |
| Quản trị hệ thống | không | không |
- Kỹ thuật thấy: tiêu đề, nhu cầu, loại, tên dự án/công trình, phạm vi chào, giai đoạn, ngày dự kiến, đường dẫn bản vẽ/thông số; **không** thấy giá trị, lịch sử giá trị, lý do thua. [C7]
- Người phụ trách cơ hội mà không phụ trách khách: thấy cơ hội đó + thẻ khách tối thiểu + người liên hệ của cơ hội; **không** thấy cơ hội khác của khách, timeline khách, ghi chú khách. [C5]
- Cùng một hàm kiểm quyền cho danh sách, chi tiết, đếm (badge), tìm kiếm, xuất dữ liệu và báo cáo; không có đường đọc nào bỏ qua.
### 5.2 Mã quyền mới [Đề xuất]
`opportunity.read`, `.read_assigned` (đường theo việc, 5.5(d)), `.create`, `.update`, `.move_stage`, `.close` (Thắng/Thua/Tạm hoãn), `.assign` (chuyển người phụ trách), `.reopen`, `.delete`, `.restore`. `opportunity.export` **không cấp cho ai** trong đợt này. **Mỗi mã cấp riêng**: không suy `move_stage`, `close`, `assign` từ `update` (PR234-R1-SEC-01); service kiểm đúng mã của thao tác.
| Mã | Quản trị CRM | Kinh doanh | Kỹ thuật | Kế toán |
|---|---|---|---|---|
| read | ALL | OWN (theo 5.1 / 5.4) | — | ALL |
| read_assigned | — | — | có (5.5(d)) | — |
| create | ALL | khách **mình phụ trách** (người phụ trách mặc định = người phụ trách khách, 6.1) | — | — |
| update / move_stage / close / resume | ALL | **chỉ cơ hội mình phụ trách** (`owner_id` = mình). Người phụ trách **khách** mà không phụ trách **cơ hội**: **chỉ đọc** (5.1) — sửa, chuyển giai đoạn, Tạm hoãn, Tiếp tục, chốt Thắng/Thua ⇒ bị từ chối (403 khi thấy được cơ hội; 404 khi ngoài phạm vi xem) | — | — |
| assign | ALL; được chuyển khác phòng; người nhận vẫn phải ACTIVE và đủ quyền (T1) | cơ hội mình phụ trách → người ACTIVE, cùng phòng, đủ quyền đảm nhận (T1); phòng chưa xác định ⇒ không được | — | — |
| reopen / delete / restore | ALL | — | — | — |
`close` = Tạm hoãn / Thắng / Thua; `resume` = Tạm hoãn → Đang mở (6.4) dùng **cùng mã** `opportunity.close`, không phải `reopen`; `reopen` = mở lại Thắng/Thua (6.7, chỉ Quản trị CRM). PR234-R1-AUTH: phạm vi **tạo** tính theo **khách**, phạm vi **ghi còn lại** tính theo **cơ hội** — hai hàm kiểm riêng, không suy quyền ghi cơ hội từ quyền trên khách.
Phạm vi mới cần thêm vào cơ chế hiện có (hiện chỉ tính theo khách): "theo người phụ trách cơ hội" và "theo việc được giao". Đây là phần rủi ro nhất; làm thành PR riêng có ma trận kiểm thử (mục 10).

### 5.4 Quyền hiệu lực và vị từ theo từng mã (PR234-R1-SEC-01) [Đề xuất kỹ thuật]
**Nguồn quyền duy nhất** = cơ chế RBAC hiện có, giữ nguyên hợp đồng `Actor {employeeId, departmentId}` + `scopeFor(actor, mã quyền)` (B3 §5): service chỉ biết **mã quyền + phạm vi hiệu lực**, **không** biết tên vai trò; không có nhánh "nếu là Kinh doanh…" trong mã.
- **Nhiều vai trò trên một người**: hợp nhất theo từng mã, "phạm vi rộng nhất thắng" như `SessionActorProvider` hiện nay. Ví dụ người vừa Kinh doanh vừa Kỹ thuật: có `opportunity.read` (OWN) **và** `opportunity.read_assigned`; với **từng cơ hội** áp đường rộng nhất mà người đó đạt (xem "đường truy cập" dưới).
- **Vai trò chưa xác nhận / đã gỡ, nhân viên không ACTIVE, tài khoản bị khoá**: không đóng góp quyền nào. Quyền tính lại ở **mọi request** từ phiên hiện tại; không lưu "đã từng có quyền". Gỡ vai trò ⇒ mất quyền ngay ở request kế tiếp.
- **Ý nghĩa phạm vi với cơ hội** (khác khách hàng): `ALL` = mọi cơ hội; `OWN` = `opportunity.owner_id = actor`; `DEPARTMENT` = phòng của người phụ trách cơ hội — **không cấp cho vai trò nào ở đợt này**, nếu cấp sau phải qua review riêng.

**Vị từ theo mã** (K = khách của cơ hội; mọi vị từ **trừ dòng Khôi phục** đều kèm `opportunity.deleted_at IS NULL AND K.deleted_at IS NULL`; Khôi phục có đường nạp riêng, xem "Khôi phục cơ hội đã xoá mềm" bên dưới — PR234-R3-SEC-02):
| Thao tác | Mã kiểm | Điều kiện trên đối tượng |
|---|---|---|
| Đọc — đường **đầy đủ** | `opportunity.read` | ALL; hoặc OWN và (`owner_id = actor` **hoặc** `K.owner_id = actor` [C4]) |
| Đọc — đường **theo việc** | `opportunity.read_assigned` | 5.5(d) |
| Tạo | `opportunity.create` | ALL; hoặc OWN và `K.owner_id = actor` |
| Sửa trường | `opportunity.update` | ALL; hoặc OWN và `owner_id = actor` |
| Đổi giai đoạn | `opportunity.move_stage` | như Sửa (mã riêng) |
| Tạm hoãn / đổi hạn hoãn / Tiếp tục / Thắng / Thua | `opportunity.close` | như Sửa (mã riêng) |
| Chuyển người phụ trách | `opportunity.assign` | ALL; hoặc OWN và `owner_id = actor` + điều kiện người nhận dưới đây |
| Mở lại / xoá mềm | `.reopen` / `.delete` | chỉ ALL |
| Khôi phục | `.restore` | chỉ ALL; **đường nạp riêng**: `opportunity.deleted_at IS NOT NULL` (xem dưới) |
Thấy được (qua bất kỳ đường đọc nào) nhưng thiếu mã ghi hoặc ngoài điều kiện ⇒ 403; không thấy được ⇒ 404. `K.owner_id = actor` **không** cho quyền ghi nào trên cơ hội do người khác phụ trách.

**Khôi phục cơ hội đã xoá mềm** (PR234-R3-SEC-02) — `POST /opportunities/:id/restore` `{ version }`:
- **Đường nạp riêng, chỉ dùng cho khôi phục và cho việc xem danh sách đã xoá**: hàm nạp này tìm đúng cơ hội có `deleted_at IS NOT NULL` và **chỉ chạy sau khi** người gọi có `opportunity.restore` phạm vi ALL đang hiệu lực. Người thiếu mã này (kể cả người phụ trách cũ, người phụ trách khách, Kế toán) ⇒ 404 `OPPORTUNITY_NOT_FOUND`, không lộ là cơ hội từng tồn tại. Mọi đường đọc/ghi bình thường **giữ nguyên** bộ lọc `deleted_at IS NULL`: không endpoint nào khác trả cơ hội đã xoá.
- **Xem cơ hội đã xoá** (để lấy `version` và chọn cái cần khôi phục): `GET /opportunities?deleted=only` — cần **cả** `opportunity.restore` ALL **và** `opportunity.read` (cùng nguyên tắc với khách hàng: quyền khôi phục không tự mở rộng quyền xem); thiếu một trong hai ⇒ fail-closed, không trả dòng nào. Không có tham số nào trộn cơ hội đã xoá vào danh sách, kanban, đếm, tìm kiếm thường.
- **Điều kiện**: cơ hội chưa bị xoá ⇒ 409 `OPPORTUNITY_STATE`; `version` lệch ⇒ 409 `OPPORTUNITY_VERSION_CONFLICT`; **khách còn bị xoá mềm ⇒ 409 `OPPORTUNITY_CUSTOMER_DELETED`, không ghi gì** — phải khôi phục khách trước (thao tác riêng, quyền `customer.restore`); khôi phục cơ hội **không** tự khôi phục khách và ngược lại.
- **Trạng thái sau khôi phục**: `deleted_at`, `deleted_by`, `delete_reason` → NULL; `version` + 1; `status`, giai đoạn, người phụ trách, `hold_*`, `won_*`, `lost_*`, `closed_at`, giá trị **giữ nguyên như lúc xoá** (cơ hội đã xoá không sửa được nên các ràng buộc R-S1..R-S3 vẫn đúng; không kiểm lại danh mục đã ẩn sau đó). Xoá mềm và khôi phục **không** tạo, đóng hay đổi người làm của công việc nào: việc gắn cơ hội vẫn là hoạt động của khách; trong lúc cơ hội bị xoá, mọi đường đọc qua cơ hội (5.5(a), (d), vị từ việc nhắc ở (e)) tự tắt vì vị từ cơ hội không còn đạt, và bật lại sau khôi phục. Người phụ trách đã mất quyền trong lúc đó ⇒ `ownerLostAccess = true` như thường lệ.
- **Dấu vết**: một transaction gồm cập nhật cơ hội + audit `opportunity.restore` (người thực hiện, thời điểm, mã cơ hội), đối xứng với audit `opportunity.delete` của quy tắc 6.12. Đã đối chiếu migration S2 đã merge: `opportunity` không có cột `restored_*` và enum `opportunity_change_field` (STAGE, STATUS, OWNER, AMOUNT, PROBABILITY, CLOSE_DATE, HOLD) không có giá trị cho xoá/khôi phục; đợt này **không** thêm cột hay giá trị enum, nên xoá mềm và khôi phục ghi ở **audit**, không ghi `opportunity_change`.

**Đường truy cập quyết định trường được trả** (thay cho "ánh xạ theo vai trò"): đạt đường **đầy đủ** ⇒ mọi trường; chỉ đạt đường **theo việc** ⇒ bản kỹ thuật (tiêu đề, nhu cầu, loại, dự án, phạm vi chào, giai đoạn, ngày dự kiến, tài liệu `TECHNICAL`), **không** có giá trị dự kiến/chốt, xác suất, lịch sử thay đổi, lý do thua, `won_doc_*`, tài liệu `COMMERCIAL`. Người đạt cả hai đường với cùng một cơ hội ⇒ đầy đủ. Áp cho **mọi** đầu ra: chi tiết, danh sách, tìm kiếm, đếm, tổng cột kanban, `/changes`, tài liệu, và nội dung công việc tự sinh (tiêu đề/nội dung việc tự sinh không chứa giá trị).

**Điều kiện người nhận khi chuyển người phụ trách** [O3] — "đủ quyền đảm nhận":
1. Nhân viên ACTIVE (chưa xoá mềm) **và** tài khoản đăng nhập dùng được. Nguồn kiểm (PR234-R3-DESIGN-01): xem "Nguồn kiểm trạng thái tài khoản của người nhận" bên dưới — helper người nhận hiện có của B3 **không** kiểm được điều này.
2. Quyền hiệu lực của **người nhận** (tính bằng đúng hàm hợp nhất ở trên, như B3 tính cho người được giao việc) có **cả** `opportunity.read` **và** `opportunity.update` ở bất kỳ phạm vi. Thiếu `read` ⇒ từ chối (tránh người phụ trách không đọc được cơ hội của mình).
3. Cùng phòng với người phụ trách hiện tại, trừ khi người chuyển có `opportunity.assign` phạm vi ALL. Phòng của một trong hai chưa xác định ⇒ chỉ phạm vi ALL được chuyển.
4. **Không** yêu cầu người nhận có quyền trên chính cơ hội đó từ trước, **không** yêu cầu đọc được khách. Sau khi `owner_id` đổi: người nhận đạt vị từ OWN ⇒ đọc/sửa được; việc người đó **chốt** hay **chuyển tiếp** được hay không tuỳ họ có mã `close` / `assign` — không suy ra từ `update`. Người cũ mất vị từ OWN ngay (còn đọc nếu là người phụ trách khách).
**Người phụ trách mất quyền sau khi nhận** (gỡ vai trò, nghỉ việc): `owner_id` giữ nguyên, người đó không đọc/ghi được nữa; chi tiết và danh sách trả cờ `ownerLostAccess = true` cho người có `opportunity.assign` để chuyển lại. Không tự chuyển.

**Nguồn kiểm trạng thái tài khoản của người nhận** (PR234-R3-DESIGN-01) [Đề xuất kỹ thuật, kế hoạch S5]. Hiện trạng đã đối chiếu trên mã: `SessionActorProvider` kiểm `employee_credential.status = 'ACTIVE'` của **người đang đăng nhập** qua pool auth; helper người nhận của B3 (`DbEmployeeAccess` → `effectiveAccessOf`) đọc vai trò qua **pool nghiệp vụ**, chỉ biết `employee.status`, và B3 §5 **chấp nhận** giao việc cho người có credential bị khoá. Vì vậy:
- **Sales thêm một cổng riêng ở module auth** (tên gợi ý `AssigneeEligibility`), chạy trên pool auth, nhận danh sách `employeeId`, trả **đúng một cờ** cho mỗi người: `canSignIn` = nhân viên ACTIVE, chưa xoá mềm, có credential và `status = 'ACTIVE'` — **cùng tiêu chí** với `SessionActorProvider` (khoá tạm do nhập sai, `locked_until`, không tính, như phiên hiện nay). Không trả trường nào của credential, không trả lý do.
- **Không** cấp `SELECT` trên `employee_credential` cho `siscom_app`; grants V5 và `VERIFY` không đổi vì cổng này.
- **Fail-closed**: cổng lỗi hoặc không trả lời ⇒ coi là **không** đủ điều kiện, lệnh chuyển bị từ chối, không ghi gì.
- **Dùng ở đúng hai chỗ**: điều kiện 1 khi chuyển người phụ trách cơ hội (và danh sách ứng viên nhận), và cờ `ownerLostAccess` (= người phụ trách không còn `canSignIn` **hoặc** quyền hiệu lực không còn đạt đường đầy đủ với cơ hội; cờ chỉ là true/false, không nói nguyên nhân). Người nhận không đủ điều kiện ⇒ 400 `OPPORTUNITY_ASSIGNEE_INELIGIBLE` chung cho mọi nguyên nhân (không ACTIVE, tài khoản không dùng được, thiếu quyền), để thông báo lỗi không lộ trạng thái tài khoản.
- **Người làm công việc giữ nguyên hợp đồng B3**: người nhận TASK ở 5.5(b)3 và việc bàn giao ở 5.5(e) vẫn chỉ kiểm `employee.status = ACTIVE` + thẩm quyền như B3 §5 (credential bị khoá vẫn có thể được giao việc, người đó không đăng nhập được nên không đọc được gì). Đợt Sales **không** đổi helper B3.

### 5.5 Giao diện Sales ↔ Activities (PR234-R1-SEC-02) [Đề xuất kỹ thuật]
Nguyên tắc: **API Activities chung không đổi** — mọi endpoint hiện có (`/customers/:id/activities`, `/activities…`) vẫn tính quyền theo **khách** như B3 §5; đợt này không nới, **với đúng một ngoại lệ được nêu tên**: vị từ hẹp cho việc nhắc tạm hoãn ở (e). Tác vụ hợp lệ của người phụ trách cơ hội **không** phụ trách khách đi qua **endpoint của Sales**, phạm vi bó trong đúng một cơ hội.

**(a) Đọc hoạt động của cơ hội** — `GET /opportunities/:id/activities`: trả **chỉ** hoạt động có `opportunity_id` = cơ hội đó và `deleted_at IS NULL`. Không mở timeline khách, không mở hoạt động của cơ hội khác. Bộ lọc theo **đường truy cập của người gọi với cơ hội**:
- Đạt **đường đầy đủ** ⇒ thấy mọi hoạt động của cơ hội.
- **Chỉ** đạt đường theo việc (PR234-R3-SEC-01) ⇒ quyền với cơ hội **không** thay cho quyền với từng công việc. Mỗi dòng trả về phải thoả, **trên chính dòng đó**: `performed_by = người gọi` **và** người gọi đang đọc được dòng đó theo **đúng vị từ đọc của B3** — cùng một hàm với `GET /activities/:id` (trong phạm vi đọc khách; hoặc có `activity_access` của **chính hoạt động đó** chưa thu hồi, chưa hết hạn, kèm `activity.update_own` còn hiệu lực, khách và hoạt động chưa xoá mềm). Việc A còn hiệu lực chỉ mở đường tới **cơ hội**; nó **không** cho đọc việc B của cùng cơ hội khi B3 đã từ chối B (hết hạn, bị thu hồi, đã đóng nên quyền bị thu hồi, xoá mềm).
- Bộ lọc này nằm **trong điều kiện truy vấn**, trước khi đếm và phân trang: tổng số, số trang, kết quả lọc/tìm kiếm chỉ tính các dòng đã qua lọc; không có đường nào đếm trước rồi lọc sau. Sales **không** có endpoint chi tiết hoạt động riêng: chi tiết luôn đi qua `GET /activities/:id` của B3, nên dòng B3 từ chối thì không đọc được ở đâu cả.

**(b) Tạo hoạt động/công việc từ cơ hội** — `POST /opportunities/:id/activities`: hoạt động luôn gắn `opportunity_id` = cơ hội đó và `customer_id` = khách của cơ hội. Kiểm **ba** thứ độc lập:
1. **Cơ hội**: người gọi đạt vị từ `opportunity.update` trên cơ hội (đọc thôi là chưa đủ).
2. **Hoạt động**: người gọi có mã hoạt động tương ứng **đang hiệu lực** (`activity.create`, hoặc `activity.create_tech` với loại được phép) — ở endpoint này mã `activity.*` chỉ cần có hiệu lực ở bất kỳ phạm vi; **phạm vi do quyền trên cơ hội quyết định**, không phải phạm vi theo khách.
3. **Người nhận** (khi là TASK có người làm): đúng quy tắc B3 — ACTIVE và có thẩm quyền làm việc. Người nhận **không** đọc được khách ⇒ cấp `activity_access` theo B3 §5.4 **trong cùng transaction** (hạn, audit, thu hồi y như B3); người gọi phải có `activity.assign` và `activity.assign_external` đang hiệu lực (bất kỳ phạm vi, lý do như điểm 2).

Cách tính "phạm vi do quyền trên cơ hội quyết định" ở điểm 2 và 3 **chỉ tồn tại trong endpoint này**: không dùng lại ở `/customers/:id/activities` hay `/activities…`, nơi `activity.*` vẫn tính theo khách như B3. Kiểm người nhận và quyền cấp `activity_access` không được bỏ qua ở bất kỳ nhánh nào.

**(c) Gắn / đổi / bỏ `opportunityId` qua API Activities chung** (tạo hoặc sửa hoạt động của khách): ngoài kiểm B3 như cũ, kiểm thêm với **từng** cơ hội liên quan (cũ và mới): không thấy được ⇒ 404 `OPPORTUNITY_NOT_FOUND`; thấy được nhưng không đạt `opportunity.update` ⇒ 403. Cùng khách là **chưa đủ** — người phụ trách khách chỉ-đọc một cơ hội **không** gắn được việc vào cơ hội đó (vì gắn việc là mở đường đọc cơ hội cho người làm việc). DB vẫn buộc cùng khách (S2).

**(d) Đường đọc theo việc** (Kỹ thuật) — **không lưu quyền riêng**, tính ở mọi request. Người gọi đọc được bản kỹ thuật của cơ hội O khi **tồn tại** hoạt động A thoả **tất cả**: `A.opportunity_id = O`; `A.type = TASK`, `A.status = OPEN`, `A.deleted_at IS NULL`; `A.performed_by = người gọi`; người gọi **đang đọc được A theo đúng vị từ B3** (trong phạm vi khách, hoặc có `activity_access` chưa thu hồi và chưa hết hạn); người gọi có `opportunity.read_assigned` đang hiệu lực. Vì là vị từ, quyền **tự hết** ngay khi một điều kiện không còn: việc DONE/CANCELLED/xoá mềm; đổi người làm; `activity_access` hết hạn hoặc bị thu hồi; `opportunity_id` của việc bị đổi/bỏ; mất vai trò; cơ hội hoặc khách bị xoá mềm.

**(e) Công việc tự sinh** (6.13) do **service Sales** tạo qua hàm nội bộ của module Activities (không phải endpoint công khai), trong cùng transaction với thao tác trên cơ hội. Quyền = mã Sales của thao tác (`opportunity.close`), **không** đòi `activity.*` theo khách:
- **Việc nhắc tạm hoãn** (`HOLD_REMINDER`): người làm = người phụ trách cơ hội. Người phụ trách cơ hội luôn đọc được việc này qua (a) và thấy trong "Công việc của tôi"/chuông nhờ vị từ hẹp bổ sung ở Activities: `opportunity_auto_kind = 'HOLD_REMINDER' AND performed_by = actor AND actor đạt đường đầy đủ với cơ hội đó`. Không dùng `activity_access` cho loại này (hạn `activity_access` tối đa 30 ngày, ngắn hơn hạn hoãn có thể có). Đây là **ngoại lệ duy nhất** của câu "API Activities chung không đổi" (là một nhánh OR thêm vào vị từ đọc của B3), giới hạn như sau:
  - Điều kiện đầy đủ: việc có `opportunity_auto_kind = 'HOLD_REMINDER'`, `type = TASK`, `deleted_at IS NULL`; `performed_by = người gọi`; cơ hội và khách chưa xoá mềm; người gọi **đang** đạt đường đầy đủ với cơ hội đó (tính lại mỗi request). Đổi người phụ trách, mất vai trò, xoá mềm ⇒ mất ngay.
  - **Được**: đọc đúng việc đó (danh sách "Công việc của tôi", chuông, `GET /activities/:id`) và **hoàn thành** nó qua đường "`performed_by` = tôi" sẵn có của B3.
  - **Không được**: sửa nội dung, đổi hạn trực tiếp (hạn đổi qua `/hold`), giao lại, đề xuất chuyển việc, xoá; đọc khách, người liên hệ, timeline khách hay bất kỳ hoạt động nào khác — các thao tác đó vẫn tính theo khách như B3.
  - Không áp cho `WIN_HANDOVER` và không áp cho việc người dùng tạo.
- **Việc bàn giao** (`WIN_HANDOVER`): người làm do người chốt chọn; kiểm người nhận như (b)3; cần cấp `activity_access` thì cấp theo B3 §5.4, ghi `granted_by` = người chốt, audit như B3.
Phạm vi đặc biệt này chỉ áp cho hai `opportunity_auto_kind` trên; mọi việc do người dùng tạo đi qua (b) hoặc (c).

Hệ quả cho người phụ trách cơ hội **không** phụ trách khách: tạo/đổi giai đoạn/Tạm hoãn/Tiếp tục/Thắng/Thua, tạo việc gắn cơ hội, đọc việc của cơ hội — **được**; đọc timeline khách, hoạt động không gắn cơ hội, cơ hội khác của khách, tạo hoạt động qua `/customers/:id/activities` — **không**.
### 5.3 Cấp quyền trên DB đã bootstrap
Qua yêu cầu hai người (mẫu `B3_ACTIVITY_PERMISSIONS`, có script gỡ) và grants V5 cho `siscom_app` (INSERT/UPDATE `opportunity`; `opportunity_change` chỉ INSERT; không DELETE). Diễn tập trên PostgreSQL tạm trong CI trước. Ma trận trong `bootstrap.ts` chỉ áp cho DB mới tinh; unit test giữ hai nguồn khớp nhau như B3.
**Phân loại BIZ cho `opportunity.*` (phát hiện khi làm S5, 17/11/2026):** rào chắn SoD của M1 cấm vai trò `admin` (Quản trị hệ thống) giữ quyền nhóm BIZ, nhưng hàm `fn_auth_perm_class` chỉ xếp `customer|contact|activity|interaction|approval` vào BIZ ⇒ nếu không sửa, 10 mã `opportunity.*` rơi vào nhóm OTHER và DB **không** chặn việc cấp chúng cho Quản trị hệ thống (trái D6). S5 thêm migration `20261118000000_sales_perm_class` chỉ thay hàm này (không đổi bảng/dữ liệu/grants); script cấp quyền hai người **từ chối** khi migration chưa áp; rollback của migration **từ chối** khi còn mã `opportunity.*` trong `permission` (thứ tự lùi: gỡ quyền → lùi hàm). Phạm vi `opportunity.read_assigned` của Kỹ thuật ghi là `OWN` (hẹp nhất; vị từ 5.5(d) chỉ cần mã đang hiệu lực).

## 6. Quy tắc nghiệp vụ
1. **Tạo** [O4][O5]: bắt buộc khách, tiêu đề, loại. Có lựa chọn "Gắn với dự án/công trình": **bật** ⇒ bắt buộc tên dự án/công trình và phạm vi SISCOM đang chào (kể cả khi chỉ cung cấp thiết bị); loại **Thi công** hoặc **Cung cấp và thi công** ⇒ lựa chọn này **luôn bật, không tắt được**; **tắt** (bán hàng không gắn dự án) ⇒ không bắt tên dự án, vẫn tạo được cơ hội. Người phụ trách mặc định = người phụ trách khách tại lúc tạo; trạng thái Đang mở, giai đoạn Tiếp cận.
2. **Đổi giai đoạn** [C14]: tới hoặc lùi tự do giữa Tiếp cận, Khảo sát, Báo giá, Đàm phán; mỗi lần ghi lịch sử. Rời Tiếp cận cần `need_summary`. Từ Báo giá trở lên cần `expected_amount_vnd`. Xác suất về mặc định của giai đoạn mới, trừ khi đã sửa tay (khi đó hỏi giữ hay đặt lại).
3. **Sửa xác suất tay, giá trị, ngày dự kiến chốt**: ghi lịch sử; xác suất sửa tay bắt buộc lý do.
4. **Tạm hoãn** [C3][C13]: bắt buộc ngày liên hệ lại + lý do; giữ nguyên giai đoạn; rời kanban, vào danh sách Tạm hoãn; **tự tạo một công việc** (TASK) nhắc người phụ trách vào ngày đó; mở lại về đúng giai đoạn cũ, công việc nhắc còn mở tự đóng.
   - **Tiếp tục (Tạm hoãn → Đang mở)** — PR234-R1-HOLD: endpoint **riêng** `POST /opportunities/:id/resume` `{ version }` (lý do tuỳ chọn); quyền **`opportunity.close`**, cùng phạm vi với Tạm hoãn (người phụ trách cơ hội, Quản trị CRM) — **không** dùng `/reopen`. Chỉ hợp lệ khi `status = ON_HOLD` (khác ⇒ 409 `OPPORTUNITY_STATE`). Giữ nguyên `stage_id`; `status` → OPEN; `hold_until`, `hold_reason` **giữ lại** làm dấu vết (không hiển thị khi OPEN; lần Tạm hoãn sau ghi đè); ghi `opportunity_change` (STATUS ON_HOLD→OPEN). Công việc nhắc **của lần tạm hoãn hiện tại** (nhận diện theo 6.13) còn OPEN ⇒ `CANCELLED` (kết quả "Cơ hội đã tiếp tục"); đã DONE ⇒ giữ. Áp R-S1/R-S2 trên trạng thái sau cập nhật.
   - **Đổi hạn/lý do khi đang Tạm hoãn** (PR234-R1-BIZ-01): `POST /opportunities/:id/hold` `{ version, holdUntil, holdReason }` khi `status` đã là ON_HOLD = **cập nhật**, không phải tạm hoãn lần mới. `status` giữ ON_HOLD; ghi `opportunity_change` trường HOLD (hạn cũ → hạn mới, kèm lý do). Việc nhắc tự sinh còn OPEN ⇒ **cập nhật hạn và giờ nhắc của chính việc đó** (không tạo việc thứ hai); việc nhắc đã DONE hoặc bị người dùng huỷ ⇒ tạo việc nhắc mới cho hạn mới (unique riêng phần cho phép vì không còn việc OPEN). Cùng một transaction.
   - **Tạm hoãn → Thắng / Thua trực tiếp** (PR234-R1-BIZ-01): **được**, không buộc Tiếp tục trước (khách quay lại chốt, hoặc xác nhận huỷ). `/win`, `/lose` nhận cả OPEN và ON_HOLD; điều kiện Thắng/Thua như quy tắc 5, 6; ghi STATUS ON_HOLD→WON/LOST. Việc nhắc tự sinh còn OPEN ⇒ `CANCELLED` (kết quả "Cơ hội đã chốt") **trong cùng transaction**; đã DONE ⇒ giữ. Không có đường tự động chuyển Tạm hoãn thành Thua (D3): luôn là thao tác của người có `opportunity.close`.
   - **Chuyển người phụ trách khi đang Tạm hoãn**: việc nhắc tự sinh còn OPEN ⇒ **đổi người làm sang người phụ trách mới** trong cùng transaction (việc nhắc là của người phụ trách cơ hội; người cũ có thể không còn đọc được cơ hội). Việc do người dùng tạo và việc bàn giao **không** đổi người làm.
5. **Thắng** [C8][C12]: bắt buộc loại chứng từ, số, ngày, giá trị chốt, đường dẫn Drive (hệ thống không tự xác minh; đây là khai báo của người dùng); sau khi Thắng **tự tạo công việc "Bàn giao thực hiện"**, người chốt chọn người nhận; kiểm người nhận và cấp quyền theo việc theo 5.5(e) (không mở rộng phạm vi xem khách). Khi WON: `closed_at` = thời điểm chốt; xác suất **hiển thị** 100 (Thua: 0) suy từ `status`, cột `probability` giữ giá trị trước khi đóng để dùng lại nếu mở lại.
6. **Thua**: bắt buộc lý do; giá trị được để trống nếu chưa tới Báo giá.
7. **Mở lại** cơ hội đã Thắng/Thua [C16]: chỉ Quản trị CRM (`opportunity.reopen`), `POST /opportunities/:id/reopen` `{ version, reason }`, chỉ khi `status` WON/LOST (ON_HOLD dùng `/resume`, 6.4); bắt buộc lý do, ghi lịch sử; `status` → OPEN, `closed_at` → NULL (CHECK `ck_opp_closed`), giữ giai đoạn; trường thắng/thua giữ làm dấu vết. Công việc "Bàn giao thực hiện" của lần Thắng trước (6.13): còn OPEN ⇒ `CANCELLED` (kết quả "Cơ hội đã mở lại"); đã DONE ⇒ giữ. Thắng lần nữa ⇒ tạo việc bàn giao **mới**. Cơ hội đã đóng khoá sửa.
8. **Chuyển người phụ trách** [C6][O3]: bắt buộc lý do; ghi người chuyển, thời điểm, người cũ, người mới. Người nhận phải **ACTIVE**, **cùng phòng với người phụ trách hiện tại** và **đủ quyền đảm nhận** (định nghĩa ở 5.4: quyền hiệu lực có cả `opportunity.read` và `opportunity.update`); **không cần** có quyền sửa chính cơ hội đó từ trước, quyền phát sinh sau khi `owner_id` đổi. **Quản trị CRM** được chuyển khác phòng, nhưng người nhận vẫn phải ACTIVE và đủ quyền. Nếu phòng của người phụ trách hiện tại hoặc của người nhận **chưa xác định** thì chỉ Quản trị CRM được chuyển. Không đổi người phụ trách khách. Công việc đang mở của cơ hội giữ nguyên người làm, **trừ việc nhắc tạm hoãn tự sinh** (chuyển sang người phụ trách mới, quy tắc 4). Người nhận không tự thấy thêm dữ liệu khách ngoài thẻ tối thiểu.
9. **Khách bị xoá mềm** ⇒ cơ hội ẩn theo; không ai xoá vĩnh viễn qua ứng dụng. Xoá mềm cơ hội chỉ Quản trị CRM, có lý do. **Khôi phục** cơ hội đã xoá mềm: chỉ Quản trị CRM (`opportunity.restore`), theo đường nạp riêng ở 5.4; khách còn bị xoá mềm ⇒ phải khôi phục khách trước; trạng thái và công việc giữ nguyên như lúc xoá.
10. **Sửa đồng thời**: `version` như khách hàng; người sau nhận báo xung đột.
11. **Ngày, hạn** tính theo giờ Việt Nam (Asia/Ho_Chi_Minh).
12. **Audit**: mọi tạo, đổi giai đoạn, trạng thái, người phụ trách, giá trị, xác suất, ngày chốt, mở lại, xoá mềm; nội dung ghi chú và lý do được che trong audit chung.
13. **Công việc tự tạo** (Tạm hoãn → nhắc; Thắng → "Bàn giao thực hiện") — PR234-R1-TASK:
   - **Nguyên tử**: đổi `status` (kiểm `version`), ghi `opportunity_change`, tạo/đóng TASK và audit trong **một transaction**; lỗi bất kỳ ⇒ không ghi gì.
   - **Không trùng**: gửi lặp hoặc hai yêu cầu đồng thời cho cùng một lần chuyển ⇒ yêu cầu sau gặp `version` cũ ⇒ 409 `OPPORTUNITY_VERSION_CONFLICT`, không tạo TASK thứ hai. Chốt thêm ở DB: cột `activity.opportunity_auto_kind` (`HOLD_REMINDER` | `WIN_HANDOVER`, NULL với việc thường) + chỉ mục **unique riêng phần** `(opportunity_id, opportunity_auto_kind) WHERE status = 'OPEN' AND deleted_at IS NULL` ⇒ mỗi cơ hội tối đa **một** việc nhắc và **một** việc bàn giao đang mở; CHECK `opportunity_auto_kind IS NULL OR (type = 'TASK' AND opportunity_id IS NOT NULL)`. Migration **cộng thêm** ở S8 (không sửa migration S2 đã merge).
   - **Nhận diện**: việc tự sinh của lần hiện tại = việc có `opportunity_id` = cơ hội, `opportunity_auto_kind` đúng loại, `status = OPEN`, `deleted_at IS NULL` (**cùng điều kiện với chỉ mục unique riêng phần**, để truy vấn và ràng buộc không lệch nhau) — **không** dựa vào tiêu đề, **không** đóng mọi việc của cơ hội. Việc người dùng tự tạo gắn cơ hội (`opportunity_auto_kind` NULL) không bị tự đóng.
   - Người nhận việc nhắc = người phụ trách cơ hội lúc tạm hoãn; người nhận việc bàn giao = người chốt chọn (5.5(e)). Chuyển người phụ trách (6.8): việc nhắc tạm hoãn tự sinh đổi theo người phụ trách mới; việc bàn giao và việc người dùng tạo không đổi.
   - **Bảng chuyển trạng thái** (mọi dòng: kiểm `version`, một transaction, ghi `opportunity_change`):

     | Từ → Đến | Endpoint · mã quyền | Trường đặt / giữ | Việc tự sinh |
     |---|---|---|---|
     | OPEN → ON_HOLD | `/hold` · `close` | đặt `hold_until`, `hold_reason`; giữ giai đoạn | tạo 1 việc nhắc |
     | ON_HOLD → ON_HOLD (đổi hạn) | `/hold` · `close` | cập nhật `hold_*`; lịch sử HOLD | cập nhật hạn việc nhắc OPEN; không còn OPEN ⇒ tạo mới |
     | ON_HOLD → OPEN | `/resume` · `close` | giữ `hold_*` làm dấu vết; áp R-S1/R-S2 | việc nhắc OPEN ⇒ CANCELLED |
     | OPEN hoặc ON_HOLD → WON | `/win` · `close` | đặt `won_*`, `closed_at` | việc nhắc OPEN ⇒ CANCELLED; tạo 1 việc bàn giao |
     | OPEN hoặc ON_HOLD → LOST | `/lose` · `close` | đặt `lost_reason_id`, `closed_at` | việc nhắc OPEN ⇒ CANCELLED |
     | WON / LOST → OPEN | `/reopen` · `reopen` (chỉ ALL) | `closed_at` → NULL; giữ `won_*`/`lost_*` làm dấu vết (lần đóng sau ghi đè); giữ giai đoạn, `probability`; áp R-S1/R-S2 | việc bàn giao OPEN ⇒ CANCELLED |
     | WON ↔ LOST, ON_HOLD → reopen, OPEN → resume | — | không có đường; ⇒ 409 `OPPORTUNITY_STATE` | — |
14. **Tài liệu cơ hội** [C10] — PR234-R1-FILES: chỉ lưu **đường dẫn Google Drive + tên tệp**, không tải tệp lên CRM.
   - Bảng **`opportunity_document`** (migration cộng thêm ở S9): `id`, `opportunity_id`, `kind` (`TECHNICAL` = bản vẽ, thông số, hồ sơ kỹ thuật | `COMMERCIAL` = báo giá, hợp đồng, tài liệu giá), `file_name` (≤255, bắt buộc), `url` (chỉ `https://`), `created_by/at`, xoá mềm `deleted_by/at`. Chỉ thêm / xoá mềm, không sửa.
   - **Chứng từ Thắng** ở trên chính cơ hội (`won_doc_*`), bổ sung `won_doc_file_name` (≤255) cùng migration S9 để đủ "tên tệp" theo C10; **không** nằm trong `opportunity_document`.
   - Quyền: xem `TECHNICAL` = mọi người xem được cơ hội (kể cả Kỹ thuật theo việc); xem `COMMERCIAL` và `won_doc_*` = người đạt **đường đọc đầy đủ** (5.4: Quản trị CRM, Kế toán, Kinh doanh theo 5.1) — người chỉ đạt **đường theo việc** (Kỹ thuật) **không bao giờ nhận** (trường trả theo đường truy cập, 5.4). Thêm / xoá mềm = người có `opportunity.update` trên cơ hội.
   - API: `GET /opportunities/:id/documents` (lọc theo quyền xem từng `kind`), `POST /opportunities/:id/documents` `{ kind, fileName, url }`, `DELETE /opportunities/:id/documents/:docId` (xoá mềm, lý do).

## 7. API [Đề xuất] (`/api/v1`, cookie + Origin + CSRF như hiện nay, bọc `{ data }`)
`GET /opportunities` (lọc giai đoạn, trạng thái, người phụ trách, loại, khách, hạn chốt, tìm theo tiêu đề/tên dự án; phân trang) · `GET /opportunities/:id` · `POST /opportunities` · `PATCH /opportunities/:id` (có `version`) · `POST /opportunities/:id/stage` · `POST /opportunities/:id/hold` · `POST /opportunities/:id/win` · `POST /opportunities/:id/lose` · `POST /opportunities/:id/resume` (Tạm hoãn → Đang mở, 6.4) · `POST /opportunities/:id/reopen` (chỉ Thắng/Thua, Quản trị CRM, 6.7) · `POST /opportunities/:id/assign` · `GET /opportunities/:id/changes` · `GET /customers/:id/opportunities` · `DELETE /opportunities/:id` (xoá mềm, lý do) · `POST /opportunities/:id/restore` `{ version }` và `GET /opportunities?deleted=only` (đường nạp riêng, 5.4; 409 `OPPORTUNITY_CUSTOMER_DELETED` khi khách còn bị xoá). Hoạt động theo cơ hội: `GET|POST /opportunities/:id/activities` (5.5(a)(b)). API Activities chung: thêm `opportunityId` tuỳ chọn khi tạo/sửa, kiểm theo 5.5(c) (cùng khách là chưa đủ). Tài liệu: `GET|POST /opportunities/:id/documents`, `DELETE /opportunities/:id/documents/:docId` (6.14). `/hold` nhận cả OPEN (tạm hoãn) và ON_HOLD (đổi hạn); `/win`, `/lose` nhận OPEN và ON_HOLD (bảng 6.13). Trường trả về quyết định theo **đường truy cập** của người gọi với từng cơ hội (5.4), **không** theo tên vai trò: đường theo việc không bao giờ nhận giá trị, xác suất, `/changes`, lý do thua, `won_doc_*`, tài liệu `COMMERCIAL`; `/changes` và tổng giá trị (kanban, đếm) chỉ cho đường đầy đủ. Mọi thao tác đổi trạng thái nhận `version`; sai ⇒ 409. Lỗi: 404 ngoài phạm vi xem; 403 thấy được nhưng thiếu quyền; 409 `OPPORTUNITY_STATE` sai trạng thái nguồn; 409 `OPPORTUNITY_VERSION_CONFLICT`; 400 theo trường.

## 8. Màn hình
**8.1 Danh sách (máy tính, kanban)**
```
Cơ hội kinh doanh                         [Bảng | Kanban]   [+ Tạo cơ hội]
Lọc: [Người phụ trách ▾] [Loại ▾] [Dự kiến chốt ▾] [Tìm tiêu đề, tên dự án...]   Tạm hoãn (3) · Đã đóng
┌ Tiếp cận · 6 ─────┐┌ Khảo sát · 4 ────┐┌ Báo giá · 5 ─────┐┌ Đàm phán · 2 ────┐
│ 1,2 tỷ + 2 chưa rõ ││ 3,4 tỷ           ││ 9,8 tỷ           ││ 12,6 tỷ          │
│ ┌───────────────┐  ││ ┌──────────────┐ ││ ┌──────────────┐ ││ ┌──────────────┐ │
│ │CH-0012        │  ││ │CH-0009       │ ││ │CH-0007       │ ││ │CH-0003       │ │
│ │HVAC tháp A    │  ││ │Phòng sạch…   │ ││ │Chiller…      │ ││ │…             │ │
│ │Hoàng Gia      │  ││ │BV An Khang   │ ││ │7,2 tỷ · 45%  │ ││ │12,6 tỷ · 70% │ │
│ │Chưa rõ · 10%  │  ││ │1,1 tỷ · 25%  │ ││ │⚠ quá hạn chốt│ ││ │20/12 · An    │ │
│ └───────────────┘  ││ └──────────────┘ ││ └──────────────┘ ││ └──────────────┘ │
└────────────────────┘└──────────────────┘└──────────────────┘└──────────────────┘
```
Kéo thả giữa cột; mỗi thẻ có nút "Chuyển giai đoạn" (bàn phím, điện thoại). Tổng mỗi cột tách riêng "chưa rõ giá trị". Tạm hoãn và đã đóng nằm ngoài kanban, có danh sách riêng.
**8.2 Chi tiết cơ hội**
```
← CH-0007 · Chiller trung tâm dữ liệu GĐ1                [Đang mở]  [Sửa]
Khách: KH-00478 Công ty …    Loại: Cung cấp và thi công
Dự án/công trình: Trung tâm dữ liệu GĐ1    Phạm vi SISCOM chào: cung cấp chiller + lắp đặt
● Tiếp cận ── ● Khảo sát ── ◉ Báo giá ── ○ Đàm phán          [Chuyển giai đoạn ▾]
Giá trị dự kiến: 7.200.000.000 đ (chưa VAT)  Xác suất: 45%  Dự kiến chốt: 20/12/2026
Phụ trách: Trần Bình [Chuyển…]                [Tạm hoãn] [Thắng] [Thua]   (khi Tạm hoãn: [Tiếp tục])
Nhu cầu của khách: …
Tab: Hoạt động & công việc | Báo giá (gói sau) | Lịch sử thay đổi | Tài liệu (link Drive + tên tệp; nhóm Kỹ thuật / Thương mại — Kỹ thuật chỉ thấy nhóm Kỹ thuật)
```
**8.3 Biểu mẫu "Tạo cơ hội"** [C17][O4] (hướng dẫn hiện ngay trên biểu mẫu):
```
Khách hàng *        [KH-00478 Công ty … ▾]
Tiêu đề *           [__________________________]
Loại cơ hội *       (•) Cung cấp thiết bị, vật tư  ( ) Thi công  ( ) Cung cấp và thi công
   ⓘ Chọn theo PHẠM VI SISCOM CHÀO, không phải toàn bộ công trình.
     Ví dụ: chỉ bán FCU cho khách sạn → chọn "Cung cấp thiết bị, vật tư".
[ ] Gắn với dự án/công trình     (tự bật và khoá khi chọn Thi công / Cung cấp và thi công)
   Tên dự án/công trình *   [__________________]      ← chỉ hiện khi bật
   Phạm vi SISCOM đang chào *  [__________________]   ← chỉ hiện khi bật; ví dụ "cung cấp 120 FCU"
Nhu cầu của khách   [__________________]   (bắt buộc trước khi rời Tiếp cận)
```
**Các hộp thoại khác**: Chuyển giai đoạn (đòi giá trị nếu thiếu) · Tạm hoãn (ngày liên hệ lại, lý do) · Thắng (loại chứng từ, số, ngày, giá trị chốt, link; chọn người nhận "Bàn giao thực hiện") · Thua (lý do, ghi chú) · Chuyển người phụ trách (người mới, lý do) · Tiếp tục (từ Tạm hoãn; lý do tuỳ chọn) · Mở lại (từ Thắng/Thua, chỉ Quản trị CRM; lý do).
**8.4 Chi tiết khách hàng**: thêm tab "Cơ hội". Khi ghi nhận hoạt động/công việc: thêm ô chọn cơ hội của khách đó.
**8.5 Điện thoại (390 px)**: danh sách dạng thẻ, lọc theo giai đoạn bằng thanh chọn ngang; không kéo thả, dùng nút "Chuyển giai đoạn".
**8.6 Kỹ thuật**: trong công việc được giao hiện thẻ cơ hội rút gọn (không có giá trị).
Dùng bộ giao diện hiện có; hộp thoại dùng chung `Modal` (Issue #218 về quản lý focus nên sửa trước hoặc cùng đợt S10).

## 9. Kế hoạch PR nhỏ (Draft; ChatGPT review; Owner duyệt merge từng PR)
| PR | Nội dung | Đụng DB? |
|---|---|---|
| **S1** | **Tài liệu này** + checklist nghiệm thu + rà soát độc lập | không |
| S2 | Migration cộng thêm (2 bảng `opportunity`, `opportunity_change` + cột `activity.opportunity_id` + hàm mã) + rollback + diễn tập CI | chỉ PostgreSQL tạm của CI |
| S3 | Grants V5 + VERIFY + diễn tập nâng/lùi | chỉ CI |
| S4 | Danh mục (giai đoạn, 3 loại, lý do thua) trong lệnh seed | chỉ CI |
| S5 | Mã quyền `opportunity.*` (gồm `read_assigned`; mỗi mã cấp riêng) + vị từ theo 5.4 (quyền hiệu lực, nhiều vai trò, thu hồi, điều kiện người nhận, đường nạp riêng cho khôi phục) + cổng `canSignIn` ở module auth cho người nhận và `ownerLostAccess` (5.4; không cấp thêm quyền DB cho `siscom_app`) + script cấp quyền hai người + script gỡ + **migration `20261118000000_sales_perm_class`** (chỉ thay hàm `fn_auth_perm_class` để `opportunity.*` thuộc nhóm BIZ, xem 5.3) + rollback | chỉ PostgreSQL tạm của CI |
| S6 | Backend đọc: danh sách, chi tiết, theo khách; ma trận quyền | không |
| S7 | Backend ghi: tạo, sửa, đổi giai đoạn, lịch sử | không |
| S8 | Migration cộng thêm `activity.opportunity_auto_kind` + unique riêng phần (6.13) + rollback; backend: Tạm hoãn, đổi hạn hoãn, Tiếp tục, Thắng/Thua (kể cả từ Tạm hoãn), mở lại, chuyển người phụ trách (kèm chuyển việc nhắc), công việc tự tạo nguyên tử theo bảng 6.13 và 5.5(e). Rollback của migration này theo nguyên tắc S2: từ chối khi còn dữ liệu | chỉ PostgreSQL tạm của CI |
| S9 | Migration cộng thêm `opportunity_document` + `won_doc_file_name` (6.14) + rollback + grants; giao diện Sales ↔ Activities theo 5.5: endpoint hoạt động theo cơ hội, kiểm `opportunityId` ở API Activities chung, đường đọc theo việc của Kỹ thuật; API tài liệu. Rollback từ chối khi còn dữ liệu | chỉ PostgreSQL tạm của CI |
| S10 | Giao diện: danh sách bảng, chi tiết, hộp thoại (kèm sửa Issue #218) | không |
| S11 | Giao diện: kanban, tab Cơ hội trong chi tiết khách, điện thoại | không |
| S12 | Cập nhật staging: sao lưu → `deploy.sh --migrate` → grants V5 → cấp quyền hai người → seed danh mục → nghiệm thu mục 10 | **staging; Owner duyệt riêng từng bước** |
**Đường lùi (PR234-R1-DB-02)**: ưu tiên **lùi mã ứng dụng, giữ schema cộng thêm** (`deploy.sh --rollback`; cột/bảng mới để nguyên, mã cũ không dùng tới). Gỡ cấu trúc (rollback SQL của S2/S8/S9) chỉ chạy khi tiền kiểm xác nhận **không còn dữ liệu sẽ mất** — cơ hội, lịch sử, tài liệu, `activity.opportunity_id`/`opportunity_auto_kind` khác NULL, kể cả dòng đã xoá mềm; còn ⇒ script **từ chối**, dữ liệu nguyên vẹn. Thứ tự gỡ: quyền ứng dụng (script gỡ hai người) → grants về V4 → cấu trúc. Không khôi phục đè lên DB đang có dữ liệu mới như một bước tự động; khôi phục từ bản sao lưu luôn vào DB mới và do Owner quyết.
Không PR nào đụng DB thật. Phần làm **ngay**: S1–S12. Phần để **sau**: mục 3 "Để sau" và gói Báo giá đợt 1.

## 10. Tiêu chí nghiệm thu
1. Tạo cơ hội cho khách có sẵn; một khách có 2 cơ hội cùng mở; dữ liệu khách không đổi (so số khách và người phụ trách trước/sau). Không có ô chọn lĩnh vực trên màn hình.
1a. **Dự án/công trình** [O4]: loại "Thi công" hoặc "Cung cấp và thi công" ⇒ ô "Gắn với dự án/công trình" tự bật, không tắt được, gọi API cố tắt ⇒ bị từ chối. Đã gắn dự án mà thiếu tên dự án hoặc phạm vi chào (kể cả chỉ cung cấp thiết bị, kể cả chỉ có khoảng trắng) ⇒ bị chặn. Một dự án chỉ cung cấp hàng tạo được với loại "Cung cấp thiết bị, vật tư" mà không bị ép thành thi công.
1b. **Bán hàng không gắn dự án** [O5]: loại "Cung cấp thiết bị, vật tư", không gắn dự án, không tên dự án ⇒ tạo được và đi hết các giai đoạn tới Thắng/Thua. Không có chức năng bắt nhập mọi giao dịch bán lẻ đã hoàn tất.
1c. **Biểu mẫu** hiện đúng câu hướng dẫn về loại cơ hội (phạm vi SISCOM chào, ví dụ FCU khách sạn) ở trạng thái mặc định, trên máy tính và điện thoại.
2. Đi đủ Tiếp cận → Đàm phán, có bỏ qua Khảo sát và có lùi giai đoạn; mỗi bước có dòng lịch sử đúng người, đúng giờ Việt Nam.
3. Rời Tiếp cận khi thiếu nhu cầu ⇒ bị chặn. Sang Báo giá khi chưa có giá trị ⇒ bị chặn, báo rõ.
4. Sửa xác suất không lý do ⇒ bị chặn; có lý do ⇒ có lịch sử.
5. Thắng thiếu chứng từ hoặc giá trị chốt ⇒ bị chặn; Thắng đủ ⇒ tự tạo công việc "Bàn giao thực hiện". Thua thiếu lý do ⇒ bị chặn.
6. Tạm hoãn: không tính vào Thua và tỷ lệ thắng; có ngày liên hệ lại; tự tạo công việc nhắc; mở lại về đúng giai đoạn cũ và đóng công việc nhắc.
7. Giá trị trống hiển thị "Chưa rõ", không hiển thị 0 và không cộng vào tổng.
8. Chuyển người phụ trách [O3]: người phụ trách khách không đổi; có lịch sử (người chuyển, thời điểm, người cũ, người mới) + lý do; không có lý do ⇒ bị chặn. Ma trận cho người chuyển × người nhận: người phụ trách cơ hội → người ACTIVE cùng phòng, đủ quyền (Kinh doanh/Quản trị CRM) ⇒ được; → người khác phòng ⇒ bị chặn; → người không ACTIVE ⇒ bị chặn; → người không đủ quyền (Kỹ thuật, Kế toán, Quản trị hệ thống) ⇒ bị chặn; → người **chưa có quyền sửa cơ hội đó** nhưng đủ quyền đảm nhận ⇒ **được**, và sau khi chuyển người nhận sửa được, người cũ không còn sửa được; phòng của người chuyển hoặc người nhận chưa xác định ⇒ chỉ Quản trị CRM chuyển được; Quản trị CRM chuyển khác phòng ⇒ được nếu người nhận ACTIVE và đủ quyền, chuyển cho người không đủ quyền ⇒ bị chặn.
9. **Ma trận quyền** 5 vai trò × (xem danh sách, xem chi tiết, tạo, sửa, đổi giai đoạn, chốt, chuyển người, mở lại, xoá): kiểm bằng **gọi API trực tiếp**, không chỉ giao diện; ngoài phạm vi trả 404; kiểm cả đếm, tìm kiếm, xuất.
9a. **Quyền hiệu lực** (PR234-R1-SEC-01, 5.4) — mỗi ca nêu rõ được/từ chối và mã lỗi: (i) người có hai vai trò Kinh doanh + Kỹ thuật: cơ hội mình phụ trách ⇒ bản đầy đủ; cơ hội chỉ tới qua việc ⇒ bản kỹ thuật; (ii) vai trò chưa xác nhận hoặc vừa bị gỡ ⇒ không đọc/ghi được ở request kế tiếp, không cần đăng nhập lại; (iii) có `opportunity.update` nhưng **không** có `opportunity.close` ⇒ sửa được, Tạm hoãn/Thắng/Thua ⇒ 403; có `update` nhưng không có `assign` ⇒ chuyển người ⇒ 403; có `update` nhưng không có `move_stage` ⇒ đổi giai đoạn ⇒ 403; (iv) người nhận chỉ có `update` mà thiếu `read` ⇒ chuyển bị từ chối; (v) người phụ trách bị gỡ vai trò sau khi nhận ⇒ không đọc/ghi được, `ownerLostAccess = true` với người có `assign`, Quản trị CRM chuyển lại được; (vi) nhân viên không ACTIVE ⇒ không nhận được cơ hội; (vii) **tài khoản người nhận** (PR234-R3-DESIGN-01): nhân viên ACTIVE, đủ vai trò nhưng credential bị khoá (`status` khác ACTIVE) hoặc chưa có credential ⇒ chuyển bị từ chối 400 `OPPORTUNITY_ASSIGNEE_INELIGIBLE` (cùng mã với ca thiếu quyền), không có trong danh sách ứng viên, dữ liệu không đổi; người phụ trách bị khoá credential sau khi nhận ⇒ `ownerLostAccess = true`; cổng auth lỗi ⇒ từ chối (fail-closed); phản hồi không chứa trường nào của credential; `VERIFY` xác nhận `siscom_app` vẫn **không** có SELECT trên `employee_credential`; giao TASK cho người có credential bị khoá qua API Activities ⇒ kết quả **như trước Sales** (hợp đồng B3 không đổi).
9c. **Khôi phục cơ hội** (PR234-R3-SEC-02, 5.4): (i) Quản trị CRM khôi phục cơ hội đã xoá trên khách còn hoạt động ⇒ được; `status`, giai đoạn, người phụ trách, `hold_*`/`won_*` như lúc xoá; `version` tăng 1; có audit `opportunity.restore`; cơ hội hiện lại ở danh sách, chi tiết, đếm; (ii) Kinh doanh (kể cả người phụ trách cũ và người phụ trách khách), Kế toán, Kỹ thuật gọi `/restore` ⇒ 404, dữ liệu không đổi; (iii) trước khi khôi phục: chi tiết, danh sách, kanban, đếm, tìm kiếm, `/changes`, `/activities`, `/documents`, mọi lệnh ghi trên cơ hội đã xoá ⇒ 404 với **mọi** vai trò kể cả Quản trị CRM; chỉ `GET /opportunities?deleted=only` của người có `restore` ALL + `read` mới thấy; (iv) khách còn bị xoá mềm ⇒ 409 `OPPORTUNITY_CUSTOMER_DELETED`, không ghi; khôi phục khách xong thì khôi phục cơ hội được; (v) `/restore` trên cơ hội chưa xoá ⇒ 409 `OPPORTUNITY_STATE`; `version` lệch ⇒ 409; (vi) cơ hội ON_HOLD có việc nhắc OPEN: xoá rồi khôi phục ⇒ vẫn **đúng một** việc nhắc OPEN, cùng người làm; trong lúc bị xoá người phụ trách không đọc được việc nhắc qua ngoại lệ 5.5(e).
9b. **Sales ↔ Activities** (PR234-R1-SEC-02, 5.5), B = người phụ trách cơ hội **không** phụ trách khách, A = người phụ trách khách chỉ-đọc cơ hội đó: (i) B tạo việc qua `POST /opportunities/:id/activities` ⇒ được, việc gắn đúng cơ hội; B gọi `POST /customers/:id/activities` ⇒ bị từ chối như trước Sales; (ii) B Tạm hoãn / Thắng ⇒ việc nhắc / việc bàn giao được tạo, B thấy việc nhắc trong "Công việc của tôi"; (iii) B đọc `GET /opportunities/:id/activities` ⇒ chỉ việc của cơ hội đó; timeline khách, hoạt động không gắn cơ hội, cơ hội khác của khách ⇒ không; (iv) A gắn `opportunityId` của cơ hội mình chỉ-đọc vào một việc ⇒ 403; gắn ID cơ hội không thấy được ⇒ 404; dữ liệu không đổi; (v) giao việc gắn cơ hội cho Kỹ thuật không đọc được khách ⇒ có `activity_access`, Kỹ thuật thấy bản kỹ thuật; (vi) toàn bộ kiểm thử quyền B3 hiện có vẫn đạt nguyên (API Activities chung không nới); (vii) **ngoại lệ việc nhắc tạm hoãn** (5.5(e)): B đọc và hoàn thành được đúng việc nhắc của mình; B sửa nội dung, đổi hạn trực tiếp, giao lại, đề xuất chuyển, xoá việc đó ⇒ bị từ chối như B3; B đọc khách, liên hệ, timeline, hoạt động khác của khách ⇒ vẫn không; sau khi chuyển người phụ trách, B không còn đọc được việc nhắc; việc `WIN_HANDOVER` và việc người dùng tạo **không** đọc được nhờ ngoại lệ này; (viii) người có `activity.create` hiệu lực nhưng ngoài phạm vi khách gọi `/customers/:id/activities` ⇒ vẫn bị từ chối (cách tính phạm vi theo cơ hội của 5.5(b) không lọt sang API chung).
10. Kỹ thuật (đường theo việc, 5.5(d)): chỉ thấy cơ hội của việc đang mở được giao; **không** nhận giá trị dự kiến/chốt, xác suất, lý do thua, `won_doc_*`, tài liệu `COMMERCIAL` ở **mọi** đầu ra — chi tiết, danh sách, tìm kiếm, đếm, tổng cột kanban, `/changes` (bị từ chối), tiêu đề/nội dung việc tự sinh. Mất quyền xem ngay khi **từng** điều kiện sau xảy ra (mỗi điều kiện một ca): việc DONE; việc CANCELLED; việc xoá mềm; đổi người làm; `activity_access` hết hạn; `activity_access` bị thu hồi; `opportunityId` của việc bị đổi/bỏ; mất vai trò; cơ hội hoặc khách xoá mềm.
10a. **Quyền theo từng việc ở endpoint hoạt động của cơ hội** (PR234-R3-SEC-01, 5.5(a)): Kỹ thuật T **không** đọc được khách, có hai TASK A và B cùng cơ hội O, đều `performed_by = T`. A còn OPEN và `activity_access` còn hiệu lực trong mọi ca. Chạy **riêng từng nguyên nhân** cho B: (i) `activity_access` của B hết hạn; (ii) bị thu hồi; (iii) B đã DONE/CANCELLED (quyền bị thu hồi khi đóng); (iv) B bị xoá mềm; (v) B đổi người làm sang người khác. Mỗi ca kiểm đủ: T vẫn đọc được bản kỹ thuật của O (qua A); `GET /opportunities/O/activities` trả A và **không** trả B; tổng số/số trang không đếm B; lọc và tìm kiếm theo nội dung của B không ra kết quả; `GET /activities/B` bị từ chối như B3. Ca đối chứng: (vi) cả A và B còn hiệu lực ⇒ trả cả hai; (vii) T không có việc nào khác ngoài B đã hết quyền ⇒ mất luôn đường đọc O (404); (viii) hoạt động của người khác trên cùng cơ hội không bao giờ xuất hiện với T.
11. Người phụ trách cơ hội không phụ trách khách: chỉ thấy thẻ khách tối thiểu; không mở được cơ hội khác hay timeline của khách.
12. Người phụ trách khách thấy mọi cơ hội của khách mình, không sửa được cơ hội không phụ trách — kiểm bằng **gọi API**: sửa, chuyển giai đoạn, Tạm hoãn, Tiếp tục, Thắng, Thua trên cơ hội do người khác phụ trách ⇒ đều bị từ chối, dữ liệu không đổi (PR234-R1-AUTH). Tạo cơ hội cho khách mình ⇒ được; cho khách không phụ trách ⇒ bị từ chối.
12a. **Tiếp tục / mở lại** (PR234-R1-HOLD): `/resume` từ ON_HOLD ⇒ OPEN đúng giai đoạn cũ, đóng (CANCELLED) đúng việc nhắc đang mở của lần đó; `/resume` khi không ON_HOLD ⇒ 409; `/reopen` trên ON_HOLD ⇒ 409; `/reopen` bởi Kinh doanh ⇒ bị từ chối.
12b. **Công việc tự tạo** (PR234-R1-TASK): gửi lặp cùng `version` và hai yêu cầu Tạm hoãn / Thắng đồng thời ⇒ đúng **một** việc tự sinh, yêu cầu sau 409; lỗi giữa chừng ⇒ không còn trạng thái / lịch sử / việc nửa vời; Tiếp tục chỉ đóng việc nhắc tự sinh, không đóng việc người dùng tạo; Thắng → mở lại → Thắng ⇒ việc bàn giao cũ còn OPEN bị CANCELLED, có đúng một việc bàn giao OPEN mới.
12d. **Vòng đời Tạm hoãn và đóng** (PR234-R1-BIZ-01, bảng 6.13) — mỗi ca kiểm số việc tự sinh OPEN, người làm, `closed_at`, lịch sử: (i) đổi hạn khi đang Tạm hoãn ⇒ vẫn **một** việc nhắc, hạn mới, có dòng lịch sử HOLD; (ii) đổi hạn sau khi người dùng đã hoàn thành/huỷ việc nhắc ⇒ có việc nhắc mới, việc cũ giữ nguyên; (iii) Tạm hoãn → Thắng trực tiếp ⇒ việc nhắc OPEN thành CANCELLED, có một việc bàn giao, `closed_at` có; (iv) Tạm hoãn → Thua trực tiếp ⇒ việc nhắc CANCELLED, không có việc bàn giao; (v) chuyển người phụ trách khi đang Tạm hoãn ⇒ việc nhắc sang người mới, việc người dùng tạo không đổi; (vi) Thắng → mở lại ⇒ `closed_at` NULL, xác suất trở lại giá trị trước khi đóng, chứng từ cũ còn làm dấu vết; (vii) `/resume` khi OPEN, `/reopen` khi ON_HOLD, `/win` khi đã WON/LOST ⇒ 409 `OPPORTUNITY_STATE`, không ghi gì; (viii) tạo việc tự sinh lỗi giữa chừng ⇒ trạng thái cơ hội không đổi.
12e. **Ràng buộc và danh mục** (PR234-R1-DB-01): PATCH xoá `need_summary` khi đã rời Tiếp cận ⇒ 400; PATCH xoá giá trị khi đang ở Báo giá/Đàm phán và OPEN ⇒ 400; Tiếp tục/mở lại về giai đoạn Báo giá mà thiếu giá trị ⇒ 400; gán danh mục sai nhóm hoặc đã ẩn ⇒ bị chặn; liên hệ khác khách ⇒ bị chặn; trường bắt buộc chỉ có khoảng trắng ⇒ bị chặn; **đổi tên và đổi thứ tự** một giai đoạn rồi chạy lại các ca trên ⇒ kết quả không đổi (luật theo `code`).
12c. **Tài liệu** (PR234-R1-FILES): thêm tài liệu thiếu tên tệp hoặc URL không `https://` ⇒ bị chặn; Kỹ thuật gọi API danh sách tài liệu / chi tiết cơ hội ⇒ **không** có tài liệu `COMMERCIAL`, `won_doc_url`, `won_doc_file_name`; Kế toán, Kinh doanh (theo 5.1) thấy đủ.
13. Hai người sửa cùng lúc ⇒ người sau nhận báo xung đột, không mất dữ liệu.
14. Điện thoại thật (iPhone) và máy tính: tạo, chuyển giai đoạn, chốt.
15. Hồi quy: toàn bộ kiểm thử Khách hàng, Hoạt động/Công việc, Xuất CSV hiện có vẫn đạt; `VERIFY` quyền DB đạt với V5.
16. Staging: sao lưu trước; số khách hàng trước và sau migration bằng nhau; đường lùi đã diễn tập trên CI.
16a. **Đường lùi không mất dữ liệu Sales** (PR234-R1-DB-02), diễn tập trên PostgreSQL tạm của CI cho từng migration S2/S8/S9: (i) schema chưa có dữ liệu ⇒ rollback chạy được, nâng lại + grants + VERIFY đạt; (ii) đã có cơ hội / lịch sử / tài liệu / việc gắn cơ hội (kể cả dòng xoá mềm) ⇒ rollback **từ chối**, đếm lại từng bảng bằng trước khi chạy; (iii) lùi mã ứng dụng về bản trước khi có Sales trong khi schema vẫn giữ ⇒ Khách hàng, Hoạt động chạy bình thường, số cơ hội không đổi.

## 11. Rủi ro
- **Phạm vi quyền mới** (theo người phụ trách cơ hội, theo việc) khác cách tính hiện tại theo khách: dễ rò dữ liệu. Giảm: PR riêng (S5), ma trận kiểm thử qua API, 404 ngoài phạm vi, ChatGPT review tập trung phần này.
- **Đụng bảng `activity` đã nghiệm thu** (thêm cột): chỉ cộng thêm, NULL, rollback viết sẵn, chạy lại toàn bộ kiểm thử B3.
- **Migration trên staging có dữ liệu**: lần đầu dùng `--migrate` trên DB không trống; sao lưu và khôi phục thử trước.
- **Đường dẫn Google Drive**: CRM không kiểm được ai mở được tệp; người có link có thể xem ngoài quyền CRM. Chứng từ Thắng là khai báo, không được xác minh.
- **Danh mục đổi sau khi có dữ liệu**: chỉ ẩn, không xoá; gộp giai đoạn cần quy trình riêng.
- **Hai nguồn doanh thu** (`customer.revenue_vnd` ước tính và cơ hội Thắng): giữ tách biệt đến khi có hợp đồng.
- **3 loại cơ hội** chưa phủ bảo trì, sửa chữa/cải tạo, tư vấn/thiết kế (Owner giữ 3 loại, mục 1.3): **chưa định nghĩa** cách ghi các thương vụ đó; đặc tả không chỉ dẫn nhập vào loại nào. Khi thực tế phát sinh, bổ sung danh mục theo quy trình thay đổi (thêm mục, không cần sửa mã) do Owner quyết (PR234-R1-BIZ-02).
- **Loại không suy ra từ tên dự án** (C17): nhân viên có thể chọn "Thi công" cho một dự án chỉ cung cấp hàng hoặc ngược lại; `offer_scope` là chỗ ghi phạm vi thật, cần xem lại cách trình bày để loại và phạm vi không mâu thuẫn nhau trên màn hình.
- **"Đủ quyền đảm nhận" (5.4) dựa trên quyền hiệu lực**: ai được cấp cả `opportunity.read` và `opportunity.update` (qua bất kỳ vai trò nào) đều đủ điều kiện nhận cơ hội; cấp hai mã này cho vai trò mới phải được xem là quyết định về ai được nhận cơ hội.
- **Cổng `canSignIn` ở module auth** (5.4) là điểm chạm mới giữa nghiệp vụ và dữ liệu đăng nhập: chỉ trả một cờ, không cấp quyền DB cho `siscom_app`; nếu S5 không làm được trong các giới hạn đó thì dừng và báo lại, **không** nới quyền đọc credential. Người làm công việc (TASK) vẫn theo hợp đồng B3, nên một người có credential bị khoá vẫn có thể được giao việc bàn giao.
- **Xoá mềm cơ hội không đóng công việc** (5.4, khôi phục): việc nhắc tạm hoãn còn OPEN nhưng người phụ trách không đọc được cho tới khi khôi phục; chọn vậy để khôi phục trả đúng trạng thái trước khi xoá mà không phải dựng lại việc.
- **Vị từ hẹp cho việc nhắc tạm hoãn** (5.5(e)) là thay đổi duy nhất ở phần đọc của module Activities: phải có kiểm thử chứng minh nó không cho đọc khách hay hoạt động khác, và toàn bộ kiểm thử B3 giữ nguyên kết quả.
- **Người phụ trách khách không gắn được việc vào cơ hội mình chỉ-đọc** (5.5(c)): chặt có chủ đích để không mở đường đọc cơ hội; nếu thực tế cần, mở bằng quyết định riêng.
- **Lĩnh vực mặc định HVAC, chưa lưu**: nếu sau này SISCOM thêm lĩnh vực thứ hai, dữ liệu cũ phải được hiểu là HVAC; thêm bảng cộng thêm và gán một lần là đủ, không phải sửa từng cơ hội.
- Ước lượng thô, không cam kết: S1 sau review 1–2 ngày; S2–S11 khoảng 2 tuần tuỳ số vòng review; S12 1–2 ngày.

## 12. Đối chiếu review gốc 14/11/2026 (`[REVIEW-R1]` tại `bb7887c`) → mục sửa → ca nghiệm thu
Review gốc: 0 BLOCKER, 5 MAJOR, 1 MINOR. Cột "Yêu cầu của reviewer" tóm tắt **từng ý** trong "Hướng sửa" và "Tiêu chí xác nhận" của phát hiện; một phát hiện chỉ coi là đã xử lý khi mọi ý có mục sửa và ca nghiệm thu. Trạng thái do Claude tự đánh giá, **chờ ChatGPT xác nhận**.

| Mã | Yêu cầu của reviewer | Mục sửa | Ca nghiệm thu |
|---|---|---|---|
| **SEC-01** | Tách `create` khỏi thao tác trên cơ hội có sẵn | 5.2 (bảng), 5.4 (vị từ Tạo vs Sửa) | 12 |
| SEC-01 | Vị từ theo từng mã quyền, phạm vi và người phụ trách | 5.4 (bảng vị từ) | 9, 12 |
| SEC-01 | T1 dùng quyền hiệu lực đã hợp nhất theo RBAC hiện có, không đếm `role_permission` thô | 5.4 (nguồn quyền; điều kiện người nhận 2), mục 2 T1 | 8, 9a(iv) |
| SEC-01 | Quyền đọc sau khi nhận | 5.4 (điều kiện 2 và 4) | 8, 9a(iv) |
| SEC-01 | Xử lý phạm vi DEPARTMENT | 5.4 (không cấp đợt này; định nghĩa nếu cấp sau) | 9 (không vai trò nào có) |
| SEC-01 | Nhiều vai trò | 5.4 (rộng nhất thắng; đường truy cập theo từng cơ hội) | 9a(i) |
| SEC-01 | Vai trò chưa xác nhận / đã thu hồi | 5.4 (tính lại mỗi request; `ownerLostAccess`) | 9a(ii), 9a(v), 9a(vi) |
| SEC-01 | Không suy `close`/`assign` từ `update` | 5.2 (mỗi mã cấp riêng), 5.4 (mã kiểm theo thao tác) | 9a(iii) |
| SEC-01 | Luật khi một người vừa sales vừa technician; projection trường rõ | 5.4 ("đường truy cập quyết định trường được trả"), 7 | 9a(i), 10 |
| SEC-01 | Không mở quyền khách/timeline theo cơ hội | 5.1, 5.5 (hệ quả) | 11, 9b(iii) |
| **SEC-02** | Định nghĩa giao diện giữa module Sales và Activities cho việc tự tạo và liên kết | 5.5(a)–(e) | 9b |
| SEC-02 | Chủ cơ hội không phụ trách khách vẫn Tạm hoãn/Thắng và tạo việc hợp lệ | 5.5(b), 5.5(e) | 9b(i), 9b(ii) |
| SEC-02 | Không nới API Activities chung; quyền đặc biệt chỉ cho tác vụ hệ thống có phạm vi xác định | 5.5 (nguyên tắc), 5.5(e) (chỉ hai `opportunity_auto_kind`) | 9b(i), 9b(vi) |
| SEC-02 | Kiểm riêng quyền với cơ hội, với hoạt động và với người nhận | 5.5(b) 1–3, 5.5(c) | 9b(iv), 9b(v) |
| SEC-02 | "Cùng khách" là chưa đủ khi nhận `opportunityId`; ID không có quyền bị từ chối | 5.5(c) | 9b(iv) |
| SEC-02 | Quyền theo việc hết khi đổi liên kết, đổi người, đóng/xoá việc, mất vai trò, hết hạn/thu hồi | 5.5(d) | 10 (mỗi điều kiện một ca) |
| SEC-02 | Không thấy timeline/việc khác | 5.5(a), 5.5 (hệ quả) | 9b(iii), 11 |
| **BIZ-01** | Bảng trạng thái nguồn → đích, mã quyền, trường đặt/xoá/giữ, lịch sử | 6.13 (bảng chuyển trạng thái) | 12a, 12d |
| BIZ-01 | Phân biệt resume (ON_HOLD) với reopen (WON/LOST) | 6.4, 6.7, 7 | 12a, 12d(vii) |
| BIZ-01 | WON → OPEN → WON: `closed_at`, xác suất, chứng từ cũ, việc bàn giao | 6.5, 6.7, bảng 6.13 | 12b, 12d(vi) |
| BIZ-01 | Đổi ngày hoãn: định danh việc nhắc cần cập nhật | 6.4 (đổi hạn), 6.13 (nhận diện) | 12d(i), 12d(ii) |
| BIZ-01 | Chuyển người phụ trách khi có việc nhắc | 6.4, 6.8, 6.13 | 12d(v) |
| BIZ-01 | ON_HOLD → WON/LOST | 6.4, bảng 6.13 | 12d(iii), 12d(iv) |
| BIZ-01 | Transaction, chống trùng khi retry, `version` cho mọi thao tác | 6.13 (nguyên tử, không trùng), 7 | 12b, 12d(viii), 13 |
| BIZ-01 | Không tự đóng việc thủ công chỉ vì cùng `opportunity_id` | 6.13 (nhận diện theo `opportunity_auto_kind`) | 12b |
| **DB-01** | Bảng invariant và vị trí kiểm (DB / service) | 4.1 (CHECK), R-S1..R-S3, 4.4 (đã triển khai S2) | 3, 12e |
| DB-01 | Mã danh mục bất biến, không dùng tên/thứ tự làm luật | 4.2 | 12e (đổi tên, đổi thứ tự) |
| DB-01 | Kiểm ở mọi đường ghi: create/PATCH/move/hold/resume/reopen | R-S1..R-S3 ("mọi đường ghi", trạng thái sau cập nhật), 6.4, 6.7 | 12e |
| DB-01 | Chặn PATCH xoá `need_summary` sau khi rời Tiếp cận | R-S2 | 12e |
| DB-01 | `hold_reason` bắt buộc khi ON_HOLD | 4.4 (`ck_opp_hold` trong migration S2 đã buộc cả `hold_until` và `hold_reason`) | 12d(i) |
| DB-01 | FK đúng nhóm danh mục; liên hệ / hoạt động cùng khách | 4.4 (`fn_assert_lookup`, khoá ngoại ghép, `activity.opportunity_id` cùng khách) | 12e |
| DB-01 | NOT NULL và chuỗi trắng cho trường có điều kiện; giá trị chốt không âm | 4.4 (`ck_opp_need`, `ck_opp_project`, `ck_opp_won_amount`) | 1a, 12e |
| **DB-02** | Phân biệt lùi ứng dụng với gỡ schema | 9 ("Đường lùi") | 16a(iii) |
| DB-02 | Rollback cấu trúc tiền kiểm và từ chối khi còn dữ liệu, kể cả xoá mềm | 9 ("Đường lùi"), 4.4 (rollback S2) | 16a(ii) |
| DB-02 | Thứ tự gỡ quyền / grants / cấu trúc; không khôi phục đè DB có dữ liệu mới | 9 ("Đường lùi") | 16a |
| DB-02 | Diễn tập cho schema rỗng và schema có dữ liệu; nâng lại + grants + VERIFY | 9 (S2, S8, S9) | 16a(i), 16a(ii), 15 |
| **BIZ-02** (MINOR) | Bỏ chỉ dẫn nhập vào "loại gần nhất" | 11 (dòng 3 loại cơ hội), 1.3 O2 | Rà tài liệu: không còn chỉ dẫn ép loại |
| Ghi chú cuối review | "Không rò giá trị" phải kiểm cả `/changes`, tổng kanban, tìm kiếm/đếm, dữ liệu TASK tự tạo | 5.4, 7 | 10 |

### 12.1 Đối chiếu `[REVIEW-R3-RESULT]` 17/11/2026 (tại `c87b08f`) → mục sửa → ca nghiệm thu
Kết luận R3: 0 BLOCKER, 2 MAJOR, 1 MINOR. Owner duyệt thêm một vòng kiểm (`OWNER_APPROVED_EXTRA_ROUND`, 17/11/2026). Trạng thái do Claude tự đánh giá, **chờ ChatGPT kiểm đóng lỗi**.

| Mã | Yêu cầu của reviewer | Mục sửa | Ca nghiệm thu |
|---|---|---|---|
| **R3-SEC-01** (MAJOR) | Người chỉ có đường theo việc: từng dòng phải thoả quyền B3 còn hiệu lực trên chính dòng đó, cùng điều kiện xoá mềm; quyền từ A không dùng để đọc B | 5.5(a) | 10a(i)–(v) |
| R3-SEC-01 | Cùng bộ lọc cho đếm, phân trang, tìm kiếm, chi tiết | 5.5(a) (lọc trong điều kiện truy vấn; chi tiết chỉ qua B3) | 10a (tổng số, tìm kiếm, `GET /activities/B`) |
| R3-SEC-01 | Không mở timeline khách | 5.5(a), 5.5 (hệ quả) | 10a(viii), 9b(iii) |
| R3-SEC-01 | Không yêu cầu mất quyền O khi còn A hợp lệ; thử riêng từng nguyên nhân | 5.5(a), 5.5(d) | 10a (mỗi nguyên nhân một ca; đối chứng (vi), (vii)) |
| **R3-SEC-02** (MAJOR) | Tách đường nạp/kiểm quyền cho khôi phục; chỉ `restore` ALL tìm được cơ hội đã xoá | 5.4 (bảng vị từ; "Khôi phục cơ hội đã xoá mềm") | 9c(i), 9c(ii) |
| R3-SEC-02 | Không bỏ bộ lọc xoá mềm của đường đọc/ghi bình thường | 5.4 (câu đầu bảng vị từ; gạch đầu dòng 1–2) | 9c(iii) |
| R3-SEC-02 | Quy tắc khi khách còn bị xoá mềm | 5.4 (409, khôi phục khách trước), 6.9 | 9c(iv) |
| R3-SEC-02 | `version`, audit, trạng thái sau khôi phục | 5.4 (điều kiện; trạng thái sau khôi phục; dấu vết), 7 | 9c(i), 9c(v), 9c(vi) |
| **R3-DESIGN-01** (MINOR) | Chỉ ra nguồn kiểm trạng thái tài khoản người nhận; không cấp SELECT credential cho `siscom_app`; không trả dữ liệu credential | 5.4 ("Nguồn kiểm trạng thái tài khoản của người nhận"), 9 (S5) | 9a(vii) |
| R3-DESIGN-01 | Cờ `ownerLostAccess` cùng nguồn | 5.4 (cùng mục) | 9a(vii), 9a(v) |
| R3-DESIGN-01 | Ca nhân viên ACTIVE nhưng credential bị khoá | — | 9a(vii) |
| Nhận xét lựa chọn kỹ thuật | Vị từ `HOLD_REMINDER` phải ghi là ngoại lệ cụ thể của "API Activities chung không đổi"; giữ guard xoá mềm; chỉ hoàn thành đúng việc; không sửa/giao lại/đọc khách | 5.5 (nguyên tắc), 5.5(e) | 9b(vii) |
| Nhận xét lựa chọn kỹ thuật | Phạm vi cơ hội cho `activity.*` không tái dùng ở API chung; vẫn kiểm người nhận và quyền cấp access | 5.5(b) (đoạn cuối) | 9b(viii), 9b(v) |

Ba điểm trong bản sửa này là **lựa chọn kỹ thuật mới của Claude**, cần reviewer soi: (1) người thiếu `restore` nhận **404** thay vì 403, để không lộ cơ hội đã xoá; (2) xoá mềm và khôi phục **không** đụng công việc; (3) với R3-DESIGN-01 chọn phương án **cổng auth trả một cờ** cho người phụ trách cơ hội, đồng thời **giữ hợp đồng B3** cho người làm công việc.

**Giới hạn của bảng này:** toàn bộ là đặc tả; chưa có mã S5–S11 nên mọi ca nghiệm thu ở trạng thái **NOT_VERIFIED** về hành vi. Phần DB-01 dẫn tới migration S2 **đã merge** (`d45c985`) nên kiểm được trên mã. Các mục 5.4 và 5.5 là **đề xuất kỹ thuật** của Claude để thực hiện quyết định nghiệp vụ đã chốt (C4, C5, C6, C7, O3), không phải quyết định mới của Owner.
