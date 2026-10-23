// Run: node --test tests/contract/frontendBackendContract.test.mjs   (Node >= 18, không phụ thuộc, KHÔNG DB, KHÔNG Nest, KHÔNG mạng ngoài; chỉ HTTP localhost 127.0.0.1 cổng ngẫu nhiên.)
//
// QA-FRONTEND-BACKEND-COMBINED-CONTRACT-PREVIEW. Đối chiếu mã frontend THẬT (customerApiClient/Repository/Adapter, authClient, loginSession)
// với hợp đồng backend ĐỌC TỪ MÃ NGUỒN backend (backendContractFacts.mjs), qua một máy chủ HTTP giả lập trên localhost.
// Điểm khác với các smoke test frontend cũ: mock KHÔNG tự bịa — trường bắt buộc/được phép, giới hạn trang, mã lỗi, type lookups, CORS lấy từ backend.
//
// Nhãn trạng thái trong tên test:
//   KHỚP              hai bên đã đồng ý, test khóa lại.
//   LỆCH              khác biệt đã xác minh; test khóa hành vi hiện tại (hoặc là todo mô tả hành vi đúng).
//   CONTRACT_PENDING  backend chưa có route/provider: test KHÔNG giả xanh; chỉ kiểm chứng "đang chưa có" và sẽ ĐỎ khi backend thêm vào,
//                     để buộc chuyển thành test hợp đồng thật. Nửa backend nằm ở test `todo` (hiện TODO, không phải PASS).
// KHÔNG đăng ký AuthController, KHÔNG đụng guard default-deny, KHÔNG gọi PostgreSQL. Auth mock (#84) chỉ dùng để kiểm nửa FRONTEND.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { loadFacts, probeBackendAvailability } from './backendContractFacts.mjs';
import { createCustomerRepository } from '../../src/data/api/customerRepository.js';
import { createCustomerApi, readApiConfig, StaleSessionError } from '../../src/data/api/customerApiClient.js';
import { describeRepoError, buildListParams } from '../../src/features/customers/customerApiUi.js';
import { toApiCustomer, buildLookupMaps } from '../../src/data/api/customerAdapter.js';
import { createAuthClient, readAuthConfig } from '../../src/auth/authClient.js';
import { createLoginSession } from '../../src/auth/loginSession.js';

const F = loadFacts();
const PROBE = probeBackendAvailability();
const E7 = '00000000-0000-4000-8000-000000000007';
const uid = (i) => '0b9f1c52-3a0e-4c3e-9d6f-' + String(i).padStart(12, '0');

// ---------- Máy chủ giả lập (localhost) dựng từ facts ----------
// Phong bì lỗi = đúng các khóa mà AllExceptionsFilter backend ghi ra (kiểm ở nhóm FACTS).
const envelope = (status, code, message, details) => ({ statusCode: status, message, ...(Array.isArray(details) ? { details } : {}), error: { code, message, ...(details !== undefined ? { details } : {}) }, path: '/', timestamp: '2026-10-23T00:00:00.000Z' });
const LOOKUP_ROWS = (t) => ({ customer_tier: [['VIP', 'VIP'], ['POTENTIAL', 'Tiềm năng']], customer_status: [['ACTIVE', 'Đang hoạt động'], ['POTENTIAL', 'Tiềm năng']], industry: [['CONSTRUCTION', 'Xây dựng']], source: [['WEB', 'Website']], province: [['HCM', 'TP. Hồ Chí Minh']] }[t]
  .map(([code, labelVi], i) => ({ code, label: labelVi, sortOrder: i, isActive: true }))); // hình dạng của LookupsService.list (kèm sortOrder/isActive)
const detailOf = (c) => ({ id: c.id, code: c.code, name: c.name, shortName: c.shortName ?? null, taxId: null, tier: { code: 'POTENTIAL', label: 'Tiềm năng', isActive: true }, status: { code: 'POTENTIAL', label: 'Tiềm năng', isActive: true }, industry: null, source: null, province: null, address: null, phone: c.phone, phoneE164: null, email: null, website: null, owner: { id: E7, code: 'NV-0007', fullName: 'Nhân viên 7' }, note: null, tags: [], revenueVnd: '0', revenueBasis: 'CONTRACT', version: c.version, createdAt: '2026-10-23T00:00:00.000Z', updatedAt: '2026-10-23T00:00:00.000Z', deletedAt: null, restoredAt: null });
const listItemOf = (c) => { const d = detailOf(c); return { id: d.id, code: d.code, name: d.name, shortName: d.shortName, taxId: d.taxId, tier: { code: d.tier.code, label: d.tier.label }, status: { code: d.status.code, label: d.status.label }, industry: null, province: null, phone: d.phone, email: d.email, owner: { id: E7, code: 'NV-0007', fullName: 'Nhân viên 7' }, version: d.version, createdAt: d.createdAt, updatedAt: d.updatedAt, deletedAt: null }; };

const validatePayload = (body, allowed, required) => {
  const details = [];
  for (const k of Object.keys(body)) if (!allowed.includes(k)) details.push('property ' + k + ' should not exist'); // forbidNonWhitelisted
  for (const k of required) if (body[k] === undefined) details.push(k + ' should not be empty');
  return details;
};

// opts.actorProvider=false mô phỏng cấu hình thật (DenyAll): mọi route khách hàng/lookups 401 UNAUTHENTICATED.
// opts.inject(req, n) -> { status, code, message?, details? } | undefined: tiêm lỗi (403/429/5xx...). opts.delayMs(req): trì hoãn phản hồi.
async function startMock(opts = {}) {
  const store = new Map(); for (let i = 1; i <= 45; i++) store.set(uid(i), { id: uid(i), code: 'KH-' + String(i).padStart(5, '0'), name: 'Công ty ' + i, phone: '0901234567', version: 1 });
  const log = []; let n = 0;
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString('utf8');
    const u = new URL(req.url, 'http://127.0.0.1'); const path = u.pathname.replace(/^\/api\/v1/, '');
    const body = raw ? JSON.parse(raw) : null;
    const entry = { method: req.method, path, query: Object.fromEntries(u.searchParams), headers: req.headers, body }; log.push(entry); n++;
    const send = (status, json) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(json)); };
    const err = (status, code, message, details) => send(status, envelope(status, code, message, details));
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs(entry, n) || 0));
    const inj = opts.inject && opts.inject(entry, n); if (inj) return err(inj.status, inj.code, inj.message || 'x', inj.details);
    if (path.startsWith('/auth/')) return opts.auth ? opts.auth(entry, send, err) : err(404, F.filterCodes[404], 'Không tìm thấy đường dẫn yêu cầu.'); // route chưa đăng ký: Nest trả 404 TRƯỚC mọi guard
    if (opts.actorProvider === false || !/^Bearer \S+$/.test(String(req.headers.authorization || ''))) return err(401, F.filterCodes[401], 'Chưa xác thực.');
    if (path === '/lookups' && req.method === 'GET') {
      if (!F.lookupTypeRe.test(entry.query.type || '')) return err(400, F.filterCodes[400], 'type', ['type phải là danh sách loại danh mục phân cách bằng dấu phẩy.']);
      return send(200, { data: Object.fromEntries(entry.query.type.split(',').map((t) => [t, LOOKUP_ROWS(t)])) });
    }
    if (path === '/customers' && req.method === 'GET') {
      const q = entry.query; const page = q.page === undefined ? 1 : Number(q.page); const pageSize = q.pageSize === undefined ? 20 : Number(q.pageSize); const details = [];
      if (!Number.isInteger(page) || page < 1) details.push('page phải là số nguyên');
      if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > F.query.pageSizeMax) details.push('pageSize phải là số nguyên trong 1–' + F.query.pageSizeMax);
      if (q.search !== undefined && q.search.trim().length < F.query.searchMin) details.push('search phải có ít nhất ' + F.query.searchMin + ' ký tự');
      for (const k of Object.keys(q)) if (!F.query.fields.includes(k)) details.push('property ' + k + ' should not exist');
      if (details.length) return err(400, F.filterCodes[400], 'Dữ liệu gửi lên không hợp lệ.', details);
      let rows = [...store.values()]; if (q.search) rows = rows.filter((r) => r.name.includes(q.search.trim()));
      return send(200, { data: { items: rows.slice((page - 1) * pageSize, page * pageSize).map(listItemOf), page, pageSize, total: rows.length, totalPages: Math.ceil(rows.length / pageSize) } });
    }
    if (path === '/customers' && req.method === 'POST') {
      const details = validatePayload(body || {}, F.create.fields, F.create.required);
      if (body && typeof body.name === 'string' && body.name.trim().length < F.create.nameMin) details.push('Tên công ty quá ngắn');
      if (details.length) return err(400, F.filterCodes[400], 'Dữ liệu gửi lên không hợp lệ.', details);
      const c = { id: uid(100 + store.size), code: 'KH-' + String(100 + store.size).padStart(5, '0'), name: body.name, phone: body.phone, version: 1 }; store.set(c.id, c);
      return send(201, { data: detailOf(c) });
    }
    const m = /^\/customers\/([^/]+)$/.exec(path);
    if (m && req.method === 'PATCH') {
      const details = validatePayload(body || {}, F.update.fields, F.update.required);
      if (body && body.version !== undefined && (!Number.isInteger(body.version) || body.version < 1)) details.push('version phải là số nguyên');
      if (details.length) return err(400, F.filterCodes[400], 'Dữ liệu gửi lên không hợp lệ.', details);
      const cur = store.get(m[1]); if (!cur) return err(404, 'CUSTOMER_NOT_FOUND', 'Không tìm thấy khách hàng.');
      if (cur.version !== body.version) return err(409, 'CUSTOMER_VERSION_CONFLICT', 'Khách hàng đã được người khác cập nhật. Vui lòng tải lại.', { currentVersion: cur.version });
      Object.assign(cur, { name: body.name ?? cur.name, phone: body.phone ?? cur.phone, version: cur.version + 1 });
      return send(200, { data: detailOf(cur) });
    }
    if (m && req.method === 'GET') { const cur = store.get(m[1]); return cur ? send(200, { data: detailOf(cur) }) : err(404, 'CUSTOMER_NOT_FOUND', 'Không tìm thấy khách hàng.'); }
    return err(404, F.filterCodes[404], 'Không tìm thấy đường dẫn yêu cầu.');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port + '/api/v1';
  return { base, log, store, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}

const TOKEN = 'sid_' + 'A'.repeat(43);
const okSession = () => { let h = 'Bearer ' + TOKEN; const calls = []; return { calls, set: (v) => { h = v; }, getState: () => ({ status: h ? 'AUTHENTICATED' : 'IDLE' }), getAuthHeader: () => h, handleUnauthorized: (used) => { calls.push(used); } }; };
const apiOf = (mock, auth) => createCustomerApi(readApiConfig({ VITE_CRM_API_ENABLED: 'true', VITE_CRM_API_BASE: mock.base }), undefined, { auth });
const repoOf = (mock) => createCustomerRepository({ env: { VITE_CRM_API_ENABLED: 'true', VITE_CRM_API_BASE: mock.base }, fetchImpl: (url, init) => fetch(url, { ...init, headers: { ...init.headers, Authorization: 'Bearer ' + TOKEN } }) });
const thrown = async (p) => { try { await p; } catch (e) { return e; } assert.fail('mong đợi bị từ chối'); };

describe('FACTS — hằng số hợp đồng đọc từ mã nguồn backend (chống PASS rỗng)', () => {
  test('DTO tạo/sửa/truy vấn: trường bắt buộc, giới hạn, sort, mã lỗi đều trích được', () => {
    assert.deepEqual(F.create.required.sort(), ['name', 'phone']);
    assert.deepEqual(F.update.required, ['version']);
    assert.equal(F.query.pageSizeMax, 100);
    assert.equal(F.query.searchMin, 2);
    assert.ok(F.query.sortFields.includes('relevance') && F.query.sortFields.length >= 6);
    assert.equal(F.create.nameMsg, 'Vui lòng nhập tên công ty');
    assert.equal(F.domainErrors.CUSTOMER_VERSION_CONFLICT, 409);
    assert.equal(F.domainErrors.VALIDATION_FAILED, 400);
    assert.deepEqual([F.filterCodes[401], F.filterCodes[403], F.filterCodes[429]], ['UNAUTHENTICATED', 'FORBIDDEN', 'TOO_MANY_REQUESTS']);
    assert.deepEqual(F.listKeys, ['items', 'page', 'pageSize', 'total', 'totalPages']);
    assert.deepEqual(Object.values(F.lookupTypes).sort(), ['customer_status', 'customer_tier', 'industry', 'province', 'source']);
    assert.ok(F.lookupTypeRe.test('customer_tier,industry') && !F.lookupTypeRe.test('Customer-Tier'));
  });
});

describe('KHỚP — khách hàng: GET list + phân trang', () => {
  test('tham số trang/tìm kiếm frontend gửi nằm trong QueryCustomersDto; pageSize bị kẹp ≤ 100; search < 2 ký tự không được gửi', async () => {
    const p = buildListParams({ page: 2, pageSize: 5000, search: 'a' });
    assert.deepEqual(p, { page: 2, pageSize: F.query.pageSizeMax });
    for (const k of Object.keys(buildListParams({ page: 1, pageSize: 20, search: 'Công ty' }))) assert.ok(F.query.fields.includes(k), k);
    const mock = await startMock();
    try {
      const d = await repoOf(mock).list({ page: 2, pageSize: 20, search: 'Công ty' });
      assert.deepEqual(Object.keys(d).filter((k) => ['page', 'pageSize', 'total', 'totalPages'].includes(k)).sort(), ['page', 'pageSize', 'total', 'totalPages']);
      assert.equal(d.page, 2); assert.equal(d.total, 45); assert.equal(d.totalPages, 3); assert.equal(d.items.length, 20);
      assert.ok(d.items.every((c) => c.id && c.code && c.name && c.owner === 'Nhân viên 7')); // fromApiCustomer đọc đúng hình dạng list item của backend
      assert.deepEqual(mock.log.at(-1).query, { page: '2', pageSize: '20', search: 'Công ty' });
      assert.equal(mock.log.at(-1).headers.cookie, undefined); // credentials:'omit'
    } finally { await mock.close(); }
  });
  test('backend từ chối pageSize=101 và search 1 ký tự bằng 400 VALIDATION_FAILED; frontend hiện là bad_request kèm details', async () => {
    const mock = await startMock();
    try {
      for (const q of [{ page: 1, pageSize: 101 }, { page: 1, pageSize: 20, search: 'a' }]) {
        const e = await thrown(apiOf(mock, okSession()).list(q));
        assert.equal(e.status, 400); assert.equal(e.code, 'VALIDATION_FAILED'); assert.ok(Array.isArray(e.details) && e.details.length);
      }
    } finally { await mock.close(); }
  });
});

describe('KHỚP — POST tạo khách hàng: name + phone bắt buộc', () => {
  test('thân POST của frontend ⊆ CreateCustomerDto (forbidNonWhitelisted) kể cả khi điền mọi trường; không có owner/id/code/version', async () => {
    const maps = buildLookupMaps({ customer_tier: [{ code: 'VIP', label: 'VIP' }], customer_status: [{ code: 'ACTIVE', label: 'Đang hoạt động' }], industry: [{ code: 'CONSTRUCTION', label: 'Xây dựng' }], source: [{ code: 'WEB', label: 'Website' }], province: [{ code: 'HCM', label: 'TP. Hồ Chí Minh' }] });
    const ui = { name: 'Công ty A', short: 'A', taxId: '0123456789', phone: '0901234567', email: 'a@b.vn', website: 'https://a.vn', address: 'HCM', note: 'n', industry: 'Xây dựng', source: 'Website', city: 'TP. Hồ Chí Minh', tier: 'VIP', status: 'Đang hoạt động', tags: ['x'], owner: 'Hacker', ownerId: uid(9), id: uid(8), code: 'KH-1', version: 3 };
    const body = toApiCustomer(ui, maps, { mode: 'create' });
    assert.deepEqual(Object.keys(body).filter((k) => !F.create.fields.includes(k)), []);
    for (const r of F.create.required) assert.ok(body[r]);
    const patch = toApiCustomer(ui, maps, { mode: 'update', version: 3 });
    assert.deepEqual(Object.keys(patch).filter((k) => !F.update.fields.includes(k)), []);
    assert.equal(patch.version, 3);
  });
  test('thiếu tên/điện thoại: frontend chặn TRƯỚC khi gọi mạng; nếu lọt thì backend trả 400 VALIDATION_FAILED; tạo hợp lệ -> 201 {data} với id, code, version', async () => {
    const mock = await startMock();
    try {
      const repo = repoOf(mock);
      for (const bad of [{ name: '', phone: '0901234567' }, { name: 'Công ty B', phone: '  ' }]) {
        const e = await thrown(repo.create(bad)); assert.equal(e.kind, 'validation');
      }
      assert.equal(mock.log.length, 0, 'không có yêu cầu mạng nào');
      const raw = await fetch(mock.base + '/customers', { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Công ty B' }) });
      const j = await raw.json(); assert.equal(raw.status, 400); assert.equal(j.error.code, 'VALIDATION_FAILED'); assert.ok(j.details.some((d) => d.startsWith('phone')));
      const c = await repo.create({ name: 'Công ty mới', phone: '0901234567', owner: 'Hacker' });
      assert.ok(c.id && c.code && c.version === 1 && c.name === 'Công ty mới');
      assert.equal(mock.log.at(-1).body.owner, undefined);
    } finally { await mock.close(); }
  });
});

describe('KHỚP — PATCH + version, 409 CUSTOMER_VERSION_CONFLICT', () => {
  test('cập nhật gửi version hiện tại -> version tăng; version cũ -> 409 conflict, staleVersion=true, currentVersion có trong details', async () => {
    const mock = await startMock();
    try {
      const repo = repoOf(mock); const id = uid(3);
      const cur = await repo.get(id); assert.equal(cur.version, 1);
      const upd = await repo.update(id, { name: 'Tên mới ABC', phone: '0901234567' }, cur.version);
      assert.equal(upd.version, 2);
      assert.deepEqual(Object.keys(mock.log.at(-1).body).sort(), ['name', 'phone', 'version', ...Object.keys(mock.log.at(-1).body).filter((k) => !['name', 'phone', 'version'].includes(k))].sort());
      assert.equal(mock.log.at(-1).body.version, 1);
      const e = await thrown(repo.update(id, { name: 'Tên khác XYZ', phone: '0901234567' }, 1)); // version 1 đã cũ
      const d = describeRepoError(e);
      assert.equal(e.kind, 'conflict'); assert.equal(e.status, 409); assert.equal(e.code, 'CUSTOMER_VERSION_CONFLICT');
      assert.equal(d.staleVersion, true); assert.equal(e.details.currentVersion, 2);
    } finally { await mock.close(); }
  });
});

describe('KHỚP — GET /lookups danh mục', () => {
  test('type frontend gửi khớp regex backend và đúng 5 loại LOOKUP_TYPES; phản hồi backend (kèm sortOrder/isActive) map ra 5 trường chọn', async () => {
    const mock = await startMock();
    try {
      const maps = await apiOf(mock, okSession()).getLookupMaps();
      const sent = mock.log.at(-1).query.type;
      assert.ok(F.lookupTypeRe.test(sent));
      assert.deepEqual(sent.split(',').sort(), Object.values(F.lookupTypes).sort());
      for (const f of ['tier', 'status', 'industry', 'source', 'city']) assert.equal(maps[f].missing, false, f);
      assert.equal(maps.tier.toCode('VIP'), 'VIP'); assert.equal(maps.city.toLabel('HCM'), 'TP. Hồ Chí Minh');
    } finally { await mock.close(); }
  });
});

describe('KHỚP — mã lỗi 400/401/403/429 và phiên cũ', () => {
  test('401 UNAUTHENTICATED (không có actor) và 403 FORBIDDEN: frontend phân loại unauthenticated/forbidden, giữ mã backend, KHÔNG thử lại, không đổi sang dữ liệu demo', async () => {
    const mock = await startMock({ actorProvider: false });
    try {
      const noAuth = createCustomerRepository({ env: { VITE_CRM_API_ENABLED: 'true', VITE_CRM_API_BASE: mock.base } }); // không gửi Authorization
      const e401 = await thrown(noAuth.list({ page: 1, pageSize: 20 }));
      assert.equal(e401.kind, 'unauthenticated'); assert.equal(e401.code, 'UNAUTHENTICATED'); assert.equal(describeRepoError(e401).denied, true);
      assert.equal(mock.log.length, 1);
    } finally { await mock.close(); }
    const m403 = await startMock({ inject: (r) => (r.path === '/customers' ? { status: 403, code: F.filterCodes[403] } : undefined) });
    try {
      const e = await thrown(repoOf(m403).list({ page: 1, pageSize: 20 }));
      assert.equal(e.kind, 'forbidden'); assert.equal(e.code, 'FORBIDDEN'); assert.equal(describeRepoError(e).denied, true);
    } finally { await m403.close(); }
  });
  test('LỆCH — 429 TOO_MANY_REQUESTS ở API khách hàng không có nhánh riêng: kind "http", retryable, KHÔNG có gợi ý chờ (frontend chỉ phân biệt 429 ở đăng nhập)', async () => {
    const mock = await startMock({ inject: () => ({ status: 429, code: F.filterCodes[429] }) });
    try {
      const e = await thrown(repoOf(mock).list({ page: 1, pageSize: 20 }));
      const d = describeRepoError(e);
      assert.equal(e.status, 429); assert.equal(e.code, 'TOO_MANY_REQUESTS');
      assert.equal(e.kind, 'http'); assert.equal(d.hint, ''); assert.equal(d.retryable, true);
    } finally { await mock.close(); }
  });
  test('phiên: 401 gọi handleUnauthorized với ĐÚNG header đã dùng; phiên đổi trong lúc chờ -> StaleSessionError, không trả dữ liệu cũ', async () => {
    const m401 = await startMock({ inject: () => ({ status: 401, code: F.filterCodes[401] }) });
    try {
      const s = okSession(); const e = await thrown(apiOf(m401, s).list({ page: 1, pageSize: 20 }));
      assert.equal(e.status, 401); assert.deepEqual(s.calls, ['Bearer ' + TOKEN]);
    } finally { await m401.close(); }
    const slow = await startMock({ delayMs: () => 60 });
    try {
      const s = okSession(); const p = apiOf(slow, s).list({ page: 1, pageSize: 20 });
      setTimeout(() => s.set('Bearer sid_' + 'B'.repeat(43)), 15);
      assert.ok((await thrown(p)) instanceof StaleSessionError);
      const out = okSession(); const q = apiOf(slow, out).list({ page: 1, pageSize: 20 });
      setTimeout(() => out.set(null), 15); // đăng xuất khi đang chờ
      assert.ok((await thrown(q)) instanceof StaleSessionError);
    } finally { await slow.close(); }
  });
  test('không có phiên xác thực (opt-in auth) -> AuthRequiredError trước mạng, 0 yêu cầu', async () => {
    const mock = await startMock();
    try {
      const s = okSession(); s.set(null);
      const e = await thrown(apiOf(mock, s).list({ page: 1, pageSize: 20 }));
      assert.equal(e.status, 401); assert.equal(e.code, 'AUTH_REQUIRED'); assert.equal(mock.log.length, 0);
    } finally { await mock.close(); }
  });
});

describe('LỆCH — 400 details của backend không kèm tên trường', () => {
  test('các message tùy biến của DTO (details trả về là CHUỖI message) không bắt đầu bằng tên thuộc tính -> frontend không gắn được vào ô nhập, chỉ hiện ở "extra"', async () => {
    const orphan = F.customMessages.filter((m) => !m.message.startsWith(m.property));
    assert.ok(orphan.length >= 3, 'có message tùy biến không mang tên trường: ' + JSON.stringify(orphan.slice(0, 3)));
    const mock = await startMock({ inject: (r) => (r.method === 'POST' ? { status: 400, code: F.filterCodes[400], details: [F.create.nameMsg] } : undefined) });
    try {
      const e = await thrown(repoOf(mock).create({ name: 'Công ty A', phone: '0901234567' }));
      const d = describeRepoError(e);
      assert.equal(e.kind, 'bad_request');
      assert.deepEqual(d.fieldErrors, {}); assert.deepEqual(d.extra, [F.create.nameMsg]); // hiển thị được nhưng KHÔNG đánh dấu ô "Tên công ty"
    } finally { await mock.close(); }
  });
  test('hành vi mong muốn (TODO, chưa PASS): lỗi 400 của backend phải đánh dấu đúng ô — cần backend trả details dạng {field,message} hoặc frontend ánh xạ theo message', { todo: 'CONTRACT_GAP: backend details là chuỗi không kèm tên trường; chủ sở hữu chọn bên sửa' }, async () => {
    const mock = await startMock({ inject: (r) => (r.method === 'POST' ? { status: 400, code: F.filterCodes[400], details: [F.create.nameMsg] } : undefined) });
    try {
      const d = describeRepoError(await thrown(repoOf(mock).create({ name: 'Công ty A', phone: '0901234567' })));
      assert.equal(typeof d.fieldErrors.name, 'string');
    } finally { await mock.close(); }
  });
});

describe('KHỚP — CORS cấu hình backend đủ cho yêu cầu Bearer của frontend', () => {
  test('PATCH + Authorization + Content-Type được cho phép; credentials:false khớp credentials:"omit" của frontend; không cho X-CSRF-Token', () => {
    assert.ok(['GET', 'POST', 'PATCH', 'OPTIONS'].every((m) => F.cors.methods.includes(m)));
    assert.ok(['Authorization', 'Content-Type'].every((h) => F.cors.allowedHeaders.includes(h)));
    assert.equal(F.cors.credentialsFalse, true);
    assert.ok(!F.cors.allowedHeaders.some((h) => /csrf/i.test(h)), 'CSRF/cookie chưa được duyệt cho production');
  });
});

// ---------- ĐĂNG NHẬP: nửa FRONTEND kiểm trên mock theo hợp đồng #84; nửa BACKEND = CONTRACT_PENDING ----------
const AUTH_MOCK_NOTE = 'MOCK-ONLY theo hợp đồng PR #84 (không phải backend thật)';
const authMock = (extra = {}) => startMock({
  ...extra,
  auth: (r, send, err) => {
    if (r.path === '/auth/login') {
      const b = r.body || {}; const id = String(b.login || '');
      if (typeof b.login !== 'string' || typeof b.password !== 'string' || Object.keys(b).some((k) => !['login', 'password'].includes(k))) return err(400, 'REQUEST_INVALID', 'x');
      if (id === 'throttled@siscom.vn') return err(429, 'LOGIN_THROTTLED', 'x');
      const known = id === 'NV-0007' || id.toLowerCase() === 'nv7@siscom.vn';
      if (!known || b.password !== 'Mat-khau-thu-nghiem-1') return err(401, 'LOGIN_INVALID', 'x');
      return send(200, { token: TOKEN, expiresAt: '2026-10-24T00:00:00.000Z' });
    }
    if (r.path === '/auth/me') return r.headers.authorization === 'Bearer ' + TOKEN ? send(200, { employeeId: E7 }) : err(401, 'AUTH_REQUIRED', 'x');
    if (r.path === '/auth/logout') return send(200, { ok: true });
    return err(404, 'NOT_FOUND', 'x');
  },
});
const sessionOf = (mock) => createLoginSession(createAuthClient(readAuthConfig({ VITE_CRM_AUTH_ENABLED: 'true', VITE_CRM_API_BASE: mock.base })));

describe('NỬA FRONTEND của hợp đồng đăng nhập — ' + AUTH_MOCK_NOTE, () => {
  test('đăng nhập bằng email (khác hoa/thường) và mã NV: POST /auth/login {login,password} -> {token,expiresAt}; /me trả employeeId; credentials omit', async () => {
    for (const id of ['NV-0007', 'NV7@Siscom.VN']) {
      const mock = await authMock();
      try {
        const s = sessionOf(mock); const st = await s.submit(id, 'Mat-khau-thu-nghiem-1');
        assert.equal(st.status, 'AUTHENTICATED'); assert.equal(st.employeeId, E7); assert.equal(st.expiresAt, '2026-10-24T00:00:00.000Z');
        const [login, me] = mock.log;
        assert.deepEqual([login.method, login.path, me.method, me.path], ['POST', '/auth/login', 'GET', '/auth/me']);
        assert.deepEqual(Object.keys(login.body).sort(), ['login', 'password']);
        assert.equal(me.headers.authorization, 'Bearer ' + TOKEN); assert.equal(login.headers.cookie, undefined);
        assert.equal(JSON.stringify(st).includes(TOKEN), false);
      } finally { await mock.close(); }
    }
  });
  test('400/401/429/404 -> REQUEST_INVALID? / INVALID_CREDENTIALS / RATE_LIMITED / ENDPOINT_UNAVAILABLE; định danh sai không gọi mạng', async () => {
    const mock = await authMock();
    try {
      const run = async (id, pw) => (await sessionOf(mock).submit(id, pw)).error;
      assert.equal(await run('NV-0007', 'sai'), 'INVALID_CREDENTIALS');
      assert.equal(await run('NV-0099', 'Mat-khau-thu-nghiem-1'), 'INVALID_CREDENTIALS');
      assert.equal(await run('throttled@siscom.vn', 'x'), 'RATE_LIMITED');
      const before = mock.log.length;
      assert.equal(await run('NV-007', 'x'), 'IDENTIFIER_INVALID'); assert.equal(mock.log.length, before);
    } finally { await mock.close(); }
    const m400 = await startMock({ auth: (r, s, err) => err(400, 'REQUEST_INVALID', 'x') });
    const m404 = await startMock({}); // route /auth/* chưa tồn tại => 404 NOT_FOUND
    try {
      assert.equal((await sessionOf(m400).submit('NV-0007', 'x')).error, 'REQUEST_INVALID');
      assert.equal((await sessionOf(m404).submit('NV-0007', 'x')).error, 'ENDPOINT_UNAVAILABLE');
    } finally { await m400.close(); await m404.close(); }
  });
  test('phiên hết hạn: sau đăng nhập, 401 từ API khách hàng với đúng header -> SESSION_EXPIRED, token bị bỏ, API sau đó không gửi yêu cầu', async () => {
    const mock = await authMock({ inject: (r) => (r.path === '/customers' ? { status: 401, code: F.filterCodes[401] } : undefined) });
    try {
      const s = sessionOf(mock); await s.submit('NV-0007', 'Mat-khau-thu-nghiem-1');
      const api = createCustomerApi(readApiConfig({ VITE_CRM_API_ENABLED: 'true', VITE_CRM_API_BASE: mock.base }), undefined, { auth: s });
      await thrown(api.list({ page: 1, pageSize: 20 }));
      assert.equal(s.getState().status, 'ERROR'); assert.equal(s.getState().error, 'SESSION_EXPIRED'); assert.equal(s.getAuthHeader(), null);
      const n = mock.log.length; assert.equal((await thrown(api.list({ page: 1, pageSize: 20 }))).code, 'AUTH_REQUIRED'); assert.equal(mock.log.length, n);
    } finally { await mock.close(); }
  });
});

describe('CONTRACT_PENDING — những gì backend CHƯA có (không giả xanh)', () => {
  test('CONTRACT_PENDING: không có @Controller("auth") trong backend/src (POST /auth/login, GET /auth/me chưa tồn tại) — ĐỎ khi được thêm để buộc viết test hợp đồng thật', () => {
    assert.deepEqual(PROBE.authControllers, [], 'AuthController đã xuất hiện: chuyển 2 test todo bên dưới thành test thật chạy với backend thật');
  });
  test('CONTRACT_PENDING: ActorProvider duy nhất trong mã production là DenyAll -> luồng "đã đăng nhập xem khách hàng" không thể xanh với backend thật', () => {
    assert.equal(PROBE.actorProviders.length, 1);
    assert.match(PROBE.actorProviders[0], /deny-all-actor\.provider\.ts$/);
  });
  test('KHỚP (default-deny giữ nguyên): controller Customers/Lookups dùng ActorGuard, không @Public', () => {
    for (const c of PROBE.guardedControllers) { assert.equal(c.guarded, true, c.file); assert.equal(c.isPublic, false, c.file); }
  });
  test('CONTRACT_PENDING: nhánh backend này không có AccessGuard/@RequirePermissions (chuỗi #84 dùng chúng) -> hợp đồng auth #84 chưa tích hợp được với chuỗi frontend', () => {
    assert.equal(PROBE.hasAccessGuard, false);
  });
  test('backend thật: POST /api/v1/auth/login nhận email và mã NV, trả {token,expiresAt}', { todo: 'CONTRACT_PENDING: AuthController chưa được duyệt/đăng ký' }, () => { assert.fail('UNAVAILABLE'); });
  test('backend thật: GET /api/v1/auth/me trả {employeeId} và token đó mở được GET /customers (cần ActorProvider thật)', { todo: 'CONTRACT_PENDING: ActorProvider thật chưa có' }, () => { assert.fail('UNAVAILABLE'); });
});
