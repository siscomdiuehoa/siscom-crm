# Báo cáo rà soát và chuẩn bị nghiệm thu — phân hệ Sales S8–S11

- **Ngày:** 18/11/2026 · **Người lập:** Claude (dev) theo giao việc của Owner.
- **Phạm vi:** PR #243–#250 (S8a, S8b, S9a, S9b, S10a, S10b, S10c, S11). Đỉnh chuỗi: `feat/sales-s11-ui-kanban` @ `68399e5` (rà soát chạy tại `4734d4c`; sau đó gộp bản sửa L-01); `main` @ `5be556b`.
- **Giới hạn đã giữ:** không merge, không deploy, không force-push, không chuyển Draft thành Ready, không làm S12, không truy cập / sửa DB thật. Mọi kiểm thử DB chạy trên cụm PostgreSQL 18 tạm ở máy dev (127.0.0.1:55471, database `siscom_crm_test_*`).
- **Cập nhật 19/11/2026 (trưa):** reviewer trả kết quả cho #245–#250 (mục 6a). #245 đạt vòng 2 và **đã merge** (`4b02de9`, CI `main` 6/6 — run 44453870220). #246 đạt vòng 2, #247 và #248 đạt vòng 1. #249 và #250 bị yêu cầu sửa mỗi PR 1 MAJOR — **đã sửa, có test tái hiện, CI 6/6, đã gửi `[REVIEW-R2]`**. `main` hiện ở `4b02de9`; #246 đã đổi base sang `main`.
- **Cập nhật 19/11/2026 (sáng):** #243 đã merge (`7d46809`) và #244 đã merge (`eb20d5e`) ngày 18/11, mỗi PR có `[KET-LUAN]` và phê duyệt riêng của Owner; CI trên `main` đạt 6/6 sau từng lần. `main` hiện ở `eb20d5e`. #245 đã đổi base sang `main`. Bảng mục 2, mục 6 và mục 8 đã cập nhật theo; các số liệu kiểm thử giữ nguyên như lúc rà soát.
- **Cập nhật cuối ngày 18/11:** Owner chọn sửa L-01 trong #245. Đã sửa, gộp lên 5 nhánh phía trên bằng merge thường, CI 6/6 cả 6 PR, đã báo reviewer. Các mục liên quan bên dưới đã được cập nhật.
- **Trạng thái file này:** đưa vào repo qua PR tài liệu riêng theo quyết định của Owner (18/11/2026). Số liệu, HEAD và kết quả CI giữ nguyên như lúc lập; không chứa mật khẩu, khoá hay dữ liệu khách hàng thật.

## 1. Kết luận

**Về kỹ thuật, phân hệ Sales S8–S11 sẵn sàng để Owner nghiệm thu. S8 (#243, #244) đã vào `main`; S9–S11 (#245–#250) chưa merge vì review chưa xong.**

- Toàn bộ chức năng trong phạm vi đạt khi kiểm bằng test tự động, gọi API thật và trình duyệt với backend thật. Đợt rà soát tìm ra **1 lỗi mới mức nhỏ** về rò rỉ gián tiếp (mục 5, L-01) — **đã sửa** trong #245; còn một số điểm thiếu đã biết.
- Điều đang chặn merge là **quy trình**: 6/8 PR chưa có kết luận review cuối (#245, #246 chờ R2; #247–#250 chưa có vòng review nào).
- Chưa có nghiệm thu trên staging, iPhone thật, và dữ liệu thật — thuộc S12, cần Owner duyệt riêng.

## 2. Tình trạng 8 PR

| PR | Nội dung | HEAD | CI trên HEAD | Review | Việc còn lại |
|---|---|---|---|---|---|
| #243 | S8a: chuyển người phụ trách, xoá mềm, khôi phục | `a15cacc` | 6/6 (run 44048290937) | **PASS R1** (1 MINOR) | **Đã merge 18/11/2026** — `7d46809`, CI `main` 6/6 (run 44279249446) |
| #244 | S8b: Tạm hoãn / Tiếp tục / Thắng / Thua / Mở lại + việc tự tạo | `ca8831d` | 6/6 (44057650006) | **PASS R2** | **Đã merge 18/11/2026** — `eb20d5e`, CI `main` 6/6 (run 44280632001). Trước khi merge đã kiểm trên nền `main`: cây trộn trùng cây HEAD |
| #245 | S9a: hoạt động theo cơ hội, đường đọc theo việc của Kỹ thuật | `2b0f723` | 6/6 (44272823911) | **PASS R2** (19/11) — 2 MAJOR của R1 và L-01 đều CLOSED | **Đã merge 19/11/2026** — `4b02de9`, CI `main` 6/6 (run 44453870220) |
| #246 | S9b: tài liệu cơ hội | `30da84c` | 6/6 (44273183796) | **PASS R2** (19/11) | Đã đổi base sang `main`; cây trộn trùng cây HEAD; chờ Owner duyệt merge |
| #247 | S10a: API lựa chọn cho giao diện (chỉ đọc) | `5af596e` | 6/6 (44273182917) | **PASS R1** (19/11), 1 MINOR | Chờ #246 vào `main` |
| #248 | S10b: danh sách, bộ lọc, tạo, chi tiết, thao tác | `18563ee` | 6/6 (44273186268) | **PASS R1** (19/11), 1 MINOR | Chờ các PR nền vào `main` |
| #249 | S10c: sửa, 3 tab, đã xoá + khôi phục | `3bfa073` | 6/6 (44454555478) | R1 = 1 MAJOR (PR249-R1-01) **đã sửa**; chờ R2 | Chờ `[REVIEW-R2-RESULT]` |
| #250 | S11: kanban, tab Cơ hội ở khách, điện thoại | `bcaca16` | 6/6 (44454926587) | R1 = 1 MAJOR (PR250-R1-01) **đã sửa**; chờ R2 | Chờ `[REVIEW-R2-RESULT]` |

- Cả 8 PR đang là Draft, `MERGEABLE`, không xung đột.
- **Chuỗi nhánh liền mạch:** mỗi nhánh xuất phát đúng từ đỉnh nhánh trước (merge-base = đỉnh nhánh nền, lệch 0 commit). Lúc rà soát: `main..đỉnh` = 19 commit = 1 + 4 + 2 + 4 + 1 + 4 + 2 + 1; không thiếu, không lặp. Sau bản sửa L-01: thêm 1 commit ở #245 và 5 merge commit (mỗi nhánh trên một cái); kiểm lại vẫn liền mạch, mọi nhánh chứa đủ nhánh nền. `main` chưa đổi từ khi mở chuỗi.
- **Tương thích Backend ↔ Frontend:** mọi API giao diện gọi đều có ở backend của cùng chuỗi (kiểm bằng nhật ký mạng trên backend thật: không có 404 / 400 ngoài dự kiến). Frontend S10b–S11 **phụ thuộc** backend S10a (#247): `/opportunities/meta`, `owner-candidates`, `handover-candidates`. Backend không phụ thuộc frontend.

## 3. Kết quả kiểm thử (chạy thật, tại đỉnh chuỗi `4734d4c`)

| Hạng mục | Kết quả |
|---|---|
| CI GitHub trên 8 HEAD | 8/8 PR đạt 6/6 |
| Backend unit | 785/785 (58 suite) |
| Backend tích hợp, PostgreSQL tạm, DB mới | **456/456** trên 25 file (chạy từng file); 17 ca `db-roles` bỏ qua vì DB thử cục bộ chưa tách role — CI có chạy các ca này trên DB đã tách role |
| Frontend (`node --test` + harnessGuard) | 734/734; danh sách test của CI 364/364; `vite build` đạt |
| Gọi API thật bằng 4 tài khoản thử (kịch bản rà soát 143 phép kiểm) | Trước sửa: 142 đạt, 1 không đạt (L-01). **Sau sửa: 143/143** |
| Diễn tập nâng cấp / lùi trên dữ liệu cũ | Đạt (mục 4.3) |
| Trình duyệt + backend thật, 4 vai trò, máy tính + 375 px, Sáng / Tối | Đạt |

Ghi chú công cụ: chạy toàn bộ test tích hợp trong **một** tiến trình jest trên Windows bị thoát mã 127 giữa chừng (lỗi môi trường đã gặp nhiều lần); em chạy từng file. CI (Linux) chạy một lượt bình thường.

## 4. Chức năng — PASS / FAIL

Ký hiệu nguồn bằng chứng: **T** = test tự động (unit / tích hợp / giao diện), **A** = gọi API thật, **B** = trình duyệt với backend thật.

### 4.1 Nghiệp vụ

| # | Chức năng | Kết quả | Bằng chứng |
|---|---|---|---|
| 1 | Phân quyền Kinh doanh / Quản trị CRM / Kỹ thuật / Kế toán | **PASS** (L-01 đã sửa) | T, A (hơn 50 phép kiểm quyền), B |
| 2 | Tạo cơ hội; 3 loại; loại có thi công bắt buộc dự án | PASS | T, A, B |
| 3 | Danh sách, bộ lọc, tìm kiếm, phân trang | PASS | T, A, B |
| 4 | Sửa cơ hội; version cũ ⇒ 409; đổi xác suất phải có lý do | PASS | T, A, B |
| 5 | Chuyển giai đoạn tới / lùi; chặn khi thiếu nhu cầu / giá trị | PASS | T, A, B |
| 6 | Tạm hoãn, đổi hạn, Tiếp tục; đúng 1 việc nhắc, tự đóng khi tiếp tục | PASS | T, A, B |
| 7 | Thắng: đủ chứng từ, link https; tự tạo việc "Bàn giao thực hiện" | PASS | T, A, B |
| 8 | Thua: lý do theo danh mục; "Khác" phải có ghi chú | PASS | T, A, B |
| 9 | Mở lại (chỉ Quản trị CRM); về đúng giai đoạn và xác suất trước khi đóng | PASS | T, A, B |
| 10 | Chuyển người phụ trách; người phụ trách của **khách** không đổi; có lịch sử | PASS | T, A |
| 11 | Hoạt động theo cơ hội: xem, lọc, ghi nhận, hoàn thành việc | PASS | T, A, B |
| 12 | Lịch sử thay đổi (giai đoạn, trạng thái, hạn hoãn, giá trị, xác suất, ngày chốt, người phụ trách) | PASS | T, A, B |
| 13 | Tài liệu: nhóm Kỹ thuật / Thương mại; chỉ https; xoá phải có lý do | PASS | T, A, B |
| 14 | Xoá mềm; danh sách đã xoá; khôi phục giữ nguyên trạng thái | PASS | T, A, B |
| 15 | Kanban; kéo thả và nút chuyển giai đoạn (qua hộp xác nhận) | PASS | T, B |
| 16 | Tab "Cơ hội" trong chi tiết khách hàng | PASS | T, A, B |
| 17 | Giao diện điện thoại (375 px): thẻ, thanh giai đoạn, hộp thoại | PASS | T, B (giả lập kích thước) |
| 18 | Điện thoại thật (iPhone) — tiêu chí 14 | **CHƯA KIỂM** | Cần thiết bị thật / staging |

Lưu ý về mục 10: Kinh doanh (quyền `assign` phạm vi OWN) chỉ chuyển được cho người **cùng phòng**; chuyển khác phòng do Quản trị CRM làm. Đây là thiết kế (§5.4), em ghi rõ để Owner khỏi bất ngờ khi thử.

### 4.2 Bảo mật

| # | Yêu cầu | Kết quả | Bằng chứng |
|---|---|---|---|
| 1 | RBAC kiểm tại backend, không chỉ ẩn nút | **PASS** | A: mọi thao tác ghi gửi thẳng vào API bằng tài khoản không đủ quyền đều bị 403 / 404; dữ liệu không đổi |
| 2 | Chưa đăng nhập ⇒ 401; ghi thiếu CSRF ⇒ 403 | PASS | A |
| 3 | Kinh doanh không thấy / không sửa được cơ hội ngoài phạm vi (chi tiết, danh sách, tìm kiếm, 8 thao tác ghi, 5 đường đọc phụ) | PASS | A (19 phép kiểm) |
| 4 | Kế toán chỉ đọc (9 thao tác ghi ⇒ 403; khôi phục ⇒ 404) | PASS | A |
| 5 | Kỹ thuật: chỉ thấy cơ hội khi có việc **đang mở** được giao; xong việc ⇒ mất quyền ngay | PASS | A |
| 6 | Kỹ thuật không nhận giá trị dự kiến / chốt, xác suất, chứng từ, lý do thua, lịch sử, tài liệu Thương mại, liên hệ — ở chi tiết, danh sách, hoạt động, tài liệu | PASS | A (soi cả chuỗi JSON thô) |
| 7 | Kỹ thuật không suy ra được trường bị ẩn qua bộ lọc | Lúc rà soát: FAIL (L-01). **Sau sửa: PASS** | A + T |
| 8 | Tiêu đề / nội dung việc tự tạo không chứa giá trị tiền | PASS | A |
| 9 | Danh sách đã xoá và khôi phục chỉ dành cho Quản trị CRM | PASS | A |

### 4.3 Dữ liệu

| # | Yêu cầu | Kết quả | Bằng chứng |
|---|---|---|---|
| 1 | Không mất dữ liệu khách hàng cũ khi nâng cấp | **PASS** | Diễn tập dưới đây |
| 2 | Lùi (rollback) không mất dữ liệu cũ | PASS | Diễn tập dưới đây |
| 3 | Rollback **từ chối** khi còn dữ liệu Sales (cơ hội, việc tự sinh, tài liệu) | PASS | CI (bài "REFUSE_TEST" cho S2 / S8 / S9) |
| 4 | Giá trị tiền null không bị biến thành 0 | **PASS** | A + truy vấn DB thử + T |
| 5 | Không truy cập / sửa DB thật | Đã tuân thủ | — |

**Diễn tập nâng cấp / lùi trên dữ liệu cũ** (PostgreSQL tạm):
1. Tạo database theo schema **trước Sales** (commit `bbfc322`, 12 migration) và nạp dữ liệu thật bằng chính bộ test của phiên bản đó: 87 khách, 28 liên hệ, 90 hoạt động, 10 nhân viên…
2. Chụp dấu vân tay (số dòng + md5 từng dòng) của cả 20 bảng.
3. Áp 4 migration Sales ⇒ **20/20 bảng cũ khớp từng dòng**; thêm 3 bảng mới.
4. Chạy 4 script rollback (S9 → S8 → S5 → S2) ⇒ 20/20 bảng khớp; schema trùng khít bản trước Sales (`prisma migrate diff`: không khác biệt); còn đúng 12 migration.
5. Áp lại 4 migration ⇒ 20/20 bảng khớp; schema khớp bản hiện tại.

**Tiền null:** API trả `null` khi tạo không có giá trị, khi xoá giá trị, và ở danh sách; số 0 thật được giữ là `"0"`. Trong DB thử: 3 cơ hội có giá trị NULL và 3 cơ hội có giá trị 0 nằm tách biệt; lịch sử ghi `NULL` cho lần xoá giá trị, không có dòng nào ghi `0` thay cho rỗng. Giao diện hiện "Chưa rõ"; tổng cột kanban đếm riêng "chưa rõ", không cộng như 0.

## 5. Danh sách lỗi và điểm cần xử lý

### Lỗi mới phát hiện trong đợt rà soát

**L-01 — Mức: NHỎ (rò rỉ gián tiếp). Backend, thuộc phạm vi #245.**
Kỹ thuật (chỉ có đường đọc theo việc) gọi `GET /opportunities?status=WON` hoặc `?ownerId=<id>` thì dòng cơ hội của họ **có / không** xuất hiện tuỳ giá trị lọc. Nhờ đó họ suy ra được **trạng thái** và **người phụ trách** — hai trường đã được quyết định ẩn với bản kỹ thuật ở review R1 của #245.
- Tái hiện trên backend thử: `status=WON` ⇒ có dòng; `status=LOST` ⇒ không; `ownerId` = Kinh doanh ⇒ có; `ownerId` = Quản trị ⇒ không.
- Không lộ số tiền (API không có bộ lọc theo tiền). Người dò `ownerId` phải biết sẵn mã định danh nhân viên.
- Đề xuất sửa: bộ lọc `status` và `ownerId` chỉ áp cho dòng đạt đường đầy đủ (dòng theo việc bị loại khi có hai bộ lọc này), kèm test. Nên sửa trước khi merge #245, hoặc PR vá riêng ngay sau chuỗi.
- **Đã sửa (theo quyết định của Owner: sửa trong #245):** commit `2b0f723` — có bộ lọc `status` / `ownerId` thì danh sách chỉ xét dòng đạt đường đầy đủ, áp trước khi đếm và phân trang, cả ở đường theo khách. Có test tái hiện (RED trước sửa, GREEN sau sửa), chốt tĩnh, và bổ sung đặc tả §5.4. Kịch bản API thật sau sửa: 143/143. Bản sửa đã gộp lên #246–#250 bằng merge thường; CI 6/6 cả 6 PR; đã đăng cập nhật cho reviewer trên từng PR.

### Điểm tồn đã biết (không chặn nghiệm thu)

| Mã | Mức | Nội dung | Nguồn |
|---|---|---|---|
| T-01 | Nhỏ | Vai trò chỉ có `restore` mà thiếu quyền đọc: khôi phục trả 404 và lùi giao dịch. Ma trận hiện tại không có vai trò như vậy. | Review R1 #243 |
| T-02 | Nhỏ | `/changes` trả tối đa 500 dòng, không báo còn dữ liệu; giao diện Lịch sử không có "xem thêm". | Review #242 (MINOR-02) |
| T-03 | Nhỏ | Lịch sử không hiện tên người phụ trách cũ (API chỉ trả id). | #249 |
| T-04 | Nhỏ | Tổng cột kanban tính trên thẻ đã tải (tối đa 100 / lần); cột lớn hơn ghi rõ "tính trên x / y". Chưa có số đếm cạnh "Tạm hoãn". | #250 |
| T-05 | Nhỏ | Hộp "Ghi nhận hoạt động" trong cơ hội chưa cho giao việc cho người khác / chọn liên hệ; ô chọn cơ hội ở biểu mẫu Hoạt động của khách (§8.4) chưa làm. | #249, #250 |
| T-06 | Nhỏ | Trang chi tiết Công việc (`TaskView`, đã có từ trước) đặt hộp thoại trong thẻ kính mờ — có thể lệch hộp thoại; chưa kiểm, chưa sửa. | #248 |
| T-07 | Nhỏ | Tìm kiếm chưa bỏ dấu tiếng Việt. | #241 |
| T-09 | Nhỏ | Danh sách ứng viên nhận chuyển giao / bàn giao cắt ở 500 người, chưa báo khi bị cắt. | Review R1 #247 |
| T-10 | Nhỏ | Hộp thao tác (chuyển giai đoạn…) sau 409 giữ form cũ; cần buộc xác nhận lại khi cờ "xác suất nhập tay" đổi sau khi tải lại. Máy chủ vẫn kiểm version. | Review R1 #248 |
| T-08 | Lưu ý | Khách do Quản trị CRM tạo mà **chưa có người phụ trách** thì không tạo được cơ hội (409 `OPPORTUNITY_CUSTOMER_NO_OWNER`). Đúng thiết kế; cần dặn người dùng. | Rà soát này |

## 6. PR còn chờ review

- **#245** — chờ `[REVIEW-R2-RESULT]` (đã gửi R2 tại `8bc4933`).
- **#246** — chờ reviewer kiểm lại sau bản sửa #245 (đã gửi R2 tại `4c239c8`).
- **#247, #248, #249, #250** — đã gửi `[REVIEW-REQUEST]`, chưa có vòng review nào.
- **Tình trạng 19/11 (thay cho ba dòng trên):** chỉ còn **#249** (`3bfa073`) và **#250** (`bcaca16`) chờ `[REVIEW-R2-RESULT]`; chi tiết ở mục 6a.
- #243, #244 đã PASS và **đã merge ngày 18/11/2026** (xem mục 2).

## 6a. Kết quả review ngày 19/11/2026 và bản sửa

| PR | Kết quả | Phát hiện | Xử lý |
|---|---|---|---|
| #245 | PASS R2 trên `2b0f723` | PR245-R1-01, PR245-R1-02, L-01: CLOSED | Đã merge `4b02de9` |
| #246 | PASS R2 trên `30da84c` | Không có MAJOR mới | Chờ Owner duyệt merge |
| #247 | PASS R1 trên `5af596e` | MINOR: danh sách ứng viên cắt ở 500 người mà không báo | Theo dõi (T-09) |
| #248 | PASS R1 trên `18563ee` | MINOR: hộp thao tác sau 409 giữ form cũ; cần xác nhận lại khi cờ xác suất nhập tay đổi | Theo dõi (T-10) |
| #249 | CHANGES_REQUESTED trên `c5dd747` | **PR249-R1-01 (MAJOR):** lưu lại sau 409 gửi cả trường người dùng chưa sửa ⇒ ghi đè thay đổi của người khác. MINOR: hộp ghi nhận hoạt động chỉ tự nhận Công việc | Đã sửa ở `3bfa073`, chờ R2 |
| #250 | CHANGES_REQUESTED trên `68399e5` | **PR250-R1-01 (MAJOR):** tổng cột hợp lệ vượt 15 chữ số hiện "Chưa rõ" | Đã sửa ở `bcaca16`, chờ R2 |

**PR249-R1-01 — cách sửa:** biểu mẫu Sửa giữ bản gốc lúc mở. Khi cơ hội được tải lại sau 409, ô người dùng **chưa sửa** nhận giá trị bản mới; ô **cả hai cùng sửa** thành giá trị khác nhau thì nút Lưu bị khoá cho tới khi người dùng chọn "Giữ nội dung của tôi" hoặc "Dùng bản mới" cho từng ô. Test tái hiện đúng ca của reviewer (A sửa nhu cầu, B đổi tiền 100 → 200): trước sửa, lần lưu lại gửi kèm tiền 100; sau sửa chỉ gửi nhu cầu, tiền của B còn 200. Thêm 5 ca hàm thuần và 3 ca qua hộp Sửa (cùng sửa một trường, null / 0, xác suất + lý do). Frontend 729/729 trên nhánh #249.

**PR250-R1-01 — cách sửa:** bộ định dạng **tổng** nhận mọi số nguyên không âm (tính bằng BigInt, không qua Number); giới hạn 15 chữ số chỉ còn áp cho giá trị của **một** cơ hội. Test tái hiện đúng ca của reviewer (hai thẻ 999.999.999.999.999 đ ⇒ "1.999.999,9 tỷ") và các biên 15 / 16 / 17 chữ số, số 0, cột toàn null, cột lẫn tiền và null, nhãn cột qua component. Frontend 745/745 trên nhánh #250.

Ý nghĩa với đợt rà soát 18/11: hai lỗi này **không** bị bộ kiểm của đợt rà soát bắt được — ca 409 khi đó chỉ kiểm "version mới được dùng", chưa kiểm nội dung thân yêu cầu khi người khác đã đổi trường khác; ca tổng lớn chỉ kiểm hàm cộng, chưa kiểm nhãn hiển thị. Cả hai nay đã có test chốt.

## 7. Rủi ro còn tồn tại

1. **Review chưa phủ nửa sau của chuỗi.** #247–#250 (khoảng 3.500 dòng thêm mới ở frontend và 3 API chỉ đọc) mới có tự kiểm của người viết. L-01 cho thấy vẫn có thể còn điểm sót.
2. **Chuỗi 8 PR xếp chồng.** Một bản sửa ở PR dưới (ví dụ L-01 ở #245) buộc cập nhật mọi nhánh phía trên và chạy lại CI. Vì không được force-push, việc đó phải làm bằng merge nhánh dưới lên nhánh trên.
3. **Chưa chạy trên môi trường giống thật.** DB thử cục bộ chưa tách role (`siscom_app` là chủ sở hữu); CI có chạy trên DB đã tách role nhưng staging / VPS chưa có migration và grants V5 của Sales.
4. **Grants V5 được mở rộng tại chỗ** (thêm bảng tài liệu) thay vì tạo V6. Hợp lệ vì V5 chưa chạy trên DB thật, nhưng ở S12 phải chạy đúng thứ tự: migration → cấp lại grants từ V5 hiện hành → VERIFY.
5. **Chưa có nghiệm thu với người dùng thật và dữ liệu thật**; chưa thử iPhone thật; chưa thử hai người sửa cùng lúc trên trình duyệt (đã có test API và giao diện cho 409).
6. **Đồng thời:** tranh chấp quyền người nhận trong lúc chuyển người phụ trách được reviewer đánh dấu chưa kiểm chứng (#243).
7. **Quy mô:** kanban và danh sách chưa thử với hàng nghìn cơ hội thật; test dữ liệu lớn mới ở mức 230 thẻ / cột với dữ liệu giả.

## 8. Đề xuất thứ tự merge an toàn

Nguyên tắc: từng PR một, đúng thứ tự chuỗi, Merge Commit khoá theo HEAD, mỗi PR cần mã duyệt riêng của Owner.

1. L-01 đã sửa trong #245; không còn việc tiền đề nào về mã trước khi merge.
2. **Khối backend:** ~~#243~~ → ~~#244~~ (đã merge 18/11) → ~~#245~~ (đã merge 19/11) → #246 → #247.
3. **Khối frontend:** #248 → #249 → #250.
4. Sau **mỗi** lần merge:
   - chờ CI trên `main` đạt 6/6;
   - đổi base của PR kế tiếp sang `main`, chờ CI của PR đó chạy lại trên nền mới và đạt 6/6;
   - đăng `[KET-LUAN]` trước khi merge PR kế tiếp.
5. Điểm dừng an toàn: sau #247 (backend đủ, giao diện chưa đổi) và sau #250. Dừng giữa khối frontend vẫn an toàn vì mục "Cơ hội kinh doanh" chỉ mở khi máy chủ cấp quyền đọc cơ hội — mà quyền này chưa được cấp trên DB thật cho tới S12.
6. Không deploy giữa chừng. Merge vào `main` không làm thay đổi staging / VPS.

## 9. Kế hoạch đưa lên staging (S12) — chỉ là đề xuất, chưa thực hiện

Mỗi bước cần Owner duyệt riêng (theo §9 của `docs/SALES_DESIGN.md`).

| Bước | Việc | Kiểm chứng | Đường lùi |
|---|---|---|---|
| 0 | Chốt commit `main` sẽ triển khai (sau #250, CI 6/6) | SHA ghi vào biên bản | — |
| 1 | Sao lưu DB staging (có ký + mã hoá), thử khôi phục bản sao lưu | `restore-test` đạt; ghi số khách, liên hệ, hoạt động | — |
| 2 | `deploy.sh --migrate` (4 migration Sales) | `migrate status` sạch; số khách / liên hệ / hoạt động **bằng** trước khi chạy | Rollback SQL S9 → S8 → S5 → S2 (chỉ khi chưa có dữ liệu Sales) |
| 3 | Cấp lại grants từ `APP_GRANTS_V5` hiện hành | VERIFY đạt (app + auth) | Grants V4 |
| 4 | Seed danh mục Sales (4 giai đoạn, 3 loại, 9 lý do thua) | Đếm đúng 4 / 3 / 9 | Ẩn mục, không xoá |
| 5 | Cấp quyền `opportunity.*` cho hai người thử (script S5) | Script kiểm đạt | Script gỡ quyền S5 |
| 6 | Triển khai frontend + backend; kiểm sức khoẻ | `/health` đạt; đăng nhập được | `deploy.sh --rollback` (lùi mã, **giữ** schema) |
| 7 | Nghiệm thu theo §10 (tiêu chí 1–16a), gồm iPhone thật và hai người sửa cùng lúc | Biên bản PASS / FAIL từng tiêu chí | — |

Ưu tiên đường lùi: lùi mã ứng dụng và giữ schema cộng thêm; chỉ gỡ cấu trúc khi tiền kiểm xác nhận không còn dữ liệu sẽ mất.

## 10. Việc chờ Owner quyết định

1. ~~L-01~~ — đã quyết và đã làm (sửa trong #245).
2. ~~Thứ tự merge~~ — Owner đã quyết (18/11/2026): merge #243 trước, kiểm `main` và CI, rồi mới #244; không merge đồng thời — **đã thực hiện xong cả hai**; #245–#250 tiếp tục chờ review.
3. Thời điểm bắt đầu S12 và hai người dùng thử.
4. ~~Đưa báo cáo vào repo~~ — Owner đã quyết: có, qua PR tài liệu riêng.

## Phụ lục — môi trường và bằng chứng

- Backend thử: build từ `4734d4c`, `http://127.0.0.1:3100`; frontend dev `http://127.0.0.1:5180`; DB thử `siscom_crm_test_20261118_141945` (đã migrate, seed, bootstrap 5 tài khoản thử).
- Kịch bản và nhật ký nằm trong thư mục tạm của phiên làm việc (không thuộc repo): `audit-rbac.mjs` + `audit-rbac.log` (143 phép kiểm), `audit-unit.log`, `audit-int-all.log`, `legacy-base.json` (dấu vân tay 20 bảng).
- Đợt rà soát đã tạo thêm dữ liệu thử trong DB thử cục bộ (các cơ hội tên "Rà soát vòng đời…", "Cơ hội của Admin…"). Không ảnh hưởng gì ngoài máy dev.
