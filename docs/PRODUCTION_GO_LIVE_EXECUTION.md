# Biên bản thực thi đưa SISCOM CRM vào sử dụng thật

- **Kế hoạch:** `docs/PRODUCTION_GO_LIVE_PLAN.md` (PR #255, review R5 PASS trên `709926a`). Tài liệu này **không** sửa kế hoạch; chỉ ghi việc đã chạy thật, kết quả và điểm lệch so với kế hoạch.
- **Người chạy:** Claude (qua SSH bằng khoá, root), từng bước theo duyệt riêng của Owner trong chat ngày 20/11/2026. Reviewer chưa xem biên bản này.
- **Mã triển khai:** `main` = `2de465c` (kiểm lại trước bước 1 và bước 3).
- **Trạng thái (20/11/2026 17:40 giờ Việt Nam):** bước 0–4 xong; bước 7 xong phần sao lưu và bản sao ngoài VPS; **bước 5, 6b, phần khôi phục thử của bước 7 và bước 8 chưa làm** (chờ Owner). Hệ thống đang chạy trên `siscom_crm_prod`, **chưa có tài khoản nào**, chưa mở cho người dùng.
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
| 6a | — | 20/11 | Owner báo đã thử nghiệp vụ trên staging (trước bước 1) | Owner xác nhận; chưa có danh sách mã dữ liệu thử trong repo |
| 6b | — | — | **Chưa làm** (cần tài khoản) | Chờ bước 5 |
| 7 | "duyệt bước 7" | 17:34 | `systemctl start siscom-crm-backup.service`; kiểm chữ ký; chép 4 tệp của bộ về máy Owner; `ssh-keygen -Y verify` bằng `allowed_signers` Owner giữ ngoài VPS + so SHA-256 | Bộ `siscom_crm_prod_20261120_103421` (24 bảng, mã hoá) chữ ký hợp lệ; bản sao ngoài VPS đạt. **Khôi phục thử chưa làm** (cần Owner nạp khoá age) |
| 8 | — | — | **Chưa làm** | Chờ bảng GO/NO-GO đủ và Owner ghi GO |

## 2. Điểm lệch so với kế hoạch

1. **Ngày chạy.** Kế hoạch mục 2.2 ghi bước 1–7 vào thứ Bảy 21/11. Owner cho chạy bước 1–4 và phần đầu bước 7 ngay chiều thứ Sáu 20/11. Điều kiện "`main` vẫn là `2de465c`" đã kiểm trước bước 1 và bước 3. Thứ tự "bước 1 ngay trước bước 2" được giữ: CRM không đăng nhập được từ 15:59 (bước 1) tới khi có tài khoản.
2. **Thứ tự bước 7.** Kế hoạch đặt bước 7 sau bước 5 và 6b. Owner duyệt bước 7 khi chưa ngồi máy, nên bộ sao lưu đầu tiên chụp lúc `employee` = 0. Bộ này chứng minh sao lưu, mã hoá, ký và chép ra ngoài chạy được trên database thật; **đề nghị** sau bước 5 chạy lại sao lưu rồi mới khôi phục thử, để G7 dựa trên bộ có đủ 5 tài khoản.
3. **Sao lưu đêm.** Từ bước 2, timer 02:02 (giờ Việt Nam) sao lưu `siscom_crm_prod`; staging không còn được sao lưu hằng đêm (đúng mục 3 P5). Bộ staging cuối là `siscom_crm_staging_20261120_092749`.
4. **Hai lỗi đo của người chạy, không ảnh hưởng dữ liệu** (đã ghi chú ngay trong nhật ký):
   - Bước 3, kiểm trước: mã băm cấu trúc staging tính bằng lệnh gõ qua heredoc ra giá trị khác, do mất ký tự `\` trong bộ lọc dòng `\restrict` của `pg_dump` 18. Tính lại bằng kịch bản chạy từ tệp (hai lần): trùng giá trị sau bước 2.
   - Bước 4, kiểm sau: một truy vấn phụ đếm theo nhóm lỗi cú pháp (dấu nháy). Truy vấn chỉ đọc; số từng nhóm có trong đầu ra `seed-lookups`.
5. **Yêu cầu bị từ chối.** Owner đề nghị Claude tạo tài khoản thay ("Em tạo luôn cho anh đi"). Claude không làm: mật khẩu tài khoản thật do Owner tự gõ trên máy chủ (kế hoạch mục 3 P2, bước 5).
6. **Bằng chứng G5.** Kết quả bước 6a là lời xác nhận của Owner; danh sách mã dữ liệu thử và kết quả từng mục (cột "Bằng chứng" của G5) chưa có.

## 3. Bảng GO/NO-GO (kiểm chỉ đọc 20/11 17:20, `gonogo-truoc-buoc5-…log.txt`)

| # | Trạng thái | Ghi chú |
|---|---|---|
| G1 HTTPS | Đạt | Let's Encrypt, còn 89 ngày; cổng ngoài 80 / 443 / 26266 (quét từ máy Owner) |
| G2 Dịch vụ và database | Đạt | `PASS\|75` + `PASS\|33` lấy từ nhật ký bước 3 (không chạy lại `grants` vì lệnh có ghi quyền) |
| G3 Đăng nhập 5 tài khoản | Chưa | Sau bước 5 |
| G4 RBAC | Chưa | Sau bước 5 |
| G5 Nghiệp vụ trên staging | Owner báo xong | Thiếu danh sách bằng chứng (mục 2.6) |
| G6 Database thật sạch | Đạt tạm | 11 bảng nghiệp vụ = 0; `lookup_item` = 73; `audit_log` trống; `employee` = 0 (kỳ vọng 5 sau bước 5). Kiểm lại sau 6b bằng `golive-check.sh 5` |
| G7 Sao lưu | Một phần | Sao lưu có chữ ký + bản sao ngoài VPS: đạt. Khôi phục thử: chưa |
| G8 Rollback | Đạt | Bộ sao lưu staging cuối có chữ ký; staging trùng dấu vân tay; bản mã `src-20261119093630` và 4 tệp `.bak` còn |
| G9 Giao tài khoản | Chưa | Owner |
| G10 Kênh báo lỗi | Chưa | Owner |

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
| `step5-bootstrap-owner.sh` | Bước 5: Owner tự chạy (đã thử phần nhập bằng giá trị ngẫu nhiên; **chưa chạy thật**) | `d02b2afe4f2b5bbc` |
| `golive-check.sh` | Kiểm GO/NO-GO chỉ đọc: `0` trước bước 5, `5` sau bước 5 | `8e477b201c2dadc2` |
| `step7.sh` | Bước 7: `backup` / `owner-restore` (Owner, **chưa chạy**) / `status` / `drop` / `pull` / `verify-local` | `8cd37164797073c6` |

Các kịch bản này là công cụ một lần cho đợt go-live, chưa qua CI (ShellCheck chỉ quét `backend/scripts/linux`); chỉ gọi lại các script đã review (`create-db.sh`, `deploy.sh`, `backup-db.sh`, `restore-test.sh`, `run-cli.sh`, `check-tls.sh`).

## 6. NOT_VERIFIED

- Bước 5, 6b, khôi phục thử của bước 7, bước 8: chưa chạy.
- Đăng nhập thật trên `https://crm.siscom.io.vn`: chưa kiểm (chưa có tài khoản); mới kiểm preflight CORS trả đúng origin.
- Sao lưu đêm tự động đầu tiên trên `siscom_crm_prod` (02:02 ngày 21/11): chưa tới giờ.
- Tờ hướng dẫn nhân viên (ngoài repo) soạn từ mã nguồn giao diện, chưa đối chiếu trên màn hình thật.
