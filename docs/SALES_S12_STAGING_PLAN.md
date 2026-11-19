# Sales S12 — Kế hoạch đưa phân hệ Sales lên staging

- **Ngày lập:** 18/11/2026 · **Trạng thái:** KẾ HOẠCH, **chưa thực hiện bước nào**. Mỗi bước ghi ở mục 4 cần Owner phê duyệt riêng bằng văn bản.
- **Phạm vi:** cập nhật staging hiện có (`https://42.96.15.235`, DB `siscom_crm_staging`) từ bản trước Sales lên bản `main` sau khi #243–#250 đã merge. **Không** bao gồm production.
- **Tài liệu nền:** `docs/SALES_DESIGN.md` §9 (dòng S12), §10 (tiêu chí nghiệm thu); `docs/VPS_RUNBOOK.md` §4 (cập nhật), §5 (cách lùi), G6 (sao lưu / khôi phục thử); `docs/evidence/SALES_S8_S11_NGHIEM_THU_20261118.md`.
- **Cập nhật 19/11/2026:** Owner đã quyết cả bốn điểm mở (mục 8); máy chủ staging đã được khởi động lại theo quyết định đó (mục 1, dòng "Máy chủ"). #243 và #244 đã merge vào `main` (`eb20d5e`).
- Tài liệu này không chứa mật khẩu, khoá hay giá trị biến môi trường.

## 1. Hiện trạng staging (kiểm **chỉ đọc** ngày 18/11/2026, 09:33 UTC)

Cách kiểm: đăng nhập SSH bằng khoá, chỉ chạy lệnh đọc; không ghi, không khởi động lại dịch vụ, không đọc giá trị trong các file `.env`.

| Hạng mục | Hiện trạng | Nhận xét |
|---|---|---|
| Máy chủ | Ubuntu 24.04; đĩa dùng 18% (còn 32 GB); RAM 3 GB + swap 2 GB | Lúc kiểm 18/11 đang chờ khởi động lại. **Đã khởi động lại 19/11/2026 03:08 UTC** (Owner duyệt): gián đoạn khoảng 24 giây; mọi dịch vụ tự lên, không unit lỗi; khoá máy chủ SSH, cấu hình chỉ-khoá, tường lửa, swap giữ nguyên; số khách / liên hệ / nhân viên / migration không đổi (3 / 3 / 5 / 12); hết cờ chờ khởi động lại |
| Phần mềm | Node 24.22.3 · PostgreSQL 18.6 · Caddy 2.11.9 | Khớp môi trường CI |
| Dịch vụ | backend, Caddy, PostgreSQL, ufw, fail2ban, timer sao lưu: đều `active` | Đạt |
| Bản đang chạy | `releases/src-20261113083453` (main `0a87d23`, trước Sales); bản trước `src-20261112055437` | Đường lùi mã có sẵn |
| Tường lửa | ufw chỉ mở 26266 (SSH), 80, 443; backend chỉ nghe `127.0.0.1:3000`, PostgreSQL chỉ `127.0.0.1` | Đạt |
| SSH | Chỉ khoá; không cho mật khẩu; root `without-password` | Đạt |
| HTTPS | Chứng chỉ Let's Encrypt cho địa chỉ IP, hiệu lực lúc kiểm 18/11: 15/11 → 22/11/2026; **đã tự gia hạn lần hai** tối 18/11, nay 18/11 → **25/11/2026 11:02 UTC** (loại ngắn hạn ~6 ngày, Caddy tự gia hạn). HTTP tự chuyển sang HTTPS (308) | Kiểm lại hạn ngay trước ngày triển khai — xem R-5 |
| File cấu hình | `backend.env`, `migrate.env`, `db-roles.env`, `caddy.env`: quyền 600, chủ root. Dịch vụ dùng `DATABASE_URL` + `AUTH_DATABASE_URL`; `MIGRATE_DATABASE_URL` nằm riêng, không thuộc env của dịch vụ | Đúng thiết kế tách role |
| Database | `siscom_crm_staging`, chủ sở hữu `siscom_migrator`; 3 role `siscom_app` / `siscom_migrator` / `siscom_auth`, không role nào là superuser | Đã tách role |
| Schema | **12 migration**, mới nhất `20261105000100_b3_activity_tasks`; 0 migration lỗi. **Chưa có** bảng `opportunity`; **0** mã quyền `opportunity.*` | Đúng là bản trước Sales |
| Dữ liệu | 3 khách hàng, 3 liên hệ, 0 hoạt động, 5 nhân viên (5 tài khoản thử) | Mốc để so sau migration |
| Sao lưu | 9 bộ `.dump.age` (19/11: 10 bộ) (đã mã hoá), 0 bộ chưa mã hoá; bộ mới nhất 17/11 19:04 UTC; timer chạy hằng đêm, lần gần nhất `success` | Đạt |
| Khôi phục thử | **Không có** dấu `restore-ok` cho các bộ sao lưu hiện có | **Thiếu** — xem R-1 |

## 2. Điều kiện tiên quyết (phải đủ trước khi xin duyệt bước đầu tiên)

1. #243 → #250 đã merge vào `main` theo đúng thứ tự (tính đến trưa 19/11/2026: #243, #244, #245 đã merge; còn #246 → #250, trong đó #249 và #250 đang chờ review vòng 2), mỗi PR có kết luận review và mã duyệt của Owner; CI trên `main` đạt 6/6. Ghi lại SHA của `main` sẽ triển khai.
2. Một bộ sao lưu staging **mới** được khôi phục thử thành công (`restore-test.sh`: chữ ký manifest hợp lệ, số dòng từng bảng khớp). Việc này cần Owner đưa khoá riêng age lên VPS tạm thời rồi xoá ngay (quy trình G6).
3. Chứng chỉ HTTPS còn hạn ít nhất 48 giờ tại thời điểm triển khai.
4. Bản build frontend được tạo trên máy Windows bằng PowerShell từ đúng SHA ở mục 1 (VPS 3 GB không build giao diện; không build bằng Git Bash vì làm hỏng `/api/v1`).
5. Owner chỉ định hai người thực hiện bước cấp quyền (mục 4, bước 5): một tài khoản nhóm yêu cầu (vai trò `admin`) và một tài khoản duyệt (`crm_admin`), khác nhau, đang hoạt động.

## 3. Thứ tự kỹ thuật bắt buộc

`sao lưu` → `migration (bằng siscom_migrator)` → `cấp lại quyền DB từ APP_GRANTS_V5 hiện hành` → `VERIFY` → `seed danh mục` → `cấp mã quyền opportunity.*` → `kiểm API` → `nghiệm thu`.

Lý do: `APP_GRANTS_V5` đã được mở rộng tại chỗ cho bảng tài liệu cơ hội (review #246), nên phải cấp quyền **sau** khi bảng tồn tại. `deploy.sh --migrate` đã làm đúng chuỗi sao lưu → migrate → grants V5 → VERIFY; nếu sao lưu thất bại thì dừng trước khi đổi bất cứ thứ gì.

## 4. Các bước thực hiện

| # | Việc | Lệnh / công cụ | Tiêu chí đạt | Đường lùi | Cần Owner duyệt |
|---|---|---|---|---|---|
| 0 | Chốt SHA `main`, build frontend, đưa mã + `dist` lên VPS | `git archive`, `npm run build` (PowerShell), `scp` | SHA ghi vào biên bản; `dist` đúng cờ `VITE_CRM_AUTH_ENABLED`, `VITE_CRM_API_ENABLED`, `VITE_CRM_API_BASE=/api/v1` | Xoá thư mục tạm | Có (bắt đầu S12) |
| 1 | Ghi mốc dữ liệu | Truy vấn đếm (chỉ đọc) | Ghi số khách, liên hệ, hoạt động, nhân viên, số migration | — | Không (chỉ đọc) |
| 2 | Sao lưu + khôi phục thử | `backup-db.sh`; `restore-test.sh --identity <khoá riêng age>`; xoá khoá ngay | "Chữ ký manifest hợp lệ" + "PASS: n bảng khớp số dòng"; có tệp `restore-ok`; một bản sao nằm ngoài VPS | — | Có (Owner cầm khoá) |
| 3 | Chạy thử khô | `deploy.sh --src <dir> --frontend <dist> --migrate --dry-run` | Báo có migration đang chờ (4 migration Sales); không lỗi tiền kiểm | — | Không (không đổi gì) |
| 4 | Triển khai + migration + grants | `deploy.sh --src <dir> --frontend <dist> --migrate` | `migrate status` sạch, **16 migration**; VERIFY (app + auth) đạt; `/health` và `/health/database` đạt; **số khách / liên hệ / hoạt động / nhân viên bằng mốc bước 1** | Mã: `deploy.sh --rollback`. Schema: giữ nguyên (cộng thêm); gỡ cấu trúc chỉ theo mục 5 | **Có** — `OWNER_APPROVED_MIGRATION` ghi rõ `siscom_crm_staging` + phê duyệt deploy |
| 5 | Seed danh mục Sales | `run-cli.sh seed-lookups` | 4 giai đoạn, 3 loại, 9 lý do thua; chạy lại không tạo trùng | Ẩn mục (không xoá) | Có |
| 6 | Cấp 10 mã quyền `opportunity.*` (17 dòng) qua yêu cầu đặc quyền hai người | `SALES_S5_OPPORTUNITY_PERMISSIONS.sql.txt` (bằng `siscom_migrator`) | Script báo đủ 17 dòng; có nhật ký yêu cầu / duyệt / thực thi; vai trò `admin` **không** nhận mã nào | `SALES_S5_OPPORTUNITY_PERMISSIONS_REMOVE.sql.txt` | **Có** — thay đổi phân quyền, phải do Owner duyệt riêng |
| 7 | Kiểm nhanh sau triển khai | Đăng nhập 4 vai trò; kịch bản gọi API của đợt rà soát (đổi địa chỉ sang staging) | 4 vai trò đăng nhập được; mục "Cơ hội kinh doanh" hiện đúng theo quyền; không lỗi 5xx trong nhật ký | Bước 4 / 6 | Không |
| 8 | Nghiệm thu theo `SALES_DESIGN.md` §10 | Biên bản PASS / FAIL từng tiêu chí 1–16a | Gồm: iPhone thật (tiêu chí 14), hai người sửa cùng lúc (13), ma trận quyền (9), Kỹ thuật không thấy giá trị (10) | — | Owner tham gia nghiệm thu |

Thời gian gián đoạn dự kiến ở bước 4: vài giây (lần cập nhật 13/11 đo được khoảng 1,7 giây).

## 5. Phương án lùi

| Tình huống | Xử lý | Dữ liệu |
|---|---|---|
| Bản mới không khoẻ sau bước 4 | `deploy.sh --rollback` về `src-20261113083453`. Schema Sales **giữ nguyên**; mã cũ không dùng tới bảng / cột mới | Không mất |
| Migration hỏng giữa chừng | Dừng; không sửa tay DB. Khôi phục bản sao lưu của bước 2 vào DB **mới** rồi mới quyết định trỏ dịch vụ (cần Owner quyết riêng — runbook §5) | Không ghi đè DB đang chạy |
| Cần gỡ hẳn cấu trúc Sales | Chạy rollback SQL theo thứ tự S9 → S8 → S5 → S2. Mỗi script **tự từ chối** nếu còn dữ liệu Sales (cơ hội, việc tự sinh, tài liệu). Đã diễn tập trên PostgreSQL tạm với dữ liệu cũ: 20/20 bảng cũ giữ nguyên từng dòng | Chỉ khi chưa có dữ liệu Sales hoặc Owner chấp nhận xoá |
| Cần thu hồi quyền | Script gỡ quyền S5 (từng dòng, có nhật ký) | Không mất |
| Chứng chỉ lỗi | `systemctl stop caddy`; backend vẫn chỉ nghe nội bộ | Không đổi |

## 6. Rủi ro và việc cần Owner quyết

| Mã | Rủi ro / thiếu | Đề xuất |
|---|---|---|
| R-1 | Chưa có bằng chứng khôi phục thử cho các bộ sao lưu hiện có | Làm bước 2 trước mọi thay đổi; không có thì không chạy bước 4 |
| R-2 (**đã quyết**) | Staging chỉ có 5 tài khoản thử, **một** tài khoản Kinh doanh. Không thử được: chuyển người phụ trách trong cùng phòng, hai Kinh doanh không thấy cơ hội của nhau, hai người sửa cùng lúc. Công cụ thêm tài khoản (`account-admin`) hiện không chạy được trên VPS | Owner quyết: chấp nhận bằng chứng từ test tự động + kịch bản API cho các ca này, hoặc mở PR riêng để thêm được tài khoản trên VPS trước khi nghiệm thu |
| R-3 (**đã quyết**) | Cấp quyền `opportunity.*` là thay đổi phân quyền trên DB staging | Chỉ chạy bước 6 khi có phê duyệt riêng; hai người thực hiện do Owner chỉ định |
| R-4 (**đã xong**) | Máy chủ đang chờ khởi động lại | Owner quyết khởi động lại **trước** S12 (tách khỏi triển khai, kiểm dịch vụ tự lên, khoá máy chủ SSH giữ nguyên) hay để sau nghiệm thu |
| R-5 | Chứng chỉ theo IP chỉ có hạn ~6 ngày; chưa có cảnh báo tự động khi sắp hết hạn | Chạy `check-tls.sh` ngay trước bước 4; cân nhắc chuyển sang tên miền `crm-staging` (chứng chỉ 90 ngày) — cần Owner thêm bản ghi DNS |
| R-6 | Bản sao lưu ngoài VPS đang chép tay | Chép bản của bước 2 ra ngoài trước bước 4 |
| R-7 | `APP_GRANTS_V5` mở rộng tại chỗ; lần đầu chạy trên DB có dữ liệu thật | VERIFY là cổng bắt buộc của bước 4; thất bại ⇒ lùi mã, giữ schema |
| R-8 | Khách hàng không có người phụ trách thì không tạo được cơ hội (đúng thiết kế) | Dặn người dùng thử; kiểm 3 khách hiện có trên staging đã có người phụ trách chưa |
| R-9 | Sau khi có dữ liệu Sales trên staging, rollback SQL sẽ từ chối | Coi bước 4 là điểm không gỡ cấu trúc; đường lùi thực tế là lùi mã + giữ schema |

## 7. Phê duyệt cần có (tóm tắt)

1. Bắt đầu S12 và SHA `main` sẽ triển khai.
2. Bước 2: Owner cung cấp khoá riêng age tạm thời cho khôi phục thử.
3. Bước 4: `OWNER_APPROVED_MIGRATION` (ghi rõ `siscom_crm_staging`) + phê duyệt deploy.
4. Bước 5: seed danh mục.
5. Bước 6: cấp quyền `opportunity.*` + chỉ định hai người thực hiện.
6. Quyết định cho R-2 và R-4.

## 8. Quyết định của Owner (19/11/2026)

Owner duyệt cả bốn điểm mở theo phương án đề xuất:

| Điểm | Quyết định | Trạng thái |
|---|---|---|
| Khôi phục thử bản sao lưu (R-1) | Làm trước S12; không có kết quả đạt thì không chạy migration | **Chờ Owner thực hiện** theo hướng dẫn ở Phụ lục A; khoá riêng chỉ nằm trên VPS trong lúc kiểm và bị xoá ngay sau đó |
| Số tài khoản thử (R-2) | Chấp nhận bằng chứng từ test tự động và kịch bản gọi API cho các ca cần hai tài khoản Kinh doanh; nghiệm thu staging với 5 tài khoản hiện có | Đã chốt |
| Cấp mã quyền `opportunity.*` (R-3) | Duyệt. Người yêu cầu: tài khoản thử `sysadmin@` (NV-0001, vai trò `admin`); người duyệt: tài khoản thử `admin@` (NV-0002, vai trò `crm_admin`) | Chỉ chạy ở bước 6, sau khi bước 4 đạt |
| Khởi động lại máy chủ (R-4) | Làm ngay, tách khỏi S12 | **Đã xong 19/11/2026**, kiểm trước / sau đạt |

Các phê duyệt còn cần ở mục 7: (1) bắt đầu S12 + SHA `main`, (3) migration + deploy, (4) seed danh mục. Phê duyệt cấp quyền (5) đã có; vẫn chỉ thực hiện đúng thứ tự ở mục 3.

Không bước nào trong tài liệu này áp dụng cho production.

## Phụ lục A — Hướng dẫn khôi phục thử bản sao lưu staging (Owner thực hiện trước S12)

**Mục đích:** chứng minh bản sao lưu đêm của `siscom_crm_staging` giải mã được, đúng chữ ký, và khôi phục ra đủ số dòng — điều kiện bắt buộc trước khi chạy migration (bước 4).

**Nguyên tắc quản lý khoá đã chốt (runbook G6):**
- Khoá **riêng** age chỉ Owner giữ, ngoài VPS. Chỉ chép lên VPS **tạm thời** để kiểm, xong là xoá bằng `shred`.
- Không gửi khoá qua chat, email, hay dán vào bất kỳ công cụ nào khác. Không đưa khoá vào dòng lệnh (sẽ nằm trong lịch sử shell).
- Bước đưa khoá lên và xoá khoá do **Owner tự làm**. Claude chỉ kiểm kết quả ở chế độ chỉ đọc sau khi Owner báo đã xoá khoá.

**An toàn:** việc khôi phục tạo một database **mới** tên `siscom_crm_restore_<thời điểm>`; không ghi vào `siscom_crm_staging`, không dừng dịch vụ. Bản giải mã chỉ nằm trong thư mục tạm quyền 700 và tự xoá khi lệnh kết thúc. Đĩa còn trống khoảng 32 GB (kiểm 19/11).

### Các bước

Đăng nhập VPS bằng PuTTY (tài khoản root, cổng 26266, khoá của Owner), rồi làm lần lượt:

1. **Tạo bản sao lưu mới** (để kiểm đúng bản gần nhất):
   ```bash
   systemctl start siscom-crm-backup.service; systemctl show siscom-crm-backup.service -p Result
   ```
   Đạt khi in `Result=success`. Xem tên bản mới nhất: `ls -t /var/backups/siscom-crm/*.dump.age | head -1`.

2. **Đối chiếu khoá ký** với bản Owner giữ ngoài VPS:
   ```bash
   cat /etc/siscom-crm/backup-signing.allowed_signers
   ```
   Dòng in ra phải **trùng** dòng Owner đã cất. Khác ⇒ dừng, báo lại, không làm tiếp.

3. **Đưa khoá riêng lên tạm.** Cách khuyến nghị (không để lại trong lịch sử shell): gõ lệnh dưới, dán nội dung file khoá, nhấn Enter rồi `Ctrl-D`:
   ```bash
   umask 077; cat > /root/siscom-backup.key
   ```
   Hoặc chép file bằng WinSCP / `pscp` vào đúng đường dẫn `/root/siscom-backup.key` rồi chạy `chmod 600 /root/siscom-backup.key`.

4. **Chạy khôi phục thử:**
   ```bash
   cd /opt/siscom-crm/current/backend/scripts/linux && bash restore-test.sh --identity /root/siscom-backup.key
   ```
   Đạt khi có dòng `PASS: <n> bang khop so dong.` và dòng `Da ghi …restore-ok.txt`. Lệnh cũng in sẵn một dòng `DROP DATABASE "siscom_crm_restore_…"` để dọn ở bước 6.

5. **Xoá khoá ngay** (kể cả khi bước 4 không đạt):
   ```bash
   shred -u /root/siscom-backup.key; ls /root/siscom-backup.key
   ```
   Đạt khi `ls` báo không có tệp.

6. **Dọn database thử** bằng đúng lệnh mà bước 4 đã in (tên phải bắt đầu bằng `siscom_crm_restore_`):
   ```bash
   sudo -u postgres psql -c 'DROP DATABASE "siscom_crm_restore_<thời điểm>"'
   ```
   Nếu bước 4 **không đạt** thì giữ lại database thử để điều tra, chưa dọn.

7. **Chép bộ sao lưu vừa kiểm ra ngoài VPS** (tệp `.dump.age`, `.manifest`, `.manifest.sig`, `.sha256`) vào nơi Owner vẫn lưu.

8. **Báo Claude** "đã khôi phục thử, đã xoá khoá". Claude kiểm chỉ đọc: có tệp `restore-ok` của đúng bản sao lưu, không còn `/root/siscom-backup.key`, không còn database `siscom_crm_restore_*`, dịch vụ vẫn chạy; rồi ghi kết quả vào tài liệu này.

### Khi không đạt

| Thông báo | Ý nghĩa | Xử lý |
|---|---|---|
| `Giai ma that bai (sai khoa?)` | Khoá riêng không khớp khoá công khai trên VPS | Xoá khoá (bước 5), kiểm lại đúng tệp khoá; **không** chạy S12 |
| `chu ky manifest KHONG hop le` | Bản sao lưu hoặc manifest bị sửa, hoặc ký bằng khoá khác | Dừng; không dùng bản đó; báo để điều tra |
| `SHA-256 ban ro khac manifest da ky` | Tệp sao lưu hỏng | Dừng; tạo bản mới (bước 1) rồi thử lại |
| `KHONG DAT: so dong khac manifest` | Khôi phục ra thiếu / thừa dòng | Giữ database thử, báo để điều tra; **không** chạy S12 |

Chỉ khi bước 4 đạt và bước 5 xong thì điều kiện tiên quyết số 2 (mục 2) mới được coi là đủ.
