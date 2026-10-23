# OPS-BOTKEEP-DESIGN — Khảo sát Auto-Runner trên Botkeep (chỉ thiết kế)

Issue: #52. Phạm vi: **chỉ tài liệu**. Không deploy, không secrets, không DB, không sửa `runner.mjs`, không merge.
Ngày khảo sát: 2026-10-23. Mục đánh dấu **[chưa kiểm chứng]** chưa được thử thật.

## 1. Kết luận

**BOTKEEP_PLAN_BLOCKED** cho phương án "chạy nguyên Auto-Runner (gồm Claude CLI) trên Botkeep Founder Free".
**Khả thi có điều kiện** cho phương án tách đôi: *dispatcher* nhẹ trên Botkeep + *executor* (Claude CLI) ở máy khác có ≥ 4 GB RAM (máy Windows hiện tại).

Lý do chặn (có bằng chứng, mục 3):
1. Tài liệu Claude Code yêu cầu **≥ 4 GB RAM**; Founder Free chỉ có **2 GB RAM / 1,5 vCore / 2 GB đĩa**.
2. Tài liệu Botkeep **không nêu** SSH/shell/Docker cho khách → không có đường cài `claude` và đăng nhập tương tác. [chưa kiểm chứng]
3. Claude headless cần secret dài hạn (API key hoặc token đăng nhập) đặt trong env Botkeep; Terms nói rõ đó **không phải lưu trữ zero-knowledge**. Cần chủ repo quyết định, ngoài phạm vi task này.

## 2. Mã nguồn Auto-Runner (đã đọc thật: `tools/claude-auto-runner/runner.mjs` @ `origin/main` a5de704, 71 dòng)

Runner **có trong repo**. Xác minh từ mã:

| Hạng mục | Hiện trạng |
|---|---|
| Ngôn ngữ/dep | Node ESM thuần, 0 dependency; gọi `gh`, `git`, `claude` qua `spawn/spawnSync` |
| Hàng đợi | Issue #8; chỉ nhận comment của `trustedLogin`, chứa `<!-- CLAUDE_TASK -->` |
| Poll | `gh api --paginate --slurp .../comments` mỗi 10 s (đọc toàn bộ comment mỗi lần) |
| Chống trùng | Mảng `state.processed` (id comment) trong `state.json` cục bộ; 1 task/lần qua cờ `activeTask` trong tiến trình |
| Trạng thái | `%LOCALAPPDATA%\SISCOM-ClaudeRunner\state.json`, config cùng thư mục |
| Dashboard | HTTP `127.0.0.1:45871` + SSE; ghi `state.json` mỗi giây |
| Thực thi | `claude -p <prompt> --permission-mode auto`, cwd = `repoPath`, timeout `maxTaskMinutes` (30) |
| Kết quả | Comment `<!-- CLAUDE_RESULT source=<id> -->` lên Issue #8 |
| Phục hồi | Khởi động thấy `running` → đánh dấu `blocked`, **không replay** |
| Cài đặt | `install.ps1` (Scheduled Task Windows, đường dẫn `D:\`) |

Điểm yếu khi dời host:
- **Chống trùng chỉ đúng với 1 tiến trình / 1 máy.** Hai runner (Windows + Botkeep) cùng poll sẽ cùng nhận một task; id chỉ vào `processed` sau khi task kết thúc.
- Phụ thuộc Windows: `windowsHide`, `%LOCALAPPDATA%`, `install.ps1`, đường dẫn `D:\SISCOM-CRM` nhúng trong prompt.
- Poll quét toàn bộ comment, tăng dần theo thời gian; đã gặp `spawnSync gh.exe ENOBUFS` (Issue #53, xử lý riêng). Cây làm việc máy local đang có thay đổi chưa commit trên `runner.mjs`; **task này không đụng tới**.
- Danh tính người gửi dựa trên `user.login` (đúng, không lấy từ nội dung comment).

## 3. Ràng buộc runtime — bằng chứng

### 3.1 Botkeep (botkeep.cloud, botkeep.cloud/terms, truy cập 2026-10-23)
- **Founder Free** (đăng ký trong khoảng thời gian nêu ở Terms §5): 5 slot, **2 GB RAM, 1,5 vCore, 2 GB storage**, 2 backup/dịch vụ. Cần xác nhận tài khoản chủ repo thuộc nhóm Founder [chưa kiểm chứng].
- Là mức **tối đa trên hạ tầng chia sẻ**, không đảm bảo liên tục; có thể có hàng đợi, quy tắc không hoạt động, giới hạn build/log, fair-use (§5). Beta không SLA; có thể restart do bảo trì/sự cố.
- Runtime công bố: Node.js, Python, Java, PHP, Go, Rust, C++, Bun, Nodemon; DB MySQL/MariaDB/PostgreSQL/Redis. **Không thấy** Docker, SSH, shell cho khách. Giới hạn số process: "kế hoạch", chưa có giá trị.
- Env được mã hóa trong DB Botkeep và đưa vào runtime/`.env`; **không** zero-knowledge (§7). Cấm log token.
- Cấm: proxy/relay/VPN trái phép, quét mạng, "deceptive automation", vượt rate-limit (§8). Terms không nói về CLI/agent.
- Outbound allow-list không nêu [chưa kiểm chứng]: cần tới `api.github.com`, `api.anthropic.com`, `downloads.claude.ai`.

### 3.2 Claude Code CLI (code.claude.com/docs/en/setup)
- Yêu cầu **4 GB+ RAM**, x64/ARM64; Ubuntu 20.04+/Debian 10+/Alpine 3.19+, Windows 10 1809+.
- Cài: native installer, apt/dnf/apk, hoặc `npm i -g @anthropic-ai/claude-code` (Node ≥ 22; gói npm kéo binary native). Cài bằng npm trong runtime Node là khả dĩ về lý thuyết [chưa kiểm chứng].
- Cần tài khoản Pro/Max/Team/Enterprise/Console; đăng nhập qua trình duyệt hoặc `ANTHROPIC_API_KEY`. Auto-update nền ghi vào `~/.local/share/claude` (cần `DISABLE_AUTOUPDATER=1` trên host nhỏ).
- Task thật còn chạy `git`/`npm`/`tsc`/`jest` trên repo + `node_modules` → 2 GB RAM/đĩa nhiều khả năng không đủ (ước lượng, [chưa kiểm chứng]).

### 3.3 Đánh giá
| Thành phần | Botkeep 2 GB / 1,5 vCore | Ghi chú |
|---|---|---|
| Dispatcher (Node 0 dep, poll GitHub, tạo claim) | Khả thi (ước tính vài chục MB) | cần đo |
| Health endpoint | Khả thi nếu có cổng HTTP | [chưa kiểm chứng] |
| Claude CLI executor | **Không đạt** | chặn |
| Build/test repo CRM | **Không đạt** | chặn |

## 4. Kiến trúc đề xuất: tách Dispatcher / Executor

```
GitHub Issue #8 --poll (ETag/since)--> Dispatcher (Botkeep)
                                         | lọc trusted + marker + risk/approve
                                         | tạo claim nguyên tử
                                         v
                               hàng đợi = GitHub (không DB)
                                         ^ executor kéo (pull) claim
              Executor (Windows/VM >= 4 GB: claude, git, gh, repo)
                                         | chạy task, gia hạn lease
                                         v
                               CLAUDE_RESULT lên Issue #8
```

Nguyên tắc: **kéo, không đẩy** (dashboard chỉ bind 127.0.0.1, Botkeep không cần vào máy Windows). Mã chạy repo và secret Claude **ở lại executor**; Botkeep không giữ token Claude và không clone repo.

### 4.1 Chống trùng task (claim nguyên tử)
Tạo ref Git là nguyên tử: `POST /repos/{repo}/git/refs` với `refs/claims/task-<commentId>` trả 201 cho bên đầu, 422 "Reference already exists" cho bên sau. Chỉ bên nhận 201 được chạy.
- Lease: executor ghi `{runnerId, startedAt, leaseUntil}` (blob/commit nhỏ) và gia hạn mỗi ~60 s. Lease quá hạn → **không tự replay**, báo `BLOCKED_STALE` chờ chủ repo (giữ chính sách "không replay" hiện tại).
- Mỗi host một `RUNNER_ID`; chỉ một executor active; runner Windows cũ phải tắt poll khi chuyển.
- Phương án label/comment `CLAIM` có race → không dùng.
- Cần test trên repo thử, không dùng repo chính [chưa kiểm chứng]. Ref nằm ngoài `refs/heads` để không nhiễu nhánh/PR.

### 4.2 Poll
- `since=<lastSeen>` + `If-None-Match` (ETag): 304 không tốn quota; thay `--paginate` toàn bộ (cũng giảm nguy cơ ENOBUFS).
- 15–30 s/lần ≈ 120–240 req/giờ, thấp hơn nhiều so với hạn mức 5.000/giờ.

### 4.3 Restart / retry / logging
- Dispatcher gần như không giữ trạng thái: cursor + ETag trong file nhỏ (ghi atomic). Mất file → quét lại; claim ref bảo đảm không chạy trùng.
- Restart: cơ chế tự khởi động của Botkeep chưa xác minh [chưa kiểm chứng]; dispatcher phải idempotent, khởi động nhanh.
- Retry: backoff mũ 5→300 s + jitter cho lỗi GitHub 5xx/mạng. **Không** retry thực thi task.
- Log: JSON-lines ra stdout, giới hạn dung lượng, che chuỗi giống token (`gh[pousr]_`, `sk-ant-`, `Bearer`), không log nội dung task.

### 4.4 Secrets
- Botkeep: chỉ một GitHub token fine-grained, hạn ngắn, quyền tối thiểu (Issues: write; ghi ref claim cần Contents: write → cân nhắc repo riêng chỉ để chứa claim).
- Executor: giữ `gh auth` và đăng nhập Claude trên máy hiện tại.
- Tuyệt đối không đưa `.env` CRM, DB URL, JWT secret lên Botkeep.

### 4.5 An ninh hàng đợi
Giữ: chỉ `user.login == trustedLogin`, marker, `RISK/OWNER_APPROVED`. Dispatcher **không** diễn giải task, chỉ chuyển comment id; executor tự tải lại comment từ GitHub và kiểm tra lại (không tin dữ liệu từ dispatcher).

## 5. Phương án so sánh

| # | Phương án | Đánh giá |
|---|---|---|
| A | Nguyên runner + Claude CLI trên Botkeep | **Chặn**: RAM < 4 GB, không shell, secret trên host chia sẻ |
| B | Dispatcher Botkeep + executor Windows | Khả thi; có giá trị nếu cần giám sát/cảnh báo 24/7, nhưng thực thi vẫn cần máy Windows bật |
| C | Giữ Windows + watchdog/Scheduled Task restart + tắt sleep | Rẻ nhất, rủi ro thấp nhất |
| D | Executor trên VM/VPS ≥ 4 GB | Giải quyết 24/7 thật sự; tốn chi phí, cần checkout và secrets mới |

Khuyến nghị: **C trước**; **B** chỉ nếu mục tiêu là giám sát khi executor tắt; nếu cần *chạy task khi máy Windows tắt* thì phải **D** — Botkeep Free không đủ.

## 6. Kế hoạch smoke test (chưa chạy; mọi bước cần chủ repo duyệt)

Điều kiện: repo/issue thử riêng (không dùng Issue #8), token GitHub tối thiểu.
1. Xác nhận gói Founder Free (2 GB / 1,5 vCore) trong dashboard Botkeep, ghi lại giá trị.
2. App Node "hello": `node --version`, đo RSS nhàn rỗi, kiểm tra có console/shell không, kiểm tra outbound tới `api.github.com`, `api.anthropic.com`.
3. (Tùy chọn, chỉ để ghi nhận) `npm i -g @anthropic-ai/claude-code`, `claude --version`, `claude doctor`; **không nhập secret Claude**.
4. Race claim: nhiều tiến trình cùng tạo `refs/claims/test-1` → đúng 1 bên 201, còn lại 422 (100 lượt).
5. Poll ETag: xác nhận 304 không tính quota; đo RSS/CPU dispatcher 1 giờ.
6. Restart: kill dispatcher giữa chừng → không chạy trùng, không mất task.
7. Log: không lộ token.

Tiêu chí đạt: RSS dispatcher < 150 MB, CPU TB < 5% một core, 0 task trùng trong 100 lượt race, phục hồi < 30 s.

## 7. Rollback
- Thiết kế không sửa runner Windows → rollback = dừng/xóa app dispatcher trên Botkeep và bật lại poll ở runner Windows. Không có thay đổi DB/production/secrets CRM cần hoàn tác.
- Thu hồi: revoke token GitHub dành cho Botkeep; xóa `refs/claims/*` trên repo thử.
- Cắt chuyển: chỉ **một** poller tại một thời điểm (tắt Windows poll → bật dispatcher; ngược lại khi rollback). Không chạy song song.

## 8. Quyết định cần chủ repo
1. Mục tiêu thật: chạy task khi máy Windows tắt (→ D) hay chỉ giám sát (→ B/C)?
2. Chấp nhận lưu token GitHub trên hạ tầng chia sẻ không zero-knowledge? Có tách repo riêng cho claim?
3. Terms không đề cập agent/CLI, hạ tầng beta không SLA, có thể bị hạn chế do fair-use.
4. Tài khoản có phải Founder không (số liệu 2 GB phụ thuộc cửa sổ đăng ký)?
5. Mọi thay đổi `runner.mjs` (ETag, claim ref, `RUNNER_ID`) cần task + PR riêng, phối hợp Issue #53 (ENOBUFS).
6. Claude chạy ở executor nên điều kiện "supported countries" áp dụng cho vị trí executor, không phải Botkeep.

## 9. Nguồn
- https://botkeep.cloud
- https://botkeep.cloud/terms (§5 giới hạn Founder Free; §7 env; §8 cấm; §9 thực thi; §12/§14)
- https://code.claude.com/docs/en/setup
- Mã: `tools/claude-auto-runner/{runner.mjs,README.md,install.ps1,config.example.json}` @ origin/main a5de704

## 10. Đã / chưa kiểm chứng
- Đã: đọc runner trên `origin/main`; đọc hai trang Botkeep và trang setup Claude Code qua công cụ fetch (kết quả là bản tóm tắt tự động, chủ repo nên đối chiếu trực tiếp số liệu trên trang).
- Chưa: mọi thử nghiệm trên Botkeep, tạo ref claim, đo RAM, outbound network, cài Claude CLI. Không chạy test/benchmark/deploy.
