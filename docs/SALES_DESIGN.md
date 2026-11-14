# Sales — Cơ hội kinh doanh: đặc tả v2 (PR S1, 13/11/2026)

| Mục | Giá trị |
|---|---|
| Trạng thái | **Tài liệu. Chưa có mã, chưa đụng database hay VPS.** Chờ ChatGPT review độc lập và Owner duyệt trước khi viết mã |
| Nguồn quyết định | 8 câu trả lời của Owner (13/11/2026 16:50) + 16 điểm chốt (13/11/2026 17:03, Issue #233) + điều chỉnh 14/11/2026 về lĩnh vực, loại và "chào dự án" (mục 1.3, lời Owner do phiên khác chuyển lại) |
| Nền mã | `main` `0a87d23` |
| Thay thế | bản nháp `SALES_THIET_KE_MO_DAU` và `SALES_DAC_TA_V1` (thư mục bàn giao của Claude, không nằm trong repo) |
| Quy ước | **[Owner]** = Owner đã quyết. **[Đề xuất]** = Claude đề xuất, chưa được duyệt. **[Mở]** = còn chờ Owner (mục 2) |

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

### 1.3 Điều chỉnh của Owner (14/11/2026, nguồn: lời Owner được phiên Claude khác chuyển lại; **chưa xác nhận trực tiếp ở phiên viết đặc tả này**) [Owner]
| Mã | Quyết định | Hệ quả trong đặc tả |
|---|---|---|
| O1 (đã đóng) | SISCOM hiện chỉ bán thiết bị, vật tư HVAC và chào dự án HVAC. **Không** đưa Điện, Cấp thoát nước, PCCC, Phòng sạch vào danh mục riêng. Đợt đầu **mặc định lĩnh vực là HVAC, không bắt nhân viên chọn** | Đợt này **không tạo bảng/danh mục lĩnh vực**, không có ô chọn lĩnh vực. Mọi cơ hội hiểu là HVAC. Khi SISCOM có lĩnh vực thứ hai sẽ thêm bảng mới theo cách cộng thêm và gán HVAC cho dữ liệu cũ (không cần sửa dữ liệu từng dòng). Dashboard chưa có bộ lọc lĩnh vực |
| O2 (đã đóng) | Giữ **3 loại**: Cung cấp thiết bị, vật tư · Thi công · Cung cấp và thi công. Chưa mở rộng thành 6 loại | Bảo trì, sửa chữa/cải tạo, tư vấn/thiết kế chưa có loại riêng; loại là danh mục nên thêm sau không cần sửa mã |
| C17 (mới) | **"Chào dự án"** là cơ hội gắn với một dự án/công trình; có thể chỉ cung cấp hàng hoặc kèm thi công. **Không mặc định** cứ chào dự án là thi công. Phải ghi **tên dự án/công trình** và **phạm vi SISCOM đang chào** | Cột `project_name` và `offer_scope` (mục 4.1). **Loại cơ hội do nhân viên chọn theo phạm vi chào, không suy ra từ việc có tên dự án** |

## 2. Việc còn mở
| Mã | Vấn đề | Chặn |
|---|---|---|
| **O3** | Điều kiện "cùng phòng" khi chuyển người phụ trách (C6): em đề xuất người nhận phải **ACTIVE**, **cùng phòng với người phụ trách hiện tại** và **có quyền sửa cơ hội**. Chờ Owner/ChatGPT xác nhận | S5 (quyền) |
| **O4** | **Tên dự án và phạm vi chào có bắt buộc không?** Em đề xuất: **bắt buộc** `project_name` và `offer_scope` khi loại là "Thi công" hoặc "Cung cấp và thi công"; **tuỳ chọn** khi loại là "Cung cấp thiết bị, vật tư" (khách mua lẻ có thể không gắn dự án), nhưng nên ghi khi bán cho một dự án. Chờ Owner xác nhận | S2 (CHECK ở DB), S7 (kiểm khi tạo) |
| **O5** | Loại "Cung cấp thiết bị, vật tư" (không dự án) và việc bán lẻ: Owner xác nhận có cần quản lý như cơ hội trong Sales không, hay chỉ các thương vụ có hồ sơ chào | Không chặn |

## 3. Phạm vi
**Làm trong đợt Sales:** cơ hội (tạo, sửa, giai đoạn, Tạm hoãn, Thắng, Thua, mở lại, chuyển người phụ trách), lịch sử thay đổi, loại + tên dự án/công trình + phạm vi chào (lĩnh vực mặc định HVAC, chưa có ô chọn), danh sách bảng + kanban, thẻ/tab cơ hội trong chi tiết khách, gắn công việc/hoạt động vào cơ hội, quyền theo người phụ trách và theo việc được giao (kiểm ở API + giao diện), điện thoại.
**Gói Báo giá đợt 1 (ngay sau Sales, thiết kế riêng):** sổ báo giá theo cơ hội, phiên bản, trạng thái (Nháp / Đã gửi / Được chấp nhận / Bị từ chối / Hết hiệu lực), đường dẫn Drive, tạo bản mới từ bản cũ, không sửa bản đã gửi; giá trị cơ hội theo báo giá đang theo đuổi.
**Để sau:** lập báo giá từ danh mục thiết bị/vật tư, chiết khấu, VAT, duyệt giá, xuất PDF; giá vốn và lợi nhuận; Dashboard; xuất dữ liệu cơ hội; Hợp đồng; Dự án; Kho; kho tệp trong CRM; email/thông báo đẩy.

## 4. Mô hình dữ liệu [Đề xuất] — chỉ cộng thêm, không đổi/xoá cột cũ
### 4.1 Bảng
```
opportunity
  id, code CH-0001 (hàm fn_next_opportunity_code, cùng cách với khách hàng)
  customer_id → customer (bắt buộc)      contact_id → contact (tuỳ chọn, cùng khách)
  title (≤200, bắt buộc)                 need_summary text (bắt buộc trước khi rời Tiếp cận)
  type_id → lookup_item 'opportunity_type' (bắt buộc; do nhân viên chọn theo phạm vi chào, không suy ra từ tên dự án)
  project_name varchar(200) NULL         (tên dự án/công trình đang chào) [C17]
  offer_scope text NULL                  (phạm vi SISCOM đang chào: cung cấp gì, có thi công không) [C17]
                                         (cả hai bắt buộc khi loại là Thi công / Cung cấp và thi công; tuỳ chọn khi chỉ cung cấp thiết bị, vật tư — [Mở O4])
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
CHECK ở mức DB: nhất quán `status` với trường bắt buộc (ON_HOLD cần `hold_until`; WON cần đủ trường chứng từ và `won_amount_vnd`; LOST cần `lost_reason_id`); `expected_amount_vnd` không âm; khi loại là Thi công hoặc Cung cấp và thi công thì `project_name` và `offer_scope` không rỗng ([Mở O4]); khi `stage` từ Báo giá trở lên mà `status = OPEN` thì `expected_amount_vnd IS NOT NULL`; `probability` trong 0..100.
`customer.revenue_vnd` (số ước tính cũ) **không** tự cập nhật từ cơ hội: tránh hai nguồn doanh thu. Đợt này chưa có cột giá vốn, lợi nhuận, chiết khấu. `opportunity_change.reason` ≤ 500 ký tự và được che trong audit chung như các lý do khác.
Bảng `quote` (gói Báo giá) sẽ trỏ **tới** `opportunity`; `opportunity` không trỏ ngược.

### 4.2 Danh mục (`lookup_item`, nạp bằng lệnh seed; sửa tên/thứ tự không cần sửa mã; mục đã dùng chỉ **ẩn**, không xoá)
- `opportunity_stage` (kèm xác suất mặc định): Tiếp cận 10, Khảo sát 25, Báo giá 45, Đàm phán 70; hai trạng thái cuối không nằm ở danh mục giai đoạn mà ở `status`.
- `opportunity_type`: Cung cấp thiết bị, vật tư · Thi công · Cung cấp và thi công. [C1]
- Không có danh mục lĩnh vực trong đợt này (mục 1.3).
### 4.3 Lý do thua (`opportunity_lost_reason`) [C2]
Giá cao hơn đối thủ · Khách chọn đối thủ khác · Khách không phản hồi · Khách hủy dự án/nhu cầu · Khách không đủ ngân sách · Không đáp ứng tiến độ giao hàng/thi công · Không thống nhất điều kiện thanh toán/hợp đồng · SISCOM chủ động không tiếp tục theo đuổi · Khác (kèm ghi chú).

## 5. Quyền
### 5.1 Ai thấy cơ hội nào (kiểm ở máy chủ, mọi API; ngoài phạm vi trả 404 như khách hàng)
| Vai trò | Thấy | Sửa |
|---|---|---|
| Quản trị CRM | tất cả | tất cả |
| Kinh doanh | (1) cơ hội mình phụ trách; (2) mọi cơ hội của khách mình phụ trách, chỉ đọc nếu không phụ trách [C4] | chỉ cơ hội mình phụ trách |
| Kỹ thuật | chỉ cơ hội gắn với **công việc đang mở được giao cho mình** (có hiệu lực theo cơ chế quyền theo việc của B3 §5.4) | không sửa cơ hội; cập nhật kết quả qua công việc |
| Kế toán | tất cả | không |
| Quản trị hệ thống | không | không |
- Kỹ thuật thấy: tiêu đề, nhu cầu, loại, tên dự án/công trình, phạm vi chào, giai đoạn, ngày dự kiến, đường dẫn bản vẽ/thông số; **không** thấy giá trị, lịch sử giá trị, lý do thua. [C7]
- Người phụ trách cơ hội mà không phụ trách khách: thấy cơ hội đó + thẻ khách tối thiểu + người liên hệ của cơ hội; **không** thấy cơ hội khác của khách, timeline khách, ghi chú khách. [C5]
- Cùng một hàm kiểm quyền cho danh sách, chi tiết, đếm (badge), tìm kiếm, xuất dữ liệu và báo cáo; không có đường đọc nào bỏ qua.
### 5.2 Mã quyền mới [Đề xuất]
`opportunity.read`, `.create`, `.update`, `.move_stage`, `.close` (Thắng/Thua/Tạm hoãn), `.assign` (chuyển người phụ trách), `.reopen`, `.delete`, `.restore`. `opportunity.export` **không cấp cho ai** trong đợt này.
| Mã | Quản trị CRM | Kinh doanh | Kỹ thuật | Kế toán |
|---|---|---|---|---|
| read | ALL | theo 5.1 | theo việc | ALL |
| create / update / move_stage / close | ALL | khách mình + cơ hội mình phụ trách | — | — |
| assign | ALL | cơ hội mình phụ trách → người cùng phòng [C6][O3] | — | — |
| reopen / delete / restore | ALL | — | — | — |
Phạm vi mới cần thêm vào cơ chế hiện có (hiện chỉ tính theo khách): "theo người phụ trách cơ hội" và "theo việc được giao". Đây là phần rủi ro nhất; làm thành PR riêng có ma trận kiểm thử (mục 10).
### 5.3 Cấp quyền trên DB đã bootstrap
Qua yêu cầu hai người (mẫu `B3_ACTIVITY_PERMISSIONS`, có script gỡ) và grants V5 cho `siscom_app` (INSERT/UPDATE `opportunity`; `opportunity_change` chỉ INSERT; không DELETE). Diễn tập trên PostgreSQL tạm trong CI trước. Ma trận trong `bootstrap.ts` chỉ áp cho DB mới tinh; unit test giữ hai nguồn khớp nhau như B3.

## 6. Quy tắc nghiệp vụ
1. **Tạo**: bắt buộc khách, tiêu đề, loại; bắt buộc thêm tên dự án/công trình và phạm vi chào khi loại là Thi công hoặc Cung cấp và thi công ([Mở O4]); người phụ trách mặc định = người phụ trách khách tại lúc tạo; trạng thái Đang mở, giai đoạn Tiếp cận.
2. **Đổi giai đoạn** [C14]: tới hoặc lùi tự do giữa Tiếp cận, Khảo sát, Báo giá, Đàm phán; mỗi lần ghi lịch sử. Rời Tiếp cận cần `need_summary`. Từ Báo giá trở lên cần `expected_amount_vnd`. Xác suất về mặc định của giai đoạn mới, trừ khi đã sửa tay (khi đó hỏi giữ hay đặt lại).
3. **Sửa xác suất tay, giá trị, ngày dự kiến chốt**: ghi lịch sử; xác suất sửa tay bắt buộc lý do.
4. **Tạm hoãn** [C3][C13]: bắt buộc ngày liên hệ lại + lý do; giữ nguyên giai đoạn; rời kanban, vào danh sách Tạm hoãn; **tự tạo một công việc** (TASK) nhắc người phụ trách vào ngày đó; mở lại về đúng giai đoạn cũ, công việc nhắc còn mở tự đóng.
5. **Thắng** [C8][C12]: bắt buộc loại chứng từ, số, ngày, giá trị chốt, đường dẫn Drive (hệ thống không tự xác minh; đây là khai báo của người dùng); sau khi Thắng **tự tạo công việc "Bàn giao thực hiện"**, người chốt chọn người nhận theo đúng quy tắc giao việc B3 hiện có (không mở rộng phạm vi xem khách).
6. **Thua**: bắt buộc lý do; giá trị được để trống nếu chưa tới Báo giá.
7. **Mở lại** cơ hội đã Thắng/Thua [C16]: chỉ Quản trị CRM, bắt buộc lý do, ghi lịch sử. Cơ hội đã đóng khoá sửa.
8. **Chuyển người phụ trách** [C6][O3]: bắt buộc lý do; ghi người chuyển, thời điểm; người nhận ACTIVE, cùng phòng với người phụ trách hiện tại, có quyền sửa cơ hội (Quản trị CRM không bị ràng buộc cùng phòng). Không đổi người phụ trách khách. Công việc đang mở của cơ hội giữ nguyên người làm. Người nhận không tự thấy thêm dữ liệu khách ngoài thẻ tối thiểu.
9. **Khách bị xoá mềm** ⇒ cơ hội ẩn theo; không ai xoá vĩnh viễn qua ứng dụng. Xoá mềm cơ hội chỉ Quản trị CRM, có lý do.
10. **Sửa đồng thời**: `version` như khách hàng; người sau nhận báo xung đột.
11. **Ngày, hạn** tính theo giờ Việt Nam (Asia/Ho_Chi_Minh).
12. **Audit**: mọi tạo, đổi giai đoạn, trạng thái, người phụ trách, giá trị, xác suất, ngày chốt, mở lại, xoá mềm; nội dung ghi chú và lý do được che trong audit chung.

## 7. API [Đề xuất] (`/api/v1`, cookie + Origin + CSRF như hiện nay, bọc `{ data }`)
`GET /opportunities` (lọc giai đoạn, trạng thái, người phụ trách, loại, khách, hạn chốt, tìm theo tiêu đề/tên dự án; phân trang) · `GET /opportunities/:id` · `POST /opportunities` · `PATCH /opportunities/:id` (có `version`) · `POST /opportunities/:id/stage` · `POST /opportunities/:id/hold` · `POST /opportunities/:id/win` · `POST /opportunities/:id/lose` · `POST /opportunities/:id/reopen` · `POST /opportunities/:id/assign` · `GET /opportunities/:id/changes` · `GET /customers/:id/opportunities` · xoá mềm/khôi phục như khách. Hoạt động: thêm `opportunityId` tuỳ chọn khi tạo (cùng khách). Phản hồi dùng một bộ ánh xạ riêng theo vai trò để không rò trường bị ẩn (giá trị với Kỹ thuật).

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
Phụ trách: Trần Bình [Chuyển…]                [Tạm hoãn] [Thắng] [Thua]
Nhu cầu của khách: …
Tab: Hoạt động & công việc | Báo giá (gói sau) | Lịch sử thay đổi | Tài liệu (link Drive)
```
**8.3 Hộp thoại**: Tạo cơ hội · Chuyển giai đoạn (đòi giá trị nếu thiếu) · Tạm hoãn (ngày liên hệ lại, lý do) · Thắng (loại chứng từ, số, ngày, giá trị chốt, link; chọn người nhận "Bàn giao thực hiện") · Thua (lý do, ghi chú) · Chuyển người phụ trách (người mới, lý do) · Mở lại (lý do).
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
| S5 | Mã quyền `opportunity.*` + phạm vi theo người phụ trách/theo việc + script cấp quyền hai người + script gỡ | chỉ CI |
| S6 | Backend đọc: danh sách, chi tiết, theo khách; ma trận quyền | không |
| S7 | Backend ghi: tạo, sửa, đổi giai đoạn, lịch sử | không |
| S8 | Backend: Tạm hoãn, Thắng, Thua, mở lại, chuyển người phụ trách, công việc tự tạo | không |
| S9 | Gắn hoạt động/công việc vào cơ hội + quyền xem của Kỹ thuật theo việc | không |
| S10 | Giao diện: danh sách bảng, chi tiết, hộp thoại (kèm sửa Issue #218) | không |
| S11 | Giao diện: kanban, tab Cơ hội trong chi tiết khách, điện thoại | không |
| S12 | Cập nhật staging: sao lưu → `deploy.sh --migrate` → grants V5 → cấp quyền hai người → seed danh mục → nghiệm thu mục 10 | **staging; Owner duyệt riêng từng bước** |
Không PR nào đụng DB thật. Phần làm **ngay**: S1–S12. Phần để **sau**: mục 3 "Để sau" và gói Báo giá đợt 1.

## 10. Tiêu chí nghiệm thu
1. Tạo cơ hội cho khách có sẵn; một khách có 2 cơ hội cùng mở; dữ liệu khách không đổi (so số khách và người phụ trách trước/sau). Loại "Thi công" hoặc "Cung cấp và thi công" thiếu tên dự án hoặc phạm vi chào ⇒ bị chặn ([Mở O4]); một dự án chỉ cung cấp hàng tạo được với loại "Cung cấp thiết bị, vật tư" mà không bị ép thành thi công. Không có ô chọn lĩnh vực trên màn hình.
2. Đi đủ Tiếp cận → Đàm phán, có bỏ qua Khảo sát và có lùi giai đoạn; mỗi bước có dòng lịch sử đúng người, đúng giờ Việt Nam.
3. Rời Tiếp cận khi thiếu nhu cầu ⇒ bị chặn. Sang Báo giá khi chưa có giá trị ⇒ bị chặn, báo rõ.
4. Sửa xác suất không lý do ⇒ bị chặn; có lý do ⇒ có lịch sử.
5. Thắng thiếu chứng từ hoặc giá trị chốt ⇒ bị chặn; Thắng đủ ⇒ tự tạo công việc "Bàn giao thực hiện". Thua thiếu lý do ⇒ bị chặn.
6. Tạm hoãn: không tính vào Thua và tỷ lệ thắng; có ngày liên hệ lại; tự tạo công việc nhắc; mở lại về đúng giai đoạn cũ và đóng công việc nhắc.
7. Giá trị trống hiển thị "Chưa rõ", không hiển thị 0 và không cộng vào tổng.
8. Chuyển người phụ trách: người phụ trách khách không đổi; có lịch sử + lý do; người nhận khác phòng hoặc không ACTIVE ⇒ bị chặn (trừ Quản trị CRM).
9. **Ma trận quyền** 5 vai trò × (xem danh sách, xem chi tiết, tạo, sửa, đổi giai đoạn, chốt, chuyển người, mở lại, xoá): kiểm bằng **gọi API trực tiếp**, không chỉ giao diện; ngoài phạm vi trả 404; kiểm cả đếm, tìm kiếm, xuất.
10. Kỹ thuật: chỉ thấy cơ hội của việc được giao; không thấy giá trị trong phản hồi API; việc đóng ⇒ mất quyền xem.
11. Người phụ trách cơ hội không phụ trách khách: chỉ thấy thẻ khách tối thiểu; không mở được cơ hội khác hay timeline của khách.
12. Người phụ trách khách thấy mọi cơ hội của khách mình, không sửa được cơ hội không phụ trách.
13. Hai người sửa cùng lúc ⇒ người sau nhận báo xung đột, không mất dữ liệu.
14. Điện thoại thật (iPhone) và máy tính: tạo, chuyển giai đoạn, chốt.
15. Hồi quy: toàn bộ kiểm thử Khách hàng, Hoạt động/Công việc, Xuất CSV hiện có vẫn đạt; `VERIFY` quyền DB đạt với V5.
16. Staging: sao lưu trước; số khách hàng trước và sau migration bằng nhau; đường lùi đã diễn tập trên CI.

## 11. Rủi ro
- **Phạm vi quyền mới** (theo người phụ trách cơ hội, theo việc) khác cách tính hiện tại theo khách: dễ rò dữ liệu. Giảm: PR riêng (S5), ma trận kiểm thử qua API, 404 ngoài phạm vi, ChatGPT review tập trung phần này.
- **Đụng bảng `activity` đã nghiệm thu** (thêm cột): chỉ cộng thêm, NULL, rollback viết sẵn, chạy lại toàn bộ kiểm thử B3.
- **Migration trên staging có dữ liệu**: lần đầu dùng `--migrate` trên DB không trống; sao lưu và khôi phục thử trước.
- **Đường dẫn Google Drive**: CRM không kiểm được ai mở được tệp; người có link có thể xem ngoài quyền CRM. Chứng từ Thắng là khai báo, không được xác minh.
- **Danh mục đổi sau khi có dữ liệu**: chỉ ẩn, không xoá; gộp giai đoạn cần quy trình riêng.
- **Hai nguồn doanh thu** (`customer.revenue_vnd` ước tính và cơ hội Thắng): giữ tách biệt đến khi có hợp đồng.
- **3 loại cơ hội** chưa phủ bảo trì, sửa chữa/cải tạo, tư vấn/thiết kế (Owner giữ 3 loại, mục 1.3): các thương vụ đó sẽ phải nhập vào loại gần nhất cho tới khi thêm loại.
- **Loại không suy ra từ tên dự án** (C17): nhân viên có thể chọn "Thi công" cho một dự án chỉ cung cấp hàng hoặc ngược lại; `offer_scope` là chỗ ghi phạm vi thật, cần xem lại cách trình bày để loại và phạm vi không mâu thuẫn nhau trên màn hình.
- **Lĩnh vực mặc định HVAC, chưa lưu**: nếu sau này SISCOM thêm lĩnh vực thứ hai, dữ liệu cũ phải được hiểu là HVAC; thêm bảng cộng thêm và gán một lần là đủ, không phải sửa từng cơ hội.
- Ước lượng thô, không cam kết: S1 sau review 1–2 ngày; S2–S11 khoảng 2 tuần tuỳ số vòng review; S12 1–2 ngày.
