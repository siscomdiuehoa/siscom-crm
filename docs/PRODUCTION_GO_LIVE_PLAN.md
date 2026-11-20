# Kế hoạch đưa SISCOM CRM vào sử dụng thật (production)

- **Ngày lập:** 19/11/2026 · **Người lập:** Claude, theo yêu cầu của Owner ("Soạn kế hoạch", sau khi S12 đạt nghiệm thu theo quyết định của Owner).
- **Trạng thái (20/11/2026):** KẾ HOẠCH. **Bước 0 đã xong** (Owner duyệt bước 0 ngày 20/11/2026; chỉ đọc và chạy thử khô, không thay đổi cấu hình VPS — ghi chú bước 0 ở mục 5). **Bước 1–8 chưa làm.** Mỗi bước ở mục 5 cần Owner duyệt riêng bằng văn bản. Không bước nào được cấp phép bởi tài liệu này. **P3 (cloud-init): Owner chốt KHÔNG làm** (20/11/2026, mục 2.1).
- **Mã nguồn:** `main` = `2de465c` (CI 6/6), đang chạy trên staging từ 19/11/2026 16:37 (giờ Việt Nam).
- **Tài liệu nền:** `docs/VPS_RUNBOOK.md` (G6 sao lưu, G7 production, mục 9 giới hạn đã biết) — tài liệu này cụ thể hoá G7 cho lần đưa vào dùng thật đầu tiên; `docs/SALES_S12_STAGING_PLAN.md` (mục 10.7 — quyết định nghiệm thu và danh sách tiêu chí miễn kiểm); `docs/FV5_ACCOUNT_ADMIN.md`.
- Tài liệu không chứa mật khẩu, khoá hay dữ liệu khách hàng.
- **Sửa sau review R1 (20/11/2026):** bước 6 không tạo dữ liệu thử trên database thật (mục 5.4); rollback và điều kiện dừng (mục 5.2); sao lưu ngoài VPS tạm thời khi PR #235 chưa nghiệm thu (mục 5.3); bảng GO/NO-GO cho bước 8 (mục 5.1); quy ước tài khoản theo vai trò (mục 2.3). Bảng phản hồi từng điểm ở comment R2 của PR #255.
- **Sửa sau rà soát 20/11/2026 (chiều):** P3 ghi đúng trạng thái "chờ Owner chốt" thay vì vừa "cho làm" vừa "đề xuất không làm" (mục 2.1, 3, 7); bước 0 tách rõ phần đã làm và kết quả (mục 5, ghi chú bước 0), lịch mục 2.2 cập nhật theo. Sau đó Owner chốt P3: **không làm** (nguyên văn "Không làm P3", 20/11/2026).
- **Sửa sau review R2/R3 (20/11/2026):** quy trình **R-SVC** trỏ dịch vụ sang database đã khôi phục, **đã diễn tập** trên PostgreSQL tạm cách ly, có RTO / RPO (mục 5.2); bằng chứng bước 0 đưa vào repo `docs/evidence/golive-20261120/` (ghi chú bước 0); sửa kỳ vọng VERIFY `PASS|73` → `PASS|75` theo kết quả chạy trên mã `2de465c` (16 migration).
- **Sửa sau review R3/R4 (20/11/2026):** diễn tập R-SVC chạy lại trên **Linux Ubuntu 24.04, root, `runuser` / `chown` / systemd** (nhánh R-SVC giống VPS, không dùng chế độ diễn tập) và thêm **đường lùi khi R-SVC lỗi giữa chừng** — cả hai đạt (mục 5.2).

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
| D3 | Địa chỉ truy cập: `https://crm.siscom.io.vn` hay tiếp tục dùng IP? | **Tên miền.** Chứng chỉ theo IP chỉ có hạn 6 ngày, tự gia hạn nhưng chưa có cảnh báo khi hỏng. Việc cần làm: thêm **một** bản ghi A `crm` → `42.96.15.235` ở DNS **AZDIGI** (nơi đang trả lời cho `siscom.io.vn`; không đổi nameserver, không đụng website / mail). Ngày 19/11 tên này chưa tồn tại; **đã thêm 20/11** (mục 2.1) |
| D4 | Danh sách người dùng đầu tiên: họ tên, email, phòng ban, vai trò. Ai là **Quản trị CRM** (người duyệt, thấy toàn bộ khách)? Ai là **quản trị kỹ thuật** (người yêu cầu thay đổi quyền)? | Hai người này phải **khác nhau** và nên có **hai** người duyệt — bài học 19/11: staging chỉ có một người duyệt nên không tự đặt lại mật khẩu cho chính người đó được |
| D5 | Dữ liệu ban đầu: bắt đầu trống, hay nhập khách hàng có sẵn (Excel…)? | Nếu cần nhập: Owner gửi mẫu cột (không gửi dữ liệu thật qua chat); Claude kiểm hệ thống đã có chức năng nhập chưa rồi báo — **chưa kiểm** |
| D6 | Bản sao lưu ngoài VPS đặt ở đâu? | Google Drive của Owner (PR #235 — kéo tự động, đang Draft) hoặc chép tay hằng tuần như hôm nay. Sau R1: trong lúc #235 chưa nghiệm thu, chép **hằng ngày** theo mục 5.3 |
| D7 | Ngày mở cho người dùng và cách báo lỗi khi dùng | Một nhóm Zalo / một luồng chat cố định; Claude sửa qua PR như #253, #254 |

### 2.1 Câu trả lời của Owner (phiếu go-live, lưu 19/11/2026 17:08, cập nhật 20/11/2026 08:23 giờ Việt Nam)

| Mã | Owner chọn | Hệ quả |
|---|---|---|
| D1 | **Cách A** — mở sớm, tối đa 5 tài khoản | P1 (quản lý tài khoản) **không** chặn ngày mở; làm sau khi Owner cần thêm người |
| D2 | **(a)** máy chủ hiện tại, chuyển sang `siscom_crm_prod` | Staging ngừng phục vụ từ bước 2, database staging giữ nguyên |
| D3 | **Tên miền** `crm.siscom.io.vn` | **Xong 20/11/2026:** Owner thêm bản ghi A `crm` → `42.96.15.235` ở cPanel AZDIGI (tên miền mua ở BKNS, nameserver `ns3/ns4.azdigi.com`). Claude kiểm: AZDIGI, 8.8.8.8, 1.1.1.1 đều trả `42.96.15.235`. Bản ghi website giữ nguyên |
| D4 | **Đủ 5 người** (cập nhật 20/11/2026): mỗi vai trò một người — quản trị kỹ thuật, Quản trị CRM, Kinh doanh, Kỹ thuật, Kế toán | Họ tên / email **không** ghi vào repo; nằm trong phiếu của Owner. Tài khoản đặt tên theo vai trò — xem mục 2.3 |
| D5 | **Bắt đầu trống** (Owner đổi 20/11/2026; trước đó chọn nhập khách có sẵn) | Không cần công cụ nhập; không chặn ngày mở |
| D6 | **Google Drive tự động** | PR #235 (Draft, +1065 dòng) **chưa nghiệm thu** ⇒ **không** là điều kiện mở. Trước khi mở dùng phương án tạm thời ở mục 5.3 (chép bản sao đã mã hoá + ký về máy Owner, kiểm chữ ký và SHA-256, khôi phục thử đạt). Chuyển sang Drive tự động chỉ sau khi #235 được review, Owner duyệt merge và chạy thử đạt |
| D7 | Ngày mở: **càng sớm càng tốt**; báo lỗi qua **Zalo** (20/11/2026) | Lịch đề xuất ở mục 2.2 |
| P3 | Phiếu: "Cho làm" (19/11/2026 17:08). **Chốt cuối: KHÔNG làm** — Owner trả lời đề xuất của Claude, nguyên văn "Không làm P3" (20/11/2026) | Không thay đổi cloud-init. Giữ hiện trạng: cloud-init vẫn đặt lại mật khẩu root mỗi lần khởi động; mật khẩu đó chỉ dùng được ở console web BKNS (đường cứu hộ), SSH vẫn chỉ đăng nhập bằng khoá. Không phải điều kiện mở |
| P4 | Đã đặt mật khẩu cho `VPS.ppk`; chưa chuyển khoá sao lưu khỏi Dropbox; chưa đánh dấu cam kết không dùng lại mật khẩu từ chat | — |

Ghi chú của Owner, nguyên văn: "em làm cái tối ưu thêm thì làm, đừng bảo mật quá".

**P3 — Claude đề xuất KHÔNG làm (kiểm chỉ đọc 19/11); Owner chốt không làm (20/11/2026):** cloud-init của BKNS đặt lại mật khẩu root từ đĩa seed `cidata` mỗi lần khởi động, đúng mật khẩu Owner thấy trong bảng điều khiển BKNS. SSH đã chặn đăng nhập bằng mật khẩu, nên mật khẩu đó chỉ dùng được ở **console web của BKNS** — đây lại là đường cứu hộ khi mất khoá SSH. Tắt cloud-init còn có thể ảnh hưởng cấu hình mạng (`/etc/netplan/50-cloud-init.yaml` do cloud-init sinh). Rủi ro của việc giữ nguyên thấp hơn rủi ro của việc sửa; phù hợp ghi chú "đừng bảo mật quá".

**Quyết định cuối (Owner, 20/11/2026): không làm P3.** P3 không nằm trong bước 0–8, không là hạng mục GO/NO-GO (mục 5.1), không là điều kiện mở. Muốn làm sau này cần quyết định mới của Owner, lệnh cụ thể được review trước. `provision.sh` chỉ giữ khoá host SSH qua cloud-init (`ssh_deletekeys: false`, đã có trên VPS) — không liên quan P3, và bước 1 không chạy lại `provision.sh`.

### 2.2 Lịch dự kiến (Owner chọn "càng sớm càng tốt"; Owner chốt cài đặt T7 21/11/2026, mở T2 23/11/2026)

Lịch **không** phải quyền thực hiện: mỗi bước ở mục 5 vẫn cần Owner duyệt riêng; bước nào không đạt thì dừng theo mục 5.2 và lịch lùi lại.

| Khi nào | Việc | Ai |
|---|---|---|
| 20/11 (đã làm) | **Bước 0 xong** — ghi chú bước 0 ở mục 5 | Claude (Owner duyệt) |
| Trước T7 21/11 | Review kế hoạch (#255) tới PASS; Owner duyệt. Bước 6a: Owner thử nghiệp vụ trên **staging** (mục 5.4). | Reviewer, Owner |
| T7 21/11 (~3 giờ, Owner ngồi cùng) | Kiểm lại `main` vẫn là `2de465c` (khác ⇒ dừng, làm lại bước 0 cho SHA mới, lịch lùi); bước 1 (chỉ đổi Caddy: tên miền + HTTPS) **ngay trước** bước 2; bước 2–5; bước 6b (kiểm chỉ đọc, xác nhận database thật sạch); bước 7 (sao lưu, khôi phục thử, bản sao ngoài VPS) | Claude + Owner |
| T2 23/11 | Bảng GO/NO-GO (mục 5.1) đủ; Owner quyết GO ⇒ bước 8 | Owner |
| Sau ngày mở | Chép bản sao ngoài VPS hằng ngày (mục 5.3) cho tới khi PR #235 được nghiệm thu | Claude (chỉ đọc), Owner duyệt |

### 2.3 Tài khoản đặt tên theo vai trò (Owner quyết 20/11/2026)

Owner, nguyên văn: "Giữ tên theo vai trò, sửa sau khi có màn hình quản lý tài khoản." `bootstrap-auth` chỉ tạo 5 tên đăng nhập cố định theo vai trò (`sysadmin@`, `admin@`, `sale@`, `kythuat@`, `ketoan@` + `BOOTSTRAP_EMAIL_DOMAIN`) với họ tên mẫu; hệ thống chưa có chức năng sửa nhân viên.

- **Mỗi tài khoản đúng một người dùng** (theo phiếu D4; bảng ghép tên đăng nhập ↔ người do Owner giữ, **không** ghi vào repo). **Không** dùng chung, không chuyển mật khẩu cho người khác.
- Tên đăng nhập chỉ dùng để đăng nhập; hệ thống không gửi thư tới địa chỉ này.
- **Đổi về sau** (khi có màn hình quản lý tài khoản — P1): sửa họ tên / email **trên chính bản ghi nhân viên đó** (giữ nguyên mã nhân viên, lịch sử, nhật ký, quyền sở hữu khách / cơ hội / hoạt động). **Không** tạo tài khoản mới rồi xoá tài khoản cũ.
- **Người dùng đổi** (nghỉ việc, giao cho người khác): khoá tài khoản cũ, cấp tài khoản mới cho người mới, chuyển người phụ trách bằng chức năng chuyển có sẵn (có nhật ký). Không đổi mật khẩu để "cho người mới dùng tiếp" tài khoản cũ.
- Việc đổi chỉ làm qua cơ chế hai người thật của P1 (quyết định Owner 10/11/2026), không sửa tay database.

## 3. Việc kỹ thuật phải xong trước (mỗi việc một PR hoặc một bước có duyệt)

| Mã | Việc | Vì sao | Ước lượng |
|---|---|---|---|
| **P1** | **Quản lý tài khoản dùng được trên máy chủ thật** — bắt buộc cho cách B; với cách A cần để đổi họ tên / email tài khoản theo vai trò (mục 2.3) và thêm người | Công cụ `account-admin` hiện **khoá cứng** vào PostgreSQL thử (FV5-DB-GUARD). Owner đã quyết 10/11/2026: phê duyệt hai người **chỉ bằng khai báo** (người chạy lệnh gõ mã hai người) **không được dùng thật**. Cần cơ chế hai người thật: người yêu cầu và người duyệt mỗi người **tự đăng nhập** và bấm trên giao diện (màn hình "Quản lý tài khoản" trong CRM). Hai kịch bản đặt lại mật khẩu dùng trên staging ngày 19/11 là loại "khai báo" ⇒ **không dùng cho database thật** | 3–5 ngày, gồm review |
| P2 | **Mật khẩu** | Mỗi người có mật khẩu riêng ≥ 12 ký tự lúc khởi tạo (Owner gõ trên máy chủ). **Không** dùng mật khẩu chung, **không** dùng lại bất kỳ mật khẩu nào từng xuất hiện trong chat hay ảnh chụp (kể cả mật khẩu thử staging) | Trong bước 5 |
| P3 | **Chặn cloud-init đặt lại mật khẩu root mỗi lần khởi động** (runbook mục 9.10) — **Owner chốt KHÔNG làm (20/11/2026)**, mục 2.1 | Đăng nhập root bằng mật khẩu qua SSH đã tắt; mật khẩu đó chỉ dùng được ở console web BKNS (đường cứu hộ khi mất khoá SSH) | Không làm |
| P4 | **Vị trí khoá** | Khoá đăng nhập VPS (`VPS.ppk`) và hai khoá giải mã sao lưu đang có bản trong **Dropbox**. Đề xuất: đặt mật khẩu bảo vệ cho `VPS.ppk` (PuTTYgen), giữ khoá giải mã sao lưu ở ổ rời / nơi không đồng bộ | Owner tự làm |
| P5 | **Sao lưu dữ liệu thật** | Timer sao lưu đêm lấy database từ `migrate.env` (`backup-db.sh`, kiểm mã 20/11) nên sau bước 2 **tự chuyển sang `siscom_crm_prod`** và ngừng sao lưu staging. Phải **khôi phục thử** bản đầu tiên của database thật và có bản sao ngoài VPS đã kiểm (mục 5.3) | Trong bước 7 |
| P6 | Mã đóng gói | Dùng `--src` từ `git archive <SHA đã duyệt>` như 19/11; hoặc Owner duyệt tạo tag `v0.1.0` trên `main` để dùng `--tag` (runbook mục 9.8) | — |

Ma trận quyền Sales (10 mã `opportunity.*`) **không** cần bước cấp riêng như S12 bước 6: database mới tinh nhận đủ quyền từ bước khởi tạo (`bootstrap.ts`, ma trận BIZ).

## 4. Rủi ro đã biết

| Mã | Rủi ro | Xử lý |
|---|---|---|
| R1 | Các tiêu chí Owner **miễn kiểm** ở S12 (Thắng + việc bàn giao, Tạm hoãn / Tiếp tục, chuyển người phụ trách, khôi phục, Kỹ thuật qua việc được giao, hai người sửa cùng lúc, kéo thả kanban, chuyển giai đoạn / chốt trên iPhone) chưa được thử trên máy chủ | Có test tự động và thử ở môi trường cục bộ. Thử nghiệp vụ trên **staging** (cùng mã `2de465c`, database riêng) ở bước 6a; **không** tạo dữ liệu thử trên database thật (mục 5.4) |
| R2 | Staging và database thật dùng **chung 3 tài khoản database** (runbook mục 9.3) | Chấp nhận được khi cùng một VPS, một người quản trị |
| R3 | Khoá ký sao lưu nằm trên VPS (runbook mục 9.5) | Chống sửa bản sao ngoài VPS, không chống người đã có root. Chấp nhận ở giai đoạn đầu |
| R4 | Một máy chủ, không có bản dự phòng chạy song song | Đường lùi là sao lưu + khôi phục (mất dữ liệu từ lần sao lưu gần nhất, tối đa 1 ngày nếu chỉ có sao lưu đêm) |
| R5 | Chưa có cảnh báo tự động khi dịch vụ / chứng chỉ hỏng | Mục 6 đề xuất kiểm hằng ngày và báo khi lỗi — cần Owner chọn kênh |

## 5. Các bước thực hiện (cách A hoặc B, phương án D2 = a)

| # | Việc | Thay đổi gì | Tiêu chí đạt | Đường lùi | Owner duyệt |
|---|---|---|---|---|---|
| 0 | Chốt SHA `main`, build giao diện (PowerShell), chép mã + giao diện lên thư mục tạm, chạy thử khô (`provision.sh --dry-run`, `deploy.sh --dry-run`). **ĐẠT 20/11/2026** — ghi chú bước 0 dưới bảng | Không đổi cấu hình (mã + giao diện dùng lại thư mục tạm chép 19/11, không chép thêm) | Dry-run rc = 0; mã trên VPS trùng `git archive` của SHA đã chốt | Xoá thư mục tạm | Có (đã duyệt 20/11) |
| 1 | Tên miền (D3, bản ghi A đã có 20/11): **làm ngay trước bước 2** — origin của staging (`CORS_ORIGINS`, `AUTH_ALLOWED_ORIGINS` = `https://42.96.15.235`) chỉ đổi ở bước 2, đổi Caddy sớm sẽ làm hỏng đăng nhập staging. **Chỉ đổi Caddy** (Owner chọn 20/11/2026, không chạy lại `provision.sh` — xem ghi chú dưới bảng): sao lưu `/etc/siscom-crm/caddy.env` + `/etc/caddy/siscom-tls.caddy` thành `.bak-<giờ>`; kiểm `/etc/caddy/Caddyfile` trùng tệp của repo; ghi `caddy.env` (600) `SISCOM_HOST=crm.siscom.io.vn`, `SISCOM_ACME_CA=https://acme-v02.api.letsencrypt.org/directory`; `install -m 644 tls-domain.caddy /etc/caddy/siscom-tls.caddy`; `caddy validate` (nạp `caddy.env`); `systemctl restart caddy` | Hai tệp cấu hình Caddy | `check-tls.sh` "TLS OK" (Let's Encrypt, ≥ 14 ngày); `curl` không `-k` đạt; HTTP → 308 | Trả hai tệp `.bak`, `systemctl restart caddy` (không đụng database, không cài gói) | Có |
| 2 | Sao lưu staging lần cuối; dừng dịch vụ; tạo `siscom_crm_prod`; đổi cấu hình dịch vụ sang database thật (`create-db.sh siscom_crm_prod create` + `env --force-env`) | Database mới, đổi cấu hình | Database mới đúng chủ sở hữu và quyền | Trả cấu hình về staging, khởi động lại | **Có** — `OWNER_APPROVED_MIGRATION` ghi rõ `siscom_crm_prod` |
| 3 | `deploy.sh --src … --frontend … --migrate` | 16 migration lên database mới | `migrate status` sạch, `PASS\|75` + `PASS\|33`, sức khoẻ đạt | **Không** dùng `deploy.sh --rollback` để lùi database (lệnh này chỉ đổi bản mã). Lùi theo mục 5.2: bỏ `siscom_crm_prod`, trả dịch vụ về staging | Có |
| 4 | Nạp danh mục (`run-cli.sh seed-lookups`) | Danh mục | 73 mục; chạy lại không đổi | Ẩn mục | Có |
| 5 | Khởi tạo tài khoản (`run-cli.sh bootstrap-auth`, `BOOTSTRAP_EMAIL_DOMAIN=siscom.vn`): Owner tự gõ mật khẩu từng người trên máy chủ (`read -rs`, không ghi tệp, không qua chat) | 5 tài khoản theo vai trò (mục 2.3); khoá chế độ khởi tạo | Chạy lại báo `BOOTSTRAP_CLOSED`; đăng nhập kiểm ở bước 6b | Không lùi bằng lệnh — theo mục 5.2: bỏ `siscom_crm_prod`, làm lại từ bước 2 với database mới (chỉ khi chưa mở) | **Có** — `OWNER_APPROVED_TASK` cho tài khoản thật |
| 6 | **6a** (trước T7): thử nghiệp vụ trên **staging**. **6b** (sau bước 5): trên database thật **chỉ** đăng nhập 5 tài khoản và kiểm xem (không tạo / sửa / xoá dữ liệu nghiệp vụ), rồi xác nhận database sạch — mục 5.4 | 6a: dữ liệu thử chỉ ở staging. 6b: chỉ phiên đăng nhập + nhật ký đăng nhập | Mục 5.4 | 6b không đạt ⇒ NO-GO, mục 5.2 | 6a Owner làm; 6b Owner + Claude |
| 7 | Sao lưu đầu tiên của database thật → khôi phục thử (Phụ lục A S12) vào database tạm → chép bản sao ra ngoài VPS và kiểm (mục 5.3) | Bộ sao lưu; database khôi phục thử (xoá sau khi Owner xem) | Có `.restore-ok.txt`; số dòng khớp manifest; bản ngoài VPS qua kiểm chữ ký + SHA-256 | Không đạt ⇒ NO-GO | Có (Owner cầm khoá) |
| 8 | Mở cho người dùng (D7) khi bảng GO/NO-GO (mục 5.1) đủ; (cách B) tạo tài khoản nhân viên qua màn hình quản lý tài khoản của P1 | Người dùng thật bắt đầu nhập liệu | Mục 5.1 | Từ đây không còn "bỏ database làm lại": mục 5.2, giai đoạn sau mở | **Có** — Owner ghi GO |

**Ghi chú bước 0 (chạy 20/11/2026, Owner duyệt bước 0; chỉ đọc + chạy thử khô, không thay đổi cấu hình VPS):**

| Phần | Kết quả |
|---|---|
| Chốt SHA | `main` = `2de465c` (kiểm 20/11); đúng bản đang chạy trên staging từ 19/11 |
| Mã nguồn | `/root/s12-src-2de465c` (chép 19/11) **trùng từng tệp** với `git archive 2de465c backend`: 546/546 tệp, cùng SHA-256 (danh sách so khớp giữ trong bằng chứng bước 0) |
| Giao diện | `/root/s12-web-dist-2de465c` (build bằng PowerShell 19/11) trùng mã băm với giao diện staging đang chạy (`releases/src-20261119093630/web`) |
| `provision.sh --dry-run` | `SISCOM_HOST=crm.siscom.io.vn` rc = 0: DNS khớp IP máy, cổng SSH 26266 giữ nguyên, ufw không có rule lạ. Mô phỏng `apt-get -s` cho thấy chạy thật sẽ **nâng PostgreSQL 18.6 → 18.7** (kèm `libpq5` 19.0) ⇒ lý do bước 1 chỉ đổi Caddy |
| `deploy.sh --src … --frontend … --migrate --dry-run` | rc = 0; không tạo / sửa / khởi động gì. **Giới hạn:** chạy với cấu hình hiện tại nên "DB đích" in ra là `siscom_crm_staging`; cấu hình `siscom_crm_prod` chỉ có sau bước 2, nên kiểm đúng database đích nằm ở tiêu chí bước 2–3 |
| Tự cập nhật | `unattended-upgrades` chỉ lấy gói từ kho Ubuntu, **không** lấy kho PGDG ⇒ PostgreSQL 18.6 không tự nâng trước ngày cài. Không chạy `apt upgrade` tay trong đợt này |
| Dịch vụ | `siscom-crm-backend`, `caddy` active; đĩa trống 31 GB |

**Bằng chứng bước 0** (đầu ra lệnh, không chứa mật khẩu) trong `docs/evidence/golive-20261120/`: `step0-provision-dry-run-20261120T041540Z.log.txt` (rc = 0); `step0-deploy-dry-run-20261120T054011Z.log.txt` (mã băm cây mã / giao diện trên VPS + `deploy.sh --dry-run` rc = 0); `step0-src-compare.txt` (546 = 546 tệp, `diff_lines=0`); `step0-vps-backend-2de465c.sha256` và `step0-git-archive-backend-2de465c.sha256` (danh sách SHA-256 từng tệp hai phía, trùng nhau — reviewer tự tạo lại phía repo bằng `git archive 2de465c backend` rồi `sha256sum` từng tệp). Bước 0 **không chạy lại** khi `main` vẫn là `2de465c`; sáng T7 chỉ kiểm SHA (mục 2.2).

**Ghi chú bước 1:** chạy thật `provision.sh` còn chạy `apt-get install` toàn bộ gói nền ⇒ PostgreSQL khởi động lại (bản 18.7) ngay trước khi tạo database thật. Vì vậy bước 1 chỉ làm đúng phần Caddy của `provision.sh` (mục 11 của script) bằng các lệnh ở bảng trên. **Không nâng cấp PostgreSQL trong đợt triển khai này;** nâng cấp làm riêng sau khi mở, có sao lưu trước và Owner duyệt.

Gián đoạn: staging ngừng phục vụ từ bước 2 (database staging vẫn giữ, không xoá).

### 5.1 GO/NO-GO trước bước 8

Mọi dòng phải **ĐẠT** và có bằng chứng (đầu ra lệnh lưu vào `docs/evidence/golive-<ngày>/`, không chứa mật khẩu). Một dòng không đạt ⇒ **NO-GO**, không mở, xử lý theo mục 5.2. Owner là người quyết GO cuối cùng.

| # | Hạng mục | Tiêu chí đạt | Bằng chứng | Người xác nhận |
|---|---|---|---|---|
| G1 | HTTPS | `check-tls.sh` "TLS OK" cho `crm.siscom.io.vn`, Let's Encrypt, còn ≥ 14 ngày; `curl` không `-k` đạt; HTTP → 308; có HSTS, `nosniff`; quét cổng ngoài chỉ thấy 26266, 80, 443 | Đầu ra lệnh | Claude chạy; Owner xem |
| G2 | Dịch vụ và database | `siscom-crm-backend` active; `/health/database`: `migrated:true`, `leastPrivilege:true`, `authPool:"separate"`, `authLeastPrivilege:true`; `migrate status` sạch; `PASS\|75`, `PASS\|33`; cổng 3000 chỉ `127.0.0.1` | Đầu ra lệnh | Claude |
| G3 | Đăng nhập 5 tài khoản | Cả 5 đăng nhập được trên trình duyệt; ít nhất 1 tài khoản trên iPhone; cookie `Secure`; sai mật khẩu bị từ chối | Owner xác nhận từng tài khoản | Owner |
| G4 | RBAC | `sysadmin` không thấy khách / cơ hội; Quản trị CRM thấy toàn bộ menu nghiệp vụ; Kinh doanh, Kỹ thuật, Kế toán chỉ thấy menu đúng vai trò; Kỹ thuật không thấy số tiền (chỉ xem, không tạo dữ liệu) | Ảnh chụp màn hình từng vai trò | Owner |
| G5 | Chức năng nghiệp vụ thiết yếu | Bước 6a trên staging đạt: tạo khách / cơ hội, chuyển giai đoạn (hộp báo đúng lý do), số tiền có dấu chấm, Thắng tạo việc bàn giao, Tạm hoãn / Tiếp tục, Kỹ thuật thấy việc được giao | Danh sách mã dữ liệu thử trên staging + kết quả từng mục | Owner |
| G6 | Database thật sạch | Mục 5.4: các bảng nghiệp vụ = 0 dòng; chỉ có dữ liệu khởi tạo | Đầu ra truy vấn chỉ đọc | Claude chạy; Owner xem |
| G7 | Sao lưu | Bộ sao lưu đầu tiên của `siscom_crm_prod` có chữ ký; khôi phục thử đạt; bản sao ngoài VPS qua kiểm chữ ký + SHA-256 (mục 5.3); timer đêm trỏ `siscom_crm_prod` | Đầu ra lệnh, tệp `.restore-ok.txt` | Claude chạy; Owner cầm khoá |
| G8 | Rollback | Bản sao lưu staging lần cuối (bước 2) có chữ ký; database staging còn nguyên (vân tay nội dung trước = sau); lệnh trả cấu hình về staging đã ghi sẵn (mục 5.2) | Đầu ra lệnh | Claude |
| G9 | Tài khoản | Owner đã giao mỗi tài khoản cho đúng một người (mục 2.3); mật khẩu do Owner gõ, không qua chat | Owner xác nhận | Owner |
| G10 | Báo lỗi | Nhóm Zalo báo lỗi đã lập; người dùng biết cách gửi | Owner xác nhận | Owner |

### 5.2 Rollback và điều kiện dừng

`deploy.sh --rollback` chỉ đổi liên kết `current` về bản mã trước — **không** hoàn tác migration, seed hay `bootstrap-auth`. Database không có lệnh "lùi": đường lùi của database là **bỏ database mới** (trước khi mở) hoặc **khôi phục từ sao lưu đã kiểm** (sau khi mở).

**Giai đoạn trước khi mở (bước 1–7, `siscom_crm_prod` chưa có dữ liệu thật):**

| Lỗi ở | Làm gì |
|---|---|
| Bước 1 | Trả `caddy.env` + `siscom-tls.caddy` đã sao lưu, `systemctl restart caddy`. Staging chạy lại bằng IP |
| Bước 2–7 | (1) `systemctl stop siscom-crm-backend`. (2) Trả Caddy như trên. (3) `SISCOM_HOST=42.96.15.235 create-db.sh siscom_crm_staging env --force-env` (trỏ lại staging). (4) Nếu bản mã đã đổi: `deploy.sh --rollback` về bản staging `src-20261119093630`. (5) Start dịch vụ, kiểm sức khoẻ và vân tay nội dung staging (phải trùng lúc trước bước 2). (6) `siscom_crm_prod` giữ lại để xem lỗi; chỉ xoá (`SISCOM_ALLOW_DROP_PROD=siscom_crm_prod create-db.sh siscom_crm_prod drop --yes-drop siscom_crm_prod`) khi Owner duyệt riêng, rồi làm lại từ bước 2 |

**Điều kiện dừng ngay** (không thử tiếp, không sửa tay database, dịch vụ để dừng, báo Owner): sao lưu staging lần cuối không thành công (khi đó **không** sang bước 2); migration lỗi giữa chừng; VERIFY / VERIFY_AUTH không đạt; `bootstrap-auth` lỗi; sức khoẻ không đạt sau 30 giây; bất kỳ dấu hiệu staging bị thay đổi (vân tay khác).

**Giai đoạn sau khi mở (bước 8 trở đi, có dữ liệu thật):**

- Lỗi mã không liên quan dữ liệu: sửa qua PR, hoặc `deploy.sh --rollback` về bản mã trước **chỉ khi** bản sau không có migration (mục 6).
- Lỗi làm hỏng / mất dữ liệu: **dừng dịch vụ**, không sửa tay database, báo Owner. Owner quyết khôi phục ⇒ quy trình **R-SVC** dưới đây (mỗi lần cần Owner duyệt riêng, Owner nạp khoá age). Mất dữ liệu kể từ lần sao lưu gần nhất.

**Quy trình R-SVC — trỏ dịch vụ sang database đã khôi phục** (giữ nguyên tên `siscom_crm_prod` nên `backend.env` / `migrate.env`, timer sao lưu và `create-db.sh` không phải đổi):

| # | Việc (lệnh trên VPS, bằng root) | Đạt khi |
|---|---|---|
| R0 | Owner chọn bộ sao lưu (thường là bộ mới nhất đã qua kiểm ở mục 5.3); tránh khung sao lưu đêm (~02:00 giờ Việt Nam) | Owner ghi tên bộ |
| R1 | `systemctl stop siscom-crm-backend` (mốc T0) | dịch vụ inactive |
| R2 | Owner chép khoá age tạm; `restore-test.sh --db siscom_crm_prod --dump <bộ đã chọn> --identity <khoá>`; xoá khoá (`shred -u`) | "Chữ ký manifest hợp lệ", "PASS: n bảng khớp số dòng", có `.restore-ok.txt`; ghi tên DB `siscom_crm_restore_<UTC>` |
| R3 | `sudo -u postgres psql -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('siscom_crm_prod','siscom_crm_restore_<UTC>')"`; `ALTER DATABASE siscom_crm_prod RENAME TO siscom_crm_prod_hong_<UTC>`; `ALTER DATABASE siscom_crm_restore_<UTC> RENAME TO siscom_crm_prod` | hai lệnh đổi tên thành công; DB hỏng **giữ lại** để điều tra |
| R4 | Quyền cấp database (DB khôi phục được tạo không qua `create-db.sh create`): `sudo -u postgres psql -X -v ON_ERROR_STOP=1 -v target_db=siscom_crm_prod -d siscom_crm_prod -f /opt/siscom-crm/current/backend/docs/B1.3_S1_ROLE_SPLIT.sql.txt`, rồi tương tự với `B1.3_S1_AUTH_ROLE.sql.txt`; kiểm bằng đúng truy vấn của `create-db.sh create` | `siscom_migrator\|true\|true\|false\|false,false,false` |
| R5 | `create-db.sh siscom_crm_prod grants` | `PASS\|75`, `PASS\|33`, "GRANTS + VERIFY DAT" |
| R6 | `systemctl start siscom-crm-backend` (mốc T1) | `/health/database`: `migrated:true`, `leastPrivilege:true`, `authPool:"separate"`, `authLeastPrivilege:true` trong 30 giây |
| R7 | Kiểm: 5 tài khoản đăng nhập bằng mật khẩu cũ, sai mật khẩu bị từ chối; dữ liệu đúng tới mốc sao lưu; ghi mới được; chạy `backup-db.sh` một lần trên DB mới | Owner xác nhận; có bộ sao lưu mới |
| R8 | Xoá `siscom_crm_prod_hong_<UTC>` và DB khôi phục thừa (nếu có) **chỉ khi Owner duyệt** (`DROP DATABASE` bằng tay; `create-db.sh drop` không nhận tên này) | — |

**Đường lùi khi R-SVC lỗi ở R3–R5** (đã diễn tập): dịch vụ để dừng; đổi ngược hai tên — `ALTER DATABASE siscom_crm_prod RENAME TO siscom_crm_restore_<UTC>` rồi `ALTER DATABASE siscom_crm_prod_hong_<UTC> RENAME TO siscom_crm_prod` (sau khi `pg_terminate_backend` như R3). Kết quả: trở lại đúng trạng thái trước R-SVC, DB khôi phục còn nguyên để làm lại từ R3 (không cần khôi phục lại). Báo Owner; không sửa tay dữ liệu.

**Diễn tập R-SVC (20/11/2026, mã `2de465c`, PostgreSQL tạm cách ly — không chạm VPS, database thật hay staging).** Kịch bản `docs/evidence/golive-20261120/rehearse-restore-service.sh` (SHA-256 `696715a1…b8b309ad`):

| Lần chạy | Môi trường | Bằng chứng |
|---|---|---|
| **Linux, nhánh VPS** (`REAL=1`) | Ubuntu 24.04.5, root, PostgreSQL 18.7 (PGDG); `create-db.sh` / `backup-db.sh` / `restore-test.sh` chạy **không** có `SISCOM_REHEARSAL` ⇒ superuser qua `runuser -u postgres` (peer), `restore-test.sh` `chown postgres` + `runuser pg_restore`, kiểm tệp 600 / root; backend chạy bằng `systemd-run` (unit tạm thời, `DynamicUser`) và dừng bằng `systemctl stop`. Máy GitHub dùng một lần, workflow tạm trên nhánh riêng `rehearsal/rsvc-linux-20261120` (Owner duyệt 20/11/2026; không merge, xoá sau khi lấy bằng chứng) | Run https://github.com/siscomdiuehoa/siscom-crm/actions/runs/44699663953 (commit nhánh `bcc1f95`); `rsvc-linux-real-20261120T080550Z.log.txt` (SHA-256 `91281390…2b760a7e`, bản tải từ artifact của run) |
| Windows (`SISCOM_REHEARSAL=1`) | Git Bash, PostgreSQL 18.6 | `rsvc-windows-20261120T075940Z.log.txt` (cùng kịch bản); `rsvc-rehearsal-20261120T071114Z.log.txt` (bản trước, chưa có đường lùi) |

Trình tự mỗi lần: dựng `siscom_crm_prod` như bước 2–5 → tạo `THU-K1` → sao lưu (age + ký) → tạo `THU-K2` → giả lập sự cố (đổi tên bảng `customer` ⇒ `GET /customers` 500) → R1–R2 → **lần 1: R3, cố ý làm R4 lỗi (`target_db` sai), chạy đường lùi** → **lần 2: R3–R7** dùng lại DB khôi phục. Kết quả (cả hai môi trường): `restore-test.sh` PASS 24 bảng; **đường lùi**: tên DB trở về như trước, dấu vân tay nội dung (số dòng từng bảng) DB gốc và DB khôi phục **trùng** trước / sau, dịch vụ chạy lại trên DB gốc vẫn lỗi 500 như trước R-SVC; **lần 2**: quyền cấp database `siscom_migrator\|true\|true\|false\|false,false,false`, `PASS\|75` + `PASS\|33`, `/health/database` đủ bốn chỉ số, 5 tài khoản đăng nhập bằng mật khẩu cũ = 200, sai mật khẩu = 401, `THU-K1` còn / `THU-K2` mất, ghi mới được, sao lưu chạy tiếp trên DB mới, DB hỏng còn nguyên.

- **RTO đo được (phần máy, database gần rỗng):** Linux 2 giây đường chính (R1–R2 1 giây + R3–R6 1 giây), đường lùi dưới 1 giây; Windows 8 giây. Trên VPS cộng thời gian Owner quyết định và nạp khoá, và `pg_restore` tăng theo dung lượng. Ước tính giai đoạn đầu: dưới 1 giờ khi Owner có mặt — **ước tính, chưa đo trên VPS**.
- **RPO:** dữ liệu tạo sau mốc sao lưu dùng để khôi phục bị mất (diễn tập: `THU-K2`). Với sao lưu đêm: tối đa khoảng 24 giờ; `deploy.sh` tự sao lưu trước mỗi lần triển khai.
- **Khác biệt còn lại so với VPS:** máy diễn tập dùng PostgreSQL 18.7 (VPS 18.6); unit backend là unit tạm `DynamicUser` thay cho `siscom-crm-backend.service` (`User=siscom`, các tuỳ chọn bảo vệ) — R-SVC chỉ `stop` / `start` unit đó, không đổi cấu hình unit. Chạy lại kịch bản trên PostgreSQL tạm cách ly khi script hoặc schema thay đổi.

### 5.3 Sao lưu ngoài VPS tạm thời (khi PR #235 chưa nghiệm thu)

1. Sau bước 7 và **mỗi sáng** sau sao lưu đêm: Claude kéo về máy Owner (`scp`, chỉ đọc trên VPS) bộ mới nhất: `<stem>.dump.age`, `<stem>.manifest`, `<stem>.manifest.sig`. Bản sao **đã mã hoá**; Claude không có khoá giải mã. Việc kéo hằng ngày cần Owner duyệt.
2. Kiểm toàn vẹn trên máy Owner: `ssh-keygen -Y verify -f allowed_signers -I siscom-crm-backup -n siscom-crm-backup -s <stem>.manifest.sig < <stem>.manifest` (dùng `allowed_signers` Owner giữ ngoài VPS) và so `file_sha256` trong manifest với `sha256sum <stem>.dump.age` (như bản staging 19/11).
3. Khôi phục thử: bộ đầu tiên của `siscom_crm_prod` khôi phục thử ở bước 7 (trên VPS, cùng tệp đã kiểm SHA-256 ở máy Owner); sau đó **hằng tuần** khôi phục thử một bộ (Owner nạp khoá, Phụ lục A S12).
4. Giữ trên máy Owner tối thiểu 14 bộ gần nhất; thư mục không đồng bộ lên dịch vụ đám mây (P4).
5. Điều kiện mở (G7): có ít nhất **một** bộ ngoài VPS đã qua bước 2 và khôi phục thử đạt.
6. Chuyển sang Google Drive tự động (D6) chỉ sau khi PR #235 được review, Owner duyệt merge và chạy thử đạt; trong lúc đó vẫn chép tay theo mục này.

### 5.4 Kiểm thử cô lập và xác nhận database thật sạch

**6a — Thử nghiệp vụ trên staging (trước T7 21/11).** Staging đang chạy đúng mã `2de465c` sẽ triển khai, trên database riêng `siscom_crm_staging`. Owner dùng các tài khoản staging; mọi dữ liệu thử đặt tên bắt đầu bằng `THU-`. Kiểm: tạo khách / cơ hội; chuyển giai đoạn khi thiếu thông tin (hộp báo đúng lý do); số tiền có dấu chấm; Thắng tạo việc bàn giao; Tạm hoãn → Tiếp tục; đăng nhập Kỹ thuật thấy việc được giao, không thấy số tiền. Dữ liệu thử ở lại staging; database thật là database mới, **không** nhận dữ liệu từ staging.

**6b — Trên database thật (sau bước 5, trước bước 7):** chỉ đăng nhập 5 tài khoản và **xem** (G3, G4). Không tạo, sửa, xoá khách / cơ hội / hoạt động. Hệ quả ghi duy nhất được chấp nhận: phiên đăng nhập (`auth_session`, `remember_device` nếu chọn ghi nhớ) và nhật ký đăng nhập trong `audit_log`.

**Xác nhận sạch (G6)** — truy vấn **chỉ đọc** bằng `siscom_migrator` (`sudo -u postgres psql -d siscom_crm_prod -c "SET ROLE siscom_migrator" …`, không đọc mật khẩu), chạy sau 6b và lưu đầu ra:

| Bảng | Kỳ vọng |
|---|---|
| `customer`, `contact`, `customer_assignment`, `opportunity`, `opportunity_change`, `opportunity_document`, `activity`, `activity_access`, `activity_transfer_request`, `privileged_change_request`, `password_reset_token` | **0** dòng |
| `employee`, `employee_credential`, `employee_role` | đúng 5 (của `bootstrap-auth`) |
| `role` | 5 |
| `lookup_item` | 73 (`seed-lookups`) |
| `audit_log` | chỉ hành động `auth.*` (`auth.bootstrap_user`, `auth.login_ok`, `auth.login_failed`, `auth.logout`, `auth.remember_*`) và dòng do hàm SQL khởi tạo / đóng khởi tạo ghi (nếu có); **không** có `customer.*`, `opportunity.*`, `activity.*`, `contact.*` |
| `app_meta` | có dấu đóng khởi tạo |

Có dòng ngoài kỳ vọng ⇒ NO-GO; không xoá tay — điều tra, rồi Owner quyết (thường là bỏ `siscom_crm_prod`, làm lại từ bước 2 theo mục 5.2).

## 6. Sau khi mở

- **Báo lỗi:** người dùng chụp màn hình + mô tả gửi kênh ở D7; Claude kiểm nhật ký (chỉ đọc), sửa qua PR có test, review, Owner duyệt merge và duyệt triển khai như #253 / #254.
- **Triển khai bản sửa:** chỉ giao diện / không migration như lần 19/11 (sao lưu tự động trước, so nội dung dữ liệu trước / sau). Có migration ⇒ quy trình như S12 cổng B.
- **Kiểm định kỳ:** chứng chỉ, sao lưu đêm, dung lượng đĩa — đề xuất một lịch kiểm hằng ngày, báo khi lỗi (cần Owner chọn kênh).

## 7. Thứ tự đề xuất

1. Owner trả lời D1–D7 (mục 2) — **xong 20/11/2026** (mục 2.1).
2. Song song: Owner làm P4 (khoá); bản ghi DNS (D3) **xong 20/11**. **P3: Owner chốt không làm** (20/11/2026, mục 2.1); không thay đổi cloud-init. P1 làm sau ngày mở (Owner chọn cách A).
3. Bước 0 **xong 20/11**; bước 1 → 8 (mục 5), mỗi bước Owner duyệt riêng; bước 8 chỉ khi bảng GO/NO-GO (mục 5.1) đủ.
