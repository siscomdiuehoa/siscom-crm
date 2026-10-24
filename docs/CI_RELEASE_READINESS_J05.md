# J05 - Sẵn sàng CI/release (SISCOM-J05-CI-RELEASE-READINESS)

Chỉ tài liệu + công cụ mẫu. **Không** sửa `.github/workflows/`, `backend/package.json`, Gitleaks, Runner. Không merge, không chuyển ready. Dữ liệu GitHub lấy 2026-10-24 qua `gh`.

## 1. CI 4/4 trên GitHub ≠ 288 test PG mock

| PR (Draft) | Head | CI trên đúng head | Ghi chú |
|---|---|---|---|
| #63 | 5cf0cb5 | 4/4 PASS | allowlist hẹp 2 false positive `generic-api-key` |
| #106 | 84da979 | **2 PASS, gitleaks FAIL, gate FAIL** | lỗi do commit `0b498f4` (`auth-security.a5.spec.ts:204`, `SECRET_PW`) mà #106 chưa có allowlist của #63 |
| #111 (= #63+#106) | 31b16b5 | 4/4 PASS | chỉ chứng minh cấu hình CI + allowlist |
| #124 (#111 + chuỗi PG H03) | 79cb5a7 | 4/4 PASS | job Backend chỉ chạy `npm run test:unit` (Jest `src/**/*.spec.ts`) → **không** chạy `.mjs` |
| #127 | 064049f | 4/4 PASS | xếp chồng #124 |
| #128 (docs) | 74c710e | **gitleaks FAIL, gate FAIL** | cùng nguyên nhân với #106 (base main, chưa có #63) |
| #132 (J03) | 2414198 | **NOT_RUN (0 check)** | `ci.yml` trên chuỗi này vẫn `pull_request: branches: [main]`, base là nhánh preview, #106 không nằm trong chuỗi (kiểm bằng `merge-base --is-ancestor`) |
| #133 (J04) | f01c10b | **NOT_RUN (0 check)** | như trên |

- **288 test `node --test`** (đo ở #128 và đo lại ở mục 3 trên SHA 79cb5a7, offline, mock) **chưa từng chạy trên GitHub**. CI xanh 4/4 của #124 không chứa số này.
- **510/510** của J03 (#132) là con số do task J03 báo, tôi **chưa chạy lại**; chưa có CI nào trên head 2414198.
- Chưa có **review nào** (API reviews rỗng) trên #63, #106, #111, #124, #127, #128, #132, #133.

## 2. `node --test` không fail-closed
Theo #128, glob không khớp → 0 test, exit 0. Vì vậy bước CI phải kiểm số testcase. `backend/scripts/ci/check-node-test-count.mjs` (mới) làm việc này: lỗi nếu 0 testcase, dưới ngưỡng, hoặc có `<failure>/<error>`; exit 2 nếu thiếu/không đọc được báo cáo.

## 3. Đã chạy thật (worktree `D:\SISCOM-CRM-j05`, nền SHA 79cb5a7, Node v24.21.0, offline)
| Lệnh | Kết quả |
|---|---|
| `node --test scripts/ci/check-node-test-count.test.mjs` | 7/7 pass |
| `node --test` 3 glob + reporter junit → checker ngưỡng 250 | 288 testcase, 0 fail, exit 0 |
| cùng JUnit, ngưỡng 400 | exit 1 (`288 < 400`) |
| JUnit rỗng (`<testsuites/>`), ngưỡng 250 | exit 1 (`0 testcase`) |

Chưa kiểm chứng: chạy trên runner `ubuntu-latest`; `tsc`/Jest không chạy (không đổi `src`). Mẫu bước CI: `docs/ci-samples/node-tests-step.sample.yml.txt` (đuôi `.txt`, ngoài `.github/`, không có hiệu lực).

## 4. Trình tự merge đề xuất (ít bước nhất, sau review độc lập)
1. **Gitleaks + CI stacked trong 1 PR:** merge **#111** (#63+#106; 4/4 PASS trên 31b16b5) thay vì 2 PR riêng. Cần reviewer ≠ tác giả hoặc owner ngoại lệ một lần (owner quyết, tôi không viết thay). Phương án chậm hơn: #63 rồi #106 (sau đó rebase #106, vì hiện đỏ do thiếu allowlist). Allowlist phải giữ `condition="AND"` đường dẫn + dòng; không tắt Gitleaks.
2. **Ghép PG tests:** rebase/retarget chuỗi #123→#129/#126→#132→#133 về `main` sau bước 1 để CI thật chạy (trước đó NOT_RUN). Đợi kết quả J04 (#133, vá fail-open đồng hồ) được review rồi mới merge cùng chuỗi.
3. **Bước CI node --test + `MIN_NODE_TESTS`:** PR `ci/` riêng (mẫu ở mục 3), ngưỡng đặt lại theo số test thực trên đầu chuỗi (hiện 288 ở 79cb5a7; 510 theo J03) - chỉ bật **sau** bước 2, nếu không glob rỗng làm đỏ mọi PR.
4. **Cổng có hiệu lực:** đặt `CI gate` làm check bắt buộc. **Blocker đã xác minh:** `gh api .../branches/main/protection` trả HTTP 403 "Upgrade to GitHub Pro or make this repository public" - repo hiện không dùng được branch protection qua API ở gói này. Owner cần nâng gói/đổi chế độ repo hoặc chấp nhận cổng chỉ bằng quy trình (không tự merge khi gate đỏ).

## 5. Blocker cần review / owner (tôi không tự quyết)
1. Chưa có review độc lập nào cho 8 PR trên; thay đổi CI/bảo mật cần người duyệt khác tác giả (CONTRIBUTING §3.3).
2. Owner chọn: ngoại lệ reviewer một lần cho #111, hoặc bổ sung reviewer.
3. Owner duyệt riêng việc sửa `ci.yml` (+ `actions/upload-artifact@v4`, ghim SHA?) và `MIN_NODE_TESTS`.
4. Branch protection không khả dụng (403) → cần quyết định gói/repo.
5. CI cho #132/#133 NOT_RUN cho đến khi #106 vào chuỗi.
6. Chưa có bằng chứng PG thật; mọi thứ ở đây là mock/offline. Cần phê duyệt riêng cho PostgreSQL disposable.

**Rollback:** đóng PR, xóa nhánh `ci/j05-node-test-count-evidence`; chỉ thêm 4 tệp mới (script + test, 2 tài liệu), không đụng tệp hiện có.
