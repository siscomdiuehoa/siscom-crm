// Run: node --test tests/apiModeDemoIsolation.test.mjs   (Node >= 18; vite + react only. Injected fetch, in-memory DOM; no network, no DB, no browser.)
// CROSS-MODULE isolation of the REAL <App> (src/App.jsx) between the localStorage demo and the customer API mode:
//   API ON : Dashboard / customer list / customer detail / global search / AI chat / demo tools never show demo customers, revenue, contacts
//            (seedV2 + APP_DATA are the oracle), the demo database in localStorage is never read, written, migrated or backed up
//            — even after 401 / 403 / network failure — and unsupported modules say "chưa hỗ trợ trong chế độ API". No fake session is created.
//   API OFF: original demo behaviour unchanged (demo data visible, demo database persisted).
// Mocked fetch only — this is NOT a real backend / browser E2E.
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import React from 'react';
import { installDom, text, byTag, findAll, buttonByText, type } from './helpers/miniDom.mjs';

const BASE = 'http://127.0.0.1:3000/api/v1';
const ID = '0b9f1c52-3a0e-4c3e-9d6f-0a1b2c3d4e5f';
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const LOOKUPS = { customer_tier: [], customer_status: [], industry: [], source: [], province: [] };
const CONFIG = new URL('../vite.config.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const UNSUPPORTED = /chưa hỗ trợ trong chế độ API/;

let dom; let act; let createRoot; let seedV2; let APP_DATA; let DB_KEY;
const servers = []; const apps = {}; let store; let writes; let reads; let fetchCalls; let fetchImpl;

async function loadApp(apiOn) {
  const prev = { f: process.env.VITE_CRM_API_ENABLED, b: process.env.VITE_CRM_API_BASE };
  if (apiOn) { process.env.VITE_CRM_API_ENABLED = 'true'; process.env.VITE_CRM_API_BASE = BASE; } else { delete process.env.VITE_CRM_API_ENABLED; delete process.env.VITE_CRM_API_BASE; }
  const vite = await createServer({ configFile: CONFIG, server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom', logLevel: 'silent', clearScreen: false });
  servers.push(vite);
  const mod = await vite.ssrLoadModule('/src/App.jsx');
  if (prev.f === undefined) delete process.env.VITE_CRM_API_ENABLED; else process.env.VITE_CRM_API_ENABLED = prev.f;
  if (prev.b === undefined) delete process.env.VITE_CRM_API_BASE; else process.env.VITE_CRM_API_BASE = prev.b;
  return { App: mod.default, vite };
}

before(async () => {
  dom = installDom();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.innerWidth = 1440;
  document.querySelector = () => null;
  Object.getPrototypeOf(document.createElement('x')).getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 40, right: 400, bottom: 40 });
  globalThis.location = { search: '', hash: '' }; window.location = globalThis.location; // App reads location at import time
  globalThis.localStorage = {
    getItem: (k) => { reads.push(k); return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: (k, v) => { writes.push(k); store[k] = String(v); },
    removeItem: (k) => { writes.push('remove:' + k); delete store[k]; },
    key: (i) => Object.keys(store)[i] || null, get length() { return Object.keys(store).length; },
  };
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: (...a) => { fetchCalls.push(a); return fetchImpl(...a); } });
  ({ createRoot } = await import('react-dom/client')); ({ act } = await import('react'));
  apps.off = await loadApp(false);
  ({ seedV2 } = await apps.off.vite.ssrLoadModule('/src/data/repository/index.js')); ({ DB_KEY } = await apps.off.vite.ssrLoadModule('/src/data/repository/index.js'));
  ({ APP_DATA } = await apps.off.vite.ssrLoadModule('/src/data/demoData.js'));
});
after(async () => { for (const s of servers) await s.close(); if (dom) dom.restore(); delete globalThis.localStorage; delete globalThis.location; delete globalThis.IS_REACT_ACT_ENVIRONMENT; });
beforeEach(() => { store = {}; writes = []; reads = []; fetchCalls = []; fetchImpl = async () => { throw new TypeError('network down'); }; });

const settle = async () => { for (let i = 0; i < 6; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
async function mount(which, hash) {
  globalThis.location.hash = hash;
  const container = dom.doc.createElement('div'); dom.doc.body.appendChild(container);
  const root = createRoot(container);
  const app = which === 'on' ? await loadApp(true) : apps.off; // fresh module graph per ON mount: the controller is a module singleton
  await act(async () => { root.render(React.createElement(app.App)); });
  await settle();
  return { container, root, unmount: async () => { await act(async () => root.unmount()); } };
}
// Strings that only exist in the demo dataset: customer names/short names/tax ids, contact names/emails/phones, opportunity + overdue labels.
function demoMarkers() {
  const db = seedV2(); const m = new Set();
  for (const c of db.customers) [c.name, c.short, c.taxId].forEach((v) => v && String(v).length > 5 && m.add(String(v)));
  for (const c of db.contacts) [c.name, c.email, c.phone].forEach((v) => v && String(v).length > 5 && m.add(String(v)));
  for (const o of db.opportunities) o.name && m.add(o.name);
  return [...m];
}
const assertNoDemo = (el, where) => { const t = text(el); for (const mk of demoMarkers()) assert.ok(!t.includes(mk), `${where}: demo marker "${mk}" leaked in API mode`); };
const apiServer = (customersResp, customerResp) => async (url) => {
  const p = new URL(url).pathname;
  if (p.endsWith('/lookups')) return res(200, { data: LOOKUPS });
  return p.endsWith('/customers') ? customersResp : customerResp;
};
const FAILS = { '401': () => res(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } }), '403': () => res(403, { error: { code: 'FORBIDDEN', message: 'x' } }), network: () => { throw new TypeError('network down'); } };
const allowedWrite = (k) => k === 'siscom-crm-theme'; // theme preference is not customer data

test('OFF (default): original demo behaviour — demo dashboard + customers visible, demo DB persisted, zero fetch', async () => {
  const d = await mount('off', '#/dashboard');
  assert.match(text(d.container), /Bản demo giao diện/);
  assert.match(text(d.container), /Doanh thu/);
  assert.ok(text(d.container).includes('Sông Xanh Land'), 'demo content on dashboard');
  assert.ok(writes.includes(DB_KEY), 'demo DB persisted in OFF mode');
  assert.equal(fetchCalls.length, 0);
  await d.unmount();
  const l = await mount('off', '#/customers');
  assert.ok(demoMarkers().some((mk) => text(l.container).includes(mk)), 'demo customers listed');
  await l.unmount();
});

test('ON: Dashboard shows no demo KPI/revenue/customers, says unsupported, makes no API call and no storage access to the demo DB', async () => {
  store[DB_KEY] = JSON.stringify({ planted: 'Khách Cắm Sẵn Nguyễn Văn Bí Mật' });
  const d = await mount('on', '#/dashboard');
  const t = text(d.container);
  assertNoDemo(d.container, 'dashboard');
  assert.doesNotMatch(t, /Doanh thu|Lợi nhuận|Công nợ phải thu|tỷ VNĐ|Hiệu suất kinh doanh|Nhận định AI/);
  assert.doesNotMatch(t, /Bản demo giao diện/);
  assert.match(t, UNSUPPORTED);
  assert.ok(!t.includes('Bí Mật'), 'planted localStorage record never rendered');
  assert.ok(!reads.includes(DB_KEY), 'demo DB never read in API mode');
  assert.ok(!writes.filter((k) => !allowedWrite(k)).length, 'no storage writes except theme: ' + writes.join(','));
  assert.equal(store[DB_KEY], JSON.stringify({ planted: 'Khách Cắm Sẵn Nguyễn Văn Bí Mật' }), 'planted value untouched');
  await d.unmount();
});

for (const [name, mk] of Object.entries(FAILS)) {
  test(`ON + ${name}: customer list shows the error, no demo data, no localStorage fallback`, async () => {
    fetchImpl = async (url) => { if (new URL(url).pathname.endsWith('/lookups')) return res(200, { data: LOOKUPS }); return mk(); };
    const l = await mount('on', '#/customers');
    assertNoDemo(l.container, 'list ' + name);
    assert.ok(fetchCalls.length > 0, 'API was attempted');
    assert.ok(!writes.filter((k) => !allowedWrite(k)).length, 'no fallback storage writes: ' + writes.join(','));
    assert.ok(!reads.includes(DB_KEY), 'demo DB never read');
    assert.ok(!findAll(l.container, (e) => e.tagName === 'TR' || e.tagName === 'ARTICLE').some((e) => /Công ty|KH-/.test(text(e)) && !UNSUPPORTED.test(text(e))), 'no fabricated rows');
    await l.unmount();
  });
  test(`ON + ${name}: customer detail shows no demo contacts/quotes/debt and no localStorage fallback`, async () => {
    fetchImpl = async (url) => { if (new URL(url).pathname.endsWith('/lookups')) return res(200, { data: LOOKUPS }); const r = mk(); return r; };
    const d = await mount('on', '#/customers/' + ID);
    assertNoDemo(d.container, 'detail ' + name);
    assert.doesNotMatch(text(byTag(d.container, 'main')[0]), /Báo giá|Công nợ quá hạn|Người liên hệ|Hợp đồng/);
    assert.ok(!writes.filter((k) => !allowedWrite(k)).length, 'no fallback storage writes: ' + writes.join(','));
    await d.unmount();
  });
}

test('ON (200): list/detail render ONLY server data; no demo extras (contacts, quotes, opportunities, debt) are attached to a server customer', async () => {
  const demoId = seedV2().customers[0].id;
  const row = { id: ID, code: 'KH-00007', name: 'Công ty Máy Chủ', shortName: 'Máy Chủ', phone: '0901234567', version: 2, owner: { id: '0b9f1c52-3a0e-4c3e-9d6f-000000000900', fullName: 'Chủ sở hữu' } };
  fetchImpl = apiServer(res(200, { data: { items: [row], page: 1, pageSize: 20, total: 1, totalPages: 1 } }), res(200, { data: row }));
  const l = await mount('on', '#/customers');
  assert.match(text(l.container), /Máy Chủ/);
  assertNoDemo(l.container, 'list 200');
  await l.unmount();
  const d = await mount('on', '#/customers/' + ID);
  assert.match(text(d.container), /Máy Chủ/);
  assertNoDemo(d.container, 'detail 200');
  await d.unmount();
  // A demo id typed into the URL must not resolve against the demo DB.
  fetchImpl = apiServer(res(404, { error: { code: 'NOT_FOUND', message: 'x' } }), res(404, { error: { code: 'NOT_FOUND', message: 'x' } }));
  const n = await mount('on', '#/customers/' + demoId);
  assertNoDemo(n.container, 'demo id in URL');
  assert.ok(!writes.filter((k) => !allowedWrite(k)).length);
  await n.unmount();
});

test('ON: global search, AI chat and demo data tools expose no demo data', async () => {
  fetchImpl = apiServer(res(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } }), res(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } }));
  const d = await mount('on', '#/dashboard');
  const search = byTag(d.container, 'input').find((i) => /tìm/i.test((i.getAttribute && (i.getAttribute('placeholder') || i.getAttribute('aria-label'))) || '') ) || byTag(d.container, 'input')[0];
  if (search) { await act(async () => { type(search, 'Sông'); }); await settle(); }
  assertNoDemo(dom.doc.body, 'global search');
  assert.equal(buttonByText(d.container, /Trợ lý AI/), undefined, 'AI assistant entry (demo-scripted answers) hidden in API mode');
  assert.doesNotMatch(text(dom.doc.body), /dữ liệu minh hoạ: 6 hoá đơn|Hoàng Gia Riverside/);
  assert.equal(buttonByText(d.container, /Sao lưu|Xuất sao lưu|Khôi phục dữ liệu mẫu|Nhập sao lưu/), undefined, 'demo backup/reset tools hidden in API mode');
  await d.unmount();
});

test('ON: no fake session — nothing identifies a demo user as a signed-in API user, and the role switch does not persist', async () => {
  const d = await mount('on', '#/customers');
  assert.ok(!reads.includes('siscom-crm-demo-user'));
  assert.ok(!writes.includes('siscom-crm-demo-user'));
  assertNoDemo(d.container, 'session');
  await d.unmount();
});
