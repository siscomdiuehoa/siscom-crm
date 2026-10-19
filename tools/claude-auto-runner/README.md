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
