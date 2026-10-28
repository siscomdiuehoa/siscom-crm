# Kế hoạch: đưa test offline `node --test` (.mjs) của PG harness vào CI

Task `SISCOM-I03` (batch CONTINUITY-I). **Chỉ là kế hoạch + lệnh đề xuất.** PR này không sửa `.github/workflows/ci.yml`, `backend/package.json`, branch protection hay Gitleaks. Mọi thay đổi bên dưới cần **owner phê duyệt riêng**.

## 1. Vấn đề đã xác minh

- H05 (#6381016342) và H08 (#6381071292): PR #124 (`ci/preview-h05-pg-stack-main`, SHA `79cb5a7`, Draft) có CI 4/4 PASS (run 40071026406). Job Backend chỉ chạy `npm run test:unit`.
- `backend/test/jest-unit.json` có `testMatch: <rootDir>/src/**/*.spec.ts`, nên Jest **không** thấy các test `.mjs`.
- Vì vậy 288 test `node --test` (guards, pg-harness, test-db-guard) chỉ có bằng chứng chạy cục bộ, chưa có bằng chứng CI.
- Trên `origin/main` hiện chỉ có `tools/claude-auto-runner/runner.mjs` là `.mjs`; các test nêu trên nằm trong chuỗi PR #123/#124, chưa vào `main`. Bước CI này chỉ có ý nghĩa sau khi chuỗi đó được merge (hoặc áp lên nhánh chứa chúng).

## 2. Đã đo thật (SHA `79cb5a7`, worktree tách riêng, Node v24.21.0, offline)

| Phép thử | Kết quả |
|---|---|
| `node --test` với 3 glob (dòng lệnh mục 3) | 288 tests, 288 pass, 0 fail, `duration_ms` 1004 (~1 s; khởi động Node + nạp file thêm vài giây) |
| Cùng lệnh qua PowerShell và `cmd /c` (dấu nháy **kép**) | 288/288 |
| Cùng glob nhưng dấu nháy **đơn** trong `cmd /c` | **0 test, thoát mã 0** (cmd không bỏ nháy đơn nên glob không khớp) |
| Glob không khớp file nào (`scripts/nonexistent/**/*.test.mjs`) | **0 test, thoát mã 0** |
| Reporter `junit` ghi file | 288 phần tử `<testcase>` |

Kết luận quan trọng: `node --test` **không fail-closed** khi không tìm thấy test. Nếu glob sai, đổi tên thư mục hoặc nháy sai, CI vẫn xanh với 0 test. Do đó bắt buộc có kiểm tra số lượng tối thiểu.

Không chạy lại ở đâu khác; chưa chạy thử trên runner GitHub (chưa kiểm chứng trên `ubuntu-latest`).

## 3. Lệnh test offline (dùng được trên Windows PowerShell, cmd, Git Bash, Linux)

Chạy trong `backend/`, chỉ dùng **dấu nháy kép** quanh glob (Node 24 tự mở rộng glob, không phụ thuộc shell):

```
node --test --test-reporter=spec --test-reporter-destination=stdout --test-reporter=junit --test-reporter-destination=node-tests-junit.xml "scripts/pg-harness/**/*.test.mjs" "scripts/guards/**/*.test.mjs" "test/helpers/*.test.mjs"
```

Không cần PostgreSQL, `.env`, mạng hay Prisma. Test dùng mock (`fake-db-executor.mjs`).

## 4. Đề xuất tối thiểu (CẦN OWNER DUYỆT RIÊNG, chưa áp dụng)

### 4.1 Một bước thêm vào job `backend` của `ci.yml`, sau "Unit test"

```yaml
      - name: Node test offline (PG harness, guards; khong DB, khong .env)
        run: |
          node --test --test-reporter=spec --test-reporter-destination=stdout --test-reporter=junit --test-reporter-destination=node-tests-junit.xml "scripts/pg-harness/**/*.test.mjs" "scripts/guards/**/*.test.mjs" "test/helpers/*.test.mjs"
          n=$(grep -c '<testcase' node-tests-junit.xml || true)
          echo "node --test: ${n} testcase"
          test "${n}" -ge "${MIN_NODE_TESTS}"
        env:
          MIN_NODE_TESTS: "250"
      - name: Luu bao cao node --test
        if: ${{ always() }}
        uses: actions/upload-artifact@v4
        with:
          name: node-tests-junit
          path: backend/node-tests-junit.xml
          if-no-files-found: error
          retention-days: 14
```

Fail-closed:
- Bước thoát khác 0 nếu bất kỳ test nào fail (mặc định của `node --test`).
- Shell mặc định của `run` trên Linux là `bash -e`, nên lệnh `node --test` lỗi thì dừng ngay. Nếu thiếu file XML, `grep -c` không in số, `n` rỗng và `test "" -ge ...` báo lỗi nên bước vẫn đỏ. `test -ge` buộc số testcase >= ngưỡng. Ngưỡng 250 thấp hơn 288 để thêm/bớt vài test không làm đỏ CI, nhưng đủ chặn trường hợp glob rỗng. Khi số test tăng đáng kể, owner nâng ngưỡng bằng PR riêng.
- `ci-gate` hiện chỉ phụ thuộc kết quả của job `backend`, nên bước mới tự động nằm trong cổng, **không cần sửa `ci-gate`**.
- `if-no-files-found: error` làm hỏng bước artifact nếu không có báo cáo.

Lưu ý: `actions/upload-artifact@v4` là action mới trong workflow, owner cần đồng ý có thêm action này (không thêm dependency npm). Nếu owner không muốn thêm action thì bỏ 2 dòng artifact; spec reporter vẫn lưu trong log của job.

### 4.2 Tùy chọn: script npm (cũng cần duyệt)

```json
"test:node": "node --test \"scripts/pg-harness/**/*.test.mjs\" \"scripts/guards/**/*.test.mjs\" \"test/helpers/*.test.mjs\""
```

Trong `package.json`, `\"` được npm chuyển cho cả `cmd.exe` lẫn `sh`; nháy đơn thì **không** (xem mục 2). Nếu chưa muốn sửa `package.json`, bước 4.1 gọi `node --test` trực tiếp là đủ và chỉ đụng một file.

## 5. Thời gian dự kiến

- Chạy test: ~1 s (đo), nên cộng bước + upload artifact khoảng 5–15 s (ước tính, chưa đo trên runner).
- Không thêm `npm ci`/build vì job `backend` đã có sẵn Node 24; tổng thời gian job tăng không đáng kể so với `timeout-minutes: 15`.

## 6. Gitleaks và các ràng buộc khác

- Không đụng job `secret-scan`, `.gitleaks.toml`, phiên bản/SHA-256 gitleaks, `fetch-depth: 0`, `--redact`.
- Không đổi `permissions: contents: read` (upload-artifact không cần thêm quyền), `persist-credentials: false`, `pull_request`/`push` trigger, branch policy.
- Báo cáo JUnit chứa tên test và đường dẫn tuyệt đối của runner, không chứa bí mật. Test không đọc `.env`/biến `PG*` thật (có guard riêng).

## 7. Rủi ro và điểm cần owner quyết

1. Thêm bước vào job bắt buộc là thay đổi CI → cần phê duyệt riêng, qua PR `ci/`, người duyệt khác tác giả.
2. Đồng ý thêm `actions/upload-artifact@v4` (hay ghim theo SHA commit, theo chuẩn bạn dùng cho Gitleaks).
3. Giá trị `MIN_NODE_TESTS` (đề xuất 250).
4. Thứ tự: chỉ thêm bước sau khi chuỗi #109→#123 (chứa các test) đã vào `main`; nếu thêm trước, glob rỗng sẽ làm CI đỏ (đúng ý fail-closed nhưng chặn mọi PR).
5. Kiểm chứng trước khi bật: chạy trên nhánh `ci/` ở Draft PR để có kết quả thật trên `ubuntu-latest`; hiện **chưa kiểm chứng**.

## 8. Không làm trong PR này

Không sửa workflow, `package.json`, Gitleaks, Runner, branch protection; không chạm database, Prisma, `.env`; không merge.

**Rollback:** đóng PR và xóa nhánh `docs/i03-pg-harness-ci-evidence-plan`. Chỉ thêm 1 file mới: `docs/PG_HARNESS_CI_EVIDENCE_PLAN.md`.
