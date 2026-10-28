// Run: node --test tests/   (Node >= 18, no dependencies). Injected fetch only; no network, no DB, no storage.
// Integration of the three customer UI behaviours on ONE controller: remote lookups (#64) + server paging/search (#65) + 409 conflict recovery (#66).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCustomerApiUi } from '../src/features/customers/customerApiUi.js';

const BASE = 'http://127.0.0.1:3000/api/v1';
const ON = { VITE_CRM_API_ENABLED: 'true', VITE_CRM_API_BASE: BASE };
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const err = (status, code, message = 'x', details) => res(status, { error: { code, message, details } });
const LOOKUPS = {
  customer_tier: [{ code: 'vip', label: 'VIP' }], customer_status: [{ code: 'active', label: 'Đang hoạt động' }],
  industry: [{ code: 'IND-1', label: 'Xây dựng' }], source: [{ code: 'web', label: 'Website' }], province: [{ code: 'HCM', label: 'TP. Hồ Chí Minh' }],
};
const uid = (i) => '0b9f1c52-3a0e-4c3e-9d6f-' + String(i).padStart(12, '0');
const apiCust = (i, over = {}) => ({ id: uid(i), code: 'KH-' + String(i).padStart(5, '0'), name: 'Công ty ' + i, phone: '0901234567', version: 2, ...over });
const q = (url) => Object.fromEntries(new URL(url).searchParams);

// Fake server: 45 customers, paging honoured; PATCH #1 -> 409 stale, PATCH #2 -> success; `authed=false` -> every call 401.
const makeServer = (state = { authed: true }) => {
  const calls = []; let np = 0; let ng = 0;
  const f = async (url, init = {}) => {
    const method = init.method || 'GET'; calls.push({ url, method, body: init.body ? JSON.parse(init.body) : null });
    if (!state.authed) return err(401, 'UNAUTHENTICATED');
    const path = new URL(url).pathname.replace('/api/v1', '');
    if (path === '/lookups') return res(200, { data: LOOKUPS });
    if (method === 'PATCH') return ++np === 1 ? err(409, 'CUSTOMER_VERSION_CONFLICT', 'stale', { currentVersion: 5 }) : res(200, { data: apiCust(21, { version: 6, name: 'Bản của tôi' }) });
    if (path === '/customers') {
      const p = q(url); const page = Number(p.page || 1); const size = Number(p.pageSize || 20); const items = [];
      for (let i = (page - 1) * size + 1; i <= Math.min(page * size, 45); i++) items.push(apiCust(i));
      return res(200, { data: { items, page, pageSize: size, total: 45, totalPages: Math.ceil(45 / size) } });
    }
    return ++ng === 1 ? res(200, { data: apiCust(21, { version: 2 }) }) : res(200, { data: apiCust(21, { version: 5, name: 'Bản máy chủ' }) });
  };
  f.calls = calls; f.patches = () => calls.filter((c) => c.method === 'PATCH'); return f;
};

test('lookup + paging + conflict trên cùng một controller: không phá nhau', async () => {
  const f = makeServer(); const c = createCustomerApiUi({ env: ON, fetchImpl: f });
  await c.loadLookups(); assert.equal(c.getState().lookups.status, 'ready');
  await c.load({ page: 1 }); await c.nextPage();
  let s = c.getState(); assert.equal(s.list.paging.page, 2); assert.equal(s.list.items.length, 20);
  await c.loadDetail(uid(21)); assert.equal(s.lookups.status, 'ready');
  const r = await c.update(uid(21), { name: 'Bản của tôi', phone: '0901234567', short: '', taxId: '' }, 2);
  assert.equal(r.error.staleVersion, true); assert.equal(f.patches()[0].body.version, 2);
  s = c.getState();
  assert.equal(s.lookups.status, 'ready', 'lookups còn nguyên sau 409'); assert.equal(s.list.paging.page, 2, 'trang hiện tại còn nguyên sau 409');
  assert.equal(s.update.conflict.status, 'idle');
  await c.refreshConflict(uid(21)); s = c.getState();
  assert.equal(s.update.conflict.server.version, 5); assert.equal(s.detail.customer.version, 2, 'chưa tự ghi đè detail');
  // Người dùng chọn "giữ bản của tôi": lưu lại với version máy chủ, sau đó phân trang vẫn chạy.
  const r2 = await c.update(uid(21), { name: 'Bản của tôi', phone: '0901234567', short: '', taxId: '' }, s.update.conflict.server.version);
  assert.equal(r2.ok, true); assert.equal(f.patches()[1].body.version, 5);
  await c.prevPage(); s = c.getState(); assert.equal(s.list.paging.page, 1); assert.equal(s.lookups.status, 'ready');
  await c.search('ab'); assert.equal(c.getState().list.params.search, 'ab'); assert.equal(c.getState().list.params.page, 1);
  assert.equal(f.calls.filter((x) => x.url.includes('/lookups')).length, 1, 'lookups chỉ tải một lần');
});

test('cờ TẮT: controller = null, không fetch, localStorage không bị đụng', () => {
  const touched = []; const prev = globalThis.localStorage;
  globalThis.localStorage = new Proxy({}, { get: (_t, k) => { touched.push(String(k)); return () => null; } });
  try {
    const f = makeServer();
    for (const env of [{}, { VITE_CRM_API_ENABLED: 'false' }, { VITE_CRM_API_ENABLED: 'TRUE' }, { VITE_CRM_API_BASE: BASE }]) assert.equal(createCustomerApiUi({ env, fetchImpl: f }), null);
    assert.equal(f.calls.length, 0); assert.deepEqual(touched, []);
  } finally { if (prev === undefined) delete globalThis.localStorage; else globalThis.localStorage = prev; }
});

test('cờ BẬT + 401: lookups/list/detail đều lỗi unauthenticated, không dữ liệu demo, không PATCH, không đụng localStorage', async () => {
  const touched = []; const prev = globalThis.localStorage;
  globalThis.localStorage = new Proxy({}, { get: (_t, k) => { touched.push(String(k)); return () => null; } });
  try {
    const f = makeServer({ authed: false }); const c = createCustomerApiUi({ env: ON, fetchImpl: f });
    await c.loadLookups(); await c.load({ page: 2 }); await c.loadDetail(uid(1));
    const s = c.getState();
    assert.equal(s.lookups.status, 'error'); assert.equal(s.lookups.error.kind, 'unauthenticated'); assert.equal(s.lookups.maps, null);
    assert.equal(s.list.status, 'error'); assert.equal(s.list.error.status, 401); assert.deepEqual(s.list.items, []); assert.equal(s.list.params.page, 2);
    assert.equal(s.detail.status, 'error');
    const r = await c.update(uid(1), { name: 'x', phone: '0901234567', short: '', taxId: '' }, 1);
    assert.equal(r.error.kind, 'unauthenticated'); assert.equal(s.update.conflict, null);
    assert.equal(f.calls.every((x) => x.url.startsWith(BASE)), true); assert.deepEqual(touched, []);
  } finally { if (prev === undefined) delete globalThis.localStorage; else globalThis.localStorage = prev; }
});
