# Báo cáo rà soát và chuẩn bị nghiệm thu — phân hệ Sales S8–S11

- **Ngày:** 18/11/2026 · **Người lập:** Claude (dev) theo giao việc của Owner.
- **Phạm vi:** PR #243–#250 (S8a, S8b, S9a, S9b, S10a, S10b, S10c, S11).
- **Cách đọc tài liệu này (sửa theo PR251-R1-01):** có **hai lớp thông tin, không trộn nhau**.
  - **Mục 0 — Hiện trạng:** trạng thái PR / review / merge / `main` tại một thời điểm kiểm ghi rõ. Đây là phần duy nhất mô tả "bây giờ".
  - **Mục 1–7 — Ảnh chụp đợt rà soát 18/11/2026:** kết quả tại hai mốc mã cố định — `4734d4c` (đỉnh chuỗi lúc rà soát) và `68399e5` (đỉnh chuỗi sau khi gộp bản sửa L-01, cuối ngày 18/11); `main` lúc đó là `5be556b`. Các con số ở đó **chỉ** là bằng chứng cho đúng hai mốc này, không phải cho HEAD về sau.
- **Giới hạn đã giữ:** không merge, không deploy, không force-push, không chuyển Draft thành Ready, không làm S12, không truy cập / sửa DB thật. Mọi kiểm thử DB chạy trên cụm PostgreSQL 18 tạm ở máy dev (127.0.0.1:55471, database `siscom_crm_test_*`).
- **Giới hạn của phần hiện trạng:** em (Claude) không chạy lại toàn bộ đợt rà soát trên các HEAD mới. Cột "đã chạy lại / chưa chạy lại" ở mục 0.3 ghi rõ từng hạng mục.
- **Trạng thái file này:** đưa vào repo qua PR tài liệu riêng theo quyết định của Owner (18/11/2026). Không chứa mật khẩu, khoá hay dữ liệu khách hàng thật.

## 0. Hiện trạng — kiểm ngày 19/11/2026, 04:47 UTC

Nguồn: GitHub (`gh pr view`, `gh run list`, danh sách bình luận của từng PR) tại thời điểm trên. Mọi thay đổi sau thời điểm này không được phản ánh ở các mục 0.1–0.4; **dòng kiểm mới hơn nằm ở mục 0.5** (06:00 UTC: cả 8 PR đã merge, `main` = `0e709b9`).

### 0.1 `main` và 8 PR

`main` = `d5035da` (merge commit của #248); CI trên `main` 6/6 — run 44458491732.

| PR | Nội dung | Trạng thái | HEAD | Kết luận review (liên kết) | Merge commit · CI `main` sau merge |
|---|---|---|---|---|---|
| #243 | S8a | **Đã merge** 18/11 | `a15cacc` | PASS R1 — [6966289780](https://github.com/siscomdiuehoa/siscom-crm/pull/243#issuecomment-6966289780) | `7d46809` · 6/6 (44279249446) |
| #244 | S8b | **Đã merge** 18/11 | `ca8831d` | PASS R2 — [6966290183](https://github.com/siscomdiuehoa/siscom-crm/pull/244#issuecomment-6966290183) | `eb20d5e` · 6/6 (44280632001) |
| #245 | S9a | **Đã merge** 19/11 | `2b0f723` | PASS R2 — [6998847862](https://github.com/siscomdiuehoa/siscom-crm/pull/245#issuecomment-6998847862) | `4b02de9` · 6/6 (44453870220) |
| #246 | S9b | **Đã merge** 19/11 | `30da84c` | PASS R2 — [6998848088](https://github.com/siscomdiuehoa/siscom-crm/pull/246#issuecomment-6998848088) | `44cff52` · 6/6 (44456195128) |
| #247 | S10a | **Đã merge** 19/11 | `5af596e` | PASS R1, 1 MINOR — [6998848393](https://github.com/siscomdiuehoa/siscom-crm/pull/247#issuecomment-6998848393) | `2725e80` · 6/6 (44457272471) |
| #248 | S10b | **Đã merge** 19/11 (Owner miễn QA riêng cho PR này) | `18563ee` | PASS R1, 1 MINOR — [6998868241](https://github.com/siscomdiuehoa/siscom-crm/pull/248#issuecomment-6998868241) | `d5035da` · 6/6 (44458491732) |
| #249 | S10c | Mở, Draft, base `main` | `3bfa073` | R1 = 1 MAJOR — [6998868526](https://github.com/siscomdiuehoa/siscom-crm/pull/249#issuecomment-6998868526); **PASS R2** trên `3bfa073` — [6999317246](https://github.com/siscomdiuehoa/siscom-crm/pull/249#issuecomment-6999317246) | Chưa merge — chờ Owner duyệt |
| #250 | S11 | Mở, Draft, base `feat/sales-s10c-ui-detail` | `bcaca16` | R1 = 1 MAJOR — [6998868894](https://github.com/siscomdiuehoa/siscom-crm/pull/250#issuecomment-6998868894); **PASS R2** trên `bcaca16` — [6999317500](https://github.com/siscomdiuehoa/siscom-crm/pull/250#issuecomment-6999317500) | Chưa merge — sau #249 |

Mỗi PR đã merge có `[KET-LUAN]` riêng trên chính PR đó và phê duyệt riêng của Owner; merge bằng Merge Commit khoá theo HEAD.

### 0.2 Hai lỗi MAJOR do reviewer phát hiện sau đợt rà soát

Đợt rà soát 18/11 **không** bắt được hai lỗi dưới đây (mục 1 khi đó ghi "sẵn sàng nghiệm thu" là kết luận của người viết, chưa qua review độc lập cho nửa sau của chuỗi):

| Mã | PR · HEAD bị lỗi | Lỗi | Bản sửa | Kết luận |
|---|---|---|---|---|
| PR249-R1-01 | #249 · `c5dd747` | Lưu lại sau 409 gửi cả những trường người dùng **chưa sửa** ⇒ ghi đè thay đổi của người khác | `3bfa073` (chi tiết ở mục 6a) | R2: CLOSED — [6999317246](https://github.com/siscomdiuehoa/siscom-crm/pull/249#issuecomment-6999317246) |
| PR250-R1-01 | #250 · `68399e5` | Tổng cột kanban hợp lệ nhưng dài hơn 15 chữ số hiện thành "Chưa rõ" | `bcaca16` (chi tiết ở mục 6a) | R2: CLOSED — [6999317500](https://github.com/siscomdiuehoa/siscom-crm/pull/250#issuecomment-6999317500) |

### 0.3 Số liệu kiểm thử — gắn với từng mốc mã và nguồn

| Mốc mã | Hạng mục | Số liệu | Nguồn | Ai kiểm được |
|---|---|---|---|---|
| `4734d4c` | Backend unit | 785/785 (58 suite) | Chạy cục bộ 18/11; log: `sales-s8-s11-20261118/backend-unit.txt` | Tác giả; log nay nằm trong PR |
| `4734d4c` | Backend tích hợp | 456/456 trên 25 file, 17 ca `db-roles` bỏ qua | Chạy cục bộ từng file: `backend-int-tung-file.txt` (24 file đạt = 365 ca; `auth.int-spec` rớt 91/91 vì cần DB mới) + `backend-int-auth-db-moi.txt` (chạy lại `auth.int-spec` trên DB mới: 91/91) | Tác giả; log nay nằm trong PR |
| `4734d4c` | Frontend toàn bộ | 734/734; danh sách test của CI 364/364 | Chạy cục bộ 18/11; **không còn log** | Tác giả — reviewer: NOT_VERIFIED |
| `4734d4c` | Kịch bản API 143 phép kiểm | 142 đạt, 1 không đạt (L-01) | `api-rbac-truoc-sua-L01.txt` | Tác giả; log nay nằm trong PR |
| Backend thử có bản sửa L-01 (`2b0f723`) | Kịch bản API 143 phép kiểm | 143/143 | `api-rbac-sau-sua-L01.txt` | Tác giả; log nay nằm trong PR |
| Schema trước Sales `bbfc322` → `4734d4c` | Dấu vân tay 20 bảng cũ | 20/20 khớp sau nâng cấp, sau lùi, sau nâng lại | `legacy-20-bang-dau-van-tay.json` (mốc trước nâng cấp: số dòng + md5 từng bảng) | Tác giả; mốc nay nằm trong PR, kết quả so sánh không còn log |
| `3bfa073` (#249) | Frontend trong CI | 359/359, build đạt | Log CI run 44454555478 | **Reviewer đã kiểm độc lập** |
| `3bfa073` (#249) | Frontend toàn bộ, cục bộ | 729/729 | Chạy cục bộ 19/11; không lưu log | Tác giả — NOT_VERIFIED |
| `bcaca16` (#250) | Frontend trong CI | 375/375, build đạt | Log CI run 44454926587 | **Reviewer đã kiểm độc lập** |
| `bcaca16` (#250) | Frontend toàn bộ, cục bộ | 745/745 | Chạy cục bộ 19/11; không lưu log | Tác giả — NOT_VERIFIED |
| `d5035da` (`main`) | CI đầy đủ | 6/6 | Run 44458491732 | Ai cũng xem được |

Các tệp log nằm ở `docs/evidence/sales-s8-s11-20261118/` (đã bỏ mã màu; không có mật khẩu, cookie, chuỗi kết nối).

**Chưa chạy lại trên HEAD mới (`3bfa073`, `bcaca16`) hay trên `main` `d5035da`:** backend unit / tích hợp cục bộ (hai bản sửa chỉ chạm frontend; CI có chạy backend trên các HEAD này), kịch bản API 143 phép kiểm, diễn tập nâng cấp / lùi, và lượt thử trình duyệt 4 vai trò. Số 734 / 364 / 456 / 143 ở các mục dưới **không** phải bằng chứng cho HEAD mới.

### 0.4 Việc còn mở

1. #249 rồi #250: chờ Owner duyệt merge từng PR. Cả hai đổi `frontend/` nên thuộc diện QA theo `docs/QUY_TRINH_PHOI_HOP_AI.md` §2; cách xử lý QA do Owner quyết và được ghi trong `[KET-LUAN]` của từng PR.
2. Khôi phục thử bản sao lưu staging (Owner thực hiện — `docs/SALES_S12_STAGING_PLAN.md`, Phụ lục A).
3. S12 (staging): chưa bắt đầu; mỗi bước cần Owner duyệt riêng.
4. Chưa có: nghiệm thu trên staging, iPhone thật, hai người sửa cùng lúc trên trình duyệt thật, dữ liệu thật.

### 0.5 Kiểm lại — 19/11/2026, 06:00 UTC (thay cho trạng thái của #249, #250 và `main` ở 0.1 và 0.4)

**Cả 8 PR #243–#250 đã merge. `main` = `0e709b9`; CI trên `main` 6/6 — run 44466202529.** Số liệu lịch sử ở các mục khác giữ nguyên.

| PR | HEAD đã merge | Merge commit | CI `main` sau merge | `[KET-LUAN]` | Thử giao diện trên trình duyệt thật (tác giả chạy) |
|---|---|---|---|---|---|
| #249 | `3bfa073` | `ed9e0d1` (19/11 05:25 UTC) | 6/6 (44465045282) | [7000595107](https://github.com/siscomdiuehoa/siscom-crm/pull/249#issuecomment-7000595107) | Hai phiên cùng sửa một cơ hội: 25/25 — [7000182390](https://github.com/siscomdiuehoa/siscom-crm/pull/249#issuecomment-7000182390) |
| #250 | `bcaca16` | `0e709b9` (19/11 05:35 UTC) | 6/6 (44466202529) | [7000752437](https://github.com/siscomdiuehoa/siscom-crm/pull/250#issuecomment-7000752437) | Tổng cột kanban + bản 375 px: 11/11 — [7000641223](https://github.com/siscomdiuehoa/siscom-crm/pull/250#issuecomment-7000641223) |

- **QA giao diện:** không có `[QA-REPORT]` cho #249 và #250. Owner chỉ đạo (19/11/2026) không đưa Gemini vào luồng; nguyên văn chỉ đạo và danh sách phần giao diện đã thử / còn thiếu nằm trong `[KET-LUAN]` của từng PR. Các lượt thử trình duyệt đều do tác giả chạy — **chưa có kiểm thử giao diện độc lập**.
- Việc 1 ở mục 0.4 đã xong. Còn mở: việc 2 (khôi phục thử), 3 (S12), 4 (nghiệm thu staging, iPhone thật, dữ liệu thật).
- Mã trên `main` tại `0e709b9` trùng cây mã của HEAD `bcaca16` (đã kiểm trước khi merge), nên các kết quả CI và thử giao diện ghi cho `bcaca16` áp dụng cho `main` hiện tại. Kịch bản API 143 phép kiểm, diễn tập nâng cấp / lùi và lượt thử 4 vai trò **vẫn chưa** được chạy lại trên `main` này.

---

**Từ đây trở xuống là ảnh chụp đợt rà soát 18/11/2026.** Nội dung giữ nguyên như lúc lập (mốc `4734d4c`, và `68399e5` sau bản sửa L-01), chỉ sửa những câu tự mâu thuẫn mà reviewer đã chỉ ra. Trạng thái hiện tại xem mục 0.

## 1. Kết luận của đợt rà soát (18/11/2026, tại `4734d4c` / `68399e5`)

**Tại thời điểm rà soát, người viết đánh giá phân hệ Sales S8–S11 sẵn sàng về kỹ thuật để Owner nghiệm thu.** Đánh giá này được đưa ra **trước** khi #247–#250 có review độc lập; review sau đó tìm thêm 2 lỗi MAJOR (mục 0.2). Vì vậy kết luận "sẵn sàng" chỉ có giá trị cùng với các kết luận R2 PASS ở mục 0.1, không tự đứng một mình.

- Lúc rà soát: chức năng trong phạm vi đạt khi kiểm bằng test tự động, gọi API thật và trình duyệt với backend thật. Đợt rà soát tìm ra **1 lỗi mới mức nhỏ** về rò rỉ gián tiếp (mục 5, L-01) — đã sửa trong #245; còn một số điểm thiếu đã biết.
- Lúc rà soát: 6/8 PR chưa có kết luận review cuối (#245, #246 chờ R2; #247–#250 chưa có vòng review nào).
- Chưa có nghiệm thu trên staging, iPhone thật, và dữ liệu thật — thuộc S12, cần Owner duyệt riêng. (Vẫn đúng tại mục 0.)

## 2. Tình trạng 8 PR lúc rà soát (cuối ngày 18/11/2026, sau bản sửa L-01, trước khi merge PR đầu tiên)

| PR | Nội dung | HEAD lúc đó | CI trên HEAD đó | Review lúc đó |
|---|---|---|---|---|
| #243 | S8a: chuyển người phụ trách, xoá mềm, khôi phục | `a15cacc` | 6/6 (run 44048290937) | PASS R1 (1 MINOR) |
| #244 | S8b: Tạm hoãn / Tiếp tục / Thắng / Thua / Mở lại + việc tự tạo | `ca8831d` | 6/6 (44057650006) | PASS R2 |
| #245 | S9a: hoạt động theo cơ hội, đường đọc theo việc của Kỹ thuật | `2b0f723` | 6/6 (44272823911) | R1 = 2 MAJOR đã sửa; chờ R2 (thêm bản sửa L-01) |
| #246 | S9b: tài liệu cơ hội | `30da84c` | 6/6 (44273183796) | PASS R1 phần S9b; chờ kiểm lại sau bản sửa #245 |
| #247 | S10a: API lựa chọn cho giao diện (chỉ đọc) | `5af596e` | 6/6 (44273182917) | Chưa có |
| #248 | S10b: danh sách, bộ lọc, tạo, chi tiết, thao tác | `18563ee` | 6/6 (44273186268) | Chưa có |
| #249 | S10c: sửa, 3 tab, đã xoá + khôi phục | `c5dd747` | 6/6 (44273183825) | Chưa có |
| #250 | S11: kanban, tab Cơ hội ở khách, điện thoại | `68399e5` | 6/6 (44273183263) | Chưa có |

- Lúc đó cả 8 PR là Draft, `MERGEABLE`, không xung đột. (Hiện trạng: 6 PR đã merge — mục 0.1.)
- **Chuỗi nhánh liền mạch:** mỗi nhánh xuất phát đúng từ đỉnh nhánh trước (merge-base = đỉnh nhánh nền, lệch 0 commit). Lúc rà soát: `main..đỉnh` = 19 commit = 1 + 4 + 2 + 4 + 1 + 4 + 2 + 1; không thiếu, không lặp. Sau bản sửa L-01: thêm 1 commit ở #245 và 5 merge commit (mỗi nhánh trên một cái); kiểm lại vẫn liền mạch, mọi nhánh chứa đủ nhánh nền. `main` đứng ở `5be556b` từ khi mở chuỗi cho tới lần merge đầu tiên (#243, 18/11/2026 09:47 UTC); từ đó `main` đã đổi 6 lần (mục 0.1).
- **Tương thích Backend ↔ Frontend:** mọi API giao diện gọi đều có ở backend của cùng chuỗi (kiểm bằng nhật ký mạng trên backend thật: không có 404 / 400 ngoài dự kiến). Frontend S10b–S11 **phụ thuộc** backend S10a (#247): `/opportunities/meta`, `owner-candidates`, `handover-candidates`. Backend không phụ thuộc frontend.

## 3. Kết quả kiểm thử (chạy thật, tại đỉnh chuỗi `4734d4c`; nguồn và log của từng số: mục 0.3)

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
4. Chạy 4 script rollback (S9 → S8 → S5 → S2) ⇒ 20/20 bảng khớp; schema trùng khít bản trước Sales (`prisma migrate diff`: không khác biệt); còn đúng 12 migration. **Giới hạn của diễn tập này:** database diễn tập **chưa** được cấp 10 mã quyền `opportunity.*`, nên bước gỡ quyền (`SALES_S5_OPPORTUNITY_PERMISSIONS_REMOVE`) không nằm trong lượt chạy. Trên một DB **đã** cấp quyền (như staging sau S12 bước 6), script S5 sẽ từ chối cho tới khi gỡ quyền xong — thứ tự đầy đủ ở `docs/SALES_S12_STAGING_PLAN.md` mục 5. Đường "cấp quyền → gỡ quyền → gỡ cấu trúc" trên dữ liệu cũ **chưa** được diễn tập trong đợt này.
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

## 6. PR còn chờ review lúc rà soát (cuối ngày 18/11/2026)

- **#245** — chờ `[REVIEW-R2-RESULT]` (đã gửi R2 tại `8bc4933`).
- **#246** — chờ reviewer kiểm lại sau bản sửa #245 (đã gửi R2 tại `4c239c8`).
- **#247, #248, #249, #250** — đã gửi `[REVIEW-REQUEST]`, chưa có vòng review nào.

Hiện trạng: cả 8 PR đã có kết luận review PASS trên HEAD cuối; liên kết từng kết luận ở mục 0.1.

## 6a. Kết quả review ngày 19/11/2026 và bản sửa

| PR | Kết quả | Phát hiện | Xử lý |
|---|---|---|---|
| #245 | PASS R2 trên `2b0f723` | PR245-R1-01, PR245-R1-02, L-01: CLOSED | Đã merge `4b02de9` |
| #246 | PASS R2 trên `30da84c` | Không có MAJOR mới | Đã merge `44cff52` |
| #247 | PASS R1 trên `5af596e` | MINOR: danh sách ứng viên cắt ở 500 người mà không báo | Đã merge `2725e80`; MINOR theo dõi (T-09) |
| #248 | PASS R1 trên `18563ee` | MINOR: hộp thao tác sau 409 giữ form cũ; cần xác nhận lại khi cờ xác suất nhập tay đổi | Đã merge `d5035da`; MINOR theo dõi (T-10) |
| #249 | R1: CHANGES_REQUESTED trên `c5dd747` → **R2: PASS trên `3bfa073`** | **PR249-R1-01 (MAJOR):** lưu lại sau 409 gửi cả trường người dùng chưa sửa ⇒ ghi đè thay đổi của người khác. MINOR: hộp ghi nhận hoạt động chỉ tự nhận Công việc | MAJOR đã sửa ở `3bfa073`, reviewer ghi CLOSED; chờ Owner duyệt merge |
| #250 | R1: CHANGES_REQUESTED trên `68399e5` → **R2: PASS trên `bcaca16`** | **PR250-R1-01 (MAJOR):** tổng cột hợp lệ vượt 15 chữ số hiện "Chưa rõ" | MAJOR đã sửa ở `bcaca16`, reviewer ghi CLOSED; merge sau #249 |

**PR249-R1-01 — cách sửa:** biểu mẫu Sửa giữ bản gốc lúc mở. Khi cơ hội được tải lại sau 409, ô người dùng **chưa sửa** nhận giá trị bản mới; ô **cả hai cùng sửa** thành giá trị khác nhau thì nút Lưu bị khoá cho tới khi người dùng chọn "Giữ nội dung của tôi" hoặc "Dùng bản mới" cho từng ô. Test tái hiện đúng ca của reviewer (A sửa nhu cầu, B đổi tiền 100 → 200): trước sửa, lần lưu lại gửi kèm tiền 100; sau sửa chỉ gửi nhu cầu, tiền của B còn 200. Thêm 5 ca hàm thuần và 3 ca qua hộp Sửa (cùng sửa một trường, null / 0, xác suất + lý do). Frontend 729/729 trên nhánh #249.

**PR250-R1-01 — cách sửa:** bộ định dạng **tổng** nhận mọi số nguyên không âm (tính bằng BigInt, không qua Number); giới hạn 15 chữ số chỉ còn áp cho giá trị của **một** cơ hội. Test tái hiện đúng ca của reviewer (hai thẻ 999.999.999.999.999 đ ⇒ "1.999.999,9 tỷ") và các biên 15 / 16 / 17 chữ số, số 0, cột toàn null, cột lẫn tiền và null, nhãn cột qua component. Frontend 745/745 trên nhánh #250.

Ý nghĩa với đợt rà soát 18/11: hai lỗi này **không** bị bộ kiểm của đợt rà soát bắt được — ca 409 khi đó chỉ kiểm "version mới được dùng", chưa kiểm nội dung thân yêu cầu khi người khác đã đổi trường khác; ca tổng lớn chỉ kiểm hàm cộng, chưa kiểm nhãn hiển thị. Cả hai nay đã có test chốt.

## 7. Rủi ro còn tồn tại

1. **(Lúc rà soát) Review chưa phủ nửa sau của chuỗi.** #247–#250 (khoảng 3.500 dòng thêm mới ở frontend và 3 API chỉ đọc) khi đó mới có tự kiểm của người viết. Rủi ro này **đã thành sự thật**: review ngày 19/11 tìm ra 2 MAJOR ở #249 và #250 (mục 0.2), nay đã sửa và được R2 đóng. Phần còn lại của rủi ro: giao diện chưa có QA độc lập trên trình duyệt thật.
2. **Chuỗi 8 PR xếp chồng.** Một bản sửa ở PR dưới (ví dụ L-01 ở #245) buộc cập nhật mọi nhánh phía trên và chạy lại CI. Vì không được force-push, việc đó phải làm bằng merge nhánh dưới lên nhánh trên.
3. **Chưa chạy trên môi trường giống thật.** DB thử cục bộ chưa tách role (`siscom_app` là chủ sở hữu); CI có chạy trên DB đã tách role nhưng staging / VPS chưa có migration và grants V5 của Sales.
4. **Grants V5 được mở rộng tại chỗ** (thêm bảng tài liệu) thay vì tạo V6. Hợp lệ vì V5 chưa chạy trên DB thật, nhưng ở S12 phải chạy đúng thứ tự: migration → cấp lại grants từ V5 hiện hành → VERIFY.
5. **Chưa có nghiệm thu với người dùng thật và dữ liệu thật**; chưa thử iPhone thật; chưa thử hai người sửa cùng lúc trên trình duyệt (đã có test API và giao diện cho 409).
6. **Đồng thời:** tranh chấp quyền người nhận trong lúc chuyển người phụ trách được reviewer đánh dấu chưa kiểm chứng (#243).
7. **Quy mô:** kanban và danh sách chưa thử với hàng nghìn cơ hội thật; test dữ liệu lớn mới ở mức 230 thẻ / cột với dữ liệu giả.

## 8. Đề xuất thứ tự merge an toàn

Nguyên tắc: từng PR một, đúng thứ tự chuỗi, Merge Commit khoá theo HEAD, mỗi PR cần mã duyệt riêng của Owner.

1. L-01 đã sửa trong #245; không còn việc tiền đề nào về mã trước khi merge.
2. **Khối backend:** ~~#243~~ → ~~#244~~ (đã merge 18/11) → ~~#245~~ → ~~#246~~ → ~~#247~~ (đã merge 19/11).
3. **Khối frontend:** ~~#248~~ (đã merge 19/11) → #249 → #250.
4. Sau **mỗi** lần merge (cách đã thực hiện với #244–#248):
   - chờ CI trên `main` đạt 6/6;
   - đổi base của PR kế tiếp sang `main`. GitHub **không** chạy lại CI khi chỉ đổi base, nên kiểm bằng cách so cây mã: cây trộn `main` + HEAD của PR phải trùng cây của chính HEAD đó — khi trùng, lượt CI 6/6 đã có trên HEAD là hợp lệ cho nền mới; nếu khác thì phải có lượt CI mới;
   - đăng `[KET-LUAN]` trước khi merge PR kế tiếp.
5. Điểm dừng an toàn: sau #247 (backend đủ, giao diện chưa đổi) và sau #250. Dừng giữa khối frontend vẫn an toàn vì mục "Cơ hội kinh doanh" chỉ mở khi máy chủ cấp quyền đọc cơ hội — mà quyền này chưa được cấp trên DB thật cho tới S12.
6. Không deploy giữa chừng. Merge vào `main` không làm thay đổi staging / VPS.

## 9. Kế hoạch đưa lên staging (S12) — chỉ là đề xuất, chưa thực hiện

Mỗi bước cần Owner duyệt riêng (theo §9 của `docs/SALES_DESIGN.md`).

**Chuỗi thực thi duy nhất nằm ở `docs/SALES_S12_STAGING_PLAN.md`** (mục 3 — thứ tự kỹ thuật, mục 4 — các bước 0–8, mục 5 — phương án lùi). Bảng bước từng có ở đây đã được gỡ (PR251-R1-05) vì nó tách "migrate", "cấp grants" và "triển khai" thành ba bước riêng, trong khi trên thực tế **một** lệnh `deploy.sh --migrate` làm cả chuỗi sao lưu → migration → grants V5 → VERIFY → đổi bản chạy. Người vận hành chỉ theo tài liệu kế hoạch, không chạy lặp theo báo cáo này.

Tóm tắt để đối chiếu (không dùng để thao tác): chốt SHA → ghi mốc dữ liệu → sao lưu + khôi phục thử → chạy thử khô → `deploy.sh --migrate` (một lần) → seed danh mục → cấp mã quyền `opportunity.*` qua hai người (**bước 6** của kế hoạch) → kiểm nhanh → nghiệm thu. Đường lùi mặc định: lùi mã, **giữ** schema.

## 10. Việc chờ Owner quyết định

1. ~~L-01~~ — đã quyết và đã làm (sửa trong #245).
2. ~~Thứ tự merge~~ — Owner đã quyết (18/11/2026): merge #243 trước, kiểm `main` và CI, rồi mới #244; không merge đồng thời — **đã thực hiện xong cả hai**; sau đó #245–#248 cũng đã merge từng PR một (mục 0.1).
3. Duyệt merge #249, rồi #250 (từng PR, kèm quyết định về QA giao diện).
3a. Thời điểm bắt đầu S12. (Hai người thực hiện bước cấp quyền đã được Owner chỉ định ngày 19/11/2026 — `docs/SALES_S12_STAGING_PLAN.md` mục 8.)
4. ~~Đưa báo cáo vào repo~~ — Owner đã quyết: có, qua PR tài liệu riêng.

## Phụ lục — môi trường và bằng chứng

- Backend thử: build từ `4734d4c`, `http://127.0.0.1:3100`; frontend dev `http://127.0.0.1:5180`; DB thử `siscom_crm_test_20261118_141945` (đã migrate, seed, bootstrap 5 tài khoản thử).
- Nhật ký của đợt rà soát đã được đưa vào repo tại `docs/evidence/sales-s8-s11-20261118/` (19/11/2026, theo ghi chú NOT_VERIFIED của reviewer ở #251): `api-rbac-truoc-sua-L01.txt` (143 phép kiểm: 142 đạt, 1 không đạt), `api-rbac-sau-sua-L01.txt` (143/143), `backend-unit.txt`, `backend-int-tung-file.txt`, `backend-int-auth-db-moi.txt`, `legacy-20-bang-dau-van-tay.json`. Các tệp là bản sao nguyên văn của log lúc chạy, chỉ bỏ mã màu của terminal. Kịch bản `audit-rbac.mjs` (đọc mật khẩu tài khoản thử từ tệp ngoài repo) và log của frontend **không** được đưa vào; log so sánh dấu vân tay sau từng bước diễn tập không còn.
- Đợt rà soát đã tạo thêm dữ liệu thử trong DB thử cục bộ (các cơ hội tên "Rà soát vòng đời…", "Cơ hội của Admin…"). Không ảnh hưởng gì ngoài máy dev.
