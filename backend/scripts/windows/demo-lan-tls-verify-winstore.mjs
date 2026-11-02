// SISCOM CRM B1.5 - doc kho CA tin cay cua Windows cho T4 cua demo-lan-tls-verify.mjs (tach rieng de tu kiem import duoc ma script chinh
// LUON chay day du khi goi truc tiep - khong dung nhan dien "isMain" (QA Codex PR #199: chay qua symlink => isMain sai => thoat 0 im lang).
import crypto from 'node:crypto';
import path from 'node:path';
import { execFile } from 'node:child_process';

// ---- Kho CA tin cay cua WINDOWS (T4) - doc TRUC TIEP, CHI DOC, khong phu thuoc NODE_USE_SYSTEM_CA ----
// Node 24 mac dinh CHI tin kho CA rieng cua Node; kho Windows chi duoc dung khi dat NODE_USE_SYSTEM_CA=1 / --use-system-ca.
// Vi vay handshake khong CA (T4 cu) KHONG chung minh duoc CA mkcert vang mat khoi kho Windows. Ham duoi doi chieu SHA-256 cua
// rootCA.pem voi TUNG chung chi trong cac kho Root cua Windows (Get-ChildItem Cert:\..., chi doc; khong them/xoa/sua chung chi nao).
export const WINDOWS_ROOT_STORES = ['Cert:\\CurrentUser\\Root', 'Cert:\\LocalMachine\\Root', 'Cert:\\LocalMachine\\AuthRoot'];
const PS_READ_STORES = "$ErrorActionPreference='Stop'; foreach ($s in @(" + WINDOWS_ROOT_STORES.map((s) => "'" + s + "'").join(',') + ")) { Get-ChildItem -LiteralPath $s | ForEach-Object { 'C ' + $s + ' ' + [Convert]::ToBase64String($_.RawData) } }; 'END'";
export function defaultPowerShellPath() { return path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'); }
// Tra { ok: true, certs: [{ store, der }] } hoac { ok: false, code: 'TIMEOUT' | 'READ_ERROR' | 'NOT_WINDOWS', detail }.
export function readWindowsRootStore({ timeoutMs = 20000, psPath = defaultPowerShellPath(), exec = execFile, platform = process.platform } = {}) {
  if (platform !== 'win32') return Promise.resolve({ ok: false, code: 'NOT_WINDOWS', detail: 'he dieu hanh ' + platform });
  return new Promise((resolve) => {
    exec(psPath, ['-NoProfile', '-NonInteractive', '-Command', PS_READ_STORES], { timeout: timeoutMs, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        if (err.killed || err.signal || err.code === 'ETIMEDOUT') return resolve({ ok: false, code: 'TIMEOUT', detail: 'qua ' + timeoutMs + ' ms' });
        return resolve({ ok: false, code: 'READ_ERROR', detail: String((stderr || err.message || err.code || '')).split(/\r?\n/).find((l) => l.trim()) || String(err.code) });
      }
      const lines = String(stdout).split(/\r?\n/);
      if (!lines.some((l) => l.trim() === 'END')) return resolve({ ok: false, code: 'READ_ERROR', detail: 'dau ra thieu dong END (bi cat)' });
      const certs = [];
      for (const l of lines) { const m = /^C (\S+) ([A-Za-z0-9+/=]+)$/.exec(l.trim()); if (m) certs.push({ store: m[1], der: Buffer.from(m[2], 'base64') }); }
      resolve({ ok: true, certs });
    });
  });
}
// Tra { ok, status: 'NOT_PRESENT' | 'PRESENT' | 'ERROR', detail }. ok=true CHI khi doc duoc kho va KHONG co chung chi nao trung SHA-256.
// So bang dau van tay SHA-256 cua toan bo chung chi (khong so ten/subject: CA khac khoa cung ten => khong trung).
export async function checkCaNotInWindowsStore(caPem, { reader = readWindowsRootStore } = {}) {
  let caFp;
  try { caFp = new crypto.X509Certificate(caPem).fingerprint256; } catch { return { ok: false, status: 'ERROR', detail: 'khong doc duoc rootCA.pem' }; }
  const r = await reader();
  if (!r.ok) return { ok: false, status: 'ERROR', detail: 'khong ket luan duoc: khong doc duoc kho CA Windows (' + r.code + (r.detail ? ': ' + r.detail : '') + ')' };
  let parsed = 0; const hits = new Set();
  for (const c of r.certs) {
    let fp; try { fp = new crypto.X509Certificate(c.der).fingerprint256; } catch { continue; }
    parsed++; if (fp === caFp) hits.add(c.store);
  }
  if (!parsed) return { ok: false, status: 'ERROR', detail: 'khong ket luan duoc: kho CA Windows doc ra 0 chung chi hop le' };
  if (hits.size) return { ok: false, status: 'PRESENT', detail: 'CA mkcert (SHA-256 ' + caFp + ') CO trong kho Windows: ' + [...hits].join(', ') };
  return { ok: true, status: 'NOT_PRESENT', detail: 'SHA-256 ' + caFp.slice(0, 23) + '... khong trung voi ' + parsed + ' chung chi trong ' + WINDOWS_ROOT_STORES.join(', ') };
}
