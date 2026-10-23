// Run: node --test tests/apiModePermissionFailClosed.test.mjs   (Node >= 18; vite + react only. Injected fetch, in-memory DOM; no network, no DB, no browser.)
// FAIL-CLOSED UI permissions of the REAL <App> in API mode. Today the app has NO authenticated server actor and NO server-provided permission set,
// so every sensitive control (create / edit / import / export / delete / dashboard) must be disabled or absent, a click must not reach the network,
// and the demo role matrix (src/auth/permissions.js, default 'u-director' = everything allowed) or app localStorage ('siscom-crm-demo-user')
// must never grant anything. OFF (demo) mode must keep its original role-based UI. UI gating is NOT a replacement for backend permissions.
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import React from 'react';
import { installDom, text, byTag, buttonByText, click } from './helpers/miniDom.mjs';

const BASE = 'http://127.0.0.1:3000/api/v1';
const ID = '0b9f1c52-3a0e-4c3e-9d6f-0a1b2c3d4e5f';
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const LOOKUPS = { customer_tier: [], customer_status: [], industry: [], source: [], province: [] };
const CONFIG = new URL('../vite.config.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const ROW = { id: ID, code: 'KH-00007', name: 'Công ty Máy Chủ', shortName: 'Máy Chủ', phone: '0901234567', version: 2, owner: { id: '0b9f1c52-3a0e-4c3e-9d6f-000000000900', fullName: 'Chủ sở hữu' } };

let dom; let act; let createRoot; let store; let fetchCalls; let fetchImpl;
const servers = [];

async function loadApp(apiOn) {
  const prev = { f: process.env.VITE_CRM_API_ENABLED, b: process.env.VITE_CRM_API_BASE };
  if (apiOn) { process.env.VITE_CRM_API_ENABLED = 'true'; process.env.VITE_CRM_API_BASE = BASE; } else { delete process.env.VITE_CRM_API_ENABLED; delete process.env.VITE_CRM_API_BASE; }
  const vite = await createServer({ configFile: CONFIG, server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom', logLevel: 'silent', clearScreen: false });
  servers.push(vite);
  const mod = await vite.ssrLoadModule('/src/App.jsx');
  if (prev.f === undefined) delete process.env.VITE_CRM_API_ENABLED; else process.env.VITE_CRM_API_ENABLED = prev.f;
  if (prev.b === undefined) delete process.env.VITE_CRM_API_BASE; else process.env.VITE_CRM_API_BASE = prev.b;
  return mod.default;
}

before(async () => {
  dom = installDom();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.innerWidth = 1440;
  document.querySelector = () => null;
  Object.getPrototypeOf(document.createElement('x')).getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 40, right: 400, bottom: 40 });
  globalThis.location = { search: '', hash: '' }; window.location = globalThis.location;
  globalThis.localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; },
    key: (i) => Object.keys(store)[i] || null, get length() { return Object.keys(store).length; },
  };
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: (...a) => { fetchCalls.push(a); return fetchImpl(...a); } });
  ({ createRoot } = await import('react-dom/client')); ({ act } = await import('react'));
});
after(async () => { for (const s of servers) await s.close(); if (dom) dom.restore(); delete globalThis.localStorage; delete globalThis.location; delete globalThis.IS_REACT_ACT_ENVIRONMENT; });
beforeEach(() => { store = {}; fetchCalls = []; fetchImpl = async () => { throw new TypeError('network down'); }; });

const settle = async () => { for (let i = 0; i < 6; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
async function mount(apiOn, hash) {
  globalThis.location.hash = hash;
  const container = dom.doc.createElement('div'); dom.doc.body.appendChild(container);
  const root = createRoot(container);
  const App = await loadApp(apiOn);
  await act(async () => { root.render(React.createElement(App)); });
  await settle();
  return { container, unmount: async () => { await act(async () => root.unmount()); } };
}
const okServer = async (url) => {
  const p = new URL(url).pathname;
  if (p.endsWith('/lookups')) return res(200, { data: LOOKUPS });
  return p.endsWith('/customers') ? res(200, { data: { items: [ROW], page: 1, pageSize: 20, total: 1, totalPages: 1 } }) : res(200, { data: ROW });
};
const writeCalls = () => fetchCalls.filter(([, init]) => init && init.method && init.method !== 'GET');
const denied = (b) => !b || b.disabled === true; // absent (hidden) or disabled both count as fail-closed
const clickAll = async (container, re) => { for (const b of byTag(container, 'button').filter((x) => re.test(text(x)) || re.test(x.getAttribute('aria-label') || ''))) { await act(async () => { click(b); }); await settle(); } };

test('ON (không có actor máy chủ): danh sách — Thêm/Nhập/Xuất/Sửa/Xoá bị khoá; bấm không mở form, không gọi ghi API', async () => {
  fetchImpl = okServer;
  const l = await mount(true, '#/customers');
  assert.match(text(l.container), /Máy Chủ/, 'dữ liệu máy chủ vẫn hiển thị (đọc do máy chủ quyết định)');
  for (const re of [/Thêm khách hàng/, /Nhập/, /Xuất/]) assert.ok(denied(buttonByText(l.container, re)), 'khoá: ' + re);
  for (const b of byTag(l.container, 'button').filter((x) => /^(Sửa|Xoá)$/.test(x.getAttribute('aria-label') || ''))) assert.ok(b.disabled, 'khoá nút hàng: ' + b.getAttribute('aria-label'));
  const before = fetchCalls.length;
  await clickAll(l.container, /Thêm khách hàng|Nhập|Xuất|^Sửa$|^Xoá$/);
  assert.equal(dom.doc.body.querySelectorAll((e) => e.getAttribute && e.getAttribute('role') === 'dialog').length, 0, 'không mở drawer/dialog');
  assert.equal(writeCalls().length, 0, 'không có POST/PATCH/DELETE');
  assert.equal(fetchCalls.length, before, 'bấm không phát sinh request nào');
  await l.unmount();
});

test('ON: chi tiết khách hàng — "Sửa thông tin" bị khoá; bấm không mở form, không PATCH', async () => {
  fetchImpl = okServer;
  const d = await mount(true, '#/customers/' + ID);
  assert.match(text(d.container), /Máy Chủ/);
  assert.ok(denied(buttonByText(d.container, /Sửa thông tin/)), 'Sửa thông tin phải bị khoá khi chưa có quyền do máy chủ cấp');
  const before = fetchCalls.length;
  await clickAll(d.container, /Sửa thông tin/);
  assert.equal(buttonByText(dom.doc.body, /Lưu thay đổi/), undefined, 'không mở form sửa');
  assert.equal(writeCalls().length, 0);
  assert.equal(fetchCalls.length, before);
  await d.unmount();
});

test('ON: không tin localStorage / công tắc vai trò — vai trò admin cắm sẵn trong localStorage không mở khoá gì, công tắc vai trò không hiện', async () => {
  store['siscom-crm-demo-user'] = 'u-admin';
  fetchImpl = okServer;
  const l = await mount(true, '#/customers');
  assert.ok(denied(buttonByText(l.container, /Thêm khách hàng/)));
  assert.equal(byTag(l.container, 'main').length, 1);
  assert.doesNotMatch(text(l.container), /Tài khoản demo|Quản trị hệ thống ·|Giám đốc điều hành/);
  assert.equal(store['siscom-crm-demo-user'], 'u-admin', 'không đọc/ghi lại khoá demo');
  await l.unmount();
});

test('ON: đường dẫn trực tiếp tới Dashboard / module chưa hỗ trợ / Cài đặt — trạng thái không vận hành, không gọi API, không nút nhạy cảm', async () => {
  for (const hash of ['#/dashboard', '#/settings', '#/contracts', '#/customers/new', '#/admin']) {
    fetchCalls = []; fetchImpl = okServer;
    const p = await mount(true, hash);
    const t = text(byTag(p.container, 'main')[0]);
    if (!hash.startsWith('#/customers')) {
      assert.match(t, /chưa hỗ trợ trong chế độ API|chờ duyệt giai đoạn 1/, hash + ' phải là trạng thái không vận hành rõ ràng');
      assert.equal(fetchCalls.length, 0, hash + ' không được gọi API');
    }
    assert.ok(denied(buttonByText(p.container, /Phê duyệt|Từ chối|Thêm khách hàng|Sao lưu|Khôi phục/)), hash + ' không có nút nhạy cảm đang bật');
    assert.equal(writeCalls().length, 0);
    await p.unmount();
  }
});

test('OFF (demo): giữ nguyên giao diện phân quyền theo vai trò — giám đốc thấy các nút bật, phiên API không có', async () => {
  const l = await mount(false, '#/customers');
  assert.equal(buttonByText(l.container, /Thêm khách hàng/).disabled, false);
  assert.equal(buttonByText(l.container, /Nhập/).disabled, false);
  assert.equal(fetchCalls.length, 0);
  assert.match(text(l.container), /Bản demo giao diện/);
  await l.unmount();
});

test('OFF (demo): vai trò kế toán chỉ-đọc vẫn bị khoá Thêm/Nhập như trước (không đổi hành vi demo)', async () => {
  store['siscom-crm-demo-user'] = 'u-acc';
  const l = await mount(false, '#/customers');
  assert.equal(buttonByText(l.container, /Thêm khách hàng/).disabled, true);
  assert.equal(buttonByText(l.container, /Nhập/).disabled, true);
  await l.unmount();
});
