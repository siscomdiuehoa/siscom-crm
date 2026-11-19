# Kế hoạch đưa SISCOM CRM vào sử dụng thật (production)

- **Ngày lập:** 19/11/2026 · **Người lập:** Claude, theo yêu cầu của Owner ("Soạn kế hoạch", sau khi S12 đạt nghiệm thu theo quyết định của Owner).
- **Trạng thái:** KẾ HOẠCH, **chưa thực hiện bước nào**. Mỗi bước ở mục 5 cần Owner duyệt riêng bằng văn bản. Không bước nào được cấp phép bởi tài liệu này.
- **Mã nguồn:** `main` = `2de465c` (CI 6/6), đang chạy trên staging từ 19/11/2026 16:37 (giờ Việt Nam).
- **Tài liệu nền:** `docs/VPS_RUNBOOK.md` (G6 sao lưu, G7 production, mục 9 giới hạn đã biết) — tài liệu này cụ thể hoá G7 cho lần đưa vào dùng thật đầu tiên; `docs/SALES_S12_STAGING_PLAN.md` (mục 10.7 — quyết định nghiệm thu và danh sách tiêu chí miễn kiểm); `docs/FV5_ACCOUNT_ADMIN.md`.
- Tài liệu không chứa mật khẩu, khoá hay dữ liệu khách hàng.

## 1. Tóm tắt

Đưa vào dùng thật **được** trong vài ngày, nhưng có **một việc chặn**: hệ thống hiện chỉ tạo được **tối đa 5 tài khoản** (mỗi vai trò một người, lúc khởi tạo). Muốn mỗi nhân viên có tài khoản riêng thì phải làm thêm chức năng quản lý tài khoản (mục 3, P1). Có hai cách đi:

| | Cách A — mở sớm, 5 tài khoản | Cách B — mở đủ cho mọi nhân viên |
|---|---|---|
| Khi nào dùng được | Khoảng 1–2 ngày sau khi Owner trả lời mục 2 | Thêm khoảng 3–5 ngày làm, review, thử |
| Tài khoản | 5 người thật: 1 quản trị kỹ thuật, 1 Quản trị CRM (người duyệt), 1 Kinh doanh, 1 Kỹ thuật, 1 Kế toán | Mọi nhân viên, mỗi người một tài khoản |
| Đánh đổi | Nhân viên khác **không** có tài khoản; không được dùng chung tài khoản | Chậm hơn |
| Đề xuất | Dùng nếu cần chạy ngay với nhóm nhỏ, rồi làm P1 song song | Dùng nếu cả phòng kinh doanh cần dùng ngay |

**Không** đề xuất dùng chung một tài khoản cho nhiều người: mất dấu vết ai làm gì, và phân quyền theo người phụ trách không còn ý nghĩa.

## 2. Việc Owner cần quyết trước khi bắt đầu

| Mã | Câu hỏi | Đề xuất của Claude |
|---|---|---|
| D1 | Cách A hay cách B (mục 1)? | Cách A nếu nhóm dùng đầu tiên ≤ 5 người; nếu không thì cách B |
| D2 | Chạy ở đâu? (a) chính VPS hiện tại, **chuyển** dịch vụ sang database thật `siscom_crm_prod` — staging tạm ngừng; (b) cùng VPS, chạy hai bản song song; (c) thuê VPS thứ hai | **(a)**: script đã hỗ trợ sẵn (G7), VPS còn trống 32 GB đĩa, 2,4 GB RAM. Staging giữ database để so sánh; khi cần thử bản mới thì làm trên database thử cục bộ như hôm nay. (b) cần sửa script, (c) tốn thêm chi phí |
| D3 | Địa chỉ truy cập: `https://crm.siscom.io.vn` hay tiếp tục dùng IP? | **Tên miền.** Chứng chỉ theo IP chỉ có hạn 6 ngày, tự gia hạn nhưng chưa có cảnh báo khi hỏng. Việc cần làm: thêm **một** bản ghi A `crm` → `42.96.15.235` ở DNS **AZDIGI** (nơi đang trả lời cho `siscom.io.vn`; không đổi nameserver, không đụng website / mail). Hiện tên này chưa tồn tại (kiểm 19/11) |
| D4 | Danh sách người dùng đầu tiên: họ tên, email, phòng ban, vai trò. Ai là **Quản trị CRM** (người duyệt, thấy toàn bộ khách)? Ai là **quản trị kỹ thuật** (người yêu cầu thay đổi quyền)? | Hai người này phải **khác nhau** và nên có **hai** người duyệt — bài học 19/11: staging chỉ có một người duyệt nên không tự đặt lại mật khẩu cho chính người đó được |
| D5 | Dữ liệu ban đầu: bắt đầu trống, hay nhập khách hàng có sẵn (Excel…)? | Nếu cần nhập: Owner gửi mẫu cột (không gửi dữ liệu thật qua chat); Claude kiểm hệ thống đã có chức năng nhập chưa rồi báo — **chưa kiểm** |
| D6 | Bản sao lưu ngoài VPS đặt ở đâu? | Google Drive của Owner (PR #235 — kéo tự động, đang Draft) hoặc chép tay hằng tuần như hôm nay |
| D7 | Ngày mở cho người dùng và cách báo lỗi khi dùng | Một nhóm Zalo / một luồng chat cố định; Claude sửa qua PR như #253, #254 |

### 2.1 Câu trả lời của Owner (phiếu go-live, lưu 19/11/2026 17:08 giờ Việt Nam)

| Mã | Owner chọn | Hệ quả |
|---|---|---|
| D1 | **Cách A** — mở sớm, tối đa 5 tài khoản | P1 (quản lý tài khoản) **không** chặn ngày mở; làm sau khi Owner cần thêm người |
| D2 | **(a)** máy chủ hiện tại, chuyển sang `siscom_crm_prod` | Staging ngừng phục vụ từ bước 2, database staging giữ nguyên |
| D3 | **Tên miền** `crm.siscom.io.vn` | Chờ Owner thêm bản ghi A ở AZDIGI (chưa thêm lúc trả lời) |
| D4 | **Chưa điền** | Cần 5 người: họ tên, email, phòng, vai trò |
| D5 | **Nhập khách hàng có sẵn** | Hệ thống **chưa có** chức năng nhập (chỉ có xuất CSV) — kiểm mã 19/11. Cần một công cụ nhập (PR riêng) hoặc nhập tay; cần Owner cho biết dữ liệu ở đâu, bao nhiêu khách, những cột nào |
| D6 | **Google Drive tự động** | Dùng PR #235 (Draft, +1065 dòng): cần review và Owner duyệt |
| D7 | **Chưa điền** ngày mở và kênh báo lỗi | — |
| P3 | Cho làm | Xem ghi chú dưới |
| P4 | Đã đặt mật khẩu cho `VPS.ppk`; chưa chuyển khoá sao lưu khỏi Dropbox; chưa đánh dấu cam kết không dùng lại mật khẩu từ chat | — |

Ghi chú của Owner, nguyên văn: "em làm cái tối ưu thêm thì làm, đừng bảo mật quá".

**P3 — đề xuất KHÔNG làm** (sau khi kiểm chỉ đọc 19/11): cloud-init của BKNS đặt lại mật khẩu root từ đĩa seed `cidata` mỗi lần khởi động, đúng mật khẩu Owner thấy trong bảng điều khiển BKNS. SSH đã chặn đăng nhập bằng mật khẩu, nên mật khẩu đó chỉ dùng được ở **console web của BKNS** — đây lại là đường cứu hộ khi mất khoá SSH. Tắt cloud-init còn có thể ảnh hưởng cấu hình mạng (`/etc/netplan/50-cloud-init.yaml` do cloud-init sinh). Rủi ro của việc giữ nguyên thấp hơn rủi ro của việc sửa; phù hợp ghi chú "đừng bảo mật quá".

## 3. Việc kỹ thuật phải xong trước (mỗi việc một PR hoặc một bước có duyệt)

| Mã | Việc | Vì sao | Ước lượng |
|---|---|---|---|
| **P1** | **Quản lý tài khoản dùng được trên máy chủ thật** — chỉ cho cách B | Công cụ `account-admin` hiện **khoá cứng** vào PostgreSQL thử (FV5-DB-GUARD). Owner đã quyết 10/11/2026: phê duyệt hai người **chỉ bằng khai báo** (người chạy lệnh gõ mã hai người) **không được dùng thật**. Cần cơ chế hai người thật: người yêu cầu và người duyệt mỗi người **tự đăng nhập** và bấm trên giao diện (màn hình "Quản lý tài khoản" trong CRM). Hai kịch bản đặt lại mật khẩu dùng trên staging ngày 19/11 là loại "khai báo" ⇒ **không dùng cho database thật** | 3–5 ngày, gồm review |
| P2 | **Mật khẩu** | Mỗi người có mật khẩu riêng ≥ 12 ký tự lúc khởi tạo (Owner gõ trên máy chủ). **Không** dùng mật khẩu chung, **không** dùng lại bất kỳ mật khẩu nào từng xuất hiện trong chat hay ảnh chụp (kể cả mật khẩu thử staging) | Trong bước 5 |
| P3 | **Chặn cloud-init đặt lại mật khẩu root mỗi lần khởi động** (runbook mục 9.10) | Đăng nhập root bằng mật khẩu đã tắt nên rủi ro thấp, nhưng nên chặn hẳn trước khi chứa dữ liệu thật | 1 bước nhỏ, có duyệt |
| P4 | **Vị trí khoá** | Khoá đăng nhập VPS (`VPS.ppk`) và hai khoá giải mã sao lưu đang có bản trong **Dropbox**. Đề xuất: đặt mật khẩu bảo vệ cho `VPS.ppk` (PuTTYgen), giữ khoá giải mã sao lưu ở ổ rời / nơi không đồng bộ | Owner tự làm |
| P5 | **Sao lưu dữ liệu thật** | Timer sao lưu đêm sẽ tự sang database thật khi đổi cấu hình; phải **khôi phục thử** bản đầu tiên của database thật (Phụ lục A của S12) và chép ra ngoài VPS (D6) | Trong bước 7 |
| P6 | Mã đóng gói | Dùng `--src` từ `git archive <SHA đã duyệt>` như 19/11; hoặc Owner duyệt tạo tag `v0.1.0` trên `main` để dùng `--tag` (runbook mục 9.8) | — |

Ma trận quyền Sales (10 mã `opportunity.*`) **không** cần bước cấp riêng như S12 bước 6: database mới tinh nhận đủ quyền từ bước khởi tạo (`bootstrap.ts`, ma trận BIZ).

## 4. Rủi ro đã biết

| Mã | Rủi ro | Xử lý |
|---|---|---|
| R1 | Các tiêu chí Owner **miễn kiểm** ở S12 (Thắng + việc bàn giao, Tạm hoãn / Tiếp tục, chuyển người phụ trách, khôi phục, Kỹ thuật qua việc được giao, hai người sửa cùng lúc, kéo thả kanban, chuyển giai đoạn / chốt trên iPhone) chưa được thử trên máy chủ thật | Có test tự động và thử ở môi trường cục bộ. Đề xuất: Owner dành 15 phút thử 3 việc quan trọng nhất (Thắng, Tạm hoãn, Kỹ thuật) trên database thật **trước khi** nhập dữ liệu thật, rồi xoá dữ liệu thử (bước 6) |
| R2 | Staging và database thật dùng **chung 3 tài khoản database** (runbook mục 9.3) | Chấp nhận được khi cùng một VPS, một người quản trị |
| R3 | Khoá ký sao lưu nằm trên VPS (runbook mục 9.5) | Chống sửa bản sao ngoài VPS, không chống người đã có root. Chấp nhận ở giai đoạn đầu |
| R4 | Một máy chủ, không có bản dự phòng chạy song song | Đường lùi là sao lưu + khôi phục (mất dữ liệu từ lần sao lưu gần nhất, tối đa 1 ngày nếu chỉ có sao lưu đêm) |
| R5 | Chưa có cảnh báo tự động khi dịch vụ / chứng chỉ hỏng | Mục 6 đề xuất kiểm hằng ngày và báo khi lỗi — cần Owner chọn kênh |

## 5. Các bước thực hiện (cách A hoặc B, phương án D2 = a)

| # | Việc | Thay đổi gì | Tiêu chí đạt | Đường lùi | Owner duyệt |
|---|---|---|---|---|---|
| 0 | Chốt SHA `main`, build giao diện (PowerShell), chép mã + giao diện lên thư mục tạm, chạy thử khô | Chỉ thêm tệp tạm | Dry-run rc = 0 | Xoá thư mục tạm | Có |
| 1 | Tên miền (D3): Owner thêm bản ghi A ở AZDIGI; Claude kiểm DNS, đổi cấu hình Caddy sang `crm.siscom.io.vn` | Cấu hình Caddy | `check-tls.sh` đạt với tên miền | Trả cấu hình Caddy về IP | Có |
| 2 | Sao lưu staging lần cuối; dừng dịch vụ; tạo `siscom_crm_prod`; đổi cấu hình dịch vụ sang database thật (`create-db.sh siscom_crm_prod create` + `env --force-env`) | Database mới, đổi cấu hình | Database mới đúng chủ sở hữu và quyền | Trả cấu hình về staging, khởi động lại | **Có** — `OWNER_APPROVED_MIGRATION` ghi rõ `siscom_crm_prod` |
| 3 | `deploy.sh --src … --frontend … --migrate` | 16 migration lên database mới | `migrate status` sạch, VERIFY đạt, sức khoẻ đạt | `deploy.sh --rollback` + lùi bước 2 | Có |
| 4 | Nạp danh mục (`run-cli.sh seed-lookups`) | Danh mục | 73 mục; chạy lại không đổi | Ẩn mục | Có |
| 5 | Khởi tạo tài khoản (`run-cli.sh bootstrap-auth`): Owner tự gõ mật khẩu từng người trên máy chủ (`read -rs`, không ghi tệp, không qua chat) | 5 tài khoản thật (D4); khoá chế độ khởi tạo | Đăng nhập được; `sysadmin` không thấy dữ liệu khách | Không lùi bằng lệnh (chế độ khởi tạo đã đóng) — làm lại từ bước 2 với database mới | **Có** — `OWNER_APPROVED_TASK` cho tài khoản thật |
| 6 | Thử nhanh R1 trên database thật (Owner, 15 phút), rồi xoá dữ liệu thử | Dữ liệu thử | Thắng tạo việc bàn giao; Tạm hoãn / Tiếp tục đúng; Kỹ thuật không thấy tiền | — | Owner làm |
| 7 | Sao lưu đầu tiên của database thật → khôi phục thử (Phụ lục A S12) → chép ra ngoài VPS (D6) | Bộ sao lưu | Khôi phục đạt; bản ngoài VPS qua xác thực | — | Có (Owner cầm khoá) |
| 8 | Mở cho người dùng (D7); (cách B) tạo tài khoản nhân viên qua màn hình quản lý tài khoản của P1 | Người dùng thật bắt đầu nhập liệu | — | Từ đây lùi = khôi phục sao lưu, mất dữ liệu mới | Có |

Gián đoạn: staging ngừng phục vụ từ bước 2 (database staging vẫn giữ, không xoá).

## 6. Sau khi mở

- **Báo lỗi:** người dùng chụp màn hình + mô tả gửi kênh ở D7; Claude kiểm nhật ký (chỉ đọc), sửa qua PR có test, review, Owner duyệt merge và duyệt triển khai như #253 / #254.
- **Triển khai bản sửa:** chỉ giao diện / không migration như lần 19/11 (sao lưu tự động trước, so nội dung dữ liệu trước / sau). Có migration ⇒ quy trình như S12 cổng B.
- **Kiểm định kỳ:** chứng chỉ, sao lưu đêm, dung lượng đĩa — đề xuất một lịch kiểm hằng ngày, báo khi lỗi (cần Owner chọn kênh).

## 7. Thứ tự đề xuất

1. Owner trả lời D1–D7 (mục 2).
2. Song song: Owner làm P4 (khoá) và thêm bản ghi DNS (D3); Claude làm P3 và — nếu cách B — P1.
3. Bước 0 → 8 (mục 5), mỗi bước Owner duyệt riêng.
