# OVN06 — Kế hoạch tích hợp ngăn xếp PR (bổ sung cho K06 #138)

- Batch `SISCOM-OVERNIGHT-20261025`, task `SISCOM-OVN06-PR-STACK-INTEGRATION-PLAN` (Issue #8, task comment `6398970779`, approval `6398971174`, phạm vi `CODE_TEST_DRAFT_ONLY`).
- Loại: **docs-only, Draft**. Không phải bằng chứng sẵn sàng release. Không ghi hộ owner quyết định nào.
- Nguồn: `gh pr list/view/checks` (chỉ đọc) và `git merge-tree --write-tree` trên bản sao đối tượng Git, ngày 2026-10-25. `origin/main` = `a5de704`. Không chạy test mã nguồn, không đụng DB/.env/workflow/policy. Chỉ liệt kê **điều mới so với K06**; ma trận cũ xem `docs/RELEASE_BLOCKER_DECISION_PACKET_K06.md` (PR #138).

## 1. Điều mới so với K06

| # | Phát hiện | Bằng chứng |
|---|---|---|
| N1 | **#63 đã đổi head**: K06 ghi `5cf0cb5`, hiện là `350ecb1` (Q01: siết allowlist gitleaks theo đường dẫn neo `^…$` và **cả dòng**). #111 (`31b16b5`) và #124 (`79cb5a7`) vẫn mang bản allowlist **cũ, lỏng** (đường dẫn không neo, regex `^\s*const SECRET_PW = ` chấp nhận mọi giá trị trên dòng đó). | `git diff origin/main <head> -- .gitleaks.toml` |
| N2 | **#63 xung đột `.gitleaks.toml` với #111 và #124** (add/add khác nội dung). Mô phỏng `main+#63` thành công; `+#106` thành công; `+#124` và `+#111` đều `exit=1` xung đột `.gitleaks.toml`. | `git merge-tree --write-tree` |
| N3 | Ngoại lệ một lần A2 của K06 đang gắn SHA `31b16b5` — SHA đó chứa allowlist lỏng hơn #63 hiện tại. Nếu owner chọn A2, nên gắn vào #63 `350ecb1` (hoặc không dùng #111). | so sánh toml |
| N4 | **Nhóm PR docs base `main` (#138, #139, #128) và #144 đỏ gitleaks tại thời điểm 2026-10-25/26** (chưa xác minh lại từng PR ở lô S03; #106 đỏ theo K06). #144 (head `9ac25b3`, run `40205842212`): `Quet bi mat (gitleaks)` FAILURE + `CI gate` FAILURE, Backend/Frontend SUCCESS. Nguyên nhân là hai phát hiện lịch sử `generic-api-key` (`auth-security.a5.spec.ts:204`, `B1.3_M1_CONSTRAINT_TESTS.sql.txt:155`), không phải nội dung PR. Chỉ hết đỏ sau khi #63 vào `main` (hoặc PR được rebase lên nền có allowlist). | `gh pr checks 138`, log gitleaks (giá trị đã bị che) |
| N5 | PR mới: #139 (N02, docs), #140 (OVN01), #141 (OVN03), #142 (OVN04), #143 (OVN05). Chỉ **#139 và #143 có CI** (#143 xanh 4/4; #139 đỏ gitleaks như N4). #140–#142 `NOT_RUN`. | `statusCheckRollup` |
| N6 | **#142 vượt hai ngăn xếp**: base là #140 (chuỗi BE sâu 35) nhưng cộng thêm 45 commit, gồm cả nội dung FE (#137 + #141 và tổ tiên FE). Không thể merge độc lập; merge chuỗi nào trước thì #142 phải rebase. | `git rev-list --count base..head` = 45; `git diff --name-only` có `frontend/**` |
| N7 | M02 (`b85127c`) và M03 (`d16f3f8`) chỉ có commit **cục bộ**, **chưa push, chưa có PR**; không có nhánh P/Q trên remote ngoài #63 (Q01). Không có gì để tích hợp từ M/N/P/Q ngoài #139–#143 và #63. | `git ls-remote --heads`, `git worktree list` |
| N8 | Review: **0 review** trên cả 20 PR đã đọc (#63, #106, #111, #124, #127, #128, #130–#143). Tất cả `isDraft=true`. | `gh pr view --json reviews` |

## 2. Đồ thị phụ thuộc thực tế (đã kiểm: mỗi PR đều `behind=0` so với base của nó)

| Ngăn xếp | Chuỗi tới `main` | Độ sâu | CI trên head |
|---|---|---|---|
| CI/gitleaks | #63 → main; #106 → main; (#111 = #63cũ + #106 gộp → main) | 0 | #63 PASS 4/4, #106 FAIL, #111 PASS |
| PG harness + CI | #143 → #136 → #134 → #124 → main; #127 → #124 | 3 | #124/#127/#134/#136/#143 PASS 4/4 |
| PG harness (chưa CI) | #133 → #132 → #123 → #109 → #108 → #107 → #100 → main | 5–6 | #132/#133 NOT_RUN |
| FE | #137/#135/#141 → #130 → #125 → #110 → #102 → #98 → #86 → #85 → #83 → #79 → #75 → #74 → #72 → #69 → #66 → #65 → #62 → #61 → #60 → #59 → #58 → main | 19–20 | #130/#135/#137/#141 NOT_RUN |
| BE auth | #131 → #115 → #84 → #50 → … → #15 → main; #140 → #131; #142 → #140 | 33–35 | #131/#140/#142 NOT_RUN |
| Docs trên main | #128, #138, #139 → main | 0 | #128/#138/#139 FAIL gitleaks (N4) |

Xung đột (`merge-tree`, không đổi working tree): #135+#137, #135+#141, #137+#141 **không xung đột** (anh em cùng base #130). #124+#128, #124+#138, #124+#139, #106+#111, #63+#106 không xung đột. Ba cặp có xung đột: #63+#111, #63+#124 và (sau khi #63+#106 vào main) #124 chưa rebase.

## 3. Trình tự merge đề xuất (owner thực hiện; tôi không merge)

Mỗi bước squash merge sau khi có review khác tác giả (CONTRIBUTING §3.3) và CI xanh trên đúng head.

1. **#63** (head `350ecb1`, allowlist đã siết). Không dùng #111 làm phương tiện: nó trùng #63+#106 và mang allowlist lỏng.
2. **#106** (chỉ bỏ `branches: [main]` ở `pull_request`; tôi đọc diff: không có `pull_request_target`, không thêm secret). Cần rebase lên `main` sau bước 1 để gitleaks xanh.
3. Rebase **#124** lên `main` mới (giải xung đột `.gitleaks.toml` bằng cách **lấy bản của #63**, bỏ khối cũ; ngoài ra #124 đã tự chứa thay đổi #106 nên sẽ rỗng ở `ci.yml`). Chạy lại CI trước khi merge.
4. #127, #134 → #136 → #143 (đã xanh trên chuỗi, retarget về `main` dần).
5. Docs: #128, #138, #139 sau bước 1–2 (rebase để hết đỏ gitleaks).
6. Chuỗi PG #100…#133 và FE/BE sâu 19–35: **không đề xuất merge từng PR**. Cần quyết định riêng của owner (gộp bằng một PR tích hợp có review, hay merge tuần tự); #142 phụ thuộc cả hai chuỗi nên đi sau cùng.

## 4. Lỗ hổng/rủi ro bảo mật còn lại (từ đọc diff, chưa chạy test mới)

- Allowlist gitleaks lỏng của #111/#124 (N1): một bí mật thật nằm trên dòng `const SECRET_PW = …` trong đúng tệp đó sẽ không bị quét. Rủi ro hẹp nhưng tránh được bằng thứ tự ở mục 3.
- Mặc định từ chối của auth: các route auth vẫn `NOT_IMPLEMENTED` và `/customers` default-deny chỉ được khóa bằng test ở #131 (NOT_RUN CI). Chưa có triển khai auth thật nào để đánh giá lỗ hổng.
- Test `.mjs` PG chỉ chạy trong CI ở chuỗi #136, chưa có trên `main`; mọi kết quả PG là mock, DB thật `NOT_RUN`.

## 5. Quyết định cần chủ dự án (không chọn thay)

1. **JWT (HS256 + `sid`) hay `sid_` không trong suốt**: so sánh đã có ở K06 §3(b); mục này không thay đổi nhận định. Điểm mới: #131/#140 đã khóa trạng thái hiện tại và không hàm ý chọn nào; chưa PR nào triển khai token.
2. Reviewer khác tác giả cho #63/#106 (hoặc ngoại lệ một lần, nay nên nêu SHA `350ecb1` thay `31b16b5`).
3. Cách xử lý ngăn xếp sâu (mục 3 bước 6) và #142 vượt chuỗi.
4. Phê duyệt PostgreSQL disposable riêng (K06 §3(c)).

## 6. Điều kiện chưa đủ để release

Chưa review độc lập; chưa PR nào merge; CI NOT_RUN cho #130–#133, #135, #137, #140–#142; main chưa có allowlist gitleaks nên CI đỏ gitleaks (lịch sử) với nhóm PR base `main` nêu ở N4 (#138/#139/#128/#144) — không phải mọi PR (ví dụ #143 xanh 4/4 trên `6728363`, run `40205542163`); chưa kiểm DB thật; chưa chọn JWT/`sid_`; chưa có auth thật; chưa có branch protection/CI bắt buộc (K06: API 403). "Draft" hoặc "CI PASS" ở trên **không** có nghĩa sản phẩm sẵn sàng.

## 7. Phạm vi, NOT_RUN, rollback

- Đã chạy: `gh pr list/view/checks` (đọc), `gh run view --log-failed` (đọc, giá trị bí mật đã bị che bởi gitleaks), `git fetch origin`, `git merge-tree --write-tree` (khoảng 17 cặp/bước mô phỏng; chỉ ghi đối tượng Git không tham chiếu), `git commit-tree` cho mô phỏng, `git worktree add` cho nhánh docs này.
- `NOT_RUN`: mọi test mã nguồn (Jest, `node --test`, Chrome), build, DB, migration, Prisma, benchmark. Số test của các PR khác là số do task gốc tự báo (K06), chưa xác minh lại.
- Không đụng: `src`, workflow, `.gitleaks.toml`, `package.json`, Runner, `.env`, `main`, branch protection.
- Rollback: đóng Draft PR, xóa nhánh `docs/ovn06-pr-stack-integration-plan` và `git worktree remove D:\SISCOM-CRM-ovn06`.
- Rollback riêng cho OVN04 (#142): chỉ xóa **2 file** của commit `cd31e82` (`backend/docs/OVN04_CUSTOMER_API_MOCK_SMOKE.md`, `backend/src/modules/customers/fe-be-customer-api.smoke.spec.ts`; và bổ sung S03 nếu đã tích hợp). Việc này **không** hoàn tác 64 file / 45 commit của toàn stack #142 (gộp #140 + #137 + #141); muốn hoàn tác các phần đó phải làm theo từng PR nguồn.

## 8. Điều chỉnh S03 (SISCOM-S03-OVN-REVIEW-FOLLOWUPS, 2026-10-26) — chỉnh kế hoạch, KHÔNG tích hợp

Nền #144: `9ac25b3`. `origin/main` = `a5de704`. Số liệu dưới đây lấy từ `gh pr view/run view` (đọc) và lệnh test cục bộ; số tự báo của task trước **không** phải kết quả độc lập.

### 8.1 Ma trận cập nhật theo SHA mới (thay các dòng tương ứng ở mục 2 và N5, N7)

| PR | Head SHA | Base | CI trên head | Ghi chú |
|---|---|---|---|---|
| #140 | `1c68944` | #131 | NOT_RUN | S03 mục #140: **WAITING_COORDINATION** (giao thủ công 6405332316, chưa thấy kết quả/PR/commit mới) |
| #141 | `6efd961` | #130 | NOT_RUN | Bổ sung S03: #151 (`a3d123f`, test ký tự vô hình) |
| #142 | `cd31e82` | #140 | NOT_RUN | Bổ sung S03: #152 (`238568c`, nhóm E kiểm hành vi). Chỉ commit `cd31e82` (2 file) là phần OVN04 riêng; toàn diff 45 commit / 64 file |
| #143 | `6728363` | #136 | run `40205542163` SUCCESS 4/4 | Bổ sung S03: #150 (`94e90ad`), run `40250115308` SUCCESS, có bước chạy test checker |
| #144 | `9ac25b3` | main | run `40205842212`: gitleaks FAILURE, CI gate FAILURE | lỗi gitleaks do phát hiện lịch sử, chưa xử lý (không sửa `.gitleaks.toml` trong S03) |
| #145 | `b85127c` | #137 | NOT_RUN | M02 (cải chính N7: đã push, có PR từ S02) |
| #146 | `9e41847` | #145 | NOT_RUN | R01 |
| #147 | `d16f3f8` | #133 | NOT_RUN | M03 |
| #148 | `5b384d4` | #147 | NOT_RUN | R02 |
| #149 | `38001cd` | #146 | NOT_RUN | S02: cầu nối auth tùy chọn UI→repo→client; chưa phải đăng nhập/auth thật; chưa tích hợp vào #142 |

N7 ở trên (M02/M03 chưa push) đã lỗi thời: nay là #145 và #147; #146/#148/#149 là các bản sửa của S01/S02.

### 8.2 Sau squash
Khi một PR nền được squash vào `main`, các PR xếp chồng **không** chỉ retarget: phải loại commit nền đã tích hợp (rebase/cherry-pick lên `main` mới), rồi kiểm lại diff (số file/commit), SHA và CI trên SHA mới trước khi coi là đủ. #142 sau khi thu gọn nên còn phần OVN04 (+ bổ sung S03), xem `backend/docs/S03_OVN04_FOLLOWUP.md` (#152).

### 8.3 Điều kiện chặn còn thiếu (chỉ ghi nhận, không xử lý ở S03)
Allowlist gitleaks (#63) chưa vào `main`; #63/#106/#124 chưa merge; không có review độc lập; PostgreSQL, Chrome, đăng nhập thật là nghiệm thu riêng (NOT_RUN); chưa có auth thật; #63 xung đột `.gitleaks.toml` với #111/#124 (N2).
