# Sales S12 — Kế hoạch đưa phân hệ Sales lên staging

- **Ngày lập:** 18/11/2026 · **Trạng thái:** KẾ HOẠCH, **chưa thực hiện bước nào**. Mỗi bước ghi ở mục 4 cần Owner phê duyệt riêng bằng văn bản.
- **Phạm vi:** cập nhật staging hiện có (`https://42.96.15.235`, DB `siscom_crm_staging`) từ bản trước Sales lên bản `main` sau khi #243–#250 đã merge. **Không** bao gồm production.
- **Tài liệu nền:** `docs/SALES_DESIGN.md` §9 (dòng S12), §10 (tiêu chí nghiệm thu); `docs/VPS_RUNBOOK.md` §4 (cập nhật), §5 (cách lùi), G6 (sao lưu / khôi phục thử); `docs/evidence/SALES_S8_S11_NGHIEM_THU_20261118.md`.
- **Cập nhật 19/11/2026:** Owner đã quyết cả bốn điểm mở (mục 8); máy chủ staging đã được khởi động lại theo quyết định đó (mục 1, dòng "Máy chủ").
- **Trạng thái mã (kiểm 19/11/2026, 06:00 UTC):** **cả 8 PR #243–#250 đã merge**; `main` = `0e709b9`, CI 6/6 (run 44466202529). Chi tiết và liên kết: `docs/evidence/SALES_S8_S11_NGHIEM_THU_20261118.md` mục 0 và 0.5. (Dòng kiểm trước, 04:47 UTC: `main` = `d5035da`, #249 và #250 chưa merge.)
- **Sửa theo review R1 của #251 (19/11/2026):** mục 2 (điều kiện tiên quyết), mục 5 (phương án lùi — PR251-R1-02), Phụ lục A (PR251-R1-03, PR251-R1-04).
- **Sau review R2 của #251 (PASS trên `f8df110`, 3 góp ý nhỏ — 19/11/2026):** cập nhật trạng thái mã; thêm dẫn chiếu từ runbook G6; diễn tập lệnh hẹn giờ / dọn tệp bằng tệp giả và **đổi lệnh hẹn giờ ở Phụ lục A bước 3** theo kết quả diễn tập.
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
| Khôi phục thử | Lúc kiểm 18/11: **không có** dấu `restore-ok` nào. **19/11/2026 06:49 UTC: đã có** cho bộ `siscom_crm_staging_20261119_063952` (mục 9) | Đạt — R-1 đã đóng |

## 2. Điều kiện tiên quyết (phải đủ trước khi xin duyệt bước đầu tiên)

1. #243 → #250 đã merge vào `main` theo đúng thứ tự, mỗi PR có kết luận review và mã duyệt của Owner; CI trên `main` đạt 6/6. Ghi lại SHA của `main` sẽ triển khai. **Tình trạng 19/11/2026, 06:00 UTC: ĐÃ ĐỦ** — cả 8 PR đã merge; `main` = `0e709b9`, CI 6/6 (run 44466202529). SHA triển khai chốt ở bước 0 (nếu `main` có thêm commit trước ngày triển khai thì ghi lại SHA và run CI mới).
2. Một bộ sao lưu staging **mới** được khôi phục thử thành công (`restore-test.sh`: chữ ký manifest hợp lệ, số dòng từng bảng khớp). Việc này cần Owner đưa khoá riêng age lên VPS tạm thời rồi xoá ngay (quy trình G6).
3. Chứng chỉ HTTPS còn hạn ít nhất 48 giờ tại thời điểm triển khai.
4. Bản build frontend được tạo trên máy Windows bằng PowerShell từ đúng SHA ở mục 1 (VPS 3 GB không build giao diện; không build bằng Git Bash vì làm hỏng `/api/v1`).
5. Owner chỉ định hai người thực hiện bước cấp quyền (mục 4, **bước 6**): một tài khoản nhóm yêu cầu (vai trò `admin`) và một tài khoản duyệt (`crm_admin`), khác nhau, đang hoạt động. **Tình trạng: ĐÃ ĐỦ** (mục 8).

Tình trạng các điều kiện còn lại (19/11/2026, 07:00 UTC): điều kiện 2 **ĐÃ ĐỦ** — khôi phục thử đạt trên bộ `siscom_crm_staging_20261119_063952` và bản sao ngoài VPS đã qua xác thực (mục 9); điều kiện 3: chứng chỉ hiện có hạn tới 25/11/2026 11:02 UTC, phải kiểm lại ngay trước bước 4; điều kiện 4 làm ở bước 0.

## 3. Thứ tự kỹ thuật bắt buộc

`sao lưu` → `migration (bằng siscom_migrator)` → `cấp lại quyền DB từ APP_GRANTS_V5 hiện hành` → `VERIFY` → `seed danh mục` → `cấp mã quyền opportunity.*` → `kiểm API` → `nghiệm thu`.

Lý do: `APP_GRANTS_V5` đã được mở rộng tại chỗ cho bảng tài liệu cơ hội (review #246), nên phải cấp quyền **sau** khi bảng tồn tại. `deploy.sh --migrate` đã làm đúng chuỗi sao lưu → migrate → grants V5 → VERIFY; nếu sao lưu thất bại thì dừng trước khi đổi bất cứ thứ gì.

## 4. Các bước thực hiện

| # | Việc | Lệnh / công cụ | Tiêu chí đạt | Đường lùi | Cần Owner duyệt |
|---|---|---|---|---|---|
| 0 | Chốt SHA `main`, build frontend, đưa mã + `dist` lên VPS | `git archive`, `npm run build` (PowerShell), `scp` | SHA ghi vào biên bản; `dist` đúng cờ `VITE_CRM_AUTH_ENABLED`, `VITE_CRM_API_ENABLED`, `VITE_CRM_API_BASE=/api/v1` | Xoá thư mục tạm | Có (bắt đầu S12) |
| 1 | Ghi mốc dữ liệu | Truy vấn đếm (chỉ đọc) | Ghi số khách, liên hệ, hoạt động, nhân viên, số migration | — | Không (chỉ đọc) |
| 2 | Sao lưu + khôi phục thử (đúng trình tự Phụ lục A) | `backup-db.sh`; `restore-test.sh --db siscom_crm_staging --dump <đúng tệp vừa sao lưu> --identity <khoá riêng age>`; xoá khoá ngay | "Chữ ký manifest hợp lệ" + "PASS: n bảng khớp số dòng"; có tệp `restore-ok`; một bản sao nằm ngoài VPS | — | Có (Owner cầm khoá) |
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
| Cần ẩn tính năng Sales với người dùng mà không lùi mã | Thu hồi 10 mã quyền `opportunity.*` bằng `SALES_S5_OPPORTUNITY_PERMISSIONS_REMOVE.sql.txt` (chạy bằng `siscom_migrator`, qua yêu cầu đặc quyền **hai người** khác nhau, có nhật ký từng dòng). Đây là thay đổi phân quyền ⇒ cần Owner duyệt riêng như bước 6 | Không mất; bảng và dữ liệu Sales giữ nguyên |
| Chứng chỉ lỗi | `systemctl stop caddy`; backend vẫn chỉ nghe nội bộ | Không đổi |
| Cần gỡ hẳn cấu trúc Sales | **Không có đường thực hiện trên `siscom_crm_staging` trong kế hoạch này** — xem 5.1 | — |

**Đường lùi vận hành mặc định của S12 là: lùi mã (`deploy.sh --rollback`) và giữ nguyên schema.** Schema Sales chỉ cộng thêm (bảng / cột mới); bản mã trước Sales không đọc tới chúng. Nếu cần, thu hồi thêm mã quyền như dòng trên. Kế hoạch này không dựa vào việc gỡ cấu trúc để lùi.

### 5.1 Gỡ hẳn cấu trúc Sales — chỉ là diễn tập trên bản sao thử

**Nơi được phép chạy.** Bốn script gỡ cấu trúc (`SALES_S9_DOCUMENT_ROLLBACK`, `SALES_S8_AUTO_KIND_ROLLBACK`, `SALES_S5_PERM_CLASS_ROLLBACK`, `SALES_S2_ROLLBACK`, đều ở `backend/docs/*.sql.txt`) tự kiểm tên database và **chỉ chạy** trên bản sao thử có tên dạng `siscom_crm_restore_<8 số>_<6 số>` hoặc `siscom_crm_test_<8 số>_<6 số>` (trừ hai bản baseline đã khoá). Chúng **từ chối** `siscom_crm_staging`, `siscom_crm_dev` và production. Vì vậy:

- Trên staging, kế hoạch này **không** có bước gỡ cấu trúc. Nếu sau này thật sự cần gỡ trên staging thì phải có một quy trình riêng, được soạn, review và Owner phê duyệt riêng; tài liệu này không cấp phép và không mô tả việc đó.
- Không sửa, không bỏ, không vòng qua các điều kiện kiểm (guard) trong script — kể cả khi Owner đồng ý mất dữ liệu. Sự đồng ý của Owner **không** phải là điều kiện đủ để chạy: script không tự xoá dữ liệu và vẫn kiểm tên database.

**Thứ tự đầy đủ khi diễn tập trên một bản sao hợp lệ** (ví dụ database do `restore-test.sh` tạo ra từ một bản sao lưu chụp sau S12):

| Thứ tự | Việc | Script | Dừng khi |
|---|---|---|---|
| 1 | Gỡ bảng tài liệu cơ hội (S9b) | `SALES_S9_DOCUMENT_ROLLBACK.sql.txt` | Còn dòng `opportunity_document` (kể cả đã xoá mềm), hoặc còn cơ hội có tệp chứng từ thắng |
| 2 | Gỡ cột việc tự sinh (S8b) | `SALES_S8_AUTO_KIND_ROLLBACK.sql.txt` | Còn hoạt động là việc tự sinh của cơ hội |
| 3 | **Thu hồi 10 mã quyền `opportunity.*`** (17 dòng) qua **hai người** | `SALES_S5_OPPORTUNITY_PERMISSIONS_REMOVE.sql.txt` với `-v s5_sysadmin=<uuid> -v s5_approver=<uuid>` | Người yêu cầu trùng người duyệt; thiếu / sai uuid; 10 mã này đang được cấp **ngoài** ma trận S5 (phải xử lý tay trước); không chạy bằng chủ sở hữu |
| 4 | Trả phân loại quyền về bản trước Sales (S5) | `SALES_S5_PERM_CLASS_ROLLBACK.sql.txt` | **Còn bất kỳ mã `opportunity.*` nào** trong bảng quyền — tức chưa làm xong bước 3 |
| 5 | Gỡ bảng cơ hội (S2) | `SALES_S2_ROLLBACK.sql.txt` | Còn dòng cơ hội (kể cả đã xoá mềm), còn lịch sử thay đổi, còn hoạt động gắn cơ hội, hoặc còn bảng tài liệu (chưa làm bước 1) |

Bước 3 là **tiền đề bắt buộc** của bước 4 một khi mã quyền đã được cấp (sau S12 bước 6): bỏ qua thì chuỗi dừng ở bước 4 dù database chưa có cơ hội nào. Nếu bản sao được chụp **trước** bước 6 (chưa cấp quyền) thì bước 3 không có gì để gỡ.

**Điều kiện dừng, gom theo nhóm:**

- **Tên database:** không khớp mẫu bản sao thử, hoặc là baseline đã khoá ⇒ script từ chối. Dừng; không đổi tên database đang chạy để "cho khớp".
- **Dữ liệu:** còn bất kỳ dữ liệu Sales nào nêu ở cột "Dừng khi" ⇒ script từ chối và **không tự xoá**. Trên bản sao thử: xuất CSV rồi xử lý theo hướng dẫn in ra trong script. Trên dữ liệu cần giữ: dừng hẳn — đây chính là lý do đường lùi mặc định là giữ schema (R-9).
- **Quyền:** còn mã `opportunity.*`, hoặc mã được cấp ngoài ma trận S5 ⇒ dừng ở bước 3 / 4; xử lý phân quyền trước, qua hai người.
- **Trạng thái migration:** migration tương ứng chưa áp ⇒ script báo không có gì để lùi.

**Đã diễn tập đến đâu:** chuỗi S9 → S8 → S5 → S2 đã chạy trên PostgreSQL tạm với dữ liệu cũ (20/20 bảng cũ giữ nguyên từng dòng) nhưng trên database **chưa cấp** mã quyền, nên **chưa** gồm bước 3. CI có bài kiểm rằng script S5 từ chối khi còn mã `opportunity.*`. Chuỗi 5 bước đầy đủ trên bản sao có cấp quyền **chưa được diễn tập**; nếu Owner muốn có bằng chứng này trước S12 thì cần giao việc riêng (chạy trên PostgreSQL tạm, không đụng staging).

## 6. Rủi ro và việc cần Owner quyết

| Mã | Rủi ro / thiếu | Đề xuất |
|---|---|---|
| R-1 (**đã đóng 19/11**) | Chưa có bằng chứng khôi phục thử cho các bộ sao lưu hiện có | Bộ R đã khôi phục thử đạt và có bản sao ngoài VPS đã xác thực (mục 9). Điểm khôi phục chính của bước 4 là bộ M chụp ngay trước migration; vai trò, giới hạn từng bộ và cách xác nhận dữ liệu ở mục 9.1–9.2 |
| R-2 (**đã quyết**) | Staging chỉ có 5 tài khoản thử, **một** tài khoản Kinh doanh. Không thử được: chuyển người phụ trách trong cùng phòng, hai Kinh doanh không thấy cơ hội của nhau, hai người sửa cùng lúc. Công cụ thêm tài khoản (`account-admin`) hiện không chạy được trên VPS | Owner quyết: chấp nhận bằng chứng từ test tự động + kịch bản API cho các ca này, hoặc mở PR riêng để thêm được tài khoản trên VPS trước khi nghiệm thu |
| R-3 (**đã quyết**) | Cấp quyền `opportunity.*` là thay đổi phân quyền trên DB staging | Chỉ chạy bước 6 khi có phê duyệt riêng; hai người thực hiện do Owner chỉ định |
| R-4 (**đã xong**) | Máy chủ đang chờ khởi động lại | Owner quyết khởi động lại **trước** S12 (tách khỏi triển khai, kiểm dịch vụ tự lên, khoá máy chủ SSH giữ nguyên) hay để sau nghiệm thu |
| R-5 | Chứng chỉ theo IP chỉ có hạn ~6 ngày; chưa có cảnh báo tự động khi sắp hết hạn | Chạy `check-tls.sh` ngay trước bước 4; cân nhắc chuyển sang tên miền `crm-staging` (chứng chỉ 90 ngày) — cần Owner thêm bản ghi DNS |
| R-6 | Bản sao lưu ngoài VPS đang chép tay | Chép bản của bước 2 ra ngoài trước bước 4 |
| R-7 | `APP_GRANTS_V5` mở rộng tại chỗ; lần đầu chạy trên DB có dữ liệu thật | VERIFY là cổng bắt buộc của bước 4; thất bại ⇒ lùi mã, giữ schema |
| R-8 | Khách hàng không có người phụ trách thì không tạo được cơ hội (đúng thiết kế) | Dặn người dùng thử; kiểm 3 khách hiện có trên staging đã có người phụ trách chưa |
| R-9 | Rollback SQL gỡ cấu trúc không chạy được trên `siscom_crm_staging` (kiểm tên database), và trên bản sao thử cũng từ chối khi còn dữ liệu Sales hoặc còn mã quyền `opportunity.*` | Coi bước 4 là điểm không gỡ cấu trúc; đường lùi thực tế là lùi mã + giữ schema (mục 5). Gỡ cấu trúc chỉ là diễn tập trên bản sao thử (mục 5.1) |

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
| Khôi phục thử bản sao lưu (R-1) | Làm trước S12; không có kết quả đạt thì không chạy migration | **Đã xong 19/11/2026 — ĐẠT** (mục 9). Owner tự đưa khoá lên và tự xoá; Claude kiểm chỉ đọc sau đó |
| Số tài khoản thử (R-2) | Chấp nhận bằng chứng từ test tự động và kịch bản gọi API cho các ca cần hai tài khoản Kinh doanh; nghiệm thu staging với 5 tài khoản hiện có | Đã chốt |
| Cấp mã quyền `opportunity.*` (R-3) | Duyệt. Người yêu cầu: tài khoản thử `sysadmin@` (NV-0001, vai trò `admin`); người duyệt: tài khoản thử `admin@` (NV-0002, vai trò `crm_admin`) | Chỉ chạy ở bước 6, sau khi bước 4 đạt |
| Khởi động lại máy chủ (R-4) | Làm ngay, tách khỏi S12 | **Đã xong 19/11/2026**, kiểm trước / sau đạt |

Các phê duyệt còn cần ở mục 7: (1) bắt đầu S12 + SHA `main`, (3) migration + deploy, (4) seed danh mục. Phê duyệt cấp quyền (5) đã có; vẫn chỉ thực hiện đúng thứ tự ở mục 3.

Không bước nào trong tài liệu này áp dụng cho production.

## 9. Kết quả khôi phục thử (19/11/2026) — điều kiện tiên quyết số 2

**ĐẠT.** Owner thực hiện trên VPS bằng phiên đăng nhập và khoá của Owner, theo Phụ lục A, có Claude hướng dẫn từng bước qua ảnh chụp màn hình; Claude không cầm, không nhìn thấy khoá riêng age.

| Hạng mục | Kết quả | Nguồn |
|---|---|---|
| Bộ sao lưu được kiểm | `siscom_crm_staging_20261119_063952` (tạo 06:39 UTC bằng `siscom-crm-backup.service`, `Result=success`; 227.935 byte, 414 mục, đã mã hoá) | Màn hình của Owner |
| Khoá ký trên VPS so với bản Owner cất ngoài VPS (13/11) | Trùng (so SHA-256 của hai tệp `allowed_signers`) | Claude so, chỉ đọc |
| `restore-test.sh --db siscom_crm_staging --dump <đúng bộ> --identity …` | `Chu ky manifest hop le` → tạo `siscom_crm_restore_20261119_064915` → `pg_restore hoan tat` → **`PASS: 21 bang khop so dong`**; `schema_baseline=b1.1`, 12 migration; ghi `…063952.dump.age.restore-ok.txt` lúc 06:49:19 UTC | Màn hình của Owner + tệp `restore-ok` (Claude đọc) |
| Xoá khoá | `shred -u` + huỷ hẹn giờ ngay sau khi chạy xong. Kiểm chỉ đọc lúc 06:55 UTC: `/run/siscom-restore/` rỗng, không có tệp `*.key` ở `/root`, 0 hẹn giờ `siscom-key-cleanup`, 0 unit lỗi, không có chuỗi khoá trong lịch sử shell | Claude kiểm, chỉ đọc |
| Dọn database thử | `DROP DATABASE "siscom_crm_restore_20261119_064915"` — không còn database `siscom_crm_restore_*`; không sót thư mục tạm | Màn hình + Claude kiểm |
| Staging sau khi kiểm | Dịch vụ backend / Caddy / PostgreSQL `active`; dữ liệu không đổi: 3 khách / 3 liên hệ / 5 nhân viên / 12 migration | Claude kiểm, chỉ đọc |
| Bản sao ngoài VPS | Owner chép đủ 5 tệp của bộ (bằng `pscp`) về máy Owner | Màn hình của Owner |
| Xác thực bản sao ngoài VPS | `ssh-keygen -Y verify` với bản `allowed_signers` Owner giữ: **`Good "siscom-crm-backup" signature`** (khoá `SHA256:/WphGVEJpF1b5MwmYnKqatrTLxDuCsa9xLbhyDnso7Q`). SHA-256 của tệp `.dump.age` = `file_sha256` trong manifest đã ký = `sha256_file` trong `restore-ok` = `8dc29a32…07f6442b`. Cả 5 tệp trùng SHA-256 với bản trên VPS | Claude chạy trên máy Owner |

**Sai khác so với hướng dẫn và sự cố, ghi lại cho đủ:**

1. **Lần chạy bước 4 đầu tiên không đạt:** nội dung khoá bị dán lặp 6 lần (tệp 1.130 byte thay vì 189), các lần dán dính liền nhau làm hỏng dòng khoá ⇒ `age: malformed secret key`, `Giai ma that bai`. Script dừng trước khi tạo database thử. Owner chạy bước 5 (xoá tệp, huỷ hẹn giờ), hẹn giờ lại, dán lại **một lần** (kiểm: 1 dòng khoá, 189 byte), chạy lại ⇒ đạt. Claude đã nhận định sai rằng tệp có khoá lặp là vô hại — nhận định đó không đúng với trường hợp các bản dán không có dấu xuống dòng ở cuối.
2. **Lệnh đưa khoá lên** được thêm `stty -echo … stty echo` để nội dung khoá không hiện trên màn hình khi dán (Owner đang gửi ảnh chụp màn hình). Thay đổi này chưa qua review ở #251; nay đã đưa vào Phụ lục A bước 3 cùng bước kiểm số dòng / số byte trước khi chạy.
3. **Bước 2** (đối chiếu khoá ký) và **bước 7** (xác thực trên máy Owner) do Claude chạy bằng `ssh-keygen` / `sha256sum` trong Git Bash, không phải hai lệnh `cmd` / PowerShell ghi trong Phụ lục A. Hai lệnh đó vì vậy **vẫn chưa được chạy thử**.
4. Khoá riêng age có mặt trên VPS (tmpfs `/run`) hai lần, tổng cộng vài phút (lần 1 khoảng 06:45–06:46, lần 2 khoảng 06:48–06:50 UTC). Giới hạn về "đã xoá" nêu ở Phụ lục A vẫn áp dụng.
5. Khoá ký trên VPS và bản Owner giữ được so bằng mã băm do Claude tính, không phải Owner tự so bằng mắt.

**Hiệu lực:** kết quả này chứng minh đúng một điều — bộ `…20261119_063952` khôi phục được và chứa dữ liệu staging **tại 06:39:52 UTC ngày 19/11/2026**. Nó **không** chứng minh bộ này chứa những gì thay đổi sau thời điểm đó. Bản trước của mục này (và R-1, điều kiện dừng ở mục 10) từng suy ra "số đếm không đổi nên dữ liệu vẫn khớp bản sao lưu" — suy luận đó **sai và đã bị gỡ** (PR252-R1-01): sửa số điện thoại, người phụ trách, mật khẩu, vai trò, hoặc xoá một dòng rồi thêm một dòng đều giữ nguyên mọi số đếm.

### 9.1 Hai bộ sao lưu của S12 và giới hạn phục hồi của từng bộ

| | **Bộ R** — đã khôi phục thử | **Bộ M** — sao lưu ngay trước migration |
|---|---|---|
| Tên / thời điểm | `siscom_crm_staging_20261119_063952`, chụp 06:39:52 UTC 19/11/2026 | Do `deploy.sh --migrate` tự tạo ở bước 4, ngay trước `prisma migrate deploy`; tên theo giờ chạy. **Chưa tồn tại** |
| Chứa gì | Dữ liệu tới 06:39:52 UTC | Dữ liệu tới thời điểm chụp, vài giây trước migration — tức **mọi cập nhật sau mốc R cũng nằm trong M** |
| Đã chứng minh | Chữ ký manifest hợp lệ; giải mã được bằng khoá của Owner; `pg_restore` ra đủ 21 bảng, khớp số dòng với manifest; bản sao ngoài VPS trùng từng byte và qua xác thực chữ ký | Sẽ có: script tự kiểm chữ ký manifest và SHA-256 của tệp ngay khi tạo (deploy dừng nếu sao lưu không đạt); sau bước 4 chép ra ngoài VPS và xác thực chữ ký + SHA-256 bằng `allowed_signers` Owner giữ (không cần khoá riêng) |
| **Chưa** chứng minh | Không chứng minh được nội dung của các thay đổi sau 06:39:52 | **Chưa được khôi phục thử.** Giải mã và `pg_restore` của chính bộ này chưa từng chạy. Căn cứ gián tiếp: cùng script, cùng khoá công khai, cùng định dạng với bộ R vừa khôi phục đạt |
| Dùng khi nào | Chỉ khi bộ M không khôi phục được | **Điểm khôi phục chính** nếu bước 4 hỏng và phải khôi phục dữ liệu |
| Mất gì nếu phải dùng | **Mọi cập nhật trên staging từ 06:39:52 UTC tới lúc chụp M.** Mức này được ước lượng ở 9.2 — hiện tại: không nhận diện được cập nhật nào | Các thao tác ghi xảy ra trong vài giây giữa lúc chụp M và lúc migration (script không chặn ghi; bản cũ vẫn chạy trong khoảng đó) |
| Cần khoá riêng age của Owner | Chỉ khi khôi phục thật | Chỉ khi khôi phục thật, hoặc khi Owner muốn khôi phục thử bộ M |

Khôi phục thật — từ bộ nào cũng vậy — là một việc riêng, cần Owner quyết và cầm khoá (mục 5, dòng "Migration hỏng giữa chừng"); S12 không tự khôi phục.

**Có cần Owner đưa khoá lên lần nữa trước bước 4 không? — Không.** Lý do: (a) điểm khôi phục chính của bước 4 là bộ M, chứa đủ mọi thay đổi tới sát migration, nên không cần một bộ "đã khôi phục thử" mới hơn để tránh mất cập nhật; (b) khả năng khôi phục của quy trình (script + khoá + định dạng) vừa được chứng minh bằng bộ R; (c) theo 9.2, không có cập nhật nào nhận diện được giữa R và hiện tại, nên ngay cả khi phải lùi về R thì mức mất dự kiến là không. Khoá chỉ cần khi **thật sự** phải khôi phục. Tuỳ chọn, không chặn S12: sau nghiệm thu, Owner có thể khôi phục thử bộ M (hoặc bộ sao lưu đêm kế tiếp) theo Phụ lục A để có một điểm đã kiểm sau S12.

**Điều cần Owner xác nhận khi duyệt cổng B** (mức mất cập nhật chấp nhận được): nếu bộ M không khôi phục được và phải dùng bộ R, staging mất mọi cập nhật sau 06:39:52 UTC ngày 19/11/2026. Staging chỉ có dữ liệu thử (3 khách thử, 5 tài khoản thử).

### 9.2 Cách xác nhận dữ liệu — căn cứ thay cho "số đếm bằng nhau"

Kiểm **chỉ đọc** trên `siscom_crm_staging` lúc 07:21–07:22 UTC ngày 19/11/2026 (mốc A). Kết quả chỉ gồm tên bảng, số dòng, thời điểm và mã băm gộp — không có giá trị dữ liệu. Tệp: `docs/evidence/s12-20261119/`.

**(a) Thay đổi nhận diện được sau mốc R** — `thay-doi-sau-moc-R-va-bo-dem-ghi.txt`:

- 18 / 21 bảng có cột thời gian. Ở cả 18 bảng: **0 dòng** có bất kỳ cột thời gian nào sau 06:39:52 UTC.
- Dấu thời gian mới nhất trong toàn bộ database là **13/11/2026 08:35:53 UTC** (`audit_log`, `employee_credential`). Mọi cột thời gian của `auth_session` — gồm cả lần dùng phiên gần nhất và hạn hết phiên — đều không muộn hơn 12/11/2026 22:33:46 UTC. Tức không có dấu vết đăng nhập hay dùng ứng dụng staging nào từ 13/11 tới mốc A.
- 3 bảng không có cột thời gian (`permission`, `role`, `role_permission`): bộ đếm ghi của PostgreSQL (chưa từng reset) cho thấy **0 lần sửa, 0 lần xoá**, và số lần thêm bằng đúng số dòng hiện có (27 / 5 / 49) — chưa từng bị sửa từ khi tạo.
- Số dòng của cả 21 bảng tại mốc A bằng số dòng ghi trong manifest đã ký của bộ R. (Chỉ là kiểm phụ; tự nó không chứng minh gì — xem trên.)

**Giới hạn của (a):** một lệnh sửa trực tiếp bằng SQL không đụng tới cột thời gian nào, trên một bảng có cột thời gian, sẽ không bị cách này phát hiện. Ứng dụng luôn cập nhật `updated_at` / ghi `audit_log` khi ghi, và cần phiên đăng nhập (`last_used_at`); đường còn lại là người có quyền quản trị database sửa tay — chỉ Owner và Claude có quyền đó, và Claude không chạy lệnh ghi nào vào database này. Đây là lập luận, không phải bằng chứng tuyệt đối.

**(b) Dấu vân tay nội dung** — `dau-van-tay.sql.txt` (bộ truy vấn, danh sách cột cố định theo schema trước Sales) và `dau-van-tay-moc-A.txt` (kết quả mốc A): với mỗi bảng, md5 gộp của md5 từng dòng trên toàn bộ cột. Dùng để so **nội dung**, không phải số đếm:

| So sánh | Khi nào chạy | Chứng minh gì | Xử lý khi khác |
|---|---|---|---|
| Mốc A ↔ mốc B0 | Ngay trước bước 4 | Nội dung cả 21 bảng không đổi từ 07:21 UTC tới sát migration | **Dừng**, báo Owner bảng nào khác; không chạy bước 4 cho tới khi Owner quyết (thay đổi đó sẽ nằm trong bộ M nhưng không nằm trong bộ R) |
| Mốc B0 ↔ sau bước 4 | Ngay sau migration | Migration không làm đổi dữ liệu cũ: 20 bảng phải trùng từng dòng trên các cột cũ; riêng `_prisma_migrations` phải thêm đúng 4 dòng | Dừng, không chạy bước 5; đánh giá lùi mã / khôi phục cùng Owner |
| Bộ đếm ghi mốc A ↔ mốc B0 | Ngay trước bước 4 | Không có lệnh ghi nào vào 21 bảng trong khoảng đó (bắt cả trường hợp sửa rồi sửa lại) | Như dòng đầu |

**Giới hạn của (b):** không có dấu vân tay của chính bộ R (database khôi phục thử đã được dọn trước khi cần tới), nên (b) nối từ mốc A trở đi; khoảng 06:39:52 → 07:21 dựa vào (a). Muốn có dấu vân tay trực tiếp của bộ R thì phải khôi phục lại bộ R (cần khoá) — không làm, vì bộ M mới là điểm khôi phục chính. Mã băm của các bảng chứa thông tin xác thực (`employee_credential`, `auth_session`…) là md5 gộp của cả bảng, không suy ngược ra giá trị từng dòng.

**Số đếm** vẫn được dùng, nhưng chỉ như phép kiểm nhanh sau migration; không còn là căn cứ cho kết luận "dữ liệu không đổi".

## 10. Kế hoạch thực hiện S12 — TRÌNH OWNER DUYỆT (chưa thực hiện bước nào)

Mục này không thay các mục 3–5; nó chốt **ai làm, làm khi nào, cần phê duyệt gì, dừng khi nào** cho một lần thực hiện.

**Bản mã triển khai:** `main` tại thời điểm Owner duyệt bắt đầu, với điều kiện CI trên `main` 6/6. Hiện tại `main` = `9bc30b1` (CI 6/6 — run 44470687640); phần mã chạy được của `9bc30b1` trùng `0e709b9` (bản đã qua review và thử giao diện), chỉ khác tài liệu. SHA cuối cùng ghi vào biên bản ở bước 0.

**Người thực hiện:** Claude chạy lệnh trên VPS bằng khoá SSH riêng của Claude, **chỉ sau từng phê duyệt của Owner**; Owner theo dõi và tham gia nghiệm thu. Không ai dùng khoá riêng age trong S12.

**Thời điểm:** làm trong một buổi, khoảng 45–60 phút, gián đoạn dịch vụ dự kiến vài giây ở bước 4. Chứng chỉ HTTPS hiện có hạn tới 25/11/2026 11:02 UTC ⇒ bước 4 phải chạy khi chứng chỉ còn ít nhất 48 giờ (trước 23/11 11:02 UTC, hoặc sau khi Caddy đã tự gia hạn).

| Cổng duyệt | Câu Owner ghi | Mở ra các bước (mục 4) | Thay đổi gì trên staging |
|---|---|---|---|
| **A** | "Duyệt bắt đầu S12 tại SHA `<sha>`" | 0 (build frontend trên Windows, chép mã + `dist` lên thư mục tạm của VPS), 1 (đếm mốc dữ liệu), 3 (chạy thử khô) | Chỉ thêm tệp vào thư mục tạm; không đổi database, không đổi bản đang chạy |
| **B** | "`OWNER_APPROVED_MIGRATION` cho `siscom_crm_staging` + duyệt deploy SHA `<sha>`", kèm xác nhận mức mất cập nhật ở mục 9.1 và đồng ý cho chép bộ M ra máy Owner | 4 (`deploy.sh --migrate`: sao lưu → 4 migration Sales → grants V5 → VERIFY → đổi bản chạy) | **Đổi schema và bản chạy.** Điểm không gỡ cấu trúc (R-9) |
| **C** | "Duyệt seed danh mục Sales" | 5 (`seed-lookups`) | Thêm 4 giai đoạn, 3 loại, 9 lý do thua |
| (đã có) | Quyết định R-3 ngày 19/11/2026 | 6 (cấp 10 mã quyền `opportunity.*` qua `sysadmin@` yêu cầu, `admin@` duyệt) | Đổi phân quyền. Claude báo Owner ngay trước khi chạy; Owner có thể dừng |
| — | Owner tham gia | 7 (kiểm nhanh), 8 (nghiệm thu §10, gồm iPhone thật) | Tạo dữ liệu thử Sales trên staging |

Bước 2 của mục 4 (sao lưu + khôi phục thử) **đã xong** — mục 9.

**Sau mỗi cổng, Claude báo kết quả thật rồi mới xin cổng kế.** Tiêu chí đạt của từng bước giữ nguyên như mục 4.

**Dừng ngay và báo Owner, không tự xử lý, khi:**

- Bước 1 và ngay trước bước 4: dấu vân tay nội dung hoặc bộ đếm ghi khác mốc A (mục 9.2 b) ⇒ dừng, báo Owner bảng nào đổi. Không tự kết luận "không đổi" từ số đếm. Không tự yêu cầu Owner đưa khoá lên lại; việc có cần khôi phục thử thêm hay không do Owner quyết sau khi xem thay đổi.
- Bước 3: chạy thử khô báo lỗi tiền kiểm, hoặc số migration đang chờ khác 4.
- Trước bước 4: `check-tls.sh` cho thấy chứng chỉ còn dưới 48 giờ; hoặc CI trên SHA triển khai không phải 6/6.
- Bước 4: sao lưu tự động thất bại (script tự dừng trước khi đổi gì); migration lỗi giữa chừng (không sửa tay — mục 5, dòng 2); VERIFY không đạt hoặc `/health` không đạt ⇒ `deploy.sh --rollback`, giữ schema; dấu vân tay nội dung của 20 bảng cũ sau migration khác mốc B0, hoặc `_prisma_migrations` không thêm đúng 4 dòng (mục 9.2 b).
- Sau bước 4: bộ M chép ra ngoài VPS không qua được xác thực chữ ký / SHA-256 ⇒ báo Owner ngay; không chạy bước 5 cho tới khi Owner quyết (khi đó điểm khôi phục đã kiểm chỉ còn bộ R).
- Bước 5: đếm danh mục khác 4 / 3 / 9.
- Bước 6: script báo khác 17 dòng, hoặc vai trò `admin` nhận được mã quyền.
- Bước 7: có lỗi 5xx trong nhật ký, hoặc một vai trò thấy mục "Cơ hội kinh doanh" sai với ma trận quyền.

**Đường lùi:** như mục 5 — lùi mã về `src-20261113083453`, giữ schema; cần ẩn tính năng thì thu hồi mã quyền (cần Owner duyệt riêng). Điểm khôi phục dữ liệu: **bộ M** (sao lưu ngay trước migration — điểm chính, chưa khôi phục thử) rồi mới tới **bộ R** (`…20261119_063952`, đã khôi phục thử, mất cập nhật sau 06:39:52 UTC) — vai trò và giới hạn từng bộ ở mục 9.1.

**Trình tự của cổng B** (thay cho việc chỉ chạy một lệnh):

1. Kiểm lại: CI của SHA triển khai 6/6; `check-tls.sh` còn ≥ 48 giờ; không ai đang dùng staging (Owner báo; Claude đối chiếu `auth_session.last_used_at`).
2. Lấy mốc B0: chạy lại bộ truy vấn dấu vân tay và bộ đếm ghi; so với mốc A. Khác ⇒ dừng.
3. `deploy.sh --src … --frontend … --migrate` (bước 4 của mục 4). Ghi tên bộ M từ dòng `Da sao luu:`.
4. Chạy lại dấu vân tay trên 20 bảng cũ + đếm `_prisma_migrations`; so với mốc B0.
5. Chép 4 tệp của bộ M ra máy Owner (Claude tải bằng khoá SSH của Claude — cần Owner đồng ý trong câu duyệt cổng B), xác thực chữ ký + SHA-256.
6. Báo Owner kết quả cả 5 việc, rồi mới xin cổng C.

### 10.1 Kết quả cổng A (19/11/2026, Owner ghi "Duyệt cổng A"; SHA `9bc30b1`)

| Bước | Kết quả |
|---|---|
| 0 | Mã: `git archive 9bc30b1 backend` (16 migration, không có tệp `.env` / khoá / dump). Giao diện: build bằng PowerShell từ cây mã trùng `9bc30b1`, cờ `VITE_CRM_AUTH_ENABLED` / `VITE_CRM_API_ENABLED` bật, `VITE_CRM_API_BASE=/api/v1`; dùng lại `node_modules` đã cài, không `npm ci` lại. Hai gói đã ở `/root/s12-src-9bc30b1` và `/root/s12-web-dist-9bc30b1`; SHA-256 trên VPS khớp bản trên máy dev (`2b978216…`, `ee462a2b…`) |
| 1 | 07:16 UTC: 3 khách / 3 liên hệ / 0 hoạt động / 5 nhân viên / 12 migration, 0 migration lỗi; chưa có bảng `opportunity`, 0 mã `opportunity.*`. 1 trong 3 khách chưa có người phụ trách (R-8). Mốc nội dung A lấy lúc 07:21 UTC (mục 9.2) |
| 3 | `deploy.sh … --migrate --dry-run`: rc = 0, in đủ chuỗi bước, bản mới sẽ nằm cạnh `src-20261113083453`. Dry-run **không** tự đếm migration chờ; so riêng (chỉ đọc): đúng 4 migration Sales chưa áp, không có migration lạ trong database. `check-tls.sh`: đạt, hạn 25/11/2026 11:02 UTC |

Sau cổng A staging **không đổi**: bản đang chạy, số migration, số bộ sao lưu, dịch vụ đều như trước. Cổng B khi đó chưa được duyệt; kết quả cổng B ở mục 10.2.

### 10.2 Kết quả cổng B (19/11/2026; Owner ghi `OWNER_APPROVED_MIGRATION` cho `siscom_crm_staging`, SHA `9bc30b1`)

Owner xác nhận khi duyệt: chấp nhận bộ M chưa khôi phục thử và không bảo đảm cửa sổ mất dữ liệu chỉ vài giây; nếu phải dùng bộ R thì mất cập nhật sau 13:39:52 ngày 19/11/2026 giờ Việt Nam (06:39:52 UTC); cho phép chép bộ M đã mã hoá về máy Owner và xác thực.

| Việc | Kết quả | Bằng chứng |
|---|---|---|
| 1. Tiền kiểm (07:38 UTC) | `main` = `9bc30b1`, CI 6/6 (run 44470687640); `check-tls.sh` đạt, chứng chỉ còn 6 ngày; hai gói ở thư mục tạm đúng SHA-256; 0 phiên đăng nhập còn hiệu lực; 0 kết nối ứng dụng đang mở tới database; 0 unit lỗi | Lệnh chỉ đọc |
| 2. Mốc B0 (07:37 UTC) | Dấu vân tay nội dung **21 / 21 bảng trùng mốc A**; bộ đếm ghi 21 / 21 bảng trùng mốc A ⇒ không có lệnh ghi nào từ 07:21 tới sát migration | `dau-van-tay-moc-B0.txt`, `bo-dem-ghi-moc-B0.txt` |
| 3. `deploy.sh --src … --frontend … --migrate` | 07:38:43 → 07:39:46 UTC, `DEPLOY_RC=0`. `npm ci` + build + kiểm argon2 / Prisma đạt → **bộ M = `siscom_crm_staging_20261119_073931`** (chụp 07:39:31; manifest đã ký, tự kiểm đạt) → `prisma migrate deploy` áp đúng 4 migration Sales lúc 07:39:39 → `APP_GRANTS_V5` → VERIFY app `PASS|75`, VERIFY auth `PASS|33` → đổi `current` sang `src-20261119073843` → sức khoẻ đạt (`database up, migrated:true`) | `buoc-4-deploy-log.txt` (đã che chuỗi kết nối; bỏ dòng `npm warn`) |
| 4. So nội dung sau migration | **20 / 21 bảng trùng từng dòng** với mốc B0 trên các cột trước Sales. Bảng còn lại là `_prisma_migrations`: 12 → 16 dòng, 12 dòng cũ có mã băm trùng mốc B0 (`c47ea98c…`), 4 dòng mới là 4 migration Sales, 0 migration lỗi / dở. Có thêm 3 bảng `opportunity`, `opportunity_change`, `opportunity_document` (0 dòng). Vẫn 0 mã quyền `opportunity.*`. Đếm nhanh 3 / 3 / 0 / 5 | `dau-van-tay-sau-buoc-4.txt` |
| 5. Bộ M ra ngoài VPS | 4 tệp chép về máy Owner; `ssh-keygen -Y verify` bằng `allowed_signers` Owner giữ: `Good "siscom-crm-backup" signature`; SHA-256 tệp `.dump.age` = `file_sha256` trong manifest đã ký (`a2513057…f943fc09b`); 4 tệp trùng SHA-256 với VPS; số dòng từng bảng trong manifest M trùng manifest R | Claude chạy trên máy Owner |
| Sau triển khai | `https://42.96.15.235/` 200, phục vụ gói giao diện mới (`index-DKeOgGTW.js`); `/api/v1/health` 200; `/api/v1/opportunities` khi chưa đăng nhập 401 (đường dẫn mới đã có, vẫn đòi đăng nhập); 0 unit lỗi; nhật ký backend sau 07:39 không có dòng cảnh báo / lỗi nào ngoài các yêu cầu 401 do chính các phép kiểm chưa đăng nhập này tạo; không có phiên đăng nhập nào được dùng trong lúc chạy | Lệnh chỉ đọc |

**Khoảng không được sao lưu che:** bộ M chụp 07:39:31, migration áp 07:39:39 — 8 giây. Trong khoảng đó không có phiên đăng nhập nào hoạt động và dấu vân tay 20 bảng cũ sau migration trùng mốc B0, nên không có thao tác ghi nào rơi vào khoảng này.

**Chưa làm / chưa kiểm ở cổng B:** bộ M **chưa được khôi phục thử** (đúng như Owner đã chấp nhận); chưa đăng nhập thử bằng tài khoản nào trên bản mới (thuộc bước 7); mục "Cơ hội kinh doanh" chưa hiện với ai vì chưa cấp mã quyền (bước 6) và chưa seed danh mục (bước 5, cổng C). Lệnh theo dõi nhật ký của Claude bị treo sau khi deploy đã xong (lỗi của lệnh theo dõi, không phải của deploy) nên kết quả được đọc trễ khoảng 9 phút; tiến trình theo dõi đã được dừng.

**Đường lùi hiện có:** `deploy.sh --rollback` về `src-20261113083453` (ghi trong `/opt/siscom-crm/previous`), giữ schema. Điểm khôi phục: bộ M (chính), bộ R (dự phòng) — mục 9.1.

Cổng C khi đó chưa được duyệt; kết quả ở mục 10.3.

### 10.3 Kết quả cổng C và bước 6 (19/11/2026)

**Cổng C — seed danh mục** (Owner: "Anh duyệt cổng C: seed danh mục Sales trên siscom_crm_staging bằng bản đang chạy 9bc30b1"). Bản đang chạy: `src-20261119073843`. Bằng chứng: `docs/evidence/s12-20261119/buoc-5-seed-danh-muc.txt`.

| Kiểm | Kết quả |
|---|---|
| `run-cli.sh seed-lookups` lần 1 (07:54:55 UTC) | rc = 0: "tổng 73, chèn mới 16, đã có 57" |
| Danh mục Sales | 4 giai đoạn (Tiếp cận, Khảo sát, Báo giá, Đàm phán), 3 loại cơ hội, 9 lý do thua — **tất cả đang hoạt động**; không có mã trùng |
| Chạy lại lần 2 | rc = 0: "chèn mới 0, đã có 73"; mã băm từng nhóm danh mục **trùng lần 1** ⇒ không thêm, không sửa, không xoá |
| 57 mục danh mục cũ | Mã băm trên toàn bộ cột (gồm `updated_at`) **không đổi** trước seed, sau lần 1, sau lần 2 |

**Bước 6 — cấp 10 mã quyền `opportunity.*`** (phê duyệt R-3 của Owner ngày 19/11; Claude báo Owner ngay trước khi chạy). Bằng chứng: `buoc-6-cap-quyen.txt`.

| Kiểm | Kết quả |
|---|---|
| Hai người | Yêu cầu + thực thi: NV-0001 (`sysadmin@`, vai trò `admin`); duyệt: NV-0002 (`admin@`, vai trò `crm_admin`); cả hai ACTIVE, khác nhau |
| Script | `SALES_S5_OPPORTUNITY_PERMISSIONS.sql.txt`, rc = 0, một transaction: "đã cấp 17 dòng, bỏ qua 0"; bảng tự kiểm của script đúng cả 7 dòng (10 mã; crm_admin 9, sales 6, technician 1, accountant 1, **admin 0**; tổng 17) |
| Ma trận sau cấp | `crm_admin`: 9 mã phạm vi ALL · `sales`: read / create / update / move_stage / close / assign phạm vi OWN · `technician`: read_assigned OWN · `accountant`: read ALL · `admin`: không có mã nào |
| Dấu vết | 17 yêu cầu `ROLE_PERMISSION_CHANGE`, tất cả `EXECUTED`; ở mọi yêu cầu người yêu cầu ≠ người duyệt; 51 dòng nhật ký mới (17 tạo + 17 duyệt + 17 thực thi) |
| Số liệu | `permission` 27 → 37, `role_permission` 49 → 66, `audit_log` 30 → 81 |

**Sai khác so với cách ghi trong script:** script ghi "chạy bằng psql với `siscom_migrator`". Claude chạy qua tài khoản quản trị PostgreSQL cục bộ rồi `SET ROLE siscom_migrator` trong cùng phiên (script in `chay_bang = siscom_migrator` và phép kiểm quyền của script đạt) để không phải đọc mật khẩu trong tệp cấu hình. Khác biệt: `session_user` là `postgres`; các hàm đặc quyền không dùng `session_user`.

**Bước 7 — kiểm nhanh: mới làm được phần không cần đăng nhập.** Trang chủ 200; `/health/database`: `up`, `migrated:true`, `leastPrivilege:true`; `/opportunities`, `/opportunities/meta`, `/opportunities/board` khi chưa đăng nhập đều 401; nhật ký backend từ lúc triển khai không có cảnh báo / lỗi nào ngoài các 401 đó; 0 unit lỗi; 5 tài khoản thử đều ACTIVE, không bị khoá, không bị buộc đổi mật khẩu. **Chưa làm: đăng nhập bằng 4 vai trò và kiểm mục "Cơ hội kinh doanh" theo quyền** — Claude không có mật khẩu các tài khoản thử trên staging (Owner đặt khi bootstrap, không qua chat) nên phần này do Owner làm, cũng là bước mở đầu của nghiệm thu (bước 8). Vì vậy tiêu chí "4 vai trò đăng nhập được" của bước 7 **chưa có kết quả**.

**Dữ liệu thử sẵn có cho nghiệm thu:** KH-00003 và KH-00004 do NV-0003 (`sale@`) phụ trách; KH-00002 chưa có người phụ trách ⇒ không tạo được cơ hội trên khách này cho tới khi gán người phụ trách (R-8).

### 10.4 Triển khai giao diện sau nghiệm thu đầu tiên (19/11/2026; Owner ghi "Duyệt triển khai")

Đưa #253 (ô tiền có dấu chấm ngăn nhóm hàng nghìn) và #254 (hộp thao tác hiện rõ lý do máy chủ từ chối) lên staging. `main` = `2de465c`, CI 6/6 (run 44496582470).

| Việc | Kết quả |
|---|---|
| Đóng gói | Giao diện build bằng PowerShell từ `2de465c` (bundle `index-DDo23VPN.js`, có đủ hai thay đổi); mã máy chủ `git archive 2de465c backend` — **trùng từng tệp** với gói `9bc30b1` đang chạy (chỉ khác thư mục `generated` do build sinh), 16 migration, 0 migration chờ |
| Sự cố nhỏ | Lần đóng gói đầu rỗng vì kho dùng để đóng gói chưa tải `main` mới; lệnh trên máy chủ dừng ở bước giải nén, chưa chạy gì; đã xoá tệp / thư mục rỗng, đóng gói lại |
| Chạy thử khô | rc = 0; `check-tls.sh` đạt |
| `deploy.sh --src … --frontend …` (không `--migrate`) | 09:36:30 → 09:37:25 UTC, `DEPLOY_RC=0`; sao lưu `siscom_crm_staging_20261119_093713` (tự kiểm chữ ký đạt, chưa khôi phục thử, chưa chép ra ngoài); bản chạy `src-20261119093630`, bản trước `src-20261119073843`; sức khoẻ đạt |
| So nội dung | Dấu vân tay **24 / 24 bảng trùng** trước và sau (gồm các bảng Sales); bộ đếm ghi của 24 bảng không đổi ⇒ không có thao tác ghi nào trong lúc triển khai |
| Sau triển khai | HTTPS 200, phục vụ đúng bundle mới; `/opportunities` chưa đăng nhập 401; 0 cảnh báo / lỗi trong nhật ký backend ngoài 401 do phép kiểm; 0 unit lỗi; 16 migration |

Lúc triển khai Owner đang dùng staging (có phiên đăng nhập hoạt động); dịch vụ khởi động lại khoảng vài giây. Chưa thử giao diện mới trên staging bằng tài khoản thật — Owner thử khi nghiệm thu.

### 10.5 Bước 7–8 — ghi nhận đến 19/11/2026, 16:50 (giờ Việt Nam)

Owner báo: "anh đã đăng nhập cả 4 vai trò và cả đăng nhập trên iPhone". Claude đối chiếu **chỉ đọc** trên `siscom_crm_staging` (`auth_session`, `audit_log`, `employee_credential`); không đọc mật khẩu, không ghi.

| Mục | Bằng chứng trên máy chủ | Đánh giá |
|---|---|---|
| Đăng nhập 4 vai trò (máy tính) | Phiên mới hôm nay của `admin@` (Quản trị CRM), `sale@` (Kinh doanh), `kythuat@` (Kỹ thuật), `ketoan@` (Kế toán) — Chrome 157 trên Windows; `auth.login_ok` 6 lần | **Đạt** phần đăng nhập. Những gì từng vai trò **nhìn thấy** (mục "Cơ hội kinh doanh", nút theo quyền) chưa có bằng chứng trên máy chủ — cần Owner xác nhận |
| `sysadmin@` | Không có phiên hôm nay (mật khẩu chưa đặt lại) | Chưa kiểm |
| Đăng nhập iPhone | `admin@` 16:41, iOS 27.3, **Chrome cho iOS** (CriOS 157; dùng nhân WebKit như Safari) | **Đạt** phần đăng nhập trên iPhone. Chưa có thao tác nào từ iPhone; chưa thử Safari |
| Nghiệp vụ đã làm (đều bằng `admin@`, máy tính) | Tạo (15:33), Thua (15:33), Mở lại (15:34), Sửa (15:54), Chuyển giai đoạn (15:54, 16:09), Xoá (16:23) trên CH-0001; lịch sử ghi đủ STAGE / PROBABILITY / STATUS | Có bằng chứng cho một phần tiêu chí 2, 5 (Thua), 12a (mở lại) và chặn ở tiêu chí 3 (rời Tiếp cận thiếu nhu cầu ⇒ 400, xem 10.4) |
| Dữ liệu hiện tại | CH-0001 đã xoá mềm; không còn cơ hội đang mở | — |

**Chưa nghiệm thu (theo `SALES_DESIGN.md` §10):** tiêu chí 14 trên iPhone (tạo, chuyển giai đoạn, chốt **từ iPhone**); Thắng + việc "Bàn giao thực hiện" (5); Tạm hoãn / Tiếp tục (6, 12a); chuyển người phụ trách (8); luồng của `sale@` trên cơ hội mình phụ trách (12); Kỹ thuật thấy cơ hội qua việc được giao, không thấy tiền (10); khôi phục cơ hội đã xoá (9c); hai người sửa cùng lúc (13); kanban kéo thả; ô tiền có dấu chấm và hộp báo lý do mới (10.4) trên staging.

### 10.6 Đối chiếu sau khi Owner báo "anh đã làm xong" (19/11/2026, 16:50 giờ Việt Nam)

Đối chiếu **chỉ đọc** (`auth_session`, `audit_log`, `opportunity`, `opportunity_change`, nhật ký backend từ lúc triển khai 16:37):

| Thời điểm | Ai / thiết bị | Việc | Tiêu chí |
|---|---|---|---|
| 16:47 | `admin@` / **iPhone** (Chrome cho iOS; phiên máy tính của `admin@` đã đăng xuất từ trước) | Tạo CH-0002 cho KH-00003, giá trị 31.000.000 đ, người phụ trách `sale@` | 14 — **tạo trên iPhone: có** |
| 16:49 | `sale@` / máy tính | Sửa CH-0002: xác suất 10 → 20 kèm lý do; có dòng lịch sử | 4 (sửa xác suất có lý do) |

Từ 16:37 tới lúc đối chiếu: đúng 2 lệnh ghi (POST tạo, PATCH sửa), không có lỗi 4xx / 5xx nào ngoài 401.

**Chưa có bằng chứng trên máy chủ** cho: chuyển giai đoạn và chốt **trên iPhone** (14); Thắng + việc "Bàn giao thực hiện" (5); Tạm hoãn / Tiếp tục (6, 12a); chuyển người phụ trách (8); khôi phục CH-0001 (9c); giao việc cho Kỹ thuật và Kỹ thuật xem cơ hội (10); hai người sửa cùng lúc (13 — không có phản hồi 409 nào); kéo thả kanban. Nghiệm thu S12 **chưa thể ghi là đạt**.

**Chưa có trong kế hoạch này, Owner cần biết:**

- Nghiệm thu giao diện ở bước 8 là lần đầu có người ngoài tác giả thử giao diện Sales (không có QA độc lập trước đó), và là lần đầu chạy trên iPhone thật.
- Chuỗi gỡ cấu trúc 5 bước sau khi đã cấp quyền chưa từng được diễn tập (mục 5.1).
- Chỉ có một tài khoản Kinh doanh trên staging (R-2, đã chấp nhận).
- Cảnh báo tự động khi chứng chỉ sắp hết hạn chưa có (R-5).

## Phụ lục A — Hướng dẫn khôi phục thử bản sao lưu staging (Owner thực hiện trước S12)

**Mục đích:** chứng minh bản sao lưu đêm của `siscom_crm_staging` giải mã được, đúng chữ ký, và khôi phục ra đủ số dòng — điều kiện bắt buộc trước khi chạy migration (bước 4).

**Nguyên tắc quản lý khoá đã chốt (runbook G6):**
- Khoá **riêng** age chỉ Owner giữ, ngoài VPS. Chỉ chép lên VPS **tạm thời** để kiểm, xong là xoá bằng `shred`.
- Không gửi khoá qua chat, email, hay dán vào bất kỳ công cụ nào khác. Không đưa khoá vào dòng lệnh (sẽ nằm trong lịch sử shell).
- Bước đưa khoá lên và xoá khoá do **Owner tự làm**. Claude chỉ kiểm kết quả ở chế độ chỉ đọc sau khi Owner báo đã xoá khoá.

**An toàn:** việc khôi phục tạo một database **mới** tên `siscom_crm_restore_<thời điểm>`; không ghi vào `siscom_crm_staging`, không dừng dịch vụ. Bản giải mã chỉ nằm trong thư mục tạm quyền 700 và tự xoá khi lệnh kết thúc bình thường. Đĩa còn trống khoảng 32 GB (kiểm 19/11).

**Trạng thái của hướng dẫn này:** các lệnh dưới đây được soạn từ mã `backup-db.sh` / `restore-test.sh` / `lib.sh` trên `main`. Lệnh nào báo lỗi cú pháp thì dừng và báo lại, không tự sửa.

- **Đã diễn tập (19/11/2026, 05:58 UTC, trên chính máy chủ staging — Ubuntu 24.04.5, systemd 255):** các lệnh tạo thư mục, hẹn giờ, xoá tệp, huỷ hẹn giờ ở bước 3 và bước 5, **bằng một tệp giả không chứa khoá**, gồm cả lần chạy lại. Chỉ tạo tệp giả trên `/run` (RAM) và unit systemd tạm; không đụng database, dịch vụ hay tệp cấu hình; sau diễn tập không còn thư mục, unit hay unit lỗi nào. Log: `docs/evidence/sales-s8-s11-20261118/s12-dien-tap-hen-gio-xoa-khoa-20261119.txt`. Kết quả:

  | Ca | Kết quả |
  |---|---|
  | A. Lần đầu: tạo thư mục (quyền 700, tmpfs), hẹn 30 phút, tạo tệp (quyền 600), dọn tay như bước 5 | Đạt: tệp mất, không còn hẹn giờ |
  | B. Chạy lại ngay sau khi dọn tay | Đạt: hẹn giờ mới tạo được |
  | C. Gọi lệnh hẹn giờ khi hẹn giờ cũ còn đang chờ | `systemd-run` **từ chối** (`already loaded`) — đúng với điều kiện dừng ở bước 3 |
  | D. Hẹn giờ tự chạy khi còn tệp (mô phỏng mất SSH) | Đạt: tệp tự mất; chạy lại được |
  | E. Lệnh hẹn giờ của bản hướng dẫn **trước** (`shred -u` trực tiếp): xoá tệp bằng tay nhưng quên huỷ hẹn giờ | **Lỗi của bản trước:** hẹn giờ chạy, `shred` không thấy tệp ⇒ unit ở trạng thái lỗi, máy có 1 unit lỗi, và lần hẹn giờ kế tiếp **bị từ chối** cho tới khi `reset-failed` |
  | F. Lệnh hẹn giờ **hiện tại** (`--collect` + chỉ `shred` khi tệp còn): lặp lại ca E, ca D, và huỷ hẹn giờ khi tệp còn | Đạt cả ba: không sinh unit lỗi; chạy lại được ngay; huỷ hẹn giờ không xoá nhầm tệp |

  Ca E là lý do lệnh ở bước 3 được đổi sang dạng của ca F.
- **Chưa chạy thử:** bước 1 (lấy tên bộ từ nhật ký), bước 4 (`restore-test.sh` với khoá thật — Claude không được cầm khoá riêng), bước 6, và hai lệnh kiểm trên máy Windows của Owner ở bước 7.

### Các bước

Đăng nhập VPS bằng PuTTY (tài khoản root, cổng 26266, khoá của Owner), rồi làm lần lượt. Toàn bộ các bước 1–7 nên làm trong **một** lần ngồi máy.

1. **Tạo bản sao lưu mới và ghi cố định tên bộ sẽ kiểm** (PR251-R1-03). Tên bộ được lưu vào một tệp ghi chú (không phải bí mật) để mọi bước sau dùng **đúng bộ này**, kể cả khi timer đêm hay một lần sao lưu khác chen vào, hoặc khi phải đăng nhập lại:
   ```bash
   systemctl start siscom-crm-backup.service; systemctl show siscom-crm-backup.service -p Result
   ```
   Đạt khi in `Result=success`. Lấy tên tệp từ chính dòng "Da sao luu" của lần chạy vừa xong rồi ghi lại:
   ```bash
   journalctl -u siscom-crm-backup.service -n 30 --no-pager | grep 'Da sao luu:' | tail -n1
   ```
   ```bash
   echo '/var/backups/siscom-crm/siscom_crm_staging_<YYYYMMDD>_<HHMMSS>.dump.age' > /root/restore-set.txt; cat /root/restore-set.txt; ls -l "$(cat /root/restore-set.txt)"
   ```
   (Thay phần `<…>` bằng đúng tên vừa in ở lệnh trước.) Đạt khi `ls` thấy đúng tệp đó. Từ đây **không** dùng "bản mới nhất" nữa — chỉ dùng tên trong `/root/restore-set.txt`.

2. **Đối chiếu khoá ký** với bản Owner giữ ngoài VPS:
   ```bash
   cat /etc/siscom-crm/backup-signing.allowed_signers
   ```
   Dòng in ra phải **trùng** dòng Owner đã cất. Khác ⇒ dừng, báo lại, không làm tiếp.

3. **Cài hẹn giờ tự xoá khoá TRƯỚC, rồi mới đưa khoá lên** (PR251-R1-04). Khoá đặt trong thư mục tạm trên RAM (`/run`, mất khi khởi động lại máy), không đặt trên đĩa:
   ```bash
   install -d -m 700 /run/siscom-restore
   ```
   ```bash
   systemd-run --collect --on-active=30min --unit=siscom-key-cleanup /bin/sh -c '[ ! -e /run/siscom-restore/backup.key ] || /usr/bin/shred -u /run/siscom-restore/backup.key'
   ```
   (Khác `docs/VPS_RUNBOOK.md` G6 ở một điểm: runbook đặt khoá tại `/root/siscom-backup.key`; ở đây dùng `/run/siscom-restore/backup.key` và thêm hẹn giờ. Nguyên tắc "lên tạm, dùng xong xoá" không đổi. Runbook G6 đã có dòng dẫn sang phụ lục này; trong một lần khôi phục chỉ dùng **một** quy trình.)

   Lệnh thứ hai hẹn: sau 30 phút, hệ thống tự xoá tệp khoá **dù phiên SSH còn hay mất, dù người làm có quay lại hay không**. Lệnh đạt khi in hai dòng `Running timer as unit: siscom-key-cleanup.timer` và `Will run service as unit: siscom-key-cleanup.service`. Kiểm đã hẹn: `systemctl list-timers 'siscom-key-cleanup*' --no-pager` phải có một dòng.

   **Điều kiện dừng:** nếu `systemd-run` báo lỗi (ví dụ `… was already loaded or has a fragment file` — còn hẹn giờ của lần làm trước) hoặc `list-timers` không có dòng nào thì **không** đưa khoá lên. Dọn hẹn giờ cũ rồi chạy lại lệnh hẹn giờ:
   ```bash
   systemctl stop siscom-key-cleanup.timer siscom-key-cleanup.service; systemctl reset-failed siscom-key-cleanup.timer siscom-key-cleanup.service; ls -la /run/siscom-restore/
   ```
   (`reset-failed` có thể báo lỗi khi không có gì để dọn — bỏ qua được; quan trọng là sau đó `systemd-run` chạy thành công. Nếu `ls` cho thấy còn tệp khoá của lần trước thì xoá ngay bằng lệnh ở bước 5.)

   Sau đó đưa khoá lên. Cách khuyến nghị (không để lại trong lịch sử shell): gõ lệnh dưới, dán nội dung file khoá, nhấn Enter rồi `Ctrl-D`:
   ```bash
   ( old=$(stty -g); trap 'stty "$old"' EXIT INT TERM HUP; umask 077; stty -echo; cat > /run/siscom-restore/backup.key )
   ```
   Lệnh tắt hiển thị để nội dung khoá không hiện trên màn hình khi dán — màn hình **không hiện gì** là đúng. Dán **đúng một lần**; dán lặp làm hỏng tệp khoá (mục 9). Lệnh ghi nhớ trạng thái màn hình lúc đầu và **tự trả lại** khi kết thúc, kể cả khi bấm `Ctrl-C` giữa chừng (PR252-R1-02). Nếu vì lý do nào đó gõ lệnh mà không thấy chữ hiện ra: gõ `stty sane` rồi Enter (gõ "mù"), màn hình trở lại bình thường.

   Kiểm nhanh trước khi chạy bước 4 — chỉ in số đếm, không in khoá:
   ```bash
   grep -c 'AGE-SECRET-KEY' /run/siscom-restore/backup.key; wc -c < /run/siscom-restore/backup.key
   ```
   Dòng đầu phải là `1`; dòng hai phải **bằng đúng số byte của tệp khoá gốc** trên máy Owner (xem bằng `(Get-Item '<tệp khoá>').Length` trong PowerShell — không so với một con số ước lượng). Khác ⇒ chạy lại lệnh `cat` ở trên (ghi đè) rồi dán lại; bấm `Ctrl-C` giữa chừng để lại tệp rỗng, cũng chạy lại. Hai phép này chỉ là **kiểm nhanh**: `grep -c` đếm số dòng có chuỗi, không kiểm cú pháp khoá. Phép kiểm thật là việc `age` giải mã được ở bước 4.

   **Đã diễn tập bằng dữ liệu giả** (19/11/2026, trên staging, thư mục tạm riêng trên `/run`, không có khoá; log: `docs/evidence/s12-20261119/dien-tap-dan-an-tty.txt`): dán một lần + `Ctrl-D` ⇒ đủ byte, màn hình trở lại bình thường; `Ctrl-C` giữa chừng ⇒ tệp rỗng, màn hình trở lại bình thường; dán nhầm nội dung không phải khoá ⇒ phép kiểm in `0`; chạy lại ⇒ ghi đè đúng. Nội dung dán không xuất hiện trong nhật ký phiên. Lệnh **cũ** (`…; stty -echo; cat > …; stty echo`) khi bị `Ctrl-C` để màn hình ở trạng thái ẩn cho tới khi gõ `stty sane` — đó là lý do đổi lệnh.
   Hoặc chép file bằng WinSCP / `pscp` vào đúng đường dẫn `/run/siscom-restore/backup.key` rồi chạy `chmod 600 /run/siscom-restore/backup.key`.

4. **Chạy khôi phục thử trên đúng bộ đã ghi ở bước 1:**
   ```bash
   cd /opt/siscom-crm/current/backend/scripts/linux && bash restore-test.sh --db siscom_crm_staging --dump "$(cat /root/restore-set.txt)" --identity /run/siscom-restore/backup.key
   ```
   Đạt khi có dòng `PASS: <n> bang khop so dong.` và dòng `Da ghi <đúng tên tệp ở bước 1>.restore-ok.txt`. Lệnh cũng in sẵn một dòng `DROP DATABASE "siscom_crm_restore_…"` — chép lại tên database này để dùng ở bước 6.

5. **Xoá khoá ngay** — làm bước này **kể cả khi bước 4 không đạt, bị ngắt, hoặc chưa kịp chạy**:
   ```bash
   shred -u /run/siscom-restore/backup.key; systemctl stop siscom-key-cleanup.timer 2>/dev/null; ls -la /run/siscom-restore/; systemctl list-timers 'siscom-key-cleanup*' --no-pager
   ```
   Đạt khi thư mục không còn tệp khoá và không còn hẹn giờ nào đang chờ. (Nếu hẹn giờ đã tự chạy trước đó thì `shred` báo không thấy tệp — vẫn là đạt.) Luôn chạy **cả dòng lệnh**: phần `systemctl stop …timer` huỷ hẹn giờ để lần làm lại không bị vướng.

6. **Dọn database thử — chỉ khi bước 4 ĐẠT**, bằng đúng lệnh mà bước 4 đã in (tên phải bắt đầu bằng `siscom_crm_restore_`):
   ```bash
   sudo -u postgres psql -c 'DROP DATABASE "siscom_crm_restore_<thời điểm>"'
   ```
   Nếu bước 4 **không đạt** thì **giữ lại** đúng database thử đó để điều tra, chưa dọn, và ghi lại tên của nó.

7. **Chép đúng bộ đã kiểm ra ngoài VPS, rồi xác thực lại bản đã chép** (PR251-R1-03). Bộ gồm **5 tệp** cùng gốc tên với tệp ở bước 1 — in danh sách để chép cho đủ:
   ```bash
   B="$(cat /root/restore-set.txt)"; ls -l "$B" "${B%.dump.age}.manifest" "${B%.dump.age}.manifest.sig" "$B.sha256" "$B.restore-ok.txt"
   ```
   Chép cả 5 tệp (bản sao lưu `.dump.age`, `.manifest`, `.manifest.sig`, `.dump.age.sha256`, và dấu `.dump.age.restore-ok.txt`) vào nơi Owner vẫn lưu. Thiếu tệp nào trong danh sách ⇒ dừng, báo lại.

   Trên máy của Owner, trong thư mục vừa chép, xác thực bằng **bản `allowed_signers` Owner giữ ngoài VPS** (không dùng bản tải từ VPS về). Chạy trong `cmd` (không phải PowerShell, vì cần dấu `<`):
   ```
   ssh-keygen -Y verify -f <đường dẫn allowed_signers của Owner> -I siscom-crm-backup -n siscom-crm-backup -s <gốc tên>.manifest.sig < <gốc tên>.manifest
   ```
   Đạt khi in `Good "siscom-crm-backup" signature…`. Rồi so mã băm của tệp sao lưu với dòng `file_sha256=` trong manifest vừa được xác thực (PowerShell):
   ```powershell
   (Get-FileHash '<gốc tên>.dump.age' -Algorithm SHA256).Hash.ToLower(); Select-String -Path '<gốc tên>.manifest' -Pattern '^file_sha256='
   ```
   Hai chuỗi phải trùng nhau. Khác, hoặc chữ ký không hợp lệ ⇒ bản đã chép **không** dùng được; chép lại rồi kiểm lại.

8. **Báo Claude** kết quả: "đạt, đã xoá khoá" **hoặc** "không đạt, đã xoá khoá, đang giữ database thử `<tên>`". Claude kiểm ở chế độ chỉ đọc rồi ghi kết quả vào tài liệu này:
   - tệp `restore-ok` thuộc **đúng** bộ ghi trong `/root/restore-set.txt` (chỉ có khi đạt);
   - không còn tệp khoá ở `/run/siscom-restore/` hay `/root/`, và không còn hẹn giờ `siscom-key-cleanup` đang chờ;
   - **khi đạt:** không còn database `siscom_crm_restore_*` nào do lần kiểm này tạo ra; **khi không đạt:** còn **đúng một** database thử mà Owner đã báo tên — đây là trạng thái hợp lệ để điều tra, không tính là lỗi dọn dẹp;
   - dịch vụ vẫn chạy.

### Khi bị ngắt giữa chừng (mất kết nối SSH, hoặc phải dừng ở bước 3–5)

Việc dọn khoá do **Owner làm, bằng phiên đăng nhập của Owner** — Claude không dọn thay và không chạm vào tệp khoá.

1. Đăng nhập lại càng sớm càng tốt, rồi kiểm ngay:
   ```bash
   ls -la /run/siscom-restore/ 2>/dev/null; systemctl list-timers 'siscom-key-cleanup*' --no-pager; ls /root/siscom-backup.key 2>/dev/null
   ```
2. Còn tệp khoá ⇒ chạy ngay lệnh ở bước 5, không chờ hẹn giờ.
3. Không còn tệp khoá và không còn hẹn giờ ⇒ hẹn giờ đã tự xoá. Muốn làm tiếp thì bắt đầu lại từ **bước 3** (bộ sao lưu ở bước 1 vẫn dùng được, tên nằm trong `/root/restore-set.txt`).
4. Nếu không đăng nhập lại được trong 30 phút: hẹn giờ vẫn tự xoá tệp khoá; khi vào lại được vẫn làm mục 1 để xác nhận.
5. Nếu `restore-test.sh` bị ngắt khi đang chạy: có thể còn sót một database `siscom_crm_restore_*` dở dang và thư mục tạm chứa bản giải mã (lệnh chỉ tự dọn thư mục tạm khi kết thúc bình thường hoặc bị ngắt theo cách shell còn chạy được phần dọn). Báo Claude để kiểm chỉ đọc (`/tmp/tmp.*` thuộc `postgres`, danh sách database) trước khi quyết định dọn.

**Giới hạn cần biết về việc "đã xoá":** `ls` không thấy tệp chỉ chứng minh tệp không còn trong thư mục; nó **không** chứng minh mọi bản sao của nội dung khoá đã biến mất ở tầng lưu trữ. Đặt khoá trên `/run` (RAM) tránh ghi xuống ổ đĩa, nhưng máy có swap nên hệ điều hành vẫn có thể đẩy trang nhớ ra đĩa; nhà cung cấp VPS cũng có thể chụp ảnh máy. Vì vậy chỉ ghi nhận ở mức "đã xoá tệp và huỷ hẹn giờ", không ghi "khoá chắc chắn không còn dấu vết". Nếu khoá từng nằm trên VPS lâu hơn dự kiến (ví dụ hẹn giờ không chạy, hoặc quên xoá), phương án an toàn là **đổi cặp khoá age** và mã hoá các bản sao lưu về sau bằng khoá mới — việc này cần Owner quyết riêng.

### Khi không đạt

| Thông báo | Ý nghĩa | Xử lý |
|---|---|---|
| `Giai ma that bai (sai khoa?)` | Khoá riêng không khớp khoá công khai trên VPS | Xoá khoá (bước 5), kiểm lại đúng tệp khoá; **không** chạy S12 |
| `chu ky manifest KHONG hop le` | Bản sao lưu hoặc manifest bị sửa, hoặc ký bằng khoá khác | Dừng; không dùng bản đó; báo để điều tra |
| `SHA-256 ban ro khac manifest da ky` | Tệp sao lưu hỏng | Dừng; tạo bản mới (bước 1) rồi thử lại |
| `KHONG DAT: so dong khac manifest` | Khôi phục ra thiếu / thừa dòng | Giữ database thử, báo để điều tra; **không** chạy S12 |

Chỉ khi bước 4 đạt trên đúng bộ ở bước 1, bước 5 xong, và bản chép ở bước 7 qua được xác thực thì điều kiện tiên quyết số 2 (mục 2) mới được coi là đủ.
