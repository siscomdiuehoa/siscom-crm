// Gọi gh CLI KHÔNG chặn event loop, có timeout, retry + backoff cho lỗi tạm thời.
// Lý do: spawnSync làm treo HTTP/dashboard/heartbeat suốt thời gian gh chạy (mỗi lượt poll gọi nhiều trang),
// và một lỗi mạng thoáng qua (ví dụ "stream error ... CANCEL") làm hỏng cả lượt poll mà không thử lại.
import { spawn } from "node:child_process";

// Lỗi vĩnh viễn: thử lại vô ích (sai thông tin xác thực, không tìm thấy, dữ liệu sai).
const PERMANENT_RE = /Bad credentials|HTTP 401|HTTP 404|HTTP 422|Not Found|gh auth login|requires authentication|Validation Failed/i;
// Lỗi tạm thời: mạng, HTTP/2 stream bị hủy, 5xx, quá hạn, giới hạn tốc độ.
const TRANSIENT_RE = /stream error|CANCEL|ECONNRESET|ECONNREFUSED|ECONNABORTED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EPIPE|socket hang up|unexpected EOF|\bEOF\b|timed? ?out|timeout|\bTLS\b|tls:|connection (?:reset|refused|closed|aborted)|temporar|Service Unavailable|Bad Gateway|Gateway Time-?out|Internal Server Error|HTTP 5\d\d|\b50[0234]\b|rate limit|secondary rate|abuse detection|ENOBUFS|no such host|network is unreachable/i;
const RATE_LIMIT_RE = /rate limit|secondary rate|abuse detection/i;

export const errText = (r) => String((r && (r.err || r.error || r.out)) || "gh failed").trim().slice(0, 300);

// 'ok' | 'transient' | 'permanent'
export function classifyGhError(r) {
  if (r && r.code === 0) return "ok";
  const t = errText(r);
  if (RATE_LIMIT_RE.test(t)) return "transient";
  if (PERMANENT_RE.test(t)) return "permanent";
  if (TRANSIENT_RE.test(t) || (r && r.code === -2)) return "transient";
  // Không rõ nguyên nhân: coi là tạm thời (thử lại có giới hạn) thay vì bỏ ngay; hết lượt thì báo lỗi.
  return "transient";
}

// Backoff mũ có jitter: attempt=1 -> ~base, 2 -> ~2*base ... tối đa max; hệ số ngẫu nhiên 0.5..1.
export function backoffDelay(attempt, baseMs, maxMs, rnd = Math.random()) {
  const raw = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
  return Math.round(raw * (0.5 + rnd / 2));
}

const MAX_OUT = 8 * 1024 * 1024;

export function createGhClient({
  command = "gh", prefixArgs = [], cwd, timeoutMs = 45000, maxAttempts = 3,
  baseDelayMs = 1000, maxDelayMs = 8000, spawnFn = spawn,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)), rand = Math.random, onRetry = null,
} = {}) {
  const once = (args, t, input) => new Promise((resolve) => {
    let out = "", err = "", done = false, child, timer;
    const fin = (r) => { if (done) return; done = true; clearTimeout(timer); resolve(r); };
    try {
      child = spawnFn(command, [...prefixArgs, ...args], { cwd, windowsHide: true, shell: false });
      child.stdout?.on("data", (d) => {
        out += d.toString();
        if (out.length > MAX_OUT) { try { child.kill(); } catch {} fin({ code: -1, out: "", err, error: "gh output quá lớn (>8MB)" }); }
      });
      child.stderr?.on("data", (d) => { err = (err + d.toString()).slice(-8000); });
      child.on("error", (e) => fin({ code: -1, out: out.trim(), err: err.trim(), error: e.message }));
      child.on("close", (code) => fin({ code: code ?? -1, out: out.trim(), err: err.trim(), error: "" }));
      timer = setTimeout(() => { try { child.kill(); } catch {} fin({ code: -2, out: out.trim(), err: err.trim(), error: "gh timed out after " + t + "ms" }); }, t);
      if (input !== undefined && child.stdin) { child.stdin.on("error", () => {}); child.stdin.end(input); }
    } catch (e) { fin({ code: -1, out, err, error: String(e) }); }
  });

  // call(args, {attempts, timeout, input}) -> {code,out,err,error,attempts,kind}
  return async function ghAsync(args, { attempts = maxAttempts, timeout = timeoutMs, input } = {}) {
    let last;
    for (let i = 1; i <= attempts; i++) {
      last = await once(args, timeout, input);
      const kind = classifyGhError(last);
      if (kind === "ok") return { ...last, attempts: i, kind };
      if (kind === "permanent" || i === attempts) return { ...last, attempts: i, kind };
      const delay = backoffDelay(i, baseDelayMs, maxDelayMs, rand());
      try { onRetry?.({ attempt: i, delay, error: errText(last) }); } catch {}
      await sleep(delay);
    }
    return last;
  };
}
