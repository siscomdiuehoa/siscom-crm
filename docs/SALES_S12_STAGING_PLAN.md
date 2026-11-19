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
| Khôi phục thử | **Không có** dấu `restore-ok` cho các bộ sao lưu hiện có | **Thiếu** — xem R-1 |

## 2. Điều kiện tiên quyết (phải đủ trước khi xin duyệt bước đầu tiên)

1. #243 → #250 đã merge vào `main` theo đúng thứ tự, mỗi PR có kết luận review và mã duyệt của Owner; CI trên `main` đạt 6/6. Ghi lại SHA của `main` sẽ triển khai. **Tình trạng 19/11/2026, 06:00 UTC: ĐÃ ĐỦ** — cả 8 PR đã merge; `main` = `0e709b9`, CI 6/6 (run 44466202529). SHA triển khai chốt ở bước 0 (nếu `main` có thêm commit trước ngày triển khai thì ghi lại SHA và run CI mới).
2. Một bộ sao lưu staging **mới** được khôi phục thử thành công (`restore-test.sh`: chữ ký manifest hợp lệ, số dòng từng bảng khớp). Việc này cần Owner đưa khoá riêng age lên VPS tạm thời rồi xoá ngay (quy trình G6).
3. Chứng chỉ HTTPS còn hạn ít nhất 48 giờ tại thời điểm triển khai.
4. Bản build frontend được tạo trên máy Windows bằng PowerShell từ đúng SHA ở mục 1 (VPS 3 GB không build giao diện; không build bằng Git Bash vì làm hỏng `/api/v1`).
5. Owner chỉ định hai người thực hiện bước cấp quyền (mục 4, **bước 6**): một tài khoản nhóm yêu cầu (vai trò `admin`) và một tài khoản duyệt (`crm_admin`), khác nhau, đang hoạt động. **Tình trạng: ĐÃ ĐỦ** (mục 8).

Tình trạng các điều kiện còn lại (19/11/2026): điều kiện 2 **chưa đủ** (chờ Owner làm Phụ lục A); điều kiện 3 và 4 chỉ kiểm được ngay trước ngày triển khai.

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
| R-1 | Chưa có bằng chứng khôi phục thử cho các bộ sao lưu hiện có | Làm bước 2 trước mọi thay đổi; không có thì không chạy bước 4 |
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
   umask 077; cat > /run/siscom-restore/backup.key
   ```
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
