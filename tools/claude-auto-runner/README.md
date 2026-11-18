# SISCOM Claude Auto-Runner

Cầu nối local để ChatGPT giao task qua GitHub Issue #8 và Claude Code CLI tự thực thi trên máy Windows.

## Nguyên tắc
- Không thêm dependency CRM.
- Dashboard chỉ bind `127.0.0.1:45871`.
- GitHub poll 10–15 giây; heartbeat/render dashboard 1 giây qua SSE.
- Chỉ nhận task từ `siscomdiuehoa` trong Issue #8.
- Task quan trọng bị chặn nếu thiếu `OWNER_APPROVED:YES`.
- Không dùng cờ bỏ qua quyền của Claude.

## Cài một lần
```powershell
cd D:\SISCOM-CRM
powershell -ExecutionPolicy Bypass -File .\tools\claude-auto-runner\install.ps1
```

Installer kiểm tra `node`, `git`, `gh`, `claude`, tạo config trong `%LOCALAPPDATA%\SISCOM-ClaudeRunner\config.json`, tạo Scheduled Task chạy lúc đăng nhập và mở dashboard.

## Task format
```text
<!-- CLAUDE_TASK -->
RISK:SAFE

<yêu cầu>
```

Việc quan trọng chỉ chạy sau khi chủ repo duyệt:
```text
<!-- CLAUDE_TASK -->
RISK:IMPORTANT
OWNER_APPROVED:YES

<yêu cầu>
```

## Gỡ
```powershell
powershell -ExecutionPolicy Bypass -File .\tools\claude-auto-runner\uninstall.ps1
```

Nếu Claude CLI yêu cầu quyền tương tác cho một task, runner báo BLOCKED thay vì bỏ qua cơ chế quyền.

## Khả năng chịu lỗi (V5.2)
- `gh` chạy **bất đồng bộ** (không chặn HTTP/dashboard/heartbeat), có timeout; lỗi tạm thời (ví dụ `stream error ... CANCEL`, 5xx, timeout, rate limit) được **retry + backoff mũ có jitter**; lỗi vĩnh viễn (401/404/422) không retry.
- Hàng đợi đọc **tăng dần** (1 request/lượt, full resync mỗi 30 phút) thay vì ~16 request/lượt; ngay trước khi chạy task luôn **xác minh đầy đủ lại** phê duyệt (thu hồi/xoá giữa hai lượt poll => không chạy).
- Lỗi GitHub liên tiếp: Runner giãn cách poll (tối đa 2 phút), ghi `GH_ERROR` một lần, tự phục hồi và ghi `GH_RECOVERED`. `state.poll` cho biết `lastOkAt`, `consecutiveErrors`, `lastError`.
- Mỗi task: `RUNNER_ACK source=<id>` khi bắt đầu → `CLAUDE_RESULT source=<id>` khi xong. RESULT không đăng được được giữ ở `%LOCALAPPDATA%\SISCOM-ClaudeRunner\pending-posts.json` và đăng lại khi GitHub phục hồi; đăng không nhân đôi nếu phản hồi bị mất.
- Chống nhận trùng: `state.processed` + task đã có `CLAUDE_RESULT` do `trustedLogin` đăng (dù mất `state.json`) + chỉ một Runner (cổng HTTP là khóa; không bind được cổng thì thoát mã 3).
- Cơ chế `OWNER_APPROVED`, `ALLOWED_SCOPES` **không đổi**. Task có `SCOPE` ngoài danh sách (ví dụ `READ_ONLY_DIAGNOSTICS`, `READ_ONLY`) vẫn là `INVALID_SCOPE` (nay hiển thị rõ scope trong sự kiện `QUEUE`); task có `STATUS: CANCELLED_BY_OWNER` được xếp `cancelled`.

## Khởi động lại an toàn
1. Xem `http://127.0.0.1:45871/api/status`: chỉ dừng khi `claude.state` là `idle`/`waiting_approval` (không dừng khi `running`).
2. Dừng đúng một tiến trình Runner (`Get-CimInstance Win32_Process | ? CommandLine -like '*claude-auto-runner\runner.mjs*'` → `Stop-Process -Id <PID>`). Không xoá `state.json`.
3. Chép các tệp mới/sửa vào `D:\SISCOM-CRM\tools\claude-auto-runner\` (sao lưu bản cũ trước): `runner.mjs`, `ghqueue.mjs`, `queue-policy.mjs`, `ghclient.mjs`.
4. Chạy `node --test tools\claude-auto-runner\` (không cần mạng, không đụng state thật) — kỳ vọng toàn bộ đạt.
5. Khởi động đúng một Runner: `Start-Process node -ArgumentList 'D:\SISCOM-CRM\tools\claude-auto-runner\runner.mjs' -WindowStyle Hidden`. Nếu cổng đã bận, Runner mới tự thoát (mã 3) — đúng thiết kế.
6. Kiểm tra `/api/status`: có sự kiện `RUNNER`, `state.poll.lastOkAt` cập nhật, API trả lời < 1 giây.
Hoàn tác: chép lại bản sao lưu 4 tệp và khởi động lại như trên.

## Kiểm thử
`node --test tools\claude-auto-runner\` — gồm test đơn vị (retry/backoff, đồng bộ tăng dần, đăng không nhân đôi, chính sách phê duyệt) và test tích hợp chạy `runner.mjs` thật với `gh`/`claude` giả trong `test-support/` (thư mục dữ liệu tạm, cổng ngẫu nhiên; không chạm GitHub/Claude/state thật).
