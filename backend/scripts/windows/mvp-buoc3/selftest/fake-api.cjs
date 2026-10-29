// API GIẢ cho bộ tự kiểm của công cụ mvp-kiem-tra-xoa-mem.ps1 (KHÔNG phải backend thật, KHÔNG có DB, KHÔNG có dữ liệu thật).
// Mô phỏng đúng hợp đồng API (B1.3 §3.4, bộ lọc lỗi, guard CSRF toàn cục) cho các route công cụ dùng, và GHI LẠI từng yêu cầu
// (phương thức, đường dẫn, có cookie?, có X-CSRF-Token?) để bộ tự kiểm xác nhận công cụ gửi đúng header.
// Chạy: node fake-api.cjs [port]   (mặc định 3999, chỉ 127.0.0.1). Mọi tài khoản/mật khẩu đều được chấp nhận (giả).
const http = require('node:http');
const { randomUUID } = require('node:crypto');

const PORT = Number(process.argv[2] || 3999);
const ORIGINS = new Set(['http://127.0.0.1:4175', 'http://localhost:4175']);
const CUSTOMER = { id: '2fee292e-66bc-4078-a761-5c3dd973149e', code: 'KH-00013', name: 'E2E admin (gia)' };
const ROLES = {
  admin: { code: 'NV-0002', fullName: 'Quan tri CRM (gia)', roles: ['crm_admin'], permissions: { 'customer.read': 'ALL', 'customer.create': 'ALL', 'customer.update': 'ALL', 'customer.delete': 'ALL', 'customer.restore': 'ALL' } },
  ketoan: { code: 'NV-0005', fullName: 'Ke toan (gia)', roles: ['accountant'], permissions: { 'customer.read': 'ALL' } },
};
const sessions = new Map(); // sid -> { csrf, role }
const requests = [];

// Gửi Content-Length như Express/backend thật (không chunked): chính điều này làm Windows PowerShell 5.1 đọc hết luồng phản hồi
// lỗi trước khi mã gọi kịp đọc (tái hiện "mã lỗi trống" của công cụ cũ).
const send = (res, status, obj, extraHeaders = {}) => {
  const text = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text), ...extraHeaders });
  res.end(text);
};
const err = (res, status, code, message, details) => {
  const body = { statusCode: status, message, error: { code, message, ...(details !== undefined ? { details } : {}) }, path: '/', timestamp: new Date().toISOString(), requestId: randomUUID() };
  send(res, status, body, { 'X-Request-Id': body.requestId });
};
const ok = (res, status, data, extraHeaders = {}) => send(res, status, { data }, extraHeaders);
const readBody = (req) => new Promise((resolve) => { let s = ''; req.on('data', (c) => { s += c; }); req.on('end', () => resolve(s)); });
const cookieSid = (req) => { const m = /(?:^|;\s*)siscom_sid=([^;]+)/.exec(req.headers.cookie || ''); return m ? m[1] : null; };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const p = url.pathname;
  const sid = cookieSid(req);
  requests.push({ method: req.method, path: p, hasCookie: sid !== null, hasCsrf: 'x-csrf-token' in req.headers, origin: req.headers.origin || null });
  if (p === '/__selftest/requests') return ok(res, 200, requests);

  const unsafe = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
  const sess = sid ? sessions.get(sid) : undefined;
  // Guard CSRF toàn cục (như CsrfOriginGuard): có cookie phiên + ghi => Origin hợp lệ VÀ X-CSRF-Token khớp; không cookie => chỉ kiểm Origin nếu gửi.
  if (unsafe) {
    const origin = req.headers.origin;
    if (sid === null) { if (origin !== undefined && !ORIGINS.has(origin)) return err(res, 403, 'CSRF_FAILED', 'Yeu cau bi tu choi (kiem tra nguon goc).'); }
    else if (!ORIGINS.has(origin) || !sess || req.headers['x-csrf-token'] !== sess.csrf) return err(res, 403, 'CSRF_FAILED', 'Yeu cau bi tu choi (kiem tra nguon goc).');
  }
  if (p === '/api/v1/auth/login' && req.method === 'POST') {
    const body = JSON.parse((await readBody(req)) || '{}');
    const role = String(body.login || '').startsWith('ketoan') ? 'ketoan' : 'admin';
    const newSid = randomUUID().replace(/-/g, ''); const csrf = randomUUID().replace(/-/g, '');
    sessions.set(newSid, { csrf, role });
    const me = { employeeId: randomUUID(), ...ROLES[role], mustChangePassword: false };
    return ok(res, 200, { me, csrfToken: csrf }, { 'Set-Cookie': ['siscom_sid=' + newSid + '; Path=/api/v1; HttpOnly; SameSite=Lax', 'siscom_csrf=' + csrf + '; Path=/; SameSite=Lax'] });
  }
  if (!sess) return err(res, 401, 'UNAUTHENTICATED', 'Chua xac thuc.');
  const perms = ROLES[sess.role].permissions;
  if (p === '/api/v1/auth/logout' && req.method === 'POST') { sessions.delete(sid); return ok(res, 200, { ok: true }); }
  if (p === '/api/v1/customers' && req.method === 'GET') return ok(res, 200, { items: [CUSTOMER], page: 1, pageSize: Number(url.searchParams.get('pageSize') || 20), total: 1, totalPages: 1 });
  if (p === '/api/v1/customers/' + CUSTOMER.id && req.method === 'GET') return ok(res, 200, { ...CUSTOMER, deletedAt: null, version: 1 });
  if (p === '/api/v1/customers/' + CUSTOMER.id && req.method === 'DELETE') {
    if (!perms['customer.delete']) return err(res, 403, 'FORBIDDEN', 'Khong co quyen.');
    return err(res, 409, 'DELETE_LINKS_UNVERIFIED', 'Chua the xoa khach hang: he thong chua kiem tra duoc hop dong, bao gia, du an, co hoi lien quan.', { unchecked: ['contract', 'quote', 'project', 'opportunity'] });
  }
  if (p === '/api/v1/customers/' + CUSTOMER.id + '/restore' && req.method === 'POST') {
    if (!perms['customer.restore']) return err(res, 403, 'FORBIDDEN', 'Khong co quyen.');
    return err(res, 409, 'CUSTOMER_NOT_DELETED', 'Khach hang dang hoat dong, khong can khoi phuc.');
  }
  return err(res, 404, 'NOT_FOUND', 'Khong tim thay.');
}).listen(PORT, '127.0.0.1', () => console.log('fake-api listening 127.0.0.1:' + PORT));
