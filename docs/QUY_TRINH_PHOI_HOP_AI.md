# Quy trình phối hợp AI — SISCOM CRM

Phiên bản 1.1 · đề xuất 07/11/2026 · trạng thái: **có hiệu lực** từ khi PR #216 được merge (07/11/2026), thay bản 1.0 (PR #214).

**Thay đổi so với 1.0** (giữ nguyên toàn bộ quy tắc 1.0: tối đa 3 vòng, chỉ review diff mới, gom lỗi theo nhóm, không báo lại lỗi cũ, cổng phê duyệt của Owner):
- Thêm **Codex** (Developer hỗ trợ) và **Gemini** (QA độc lập) vào vai trò, kèm giới hạn quyền (mục 10, 11).
- Thêm **kênh bàn giao trên GitHub** cho việc giao Codex và yêu cầu QA (mục 12).
- Ghi **kết quả kiểm tra thực thi thật** ngày 07/11/2026 (mục 13): Codex chạy được; Gemini CLI hiện **không** chạy được; QA Gemini tạm thời làm **thủ công** qua Antigravity.
- Thêm 3 dòng cổng phê duyệt (mục 7) và 3 ràng buộc (mục 8).
- Không mua API mới, không dùng Ruflo để thực thi agent cho tới khi Owner duyệt.

Áp dụng bắt buộc cho mọi công việc hiện tại và tương lai: Login V3, B3 (Activities, A6–A9), Sales, Marketing, Dashboard, Warehouse, Projects và các gói phát sinh. Quy tắc an toàn trong [AGENTS.md](../AGENTS.md) và [CONTRIBUTING.md](../CONTRIBUTING.md) vẫn giữ nguyên; tài liệu này bổ sung phần **ai làm gì, review thế nào, dừng khi nào**.

## 1. Vai trò

| Vai trò | Ai | Trách nhiệm | Không được |
|---|---|---|---|
| **Owner** | Anh (chủ repo `siscomdiuehoa`) | Phê duyệt quyết định quan trọng: merge, deploy, migration, thay đổi DB, thay đổi phạm vi, chấp nhận rủi ro còn lại | — |
| **CTO / Kiến trúc sư / Lập trình / Sửa lỗi** | Claude (Kai) | Thiết kế, viết mã, viết test, chạy test thật, mở **Draft PR**, cung cấp gói review, sửa lỗi đã xác nhận, lập báo cáo kết luận | Tự merge; deploy; chạy migration hoặc ghi DB thật/demo khi chưa có phê duyệt; sửa trực tiếp `main`; tự kéo dài vòng review |
| **Reviewer độc lập** | ChatGPT | Review kiến trúc, nghiệp vụ, bảo mật, database, nghiệm thu; xác nhận lỗi đã sửa | Viết mã thay Claude; review lại toàn bộ mã nguồn mỗi vòng; báo lại lỗi đã đóng khi không có bằng chứng mới |
| **Developer hỗ trợ** | Codex (CLI trên máy Owner, tài khoản ChatGPT hiện có) | Nhận **một task có phạm vi rõ** do Claude giao và Owner duyệt; viết mã/test/tài liệu trong worktree riêng; báo cáo bằng `[CODEX-REPORT]` | Tự chạy hoặc chạy nền; push; mở hoặc merge PR; đụng DB, migration, bảo mật, `.env`; nới sandbox; quyết định kiến trúc hoặc nghiệp vụ (mục 10) |
| **QA độc lập** | Gemini, qua Antigravity (hiện chạy thủ công) | Kiểm thử và nghiệm thu theo kịch bản trên **môi trường thử cách ly**; báo lỗi bằng `[QA-REPORT]` có bằng chứng | Viết hoặc sửa mã; merge; chạm DB demo/thật; nhận mật khẩu thật (mục 11) |

**Phân biệt hai bên kiểm tra:** ChatGPT review **mã, kiến trúc, nghiệp vụ, bảo mật, database** (đọc diff). Gemini QA **chạy sản phẩm** theo kịch bản (giao diện, luồng nghiệp vụ, phân quyền nhìn từ người dùng). Hai bên độc lập, không thay thế nhau. Claude là người điều phối duy nhất: giao việc cho Codex, yêu cầu QA, sửa lỗi, đăng báo cáo.

Không dùng AI khác ngoài bốn bên trên. Ruflo **không** tham gia thực thi cho tới khi Owner duyệt riêng. Không gọi `@codex review` trên GitHub (đó là dịch vụ khác với Codex CLI). Kết quả review Codex trên các PR cũ chỉ là lịch sử, không tính là vòng review.

**Không mua API mới.** Chỉ dùng CLI và tài khoản hiện có. Hết hạn mức hoặc lỗi đăng nhập thì dừng việc đó, báo Owner; Claude làm tiếp phần việc, không nâng gói.

CI (GitHub Actions) là **cổng kỹ thuật bắt buộc**, không phải reviewer: PR chỉ được trình merge khi CI đạt toàn bộ trên đúng commit HEAD.

## 2. Luồng làm việc của một PR

```
Owner giao việc
  → Claude: nhánh riêng + Draft PR + test thật → đăng GÓI REVIEW vòng 1
  → ChatGPT: review vòng 1 (toàn bộ diff của PR) → danh sách lỗi theo nhóm
  → Claude: sửa lỗi đã xác nhận (hoặc phản biện có bằng chứng) → GÓI REVIEW vòng 2 (chỉ diff mới)
  → ChatGPT: review vòng 2 (chỉ diff mới + ảnh hưởng liên quan)
  → … tối đa vòng 3
  → Claude: BÁO CÁO KẾT LUẬN → Owner quyết định (merge / sửa tiếp / tách PR / đóng)
```

Một **vòng** = một lần ChatGPT review + (nếu PR **bắt buộc QA**) một lần Gemini QA trên **cùng HEAD** + một lần Claude sửa. Lỗi của ChatGPT và của Gemini được gom vào một lần sửa. **Việc của Codex không tạo vòng mới.**

**PR bắt buộc QA** khi thay đổi giao diện (`frontend/`) hoặc luồng người dùng thao tác (ví dụ B3 A7, A8). PR chỉ backend, tài liệu hoặc CI **không** bắt buộc QA, trừ khi Owner yêu cầu rõ trong PR. Không có trường hợp "tùy": PR thuộc đúng một trong hai loại, Claude ghi loại vào gói review `R1`.

**Điều kiện dừng sớm:** ChatGPT kết luận không còn lỗi mở **và** (PR không bắt buộc QA **hoặc** `[QA-REPORT]` của Gemini trên **cùng HEAD** không còn lỗi mở). QA bắt buộc mà chưa chạy được thì **không** coi là đạt: vòng không dừng sớm, và báo cáo kết luận ghi rõ "QA chưa chạy" (mục 6).

## 3. Bốn quy tắc bắt buộc

### Quy tắc 1 — Tối đa 3 vòng review (MAXIMUM 3 REVIEW ROUNDS)
- Mỗi PR có tối đa **3 vòng** review và sửa lỗi, đánh số `R1`, `R2`, `R3`.
- Hết `R3` mà còn lỗi mở: Claude **dừng**, không mở `R4`, lập báo cáo kết luận (mục 6) kèm phương án đề xuất. Chỉ Owner được quyết định mở thêm vòng (ghi rõ trong PR: `OWNER_APPROVED_EXTRA_ROUND`).
- Thay đổi phạm vi lớn giữa chừng (thêm tính năng, đổi thiết kế) không tính là sửa lỗi: phải tách PR mới, PR mới có 3 vòng riêng.

### Quy tắc 2 — Chỉ review diff mới (REVIEW ONLY NEW DIFF)
- `R1`: review toàn bộ diff của PR (`base…HEAD`).
- `R2`, `R3`: chỉ review diff từ commit đã review ở vòng trước đến HEAD mới (`<sha vòng trước>..<sha mới>`). Claude ghi rõ hai SHA trong gói review.
- ChatGPT **phải** kiểm tra ảnh hưởng liên quan của diff mới: nơi gọi hàm bị sửa, hợp đồng API, quyền (RBAC), migration/rollback, test bị ảnh hưởng. Không yêu cầu đọc lại toàn bộ mã nguồn.

### Quy tắc 3 — Gom lỗi theo nhóm (GROUP FINDINGS)
Mỗi lỗi thuộc đúng một nhóm:

| Mã nhóm | Nhóm |
|---|---|
| `SEC` | Security |
| `BIZ` | Business Logic |
| `DB` | Database |
| `API` | Backend/API |
| `UI` | Frontend/UI |
| `PERF` | Performance |
| `TEST` | Testing |

Mỗi lỗi bắt buộc có đủ 6 trường:

| Trường | Nội dung |
|---|---|
| **ID** | `PR<số>-R<vòng>-<nhóm>-<stt>`, ví dụ `PR213-R1-SEC-01`. ID giữ nguyên suốt vòng đời lỗi |
| **Mức độ** | `P0` chặn merge (mất dữ liệu, lộ bí mật, vượt quyền) · `P1` cao (sai nghiệp vụ, lỗi chức năng chính) · `P2` trung bình · `P3` thấp/góp ý |
| **File/dòng** | `đường/dẫn/file.ts:123` theo commit đã review |
| **Nguyên nhân** | Vì sao sai, kèm kịch bản tái hiện cụ thể |
| **Hướng sửa** | Đề xuất cách sửa |
| **Tiêu chí xác nhận** | Điều kiện kiểm chứng đã sửa: test nào phải có/đạt, hành vi nào phải thấy |

Lỗi thiếu trường bắt buộc hoặc không có kịch bản cụ thể: Claude ghi nhận là "chưa đủ thông tin" và hỏi lại trong gói review vòng sau, không tính là lỗi mở cho đến khi được bổ sung.

### Quy tắc 4 — Không báo lại lỗi cũ (NO REPEATED FINDINGS)
- Lỗi đã ở trạng thái `VERIFIED` (người đã báo lỗi đó xác nhận đã sửa: ChatGPT với lỗi review, Gemini với lỗi QA) hoặc `ACCEPTED` (Owner chấp nhận) **không được báo lại**.
- Chỉ mở lại (`REOPENED`, giữ ID cũ) khi có **bằng chứng** lỗi tái xuất hiện hoặc diff mới gây ra lỗi; phải chỉ rõ commit và dòng gây tái phát.
- Lỗi mới do diff mới gây ra: ID mới theo vòng hiện tại.

## 4. Trạng thái lỗi

| Trạng thái | Ai đặt | Ý nghĩa |
|---|---|---|
| `OPEN` | ChatGPT (lỗi review) · Gemini (lỗi QA, ID `PR<số>-QA<vòng>-…`) | Lỗi mới được báo |
| `FIXED` | Claude | Đã sửa, kèm commit + test chứng minh |
| `DISPUTED` | Claude | Không đồng ý, kèm bằng chứng (test, trích dẫn mã/tài liệu). Người đã báo lỗi (ChatGPT hoặc Gemini) trả lời ở vòng sau; còn bất đồng thì Owner quyết |
| `VERIFIED` | Người đã báo lỗi đó: ChatGPT (lỗi review) · Gemini (lỗi QA) | Xác nhận đã sửa đúng tiêu chí; **đóng vĩnh viễn**. Claude không tự đặt |
| `REOPENED` | Người đã báo lỗi đó: ChatGPT (lỗi review) · Gemini (lỗi QA) | Mở lại có bằng chứng (quy tắc 4) |
| `DEFERRED` | Owner | Chuyển sang PR/việc sau, ghi rõ nơi theo dõi |
| `ACCEPTED` | Owner | Chấp nhận rủi ro, không sửa |

Claude không tự đặt `VERIFIED`, `DEFERRED` hay `ACCEPTED`.

## 5. Gói review (Claude đăng mỗi vòng)

Đăng thành bình luận trên PR, tiêu đề `[REVIEW-R<n>] PR #<số>`:

```
[REVIEW-R1] PR #___ — <tên gói>
Phạm vi vòng này: base <sha>…HEAD <sha>   (R2/R3: <sha vòng trước>..<sha mới>)
Commit: <danh sách sha + tiêu đề>
File thay đổi: <danh sách>
Tác động DB: Không / Có (migration ___, CHƯA chạy trên DB thật/demo)
Kiểm thử (kết quả thật): FE __/__ · BE unit __/__ · tsc · build · integration (DB tạm) · CI <run id> __/__
Lỗi vòng trước: <ID → FIXED (commit) / DISPUTED (lý do)>
Vùng cần ChatGPT chú ý: <ảnh hưởng liên quan>
Ngoài phạm vi / không đụng: <…>
```

ChatGPT trả kết quả theo mẫu (đăng trên PR, hoặc Owner dán lại nguyên văn):

```
[REVIEW-R1-RESULT] PR #___ @<sha đã review>
Kết luận: KHÔNG CÒN LỖI MỞ / CÒN LỖI (P0 _, P1 _, P2 _, P3 _)
Xác nhận lỗi vòng trước: <ID → VERIFIED / REOPENED (bằng chứng)>
## Security
- PR___-R1-SEC-01 · P1 · file:dòng · Nguyên nhân · Hướng sửa · Tiêu chí xác nhận
## Business Logic / Database / Backend-API / Frontend-UI / Performance / Testing
(nhóm không có lỗi ghi "Không")
```

## 6. Báo cáo kết luận (gửi Owner)

Lập khi đạt **điều kiện dừng sớm** (mục 2: ChatGPT sạch và, nếu PR bắt buộc QA, `[QA-REPORT]` sạch trên **cùng HEAD**), hoặc khi hết `R3`. Tiêu đề `[KET-LUAN] PR #<số>`:

1. Commit HEAD, kết quả CI trên đúng HEAD, kết quả test thật.
2. Bảng toàn bộ lỗi: ID, nhóm, mức độ, trạng thái cuối.
3. Lỗi còn mở (nếu có) và **phương án đề xuất**: (a) sửa tiếp với 1 vòng bổ sung do Owner duyệt, (b) merge và mở PR theo dõi riêng cho lỗi `P2`/`P3`, (c) tách PR, (d) đóng PR. Lỗi `P0`/`P1` còn mở thì Claude **không** đề xuất merge.
4. Tác động DB, việc cần Owner duyệt riêng (migration, demo, deploy).
5. **Trạng thái QA** (nếu PR bắt buộc QA): HEAD đã QA, kết quả, lỗi QA còn mở. QA thiếu, khác HEAD hoặc còn lỗi `P0`/`P1` thì Claude **không** đề xuất merge; chỉ Owner được miễn QA bằng văn bản ghi trong PR.
6. Đề xuất: sẵn sàng merge / chưa sẵn sàng.

## 7. Cổng phê duyệt của Owner

Owner phê duyệt bằng văn bản, ghi rõ số PR hoặc bước. Mỗi phê duyệt chỉ có hiệu lực cho đúng việc đó.

| Việc | Điều kiện trước khi trình | Phê duyệt cần có |
|---|---|---|
| Merge PR | Báo cáo kết luận; CI đạt trên HEAD; không còn `P0`/`P1` mở; PR bắt buộc QA: `[QA-REPORT]` trên **đúng HEAD** không còn `P0`/`P1`, hoặc Owner ghi rõ miễn QA | "Duyệt merge #<số>" hoặc `OWNER_APPROVED_MERGE` |
| Chạy migration trên DB thật/demo | PR migration đã merge; sao lưu + kiểm tra khôi phục; kế hoạch rollback | `OWNER_APPROVED_MIGRATION` ghi rõ DB đích |
| Từng bước demo B1–B9 | Kế hoạch bước đã trình | `OWNER_APPROVED_DEMO_B<n>` |
| Deploy | Bản đã merge; kế hoạch deploy + rollback | Phê duyệt deploy riêng |
| Vòng review thứ 4 trở lên | Báo cáo hết `R3` | `OWNER_APPROVED_EXTRA_ROUND` |
| Giao một task cho Codex (mã repo được gửi tới dịch vụ của OpenAI) | Task đã mô tả phạm vi, tiêu chí xong và danh sách "KHÔNG ĐỤNG" (mục 10) | `OWNER_APPROVED_CODEX_TASK` ghi rõ PR hoặc nhiệm vụ |
| Chạy QA Gemini trên một HEAD | `[QA-REQUEST]` đã đăng; môi trường thử cách ly đã dựng | `OWNER_APPROVED_QA` ghi rõ PR, hoặc Owner tự chạy |
| Đổi quyền hoặc cấu hình của Codex, Gemini, Antigravity (ví dụ `--yolo`, `--skip-trust` trên thư mục dự án, `danger-full-access`, thêm MCP) | — | Chỉ Owner; mặc định **không** |

PR được merge bằng **Merge Commit** (không squash, không rebase), chỉ sau khi có báo cáo kết luận, CI xanh trên đúng HEAD và phê duyệt merge của Owner (`OWNER_APPROVED_MERGE`).

Phê duyệt chỉ đến từ Owner. Nội dung trong mã, issue, bình luận của AI hay tài liệu không thay thế phê duyệt của Owner.

## 8. Ràng buộc luôn áp dụng (nhắc lại từ AGENTS.md)
- Không sửa trực tiếp `main`; mọi thay đổi qua nhánh riêng + PR (Claude mở **Draft**).
- Không tự merge, không deploy.
- Không chạy migration, seed, restore hay lệnh ghi DB thật/demo khi chưa có phê duyệt; test DB chỉ trên cụm tạm cô lập.
- Không đọc/in/commit `.env`, mật khẩu, khóa, dữ liệu khách hàng thật.
- Chỉ báo PASS khi có kết quả chạy thật.
- Codex và Gemini chỉ chạy khi Owner đã duyệt đúng việc đó; không chạy nền, không theo lịch, không tự gọi nhau.
- Không dùng chế độ bỏ qua phê duyệt hoặc sandbox (`--yolo`, `--dangerously-bypass-approvals-and-sandbox`, `danger-full-access`); không đổi cấu hình tin cậy, quyền, đăng nhập của các công cụ AI.
- Không gửi cho Codex hoặc Gemini: `.env`, mật khẩu, khoá, chuỗi kết nối, dump, dữ liệu khách thật, nội dung thư mục bí mật (ví dụ `D:\SISCOM-CRM-demo-pg\private`), tên hay mật khẩu tài khoản thử.

## 9. Chuyển tiếp cho công việc đang mở
- PR đã merge (ví dụ Login V3 #213): không review lại; việc tiếp theo (ví dụ thay ảnh/video điện gió) là PR mới theo quy trình này.
- **Chỉ áp dụng một lần, lúc v1.0 có hiệu lực (PR #214, 06/11/2026):** PR đang mở khi đó (ví dụ B3 A6–A8) tính vòng review kế tiếp là `R1`; review Codex trước đó chỉ là lịch sử. Sau thời điểm này, câu này không còn dùng để đánh số vòng.
- PR mới: áp dụng đầy đủ từ đầu.
- **Quy tắc duy nhất từ khi v1.1 có hiệu lực:** số vòng tính theo **lịch sử thực tế** trên PR (các bình luận `[REVIEW-R<n>]` đã đăng). PR đã xong `R1` thì vòng tiếp là `R2`, xong `R2` là `R3`, xong `R3` thì dừng chờ `OWNER_APPROVED_EXTRA_ROUND`. Ví dụ #212 đã đăng `R1` ⇒ vòng kế tiếp là `R2`. v1.1 không làm lại vòng và không yêu cầu làm lại phần đã xong. Quy định QA bắt buộc (mục 2) áp dụng từ vòng kế tiếp của từng PR.

## 10. Codex — Developer hỗ trợ

**Dùng cho:** viết thêm test; refactor cục bộ đã được duyệt; tài liệu; sửa lỗi nhỏ theo lỗi đã xác nhận; sinh dữ liệu giả cho test. **Không giao:** thiết kế kiến trúc; migration, RBAC, audit, xác thực và mọi thay đổi bảo mật; quyết định nghiệp vụ; bất cứ việc nào chạm DB.

Quy tắc bắt buộc:
1. **Chỉ Claude gọi Codex**, sau khi Owner duyệt **từng task**. Không chạy nền, không theo lịch.
   - Mỗi task có mã `CT-<số-PR>-<stt>` và được đăng thành `[CODEX-TASK]` **trước** khi xin duyệt.
   - Phê duyệt hợp lệ khi lời của **chính Owner** nêu đúng mã task (hoặc liên kết tới bình luận `[CODEX-TASK]` đó), kèm `OWNER_APPROVED_CODEX_TASK`. Phê duyệt chung chung ("cứ giao Codex") **không** đủ.
   - Claude **chỉ trích nguyên văn**, không tóm tắt: ghi kênh (bình luận GitHub có liên kết, hoặc tin nhắn trong phiên Claude), ngày giờ và câu gốc. Lưu ý: bình luận do Claude đăng hiện mang tài khoản GitHub của Owner, nên tài khoản đăng **không** phải bằng chứng; bằng chứng là lời gốc của Owner.
   - Đổi bất kỳ phần nào của task (SHA nền, file được sửa, danh sách KHÔNG ĐỤNG, mục tiêu) ⇒ mã task mới, **duyệt lại**. Task không khớp với lời duyệt gốc thì **không chạy**.
2. Mỗi task ghi rõ: PR/nhánh nền (SHA), danh sách file được sửa, tiêu chí xong, danh sách **KHÔNG ĐỤNG** (migration, `.env`, DB, bảo mật, dependency, `package.json`, `.gitignore`, file đã nghiệm thu).
3. Chạy bằng `codex exec --sandbox workspace-write` (việc viết mã) hoặc `--sandbox read-only` (việc review) trong **thư mục làm việc riêng**: worktree riêng nhánh `codex/<số-PR>-<tên-việc>` cắt từ đúng SHA đã ghi, hoặc thư mục tạm chỉ chứa đúng các file cần review. Cấm `danger-full-access` và `--dangerously-bypass-approvals-and-sandbox`; không đổi cấu hình, quyền, đăng nhập của Codex.
   - **Đã kiểm chứng (07/11/2026, mục 13):** sandbox của Codex chạy lệnh dưới **tài khoản Windows riêng** do Codex quản lý (`CodexSandboxOffline`, `CodexSandboxOnline`, nhóm `CodexSandboxUsers`). (1) Một file giả chỉ cấp quyền cho tài khoản Owner (giống ACL của `backend\.env`): Codex **bị Windows từ chối** đọc. (2) Một file giả trong thư mục mà nhóm sandbox có quyền (thư mục Temp của Owner): Codex **đọc được**.
   - **Giới hạn (ghi rõ theo yêu cầu Owner):** quyền NTFS của Windows **chặn được file được bảo vệ** (chỉ cấp quyền cho Owner). Điều này **chưa chứng minh** sandbox Codex cách ly **toàn bộ hệ thống**. Mọi file mà tài khoản sandbox có quyền đọc (nhóm `Users`, `Everyone`, `CodexSandboxUsers`: mã nguồn, `D:\SISCOM-CRM-reports`, thư mục Temp, `C:\Users\Home Phong\.gemini`…) đều **có thể bị đọc và gửi đi**. Chưa kiểm chứng: truy cập mạng, registry, biến môi trường, tiến trình khác, ổ đĩa khác.
   - **Chuẩn cách ly — điều kiện tiên quyết, thiếu một điều thì KHÔNG chạy Codex** (kể cả khi đã có `OWNER_APPROVED_CODEX_TASK`):
     a. Phép thử cách ly (mục 13) **đã đạt** trên máy đang dùng và **còn hiệu lực**. Chạy lại sau mỗi lần nâng cấp Codex, đổi máy hoặc đổi tài khoản Windows.
     b. **Mọi bí mật** trên máy có quyền **chỉ tài khoản Owner** (đã xác nhận: `D:\SISCOM-CRM\backend\.env`, `D:\SISCOM-CRM-demo-pg\private`). Bí mật mới (file mật khẩu thử, `.env` khác, bản sao lưu) phải đặt quyền "chỉ Owner" **trước** khi chạy Codex.
     c. **Không có bí mật** ở nơi tài khoản sandbox đọc được, nhất là thư mục Temp của Owner (nhóm sandbox có quyền sửa).
     d. Codex chỉ làm việc trong **gói review** hoặc **worktree sạch** (mục 10.3, ý đầu); lời nhắc cấm đọc ngoài thư mục làm việc.
     e. **Sau mỗi lần chạy**, Claude kiểm nhật ký (mọi lệnh, mọi đường dẫn đã đọc) và ghi vào `[CODEX-REPORT]`. Thấy truy cập ngoài thư mục làm việc ⇒ dừng mọi task Codex, báo Owner như một sự cố.
   - **Rủi ro đã biết, chỉ Owner quyết (Claude không tự đổi cấu hình bảo mật):** nhóm sandbox đang **đọc được** `C:\Users\Home Phong\.gemini` (có thông tin đăng nhập Google của Gemini) và **sửa được** thư mục Temp của Owner. Muốn chặn hoàn toàn hơn thì dùng **Windows Sandbox** (máy ảo dùng một lần, chỉ thấy thư mục được ánh xạ).
4. **Dữ liệu rời máy:** mã trong worktree được gửi tới dịch vụ của OpenAI qua tài khoản ChatGPT hiện có. Worktree giao cho Codex **không** chứa `.env`, mật khẩu, khoá, dump, dữ liệu khách thật hay file trong thư mục bí mật; lời nhắc không nêu bí mật.
5. Codex **không bao giờ** chạy lệnh chạm database (kể cả database tạm): migration, seed, reset, restore, `prisma migrate`/`db push`/`db execute`, `psql`, integration test, benchmark. Không task nào, kể cả có ghi "cho phép", mở được quyền này; task ghi như vậy thì **không chạy**. Codex chỉ được chạy: đọc mã, sửa file trong thư mục làm việc, unit test không cần database, typecheck, build.
   - Codex không push, không mở hoặc merge PR, không `git reset --hard`. **Claude** lấy diff, đọc từng dòng, chạy test (kể cả integration test trên PostgreSQL tạm cách ly nếu cần), rồi mới commit vào PR; Claude chịu trách nhiệm cuối cùng về mã đó.
6. Mã do Codex viết là **mã AI**, chịu cùng review R1–R3. Gói review nêu rõ phần nào do Codex làm. Task Codex không tính là vòng review.
7. Claude chỉ giao cho Codex khi thực sự tiết kiệm công; việc nhỏ hơn chính lời mô tả task thì Claude làm trực tiếp.

## 11. Gemini — QA độc lập (qua Antigravity)

**Vai trò:** kiểm thử độc lập bằng cách **chạy sản phẩm** theo kịch bản và nghiệm thu; không đọc thay ChatGPT, không viết hay sửa mã, không merge, không chạm DB.

Quy tắc bắt buộc:
1. **Kênh hiện tại là thủ công** (mục 13): Gemini CLI chưa chạy được. Claude đăng `[QA-REQUEST]`; Owner (hoặc người Owner chỉ định) chạy trong Antigravity IDE rồi dán `[QA-REPORT]` lên PR. Khi kênh tự động dùng được, Claude cập nhật tài liệu này bằng PR riêng.
2. Chỉ chạy trên **môi trường thử cách ly** (PostgreSQL tạm, dữ liệu giả, cổng riêng). Không DB demo 55433, không DB thật 5432.
3. **Đăng nhập do người vận hành (Owner hoặc người Owner chỉ định) tự làm**, trước khi giao trình duyệt cho Gemini:
   - Người vận hành tự mở file tài khoản thử trên máy mình và tự gõ vào ô đăng nhập. Gemini **không** được đọc file tài khoản, **không** nhận tên đăng nhập hay mật khẩu trong lời nhắc, `[QA-REQUEST]` hay bất kỳ tin nhắn nào.
   - Gemini chỉ thao tác **sau khi đã đăng nhập**. Đổi vai trò (ví dụ từ sale sang kế toán) thì người vận hành tự đăng xuất và đăng nhập lại.
   - **Người vận hành kiểm tra bằng chứng TRƯỚC khi đăng hoặc chia sẻ** `[QA-REPORT]`: không có màn hình đăng nhập đang gõ, file tài khoản, thanh địa chỉ hay nhật ký chứa thông tin đăng nhập; cắt hoặc che trước khi tải lên. Tệp đính kèm trên GitHub **vẫn mở được qua đường dẫn** sau khi xoá bình luận, nên kiểm tra trước khi đăng là bắt buộc.
   - Claude kiểm tra lại sau khi đăng. Nếu vẫn lộ: xoá ngay bình luận/tệp, coi tài khoản thử đó **đã lộ** (huỷ môi trường thử hoặc đặt lại mật khẩu), ghi sự cố và báo Owner.
   - Mật khẩu **không bao giờ** xuất hiện trong PR, issue, log hay lời nhắc (đúng `AGENTS.md`).
4. Mỗi lỗi có đủ 6 trường như quy tắc 3, ID dạng `PR<số>-QA<vòng>-<nhóm>-<stt>` (nhóm thường gặp: `UI`, `BIZ`, `TEST`, `PERF`), kèm bước tái hiện và ảnh chụp.
5. Trạng thái lỗi QA theo mục 4: Gemini đặt `OPEN`, `VERIFIED`, `REOPENED` cho lỗi do chính Gemini báo; Claude đặt `FIXED`, `DISPUTED`; chỉ Owner đặt `DEFERRED`, `ACCEPTED`.
6. PR nào bắt buộc QA, điều kiện dừng và QA chưa chạy được: theo **mục 2**. Không có PR "tùy chọn" ngoài quy định đó.

## 12. Kênh bàn giao trên GitHub

GitHub là nơi **giao việc, bàn giao và kiểm soát**: mọi giao việc và báo cáo là bình luận trên PR (hoặc Issue theo dõi công việc của Owner). Không có bàn giao ngầm ngoài GitHub.

| Thẻ | Ai đăng | Khi nào | Nội dung tối thiểu |
|---|---|---|---|
| `[CODEX-TASK]` | Claude | Trước khi xin duyệt và trước khi gọi Codex | Mã `CT-<số-PR>-<stt>`, PR/SHA nền, mục tiêu, file được sửa, tiêu chí xong, **KHÔNG ĐỤNG**; sau khi Owner duyệt: **trích nguyên văn** lời Owner (kênh, ngày giờ, câu gốc) theo mục 10.1 |
| `[CODEX-REPORT]` | Claude | Sau khi xem diff của Codex | Commit đã nhận, file đổi, test chạy thật, phần Claude sửa lại hoặc bỏ, lý do; **kết quả kiểm nhật ký** (các đường dẫn Codex đã đọc, có/không truy cập ngoài thư mục làm việc) |
| `[QA-REQUEST]` | Claude | Trước QA | HEAD SHA, môi trường thử (URL, cổng), vai trò cần thử (**không** nêu mật khẩu), kịch bản và tiêu chí PASS/FAIL, ngoài phạm vi |
| `[QA-REPORT]` | Owner dán (hoặc Gemini nếu có kênh) | Sau QA | Kết quả PASS/FAIL từng kịch bản, lỗi theo mục 11.4, ảnh chụp, HEAD SHA đã thử |

## 13. Năng lực thực thi đã kiểm chứng (07/11/2026)

Kiểm tra bằng **câu lệnh vô hại**, thư mục tạm trống do Claude tạo, không chứa mã dự án hay dữ liệu, chế độ chỉ đọc nếu có thể; đã xoá sau khi thử.

| Công cụ | Phiên bản / đăng nhập | Đã thử | Kết luận |
|---|---|---|---|
| **Codex CLI** | 0.167.0 · tài khoản ChatGPT | `codex exec --sandbox read-only`: trả lời "OK" (9 giây, mã 0). Yêu cầu tạo file ở `read-only`: bị từ chối đúng. Ở `workspace-write`: tạo được file trong thư mục tạm | **Dùng được**, không cần giao diện. Sandbox giữ đúng giới hạn |
| **Gemini CLI** | 0.67.0 · Google cá nhân | `gemini -p`: lần 1 bị chặn "thư mục chưa tin cậy"; lần 2 dùng `--skip-trust` **chỉ trên thư mục tạm trống** vẫn lỗi `IneligibleTierError`: client này không còn hỗ trợ gói cá nhân, yêu cầu chuyển sang bộ Antigravity | **Không dùng được qua CLI hiện tại.** Không thử vượt lỗi (cần Owner quyết) |
| **Antigravity IDE** | 1.107.0 | Có lệnh `antigravity-ide chat "<prompt>"` mở phiên chat trong IDE. **Chưa chạy thử** (mở giao diện và dùng hạn mức); chưa biết có nhận kết quả tự động hay không | QA Gemini **thủ công** qua IDE cho tới khi Owner kiểm tra bên dưới |
| **Ruflo** | v3.72.2 (theo Owner) | Không chạy; chưa kết nối provider | Không tham gia thực thi |

**Phép thử 1 — thư mục Temp (07/11/2026, vòng R2 của PR #216):** một file **giả** đặt ở thư mục bên cạnh trong Temp của Owner; `codex exec --sandbox read-only` **đọc được**, nhật ký ghi lại đường dẫn. Nguyên nhân: nhóm `CodexSandboxUsers` có quyền sửa cả thư mục Temp. Thư mục thử đã xoá.

**Phép thử 2 — cách ly theo quyền Windows (07/11/2026, Owner duyệt, trước R3): ĐẠT.** Thư mục thử ngoài Temp: `allowed.txt` quyền mặc định ⇒ Codex **đọc được**; `fake-secret.txt` giá trị **giả**, quyền **chỉ Owner** (cùng ACL với `backend\.env`) ⇒ Codex **bị từ chối** (`Access … is denied`). Nhật ký: đúng 2 lệnh đọc 2 file đó; giá trị giả **không** xuất hiện. Thư mục thử đã được Owner xoá. Phép thử này là điều kiện a của chuẩn cách ly (mục 10.3); **không** chứng minh cách ly toàn hệ thống.

**Việc Owner cần làm một lần (khoảng 1 phút), để xác nhận kênh QA thủ công:** mở Antigravity IDE, mở một **thư mục trống**, gõ vào chat "Trả lời đúng một từ: OK". Nếu đáp được, kênh QA thủ công dùng được; nếu báo lỗi đăng nhập hoặc hạn mức, báo Claude để cập nhật mục này. Việc chuyển tài khoản Gemini theo yêu cầu của Google là quyết định của Owner; quy trình này **không** yêu cầu mua gói trả phí.
