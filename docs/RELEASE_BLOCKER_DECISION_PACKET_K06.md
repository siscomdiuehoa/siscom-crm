# K06 — Gói quyết định release blocker cho owner

- Batch: `SISCOM-20261024-CONTINUITY-K`, task `SISCOM-K06-RELEASE-BLOCKER-DECISION-PACKET` (Issue #8, comment `6381975984`; `OWNER_APPROVED` riêng `6381976460`, phạm vi `CODE_TEST_DRAFT_ONLY`).
- Loại tài liệu: **docs-only, Draft**. Không phải bằng chứng PASS. Không ghi thay owner bất kỳ phê duyệt merge hoặc DB nào.
- Nguồn: Issue #8 (628 comment, đọc đến comment `6382139402` lúc 2026-10-24 08:44Z) và `gh pr view` đọc ngày 2026-10-24. Tôi **không chạy lại test nào** trong task này; mọi số test là số do task gốc tự báo.
- Quy ước: **CI** = kết quả GitHub đọc từ `statusCheckRollup` của PR đúng head SHA. **Mock** = test chạy offline với executor/fetch giả. **DB thật** = chưa có bước nào.

## 1. Trạng thái J04–J06 và K01–K05 (đối chiếu `CLAUDE_RESULT source=`)

| Task | ID task → approval | CLAUDE_RESULT | Kết quả tự báo | PR | Ghi chú xác minh |
|---|---|---|---|---|---|
| J04 PG review | 6381892332 → 6381892668 | 6381970983 | DONE, 1 lỗi fail-open đồng hồ (đã vá) | #133 | khớp ID |
| J05 CI | 6381893740 → 6381894041 | 6382000365 | DONE, checker 7/7, JUnit 288 | #134 | khớp ID |
| J06 tóm tắt | 6381894415 → 6381900276 | 6382011883 | DONE, kết luận chưa sẵn sàng release | không | khớp ID |
| K01 path traversal | 6381969389 → 6381969800 | 6382047293 | DONE, staticGuard 22/22, smoke 46/46 | #135 | khớp ID |
| K02 cổng CI test mock | 6381970125 → 6381970984 | 6382077152 | DONE, CI 4/4 trên #136, `node --test` 272/272 | #136 | khớp ID |
| K03 auth compile | 6381971396 → 6381971844 | 6382090829 | DONE, tsc/nest build exit 0, Jest 12/12, không đổi mã | không | khớp ID |
| K04 PG parity | 6381972624 → **6381972908** | 6382105055 | DONE, 160/160 mock, không lệch | không | **Báo cáo K04 ghi approval là `6382021312`, đó là ID task L04, không phải approval của K04.** Approval đúng (`6381972908`) có tồn tại. Đây là lỗi dẫn nguồn trong báo cáo, không phải thiếu approval. Cần Runner/owner đối chiếu. |
| K05 FE API state | 6381974185 → 6381975067 | 6382139402 | DONE, 14/14 `apiStateErrorRegression` | #137 | khớp ID |

DONE trong bảng nghĩa là task báo xong, **không** đồng nghĩa PASS nghiệm thu. K01–K05 đều đã có kết quả, nên K06 không ở trạng thái WAITING.

## 2. Ma trận release blocker

Cột "Review độc lập" chỉ tính review GitHub của người khác tác giả. Tất cả PR dưới đây do `siscomdiuehoa` tạo và `reviews = 0`.

| PR | Head SHA | Base | Nội dung | CI trên đúng head | Mock / DB thật | Review độc lập |
|---|---|---|---|---|---|---|
| #63 | `5cf0cb5` | main | allowlist hẹp gitleaks | **PASS** 4/4 | không áp dụng | **Thiếu** |
| #106 | `84da979` | main | CI cho PR base khác main | **FAIL** gitleaks + CI gate (`SECRET_PW`, `auth-security.a5.spec.ts:204`, theo J05) | không áp dụng | **Thiếu** |
| #111 | `31b16b5` | main | ghép #63 + #106 | **PASS** 4/4 | không áp dụng | **Thiếu** |
| #124 | `79cb5a7` | main | ngăn xếp PG H03 trên #63+#106 | **PASS** 4/4 | Jest trong CI; test `.mjs` PG **không chạy trong CI** | **Thiếu** |
| #127 | `064049f` | #124 | parity ESM/TS guard tên DB | **PASS** 4/4 | mock 27/27 (J04) | **Thiếu** |
| #128 | `74c710e` | main | kế hoạch CI `node --test` | **FAIL** gitleaks + CI gate | không áp dụng | **Thiếu** |
| #131 | `342fad9` | `preview/be-l2-static-integration` | khóa auth route NOT_IMPLEMENTED, `/customers` default-deny | **NOT_RUN** (rollup rỗng) | mock offline; local tsc/nest build/Jest 12/12 (K03) | **Thiếu** |
| #132 | `2414198` | `preview/pg-h03-integrated-stack` | ghép #126+#129, vá prototype | **NOT_RUN** | mock 510/510 (J03 tự báo) | **Thiếu** |
| #133 | `f01c10b` | #132 | vá fail-open đồng hồ (J04) | **NOT_RUN** | mock 539/539 (J04 tự báo) | **Thiếu** |
| #134 | `bde8f9a` | #124 | checker đếm test JUnit, mẫu CI | **PASS** 4/4 | mock 288 testcase (J05) | **Thiếu** |
| #135 | `1c0864a` | #130 | vá path traversal harness (K01) | **NOT_RUN** | Chrome thật trên máy cục bộ + mock loopback; DB: không | **Thiếu** |
| #136 | `4f74c75` | #134 | bước `node --test` + `MIN_NODE_TESTS=250` trong ci.yml (K02) | **PASS** 4/4 (run 40078642663, theo K02) | mock 272/272 | **Thiếu** |
| #137 | `7865ddd` | #130 | 14 ca hồi quy FE API state (K05) | **NOT_RUN** | mock fetch trong tiến trình; Chrome thật chưa chạy | **Thiếu** |
| #130 | `0702cc6` | `test/h06-fe-chrome-integrated` | harness Chrome (nền #135/#137) | **NOT_RUN** | Chrome thật cục bộ: smoke 46/46, stale-401 15/15 (J01) | **Thiếu** |

Phụ: #115 (`c8eec14`), #123 (`c252a57`), #126 (`2466b0a`), #129 (`3a700f3`) cũng `reviews = 0` và không có check.

Ghi chú:
- **Không có PR nào có review độc lập.** 0 trên 14 PR trên (và 0 trên 4 PR phụ).
- **Không có bằng chứng DB thật.** Mọi kết quả PG là mock. Live PG `NOT_RUN`, migration `NOT_IMPLEMENTED`, `--execute` bị từ chối theo mã (J03/J04 tự báo).
- Con số 288 (J05), 272 (K02), 510 (J03) và 539 (J04) **không cùng một tập test**, không cộng, không so trực tiếp. 510 và 539 chưa được CI nào xác nhận.
- Branch protection: `gh api .../branches/main/protection` trả 403 (theo J05), nên chưa thể đặt CI gate bắt buộc ở GitHub.
- Hai PR #106 và #128 đỏ vì gitleaks; #111 đã xanh nhờ ghép allowlist của #63. Đây là một điểm khiến #111 hợp lý hơn #63/#106 riêng lẻ.

## 3. Đề xuất cho owner (không phải quyết định)

### (a) Review cho #111: ngoại lệ một lần hay bổ sung reviewer

Ràng buộc: CONTRIBUTING §3.3 yêu cầu thay đổi liên quan bảo mật phải có người duyệt **khác tác giả**. #111 sửa `.gitleaks.toml` (allowlist secret scanner) và `ci.yml`, tức là chạm cơ chế bảo mật. Tác giả #111 và tài khoản đăng comment `OWNER_APPROVED` đều là `siscomdiuehoa`; GitHub không cho tác giả tự approve PR của mình.

| Phương án | Ưu | Nhược / rủi ro |
|---|---|---|
| A1. Bổ sung một reviewer thật, khác tác giả | Đúng §3.3, không cần sửa quy tắc | Cần tài khoản GitHub thứ hai có quyền đọc repo; phụ thuộc người |
| A2. Owner ghi một ngoại lệ **một lần, bằng văn bản**, giới hạn đúng SHA `31b16b5` | Nhanh; phạm vi hẹp, kiểm chứng được | Phá nguyên tắc người duyệt khác tác giả cho thay đổi gitleaks; nếu head đổi thì ngoại lệ mất hiệu lực |
| A3. Chưa merge, giữ Draft | An toàn nhất | Chuỗi PG/CI vẫn bị kẹt vì chưa có CI thật |

Điều kiện an toàn nếu chọn A2 (đề xuất, owner quyết):
1. Ngoại lệ nêu rõ PR #111, SHA `31b16b5898682428fabe9c7227cd15ce2f58e5b1`, chỉ cho hai file `.github/workflows/ci.yml` và `.gitleaks.toml`.
2. Trước khi merge, đọc lại diff hai file; allowlist phải giữ điều kiện AND theo đường dẫn và dòng, không tắt rule, không thêm `pull_request_target`, không thêm secrets (J05 mô tả vậy, tôi chưa xác minh lại diff trong task này).
3. Gitleaks vẫn quét full history và fail-closed.
4. Ghi lại ngoại lệ là **một lần**, không áp dụng cho #124/#132/#133/#136.
5. Squash merge do owner thực hiện; Runner và Claude không merge.

Tôi **không** tự ghi ngoại lệ. Cần comment riêng của owner nếu chọn A2.

### (b) Chọn JWT hay `sid_` — không tự quyết

Lưu ý nguồn: thiết kế đã có trong repo (`backend/docs/B1.3.0_DESIGN.md` mục access token; `B1.3.1_DETAILED_DESIGN.md` §6.2) là **JWT HS256 ngắn hạn, mang claim `sid`, kèm refresh token ngẫu nhiên lưu SHA-256 trong `auth_session`**. Repo không có chỗ nào định nghĩa token `sid_` (tìm `sid_` trong `.md/.ts/.prisma` không ra kết quả). Dưới đây tôi hiểu `sid_` là **token phiên không trong suốt** (chuỗi ngẫu nhiên có tiền tố, tra cứu phiên ở server mỗi request). Nếu owner hiểu khác, cần nói rõ.

| Tiêu chí | JWT (thiết kế hiện có) | `sid_` (token không trong suốt, tra DB mỗi request) |
|---|---|---|
| Thu hồi tức thời | Không tức thời; hiệu lực ≤ 10 phút hoặc cache ≤ 30 s nếu kiểm phiên mỗi request (thiết kế đã bắt kiểm `tv` + phiên) | Tức thời (xóa/thu hồi bản ghi phiên) |
| Tải DB mỗi request | Có thể tránh, nhưng thiết kế hiện tại vẫn kiểm phiên/`tv` nên gần như tương đương | Luôn tra DB hoặc cache |
| Bí mật cần giữ | `JWT_ACCESS_SECRET` ≥ 32 byte, cần quay vòng; lộ khóa = giả mạo mọi token tới khi đổi khóa | Không có khóa ký; lộ DB chỉ lộ băm nếu lưu băm |
| Bề mặt tấn công | Confusion thuật toán (`none`), `kid`, đồng hồ; phải ghim thuật toán, `iss`, `aud` | Đoán token (cần ≥ 256 bit ngẫu nhiên, so sánh hằng thời gian) |
| Dependency | Cần `@nestjs/jwt` (đã ghim ở PR #14 theo tiêu đề commit `a5de704`; tôi chưa kiểm chi tiết) | Không cần thư viện JWT |
| Tương thích mã hiện có | Tài liệu thiết kế, mã B1.3.2-A và test #131 đều theo hướng JWT + `sid` | Cần thiết kế lại phần token; `auth_session` đã có sẵn nên tái dùng được phần lớn |
| Hợp đồng FE | FE giữ token trong bộ nhớ, header `Authorization: Bearer`; không đổi | Cùng cách gửi header; chuỗi khác hình dạng |

Điều kiện an toàn **bất kể chọn gì** (đề xuất):
- Default-deny giữ nguyên; danh tính chỉ từ token đã xác thực, không từ nội dung request.
- Không lưu token trong `localStorage`; không ghi token/băm vào log hay audit.
- So sánh hằng thời gian; token ≥ 256 bit ngẫu nhiên nếu chọn `sid_`; thuật toán ghim, `iss`, `aud`, `exp` ngắn nếu chọn JWT.
- Thu hồi khi đổi mật khẩu, khóa tài khoản, nghỉ việc; có kịch bản thu hồi khẩn.
- Refresh rotation + phát hiện dùng lại (đã có trong thiết kế); CSRF/Origin cho route dùng cookie.
- Quyết định này **chưa** đổi route nào: các route auth hiện trả 404 `NOT_IMPLEMENTED` và test #131 khóa trạng thái đó. Sau khi owner chọn mới được triển khai, trên nhánh/PR riêng, có reviewer khác tác giả (thay đổi auth).

Nhận xét trung lập: thiết kế đã duyệt trên giấy là JWT + `sid` nên chọn JWT ít đổi nhất; `sid_` đổi lấy thu hồi tức thời với chi phí thiết kế lại. Tôi **không chọn**.

### (c) Phê duyệt riêng cho PostgreSQL disposable

Hiện trạng đã làm: toàn bộ là mock (executor giả). Chưa làm: kết nối PG thật, migration, seed, `--execute`, đo hiệu năng, chạy integration test.

Owner cần cấp **một comment riêng bằng văn bản** (không dùng chung với phê duyệt merge) nêu đủ:
1. Một database duy nhất, tên đúng `siscom_crm_test_*` hoặc `siscom_crm_restore_*`; không chạm `siscom_crm_dev`, baseline đã khóa hay production.
2. Máy/host cho phép (guard hiện chỉ chấp nhận loopback theo probe K04), role không phải quyền siêu cấp, nơi cấp mật khẩu (người cấp, không đưa vào log/PR).
3. Thao tác được phép: ví dụ chỉ `prisma migrate deploy` trên DB đó, hay có cả seed test; thao tác cấm (DROP/TRUNCATE ngoài DB đó).
4. SHA đúng của mã được chạy (đề xuất chuỗi #132+#133 sau khi #133 có review), và việc chạy phải theo harness có guard danh tính, TTY, verdict TOCTOU.
5. Cách thu kết quả: log đã lọc bí mật, đính vào Issue #8; xóa DB sau khi xong.
6. Điều kiện dừng: guard từ chối, tên DB lệch, lỗi kết nối bất thường thì dừng, báo BLOCKED.

Chưa có gì trong số này. Task này **không** ghi hay suy diễn phê duyệt DB.

## 4. Việc chưa làm / còn mở

- Chưa PR nào có review độc lập; chưa merge; chưa deploy.
- CI NOT_RUN cho #130–#133, #135, #137. Có thể kích hoạt bằng retarget nhánh (thao tác nhánh, cần owner đồng ý); chưa làm.
- #106 và #128 đỏ gitleaks; chưa xử lý.
- Test `.mjs` PG chưa chạy trong CI trên `main`; #136 chỉ chứng minh trên chuỗi #124/#134.
- Stale-401 actor A→B trên UI thật vẫn NOT_RUN (chưa có actor được duyệt trong `src`).
- Client FE chưa có timeout riêng trong `src` (K05).
- Lỗi dẫn nguồn approval trong báo cáo K04 (mục 1) cần đối chiếu.
- Worktree/thư mục tạm ngoài repo do J01/K01/K05 để lại (`D:\SISCOM-CRM-j01`, `-k01`, `-k02`, `-k05` và `*-out`) chưa dọn; K05 dùng junction `node_modules` trỏ sang `-j01`, nên xóa `-j01` trước sẽ làm hỏng `-k05`.
- Con số test trong tài liệu này chưa được tôi xác minh lại; chỉ trạng thái PR/CI/review được đọc trực tiếp từ GitHub trong phiên này.

## 5. Không đụng tới

`src`, workflow, `.gitleaks.toml`, `package.json`, Runner, `.env`, database, migration, `main`. Rollback: đóng Draft PR và xóa nhánh `docs/k06-release-blocker-decision-packet`.
