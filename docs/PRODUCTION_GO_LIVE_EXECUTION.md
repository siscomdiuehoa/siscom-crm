# Biên bản thực thi đưa SISCOM CRM vào sử dụng thật

- **Kế hoạch:** `docs/PRODUCTION_GO_LIVE_PLAN.md` (PR #255, review R5 PASS trên `709926a`). Tài liệu này **không** sửa kế hoạch; chỉ ghi việc đã chạy thật, kết quả và điểm lệch so với kế hoạch.
- **Người chạy:** Claude (qua SSH bằng khoá, root), từng bước theo duyệt riêng của Owner trong chat ngày 20/11/2026. Reviewer chưa xem biên bản này.
- **Mã triển khai:** `main` = `2de465c` (kiểm lại trước bước 1 và bước 3).
- **Trạng thái (20/11/2026 17:40 giờ Việt Nam):** bước 0–4 xong; bước 7 xong phần sao lưu và bản sao ngoài VPS; **bước 5, 6b, phần khôi phục thử của bước 7 và bước 8 chưa làm** (chờ Owner). Hệ thống đang chạy trên `siscom_crm_prod`, **chưa có tài khoản nào**, chưa mở cho người dùng.
- **KẾT LUẬN GO/NO-GO HIỆN TẠI: NO-GO — KHÔNG MỞ cho người dùng.** Còn thiếu G3, G4, G5, G7, G9, G10 (mục 3).
- **Sửa sau review R1 của PR #256 (20/11/2026):** kịch bản bước 5 (tệp nhật ký 600 từ đầu, lọc đầu ra theo danh sách cho phép, dò mật khẩu trong đầu ra); kịch bản bước 7 (chỉ huỷ hẹn giờ sau khi xác nhận khoá đã xoá; `pull` dừng khi thiếu tệp bắt buộc; điều kiện G7); bộ thử nhánh lỗi bằng dữ liệu giả; mốc giờ các lần duyệt (mục 1.1); bảng GO/NO-GO có dòng kết luận; đối chiếu bằng chứng G5 trên staging (mục 2.6).
- **Sửa sau review R2 của PR #256 (20/11/2026, mục 5.2):** `g5-api-flows.sh` không còn báo "đạt" khi Kỹ thuật không mở được cơ hội hoặc việc nhắc Tạm hoãn không chuyển `CANCELLED`, hoặc giá trị chốt / chứng từ khi Thắng không lưu đúng; `step7.sh pull` dừng khi lỗi SSH lúc kiểm dấu khôi phục thử, không xoá dấu đã lưu; `step7.sh backup` dừng khi không khởi chạy được sao lưu và chỉ nhận bộ của lần chạy này; `golive-check.sh` bắt buộc 4 tệp cấu hình để lùi cho G8; bộ thử nhóm REAL và `selftest-cleanup` chỉ dùng hẹn giờ thử tên riêng, không đụng hẹn giờ vận hành `siscom-key-cleanup`; mục 6 thống nhất với trạng thái G5.
- Tài liệu và bằng chứng không chứa mật khẩu, khoá hay tên người dùng thật.
- **Bằng chứng:** `docs/evidence/golive-20261120/thuc-thi/` — đầu ra lệnh từng bước (`*-pre`, `*-apply`, `*-post`) và các kịch bản đã dùng. Giờ trong nhật ký là UTC.

## 1. Các bước đã chạy

| Bước | Duyệt của Owner (nguyên văn) | Giờ VN | Việc đã làm | Kết quả |
|---|---|---|---|---|
| 0 | "Anh duyệt bước không?" (bước 0) | 20/11 11:15–12:41 | Xem ghi chú bước 0 của kế hoạch | Đạt (review R3 xác nhận) |
| 1 | "Làm lioon bây giừo được thì làm đi" | 15:59 | Sao lưu `caddy.env` + `siscom-tls.caddy` (`.bak-20261120085931`); ghi `SISCOM_HOST=crm.siscom.io.vn`; cài `tls-domain.caddy` của `2de465c`; `caddy validate`; `systemctl restart caddy`. **Không** chạy `provision.sh`, không cài gói | `check-tls.sh` "TLS OK"; Let's Encrypt, hết hạn 18/02/2027; `curl` không `-k` = 200; HTTP → 308; HSTS, `nosniff`; cổng ngoài 80 / 443 / 26266; dấu vân tay số dòng staging trước = sau |
| 2 | "Anh duyệt bước 2" + "OWNER_APPROVED_MIGRATION siscom_crm_prod" | 16:27 | `backup-db.sh` (staging, lần cuối) + kiểm chữ ký; `systemctl stop siscom-crm-backend`; sao lưu `backend.env` / `migrate.env` (`.bak-20261120092749`); `create-db.sh siscom_crm_prod create`; `SISCOM_HOST=crm.siscom.io.vn create-db.sh siscom_crm_prod env --force-env` | Bộ `siscom_crm_staging_20261120_092749` chữ ký + SHA-256 hợp lệ; `siscom_crm_prod`: `siscom_migrator\|true\|true\|false\|false,false,false`, 0 bảng; ba URL và origin trỏ `siscom_crm_prod` / `https://crm.siscom.io.vn`; staging trùng dấu vân tay (chủ sở hữu + ACL, `pg_dump -s`, số dòng) |
| 3 | "A duyệt bước 3" | 16:52 | `deploy.sh --src /root/s12-src-2de465c --frontend /root/s12-web-dist-2de465c --migrate --dry-run` (DB đích in ra `siscom_crm_prod`, rc = 0), rồi chạy thật | Bản `src-20261120095200`; 16 migration; `PASS\|75` + `PASS\|33`; `migrate status` "up to date"; `/health/database`: `migrated:true`, `leastPrivilege:true`, `authPool:"separate"`, `authLeastPrivilege:true`; cổng 3000 chỉ `127.0.0.1`; `previous` = `src-20261119093630`; staging không đổi |
| 4 | "Duyệt bước 4" | 17:03 | `run-cli.sh seed-lookups` hai lần | Lần 1: chèn 73; lần 2: chèn 0, đã có 73; staging không đổi |
| 5 | "OWNER_APPROVED_TASK" | — | **Chưa làm.** Đã đặt `/root/golive-step5/bootstrap-owner.sh` (Owner tự chạy bằng PuTTY, tự gõ 5 mật khẩu; từ chối khi không có màn hình; chỉ gọi `run-cli.sh bootstrap-auth`, `BOOTSTRAP_EMAIL_DOMAIN=siscom.vn`). Kiểm trước: `employee` = 0, chế độ khởi tạo đang mở | Chờ Owner |
| 6a | "Anh đã hoàn thành kiểm thử staging." | 20/11 15:52 (lời báo) | Owner báo đã thử nghiệp vụ trên staging | **Chưa có bằng chứng.** Đối chiếu chỉ đọc trên staging (mục 2.6): không có dữ liệu `THU-`, không có phiên làm việc nào ngày 20/11; thao tác có ghi nhận là của đợt nghiệm thu S12 ngày 19/11 |
| 6b | — | — | **Chưa làm** (cần tài khoản) | Chờ bước 5 |
| 7 | "duyệt bước 7" | 17:34 | `systemctl start siscom-crm-backup.service`; kiểm chữ ký; chép 4 tệp của bộ về máy Owner; `ssh-keygen -Y verify` bằng `allowed_signers` Owner giữ ngoài VPS + so SHA-256 | Bộ `siscom_crm_prod_20261120_103421` (24 bảng, mã hoá) chữ ký hợp lệ; bản sao ngoài VPS đạt. **Khôi phục thử chưa làm** (cần Owner nạp khoá age) |
| 8 | — | — | **Chưa làm** | Chờ bảng GO/NO-GO đủ và Owner ghi GO |

### 1.1 Mốc giờ các lần duyệt của Owner

Owner duyệt trong phiên chat với Claude, **ngoài repo**. Mốc giờ dưới đây lấy từ nhật ký phiên trên máy Owner (UTC; giờ Việt Nam = UTC + 7). Repo không tự chứng minh được các lời duyệt này; Owner có thể xác nhận bằng một comment trên PR hoặc khi duyệt merge.

| Bước | Lời của Owner | Mốc giờ (UTC) | Lệnh thay đổi đầu tiên của bước (UTC) |
|---|---|---|---|
| 0 | "Anh duyệt bước không?" | 20/11 04:14:24 | 04:15:40 (`provision.sh --dry-run`) |
| 1 (cách làm) | "chỉ đổi Caddy" | 20/11 04:21:55 | — |
| 1 (chạy sáng T7) | "Sáng thứ Bảy, em thực hiện bước 1 theo đúng kế hoạch đã duyệt" | 20/11 08:52:23 | — |
| 1 (chạy ngay) | "Làm lioon bây giừo được thì làm đi" | 20/11 08:58:01 | 08:59:31 |
| 2 | "Anh duyệt bước 2", rồi chọn "OWNER_APPROVED_MIGRATION siscom_crm_prod" | 20/11 09:24:22 và 09:24:58 | 09:27:49 |
| 3 | "A duyệt bước 3" | 20/11 09:48:43 | 09:52:00 |
| 4 | "Duyệt bước 4" | 20/11 10:02:19 | 10:03:48 |
| 5 | "OWNER_APPROVED_TASK" | 20/11 10:14:01 | chưa chạy |
| 7 | "duyệt bước 7" | 20/11 10:32:49 | 10:34:21 (sao lưu) |

Điều kiện ngày chạy của kế hoạch (mục 2.2: "`main` vẫn là `2de465c`, khác ⇒ dừng"): kiểm bằng `git fetch` + `git rev-parse origin/main` trước bước 1 và trước bước 3, đều ra `2de465c` (dòng đầu của `step1-…-pre` và `step3-…-pre`).

## 2. Điểm lệch so với kế hoạch

1. **Ngày chạy.** Kế hoạch mục 2.2 ghi bước 1–7 vào thứ Bảy 21/11. Owner cho chạy bước 1–4 và phần đầu bước 7 ngay chiều thứ Sáu 20/11. Điều kiện "`main` vẫn là `2de465c`" đã kiểm trước bước 1 và bước 3. Thứ tự "bước 1 ngay trước bước 2" được giữ: CRM không đăng nhập được từ 15:59 (bước 1) tới khi có tài khoản.
2. **Thứ tự bước 7.** Kế hoạch đặt bước 7 sau bước 5 và 6b. Owner duyệt bước 7 khi chưa ngồi máy, nên bộ sao lưu đầu tiên chụp lúc `employee` = 0. Bộ này chỉ là **bản sơ bộ**: chứng minh sao lưu, mã hoá, ký và chép ra ngoài chạy được trên database thật, **không dùng cho G7**. **Điều kiện G7 (bắt buộc):** sau bước 5 (đủ 5 tài khoản) chạy lại `step7.sh backup`; Owner khôi phục thử **chính bộ mới đó** (`restore-test.sh` so số dòng từng bảng với manifest đã ký); `step7.sh pull` chép về máy Owner và kiểm chữ ký + SHA-256; `verify-local` chỉ in "KET LUAN G7 … DAT" khi manifest có `employee` = 5 **và** dấu `.restore-ok.txt` mang đúng tên tệp và SHA-256 của bộ đó.
3. **Sao lưu đêm.** Từ bước 2, timer 02:02 (giờ Việt Nam) sao lưu `siscom_crm_prod`; staging không còn được sao lưu hằng đêm (đúng mục 3 P5). Bộ staging cuối là `siscom_crm_staging_20261120_092749`.
4. **Hai lỗi đo của người chạy, không ảnh hưởng dữ liệu** (đã ghi chú ngay trong nhật ký):
   - Bước 3, kiểm trước: mã băm cấu trúc staging tính bằng lệnh gõ qua heredoc ra giá trị khác, do mất ký tự `\` trong bộ lọc dòng `\restrict` của `pg_dump` 18. Tính lại bằng kịch bản chạy từ tệp (hai lần): trùng giá trị sau bước 2.
   - Bước 4, kiểm sau: một truy vấn phụ đếm theo nhóm lỗi cú pháp (dấu nháy). Truy vấn chỉ đọc; số từng nhóm có trong đầu ra `seed-lookups`.
5. **Yêu cầu bị từ chối.** Owner đề nghị Claude tạo tài khoản thay ("Em tạo luôn cho anh đi"). Claude không làm: mật khẩu tài khoản thật do Owner tự gõ trên máy chủ (kế hoạch mục 3 P2, bước 5).
6. **Bằng chứng G5 — chưa đủ.** Kết quả bước 6a mới là lời báo của Owner. Đối chiếu chỉ đọc trên `siscom_crm_staging` lúc 20/11 11:58 UTC (`g5-staging-doi-chieu-…txt`): **0** khách tên bắt đầu `THU-`; **không** có dòng `audit_log` nào ngày 20/11 (không đăng nhập, không thao tác); thao tác cuối cùng là 19/11 09:49 UTC. Các thao tác có ghi nhận (đợt nghiệm thu S12 ngày 19/11): tạo cơ hội (2), sửa, chuyển giai đoạn (2), Thua, Mở lại, Xoá. **Chưa có ghi nhận:** Thắng + việc bàn giao, Tạm hoãn / Tiếp tục, Kỹ thuật thấy việc được giao (`activity` = 0). Từ bước 2 staging không còn phục vụ, nên phần còn thiếu không thử lại trên staging được nếu không lùi cấu hình.

   **Bổ sung 20/11 (hướng (a) — môi trường thử cách ly, theo lời Owner "Làm tiếp đi em" sau khi Claude đề xuất hướng này):**
   - **Test tự động đã có:** CI của `main` @ `2de465c` (run https://github.com/siscomdiuehoa/siscom-crm/actions/runs/44496582470, job PostgreSQL tạm, 785/785 test đạt) có ba bộ `PASS`, không có `it.skip` / `it.only`: `opportunities.lifecycle.int-spec.ts` (25 test, gồm "Thắng từ Đang mở … tạo MỘT việc bàn giao", "Thắng từ Tạm hoãn", "Tiếp tục: ON_HOLD → OPEN, giữ giai đoạn; việc nhắc còn mở ⇒ CANCELLED"), `opportunities.activities.int-spec.ts` (21 test, gồm "Kỹ thuật ngoài phạm vi khách: chỉ thấy cơ hội khi có việc OPEN được giao … ĐÚNG bộ trường kỹ thuật"), `activities.tasks.int-spec.ts` (48 test, quyền theo việc của Kỹ thuật).
   - **Chạy thật trên môi trường thử cách ly** (máy Owner; PostgreSQL 18.6 tạm cổng 55873, dựng bằng chính `create-db.sh` / `migrate deploy` / `grants` / `seed-lookups` / `bootstrap-auth` của bản `2de465c`, tài khoản thử `@thu.local`; backend `2de465c` chạy `NODE_ENV=production`; giao diện build bằng PowerShell với cờ production; gọi qua đúng đường `/api/v1` của giao diện). Kịch bản `g5-api-flows.sh`, đầu ra `g5-api-flows-moi-truong-thu-20261120T132205Z.log.txt`: Kinh doanh tạo khách `KH-00005` + cơ hội `CH-0004` → Báo giá; **Tạm hoãn** ⇒ `ON_HOLD`, sinh việc nhắc `TT-000005` (OPEN); **Tiếp tục** ⇒ `OPEN`, giữ giai đoạn `QUOTATION`, việc nhắc ⇒ `CANCELLED`; **Thắng** (giá trị chốt, hợp đồng `THU-G5-HD-001`) ⇒ `WON`, sinh việc bàn giao `TT-000006` giao `NV-0004` (Kỹ thuật); **Kỹ thuật** đăng nhập thấy việc trong "Công việc của tôi", mở cơ hội được nhưng **không** có trường số tiền / chứng từ, hoàn thành việc ⇒ `DONE`. Kết quả: **3 nghiệp vụ đều đạt.**
   - **Chưa có:** Owner tự thử trên giao diện (màn hình, hộp thoại, số tiền có dấu chấm). Môi trường thử để sẵn ở `C:\Users\namph\siscom-thu-g5` (ngoài repo) với `BAT-THU.bat`, `TAT-THU.bat`, `HUONG-DAN-THU.txt`.
   - Ghi nhận phụ: trong lúc chạy, cơ chế giới hạn đăng nhập (`LOGIN_MAX_PER_IDENTIFIER` = 5 / 15 phút) đã chặn tài khoản thử `sale@thu.local` ở lần thứ 6 (HTTP 429) — đúng thiết kế.

## 3. Bảng GO/NO-GO (kiểm chỉ đọc 20/11 17:20, `gonogo-truoc-buoc5-…log.txt`)

| # | Trạng thái | Ghi chú |
|---|---|---|
| G1 HTTPS | Đạt | Let's Encrypt, còn 89 ngày; cổng ngoài 80 / 443 / 26266 (quét từ máy Owner) |
| G2 Dịch vụ và database | Đạt | `PASS\|75` + `PASS\|33` lấy từ nhật ký bước 3 (không chạy lại `grants` vì lệnh có ghi quyền) |
| G3 Đăng nhập 5 tài khoản | Chưa | Sau bước 5 |
| G4 RBAC | Chưa | Sau bước 5 |
| G5 Nghiệp vụ thiết yếu | **Đạt phần API · chờ Owner thử giao diện** | Mục 2.6: staging 19/11 (tạo / sửa / chuyển giai đoạn / Thua / Mở lại / Xoá) + môi trường thử cách ly 20/11 qua API (Thắng + việc bàn giao, Tạm hoãn / Tiếp tục, Kỹ thuật thấy việc, không thấy số tiền) + test tự động CI `2de465c`. Còn: Owner thử trên giao diện ở môi trường thử, hoặc Owner ghi rõ chấp nhận bằng chứng API thay cho thử giao diện |
| G6 Database thật sạch | **Tạm** (chưa kết luận) | 11 bảng nghiệp vụ = 0; `lookup_item` = 73; `audit_log` trống; `employee` = 0. Chỉ kết luận sau bước 6b, bằng `golive-check.sh 5` |
| G7 Sao lưu | **Chưa đạt** (một phần) | Bộ sơ bộ (`employee` = 0) có chữ ký + bản sao ngoài VPS qua kiểm. Chưa có bộ sau bước 5, chưa khôi phục thử (điều kiện ở mục 2.2) |
| G8 Rollback | Đạt phần **chuẩn bị** | Bộ sao lưu staging cuối có chữ ký; staging trùng dấu vân tay; bản mã `src-20261119093630` và 4 tệp `.bak` còn; lệnh lùi ghi sẵn (kế hoạch mục 5.2). **Chưa thử rollback thật trên VPS**; quy trình khôi phục chỉ mới diễn tập trên PostgreSQL tạm cách ly (#255) |
| G9 Giao tài khoản | Chưa | Owner |
| G10 Kênh báo lỗi | Chưa | Owner |
| **Kết luận** | **NO-GO** | Không mở cho người dùng. Chỉ Owner quyết GO khi cả 10 dòng đạt |

## 4. Trạng thái để lùi (giai đoạn trước khi mở, kế hoạch mục 5.2)

- Caddy: `/etc/siscom-crm/caddy.env.bak-20261120085931`, `/etc/caddy/siscom-tls.caddy.bak-20261120085931`.
- Cấu hình dịch vụ: `/etc/siscom-crm/backend.env.bak-20261120092749`, `migrate.env.bak-20261120092749` (trỏ `siscom_crm_staging`, origin IP).
- Bản mã staging: `releases/src-20261119093630` (`previous`).
- Database `siscom_crm_staging` còn nguyên; `siscom_crm_prod` chưa có dữ liệu thật.

## 5. Kịch bản đã dùng (trong thư mục bằng chứng)

| Tệp | Dùng cho | SHA-256 (16 ký tự đầu) |
|---|---|---|
| `step1-caddy.sh` | Bước 1: `pre` / `apply` / `post` / `rollback <STAMP>` | `b1a536811d9d3b9b` |
| `step2-db.sh` | Bước 2: `pre` / `apply` / `post`; hàm dấu vân tay staging dùng lại ở bước 3–5 | `00e21dec57add873` |
| `step5-bootstrap-owner.sh` | Bước 5: Owner tự chạy (**chưa chạy thật**). Bản sửa sau R1 | xem `SHA256SUMS.txt` |
| `golive-check.sh` | Kiểm GO/NO-GO chỉ đọc: `0` trước bước 5, `5` sau bước 5. Lần chạy 17:20 dùng bản `8e477b201c2dadc2`; bản hiện tại đổi 3 chỗ `ls \| grep` sang `find` theo ShellCheck và (sau R2 lần 3) bắt buộc 4 tệp cấu hình để lùi cho G8 | xem `SHA256SUMS.txt` |
| `step7.sh` | Bước 7: `backup` / `owner-restore` (Owner, **chưa chạy**) / `status` / `drop` / `pull` / `verify-local` / `selftest-cleanup`. Bản sửa sau R1; lần sao lưu 17:34 chạy bằng bản trước (`8cd37164797073c6`, phần `backup` không đổi logic) | xem `SHA256SUMS.txt` |
| `test-golive-scripts.sh` | Bộ thử nhánh lỗi bằng dữ liệu giả cho hai kịch bản trên | xem `SHA256SUMS.txt` |
| `g5-api-flows.sh` | G5: 3 nghiệp vụ còn thiếu, chạy trên môi trường thử cách ly (không chạm VPS) | xem `SHA256SUMS.txt` |

Các kịch bản này là công cụ một lần cho đợt go-live, nằm ngoài phạm vi ShellCheck của CI (chỉ quét `backend/scripts/linux`); chỉ gọi lại các script đã review (`create-db.sh`, `deploy.sh`, `backup-db.sh`, `restore-test.sh`, `run-cli.sh`, `check-tls.sh`).

### 5.1 Sửa sau review R1 của PR #256

| Điểm R1 | Đã sửa | Thử bằng dữ liệu giả (`test-golive-scripts.sh`) |
|---|---|---|
| HIGH-01 — `step5-bootstrap-owner.sh` | `umask 077` ở đầu; thư mục nhật ký 700; tệp nhật ký tạo rỗng + `chmod 600` **trước** khi gọi CLI. Đầu ra thô của CLI **không ghi đĩa, không in**: giữ trong bộ nhớ, dò xem có chứa 5 mật khẩu vừa gõ không (so trong shell, không qua tham số lệnh) — có ⇒ dừng mã 3, không in / không ghi gì của đầu ra đó; rồi lọc từng dòng theo **danh sách cho phép** (dòng chạy, dòng "Khoi tao xong … closed=true", 5 dòng tài khoản đúng mẫu, lỗi `BOOTSTRAP_CLOSED` / `BOOTSTRAP_INPUT` / thiếu biến, dòng `[OK]` / `[LOI]` của script không chứa `@`). Dòng lạ chỉ được đếm. Thành công chỉ khi mã 0 + có dòng đóng khởi tạo + đúng 5 tài khoản. Đã kiểm mã `bootstrap-auth.ts` / `bootstrap.ts` @ `2de465c`: CLI chỉ in tên DB, mã nhân viên, email, vai trò hoặc thông báo lỗi; không in mật khẩu hay biến môi trường — bộ lọc là lớp phòng thêm cho thông báo lỗi của thư viện | S5-1 nhập sai; S5-2 thành công + quyền 600 của tệp **ngay lúc CLI đang chạy** (Linux); S5-3 CLI giả lộ mật khẩu ⇒ mã 3, không lộ; S5-4 CLI giả in hash argon2 + URL có mật khẩu DB giả ⇒ bị lọc; S5-5 `BOOTSTRAP_CLOSED`; S5-6 từ chối CLI giả ngoài chế độ thử |
| HIGH-02 — `step7.sh` `cleanup` | Hàm `cleanup_key`: xoá khoá, **kiểm lại `[ -e "$KEY" ]`**; còn khoá ⇒ **không** `systemctl stop` hẹn giờ, in cảnh báo và lệnh xoá tay, trả về lỗi (script thoát mã 4). Chỉ huỷ hẹn giờ khi khoá đã mất. Phần dọn khoá sót của lần trước cũng theo thứ tự này (xoá trước, xác nhận, rồi mới đụng hẹn giờ cũ) | S7-1 xoá được ⇒ có `stop`; S7-2 `shred` + `rm` giả đều lỗi ⇒ khoá còn, **không** `stop`, mã 1; S7-3 từ chối đường dẫn khoá thật; S7-REAL (Linux root): hẹn giờ systemd thật + tệp `chattr +i` ⇒ hẹn giờ **vẫn còn**; gỡ `+i` ⇒ xoá được, hẹn giờ huỷ |
| MEDIUM-03 — G7 / `pull` | `pull`: 4 tệp bắt buộc (`.dump.age`, `.manifest`, `.manifest.sig`, `.sha256`) chép lỗi hoặc rỗng ⇒ dừng mã 1; dấu `.restore-ok.txt` là tuỳ chọn, hỏi VPS trước, chưa có thì ghi rõ "chưa khôi phục thử". `verify-local`: kiểm dấu thuộc đúng bộ (tên tệp + SHA-256), `employee` trong manifest, và in kết luận G7 | S7-4 (bộ sao lưu giả, khoá ký giả): `employee` = 0 / chưa có dấu / dấu của bộ khác / tệp bị sửa / manifest bị sửa; S7-5 (`ssh` / `scp` giả): thiếu `manifest.sig` ⇒ dừng; đủ 4 tệp chưa có dấu ⇒ G7 chưa đạt; có dấu đúng bộ ⇒ đạt |
| MEDIUM-04 — GO/NO-GO | Dòng kết luận **NO-GO** ở đầu tài liệu và cuối bảng mục 3; G6 ghi "Tạm"; G5 ghi "Chưa đạt" kèm đối chiếu staging; G8 tách "chuẩn bị" với "chưa thử rollback trên VPS" | — |
| LOW — chạy sớm một ngày | Mục 1.1: mốc giờ từng lời duyệt và lệnh đầu tiên của bước; điều kiện ngày chạy | — |

Kết quả chạy bộ thử và ShellCheck:

- **Linux (bằng chứng chính):** Ubuntu 24.04, root, systemd thật — **80 đạt, 0 không đạt**, gồm quyền 600 của tệp nhật ký ngay lúc CLI đang chạy và nhóm S7-REAL (hẹn giờ thật vẫn còn khi tệp `chattr +i` không xoá được; huỷ khi đã xoá). Máy GitHub dùng một lần, workflow tạm trên nhánh riêng `rehearsal/golive-scripts-r1-20261120` (Owner duyệt 20/11/2026; không merge, đã xoá nhánh): run https://github.com/siscomdiuehoa/siscom-crm/actions/runs/44732713218 ; `test-golive-scripts-linux-run44732713218.log.txt` (SHA-256 `c2b9605f0730728b9c1d2bfdc15a42486c0f03b702a319447d7921509720a7e9`). SHA-256 các kịch bản run in ra trùng `SHA256SUMS.txt`.
- **ShellCheck 0.9.0** (`-x -S warning -e SC1091`, như CI): `step5-bootstrap-owner.sh`, `step7.sh`, `golive-check.sh`, `test-golive-scripts.sh` — **không có cảnh báo**. `step1-caddy.sh` và `step2-db.sh` **đã chạy thật nên giữ nguyên làm bằng chứng**; ShellCheck ghi nhận 2 cảnh báo, không sửa: SC1090 (nạp `caddy.env` theo biến đường dẫn cố định) và SC2010 (`ls | grep` trên thư mục sao lưu, tên tệp do `backup-db.sh` sinh, chỉ chữ số và gạch dưới; dòng này chỉ in thông tin). `shellcheck-run44732713218.log.txt`.
- **Windows / Git Bash:** `test-golive-scripts-windows-…log.txt` — 69 đạt, 0 không đạt (bỏ qua phần quyền 600 và nhóm REAL).

Hai kịch bản sửa sau R1 đã chép lên VPS thay bản cũ (`/root/golive-step5/bootstrap-owner.sh`, `/root/golive-step7/step7.sh`, đối chiếu SHA-256 với `SHA256SUMS.txt` của vòng R1); **chưa chạy thật**.

### 5.2 Sửa sau review R2 của PR #256

| Điểm R2 | Đã sửa | Thử |
|---|---|---|
| HIGH — `g5-api-flows.sh` báo đạt sai | Kỹ thuật mở cơ hội theo việc được giao: mã khác 200 ⇒ **không đạt** ("KHONG mo duoc co hoi theo viec: HTTP …"); trước đây chỉ kiểm khi mã 200. Tạm hoãn: phải có **đúng 1** việc nhắc `HOLD_REMINDER` đang `OPEN`, ghi lại mã việc; Tiếp tục: **chính việc đó** phải `CANCELLED` và không còn việc nhắc `OPEN` — trước đây chỉ in ra. Trường bị ẩn với Kỹ thuật kiểm thêm `wonDocUrl`, `wonDocFileName`. Thêm `G5_ORIGIN` / `G5_ACCOUNTS` chỉ để bộ thử chạy với máy chủ giả | `test-golive-scripts.sh` nhóm G5 (máy chủ giả Node, dữ liệu giả): bình thường ⇒ mã 0 + "3 nghiep vu deu DAT"; Kỹ thuật bị 403 ⇒ mã 1, báo "KHONG mo duoc", **không** kết luận đạt; việc nhắc không huỷ ⇒ mã 1, báo "ky vong CANCELLED", **không** kết luận đạt |
| HIGH — nhóm REAL dừng / thay hẹn giờ vận hành | `step7.sh selftest-cleanup` **bắt buộc** `STEP7_TEST_TIMER` dạng `siscom-key-cleanup-test-…` (thiếu ⇒ mã 1, sai dạng hoặc dùng tên vận hành ⇒ mã 2, không xoá gì). Bộ thử đặt tên riêng mỗi lần chạy (`siscom-key-cleanup-test-<pid>-<giờ>`); nhóm REAL chỉ tạo / kiểm / dừng hẹn giờ thử đó, **bỏ qua cả nhóm** nếu máy đang có `/run/siscom-restore/backup.key` hoặc hẹn giờ `siscom-key-cleanup.timer` đang chờ, và cuối nhóm kiểm hẹn giờ vận hành vẫn **không** bị tạo. Chế độ vận hành `owner-restore` / `cleanup` của `step7.sh` không đổi | S7-1 kiểm `stop` gọi đúng tên hẹn giờ thử, **không** gọi `stop siscom-key-cleanup.timer`; S7-3b thiếu tên / dùng tên vận hành ⇒ từ chối, tệp khoá giả còn nguyên; S7-REAL như trên với tên riêng |
| MEDIUM — mục 6 mâu thuẫn mục 2.6 | Mục 6 ghi đúng: G5 đã có bằng chứng API trên môi trường thử cách ly, còn chờ Owner thử giao diện | — |
| HIGH (R2 lần 2) — `g5-api-flows.sh` Thắng chỉ kiểm `status` | Sau Thắng kiểm `status=WON` **và** `wonAmountVnd`, `wonDocType`, `wonDocNo`, `wonDocDate`, `wonDocUrl` đúng như đã gửi, trong phản hồi **và** khi Kinh doanh đọc lại cơ hội; sai ⇒ không đạt, in tên trường sai | G5-4: máy chủ giả trả `WON` nhưng lưu giá trị chốt `0` ⇒ mã 1, báo "Thang (doc lai) sai: wonAmountVnd=0", không kết luận đạt |
| HIGH (R2 lần 2) — `step7.sh pull`: lỗi SSH bị coi là "chưa có dấu" | Hỏi VPS bằng lệnh trả lời rõ `CO` / `KHONG`; mã SSH khác 0 hoặc câu trả lời khác ⇒ dừng mã 1 "khong kiem duoc dau khoi phuc thu tren VPS", **không** xoá dấu `.restore-ok.txt` đã có trên máy Owner, không chạy `verify-local` | S7-5: `ssh` giả trả 255 ở bước kiểm dấu, dấu cục bộ có sẵn ⇒ mã 1, đúng thông báo, dấu cục bộ giữ nguyên (so SHA-256 trước / sau) |
| HIGH (R2 lần 3) — `step7.sh backup`: `systemctl start … \|\| true` | Lỗi khởi chạy `siscom-crm-backup.service` ⇒ dừng mã 1, không dùng `Result` của lần trước. Ghi mốc UTC trước khi chạy; bộ lấy từ journal phải có tên ≥ mốc đó, không thì dừng "khong phai bo vua tao" | **Chưa thử** (cần root + systemd trên VPS); mới kiểm cú pháp. Thử ở lần chạy thật `backup` sau bước 5: kết quả phải in đúng bộ mới |
| HIGH (R2 lần 3) — `golive-check.sh` G8 chỉ in số tệp `.bak` | Kiểm riêng 4 tệp để lùi (`backend.env`, `migrate.env` `.bak-20261120092749`; `caddy.env`, `siscom-tls.caddy` `.bak-20261120085931`): thiếu / rỗng / không đọc được ⇒ **không đạt**, kết quả cuối không còn "moi muc kiem duoc deu DAT" | **Chưa thử** (cần root trên VPS); mới kiểm cú pháp. Lần chạy `golive-check.sh` chỉ đọc kế tiếp sẽ in 4 dòng này |

- **Chạy lại bản R2 trên môi trường thử cách ly** (20/11 14:56 UTC, cùng môi trường mục 2.6): `g5-api-flows-r2-moi-truong-thu-20261120T145608Z.log.txt` — `CH-0006`: Tạm hoãn sinh đúng 1 việc nhắc `TT-000009` (OPEN), Tiếp tục ⇒ chính `TT-000009` thành `CANCELLED`, không còn việc nhắc OPEN; Thắng ⇒ giá trị chốt và chứng từ đúng như đã gửi, cả phản hồi lẫn khi đọc lại; việc bàn giao `TT-000010` cho `NV-0004`; Kỹ thuật mở cơ hội theo việc HTTP 200 (`access=TASK`), không có trường số tiền / chứng từ, hoàn thành ⇒ `DONE`. **3 nghiệp vụ đều đạt**, mã thoát 0. Kèm theo: sửa `bat-thu.ps1` (ngoài repo) vì lệnh bật PostgreSQL tạm có thể treo.
- **Windows / Git Bash:** `test-golive-scripts-windows-r2-…log.txt` — **91 đạt, 0 không đạt** (gồm 4 ca G5 máy chủ giả, S7-3b và ca SSH lỗi của S7-5; bỏ qua quyền 600 và nhóm REAL).
- **Linux (bằng chứng chính cho bản R2):** Ubuntu 24.04, root, systemd thật — **103 đạt, 0 không đạt**. Gồm:
  - nhóm S7-REAL chỉ dùng hẹn giờ tên riêng `siscom-key-cleanup-test-<pid>-<giờ>`; cuối nhóm xác nhận hẹn giờ vận hành `siscom-key-cleanup` **không** bị tạo / động tới;
  - 4 ca G5 với máy chủ giả.

  Máy GitHub dùng một lần (Owner duyệt 20/11/2026), workflow tạm trên nhánh riêng `rehearsal/golive-scripts-r2-20261120`; không merge, đã xoá nhánh. Run https://github.com/siscomdiuehoa/siscom-crm/actions/runs/44771509479 ; nhật ký `test-golive-scripts-linux-r2-run44771509479.log.txt`. SHA-256 các kịch bản run in ra trùng `SHA256SUMS.txt`.
- **ShellCheck** (`-x -S warning -e SC1091`, như CI) cho `step5-bootstrap-owner.sh`, `step7.sh`, `golive-check.sh`, `test-golive-scripts.sh`, `g5-api-flows.sh`: **không có cảnh báo** (`shellcheck-r2-run44771509479.log.txt`).
- `step7.sh` trên VPS (`/root/golive-step7/step7.sh`) **đã thay bằng bản R2** ngày 20/11/2026 23:15 giờ Việt Nam, Owner duyệt:
  - SHA-256 sau khi chép `3d589fd4…` trùng `SHA256SUMS.txt`; quyền 700; `bash -n` đạt;
  - bản R1 (`3ff0498e…`) giữ ở `step7.sh.bak-r1-20261120`;
  - chưa chạy chế độ nào của bản mới trên VPS.

## 6. NOT_VERIFIED

- Bước 5, 6b, khôi phục thử của bước 7, bước 8: chưa chạy. `step5-bootstrap-owner.sh` và chế độ `owner-restore` của `step7.sh` mới thử bằng dữ liệu giả, chưa chạy với mật khẩu / khoá thật.
- G5: **đã có** bằng chứng qua API trên môi trường thử cách ly cho Thắng + việc bàn giao, Tạm hoãn / Tiếp tục, việc giao cho Kỹ thuật (mục 2.6); **chưa** có lần Owner thử trên giao diện (hoặc lời Owner chấp nhận bằng chứng API thay thế).
- Sửa R2 lần 3 (`step7.sh backup`, `golive-check.sh` G8): chưa thử trên VPS, mới kiểm cú pháp (mục 5.2).
- Rollback thật trên VPS: chưa thử.
- Đăng nhập thật trên `https://crm.siscom.io.vn`: chưa kiểm (chưa có tài khoản); mới kiểm preflight CORS trả đúng origin.
- Sao lưu đêm tự động đầu tiên trên `siscom_crm_prod` (02:02 ngày 21/11): chưa tới giờ.
- Tờ hướng dẫn nhân viên (ngoài repo) soạn từ mã nguồn giao diện, chưa đối chiếu trên màn hình thật.
