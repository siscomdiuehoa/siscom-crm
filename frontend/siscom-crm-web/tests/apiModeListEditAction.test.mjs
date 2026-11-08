// Run: node --test tests/apiModeListEditAction.test.mjs   (Node >= 18; vite + react only. Injected fetch, in-memory DOM; no network, no DB, no browser.)
// E2 (05/11/2026): ở chế độ API, danh sách khách hàng KHÔNG sửa/xoá tại dòng (sửa qua trang chi tiết; xoá chưa hỗ trợ). Trước đây hai nút
// "Sửa"/"Xoá" bị disabled mà không có dấu hiệu nên người dùng bấm không thấy gì. Nay cột thao tác có MỘT nút bật "Mở chi tiết để sửa" (có tooltip)
// điều hướng sang chi tiết; không còn nút Xoá chết; ghi chú chế độ API nói rõ cách sửa. Chế độ demo (OFF) giữ nguyên Sửa/Xoá tại dòng.
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import React from 'react';
import { installDom, text, byTag, click, type, inputByLabel } from './helpers/miniDom.mjs';

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
async function mount(apiOn, hash, props = undefined) {
  globalThis.location.hash = hash;
  const container = dom.doc.createElement('div'); dom.doc.body.appendChild(container);
  const root = createRoot(container);
  const App = await loadApp(apiOn);
  await act(async () => { root.render(React.createElement(App, props)); });
  await settle();
  return { container, unmount: async () => { await act(async () => root.unmount()); } };
}
const okServer = async (url) => {
  const p = new URL(url).pathname;
  if (p.endsWith('/lookups')) return res(200, { data: LOOKUPS });
  return p.endsWith('/customers') ? res(200, { data: { items: [ROW], page: 1, pageSize: 20, total: 1, totalPages: 1 } }) : res(200, { data: ROW });
};
const writeCalls = () => fetchCalls.filter(([, init]) => init && init.method && init.method !== 'GET');
const byLabel = (root, re) => byTag(root, 'button').filter((b) => re.test(b.getAttribute('aria-label') || ''));

test('ON (API): dòng danh sách có MỘT nút bật "Mở chi tiết để sửa" (tooltip), không còn nút Sửa/Xoá bị khoá', async () => {
  fetchImpl = okServer;
  const l = await mount(true, '#/customers');
  try {
    assert.match(text(l.container), /Máy Chủ/);
    assert.equal(byLabel(l.container, /^(Sửa|Xoá)$/).length, 0, 'không còn nút Sửa/Xoá chết tại dòng');
    const open = byLabel(l.container, /^Mở chi tiết để sửa$/);
    assert.equal(open.length, 1);
    assert.equal(open[0].disabled, false, 'nút phải bật');
    assert.ok(open[0].parentNode && /sg-tip/.test(open[0].parentNode.getAttribute('class') || ''), 'có tooltip bao ngoài');
    assert.match(text(l.container), /Để sửa, mở chi tiết khách hàng/, 'ghi chú chế độ API nói rõ cách sửa');
  } finally { await l.unmount(); }
});

test('ON (API): bấm "Mở chi tiết để sửa" => sang trang chi tiết của đúng khách; không mở form, không gọi ghi API', async () => {
  fetchImpl = okServer;
  const l = await mount(true, '#/customers');
  try {
    const before = fetchCalls.length;
    await act(async () => { click(byLabel(l.container, /^Mở chi tiết để sửa$/)[0]); });
    await settle();
    assert.match(text(l.container), /Chi tiết khách hàng|Sửa thông tin/, 'đã ở trang chi tiết');
    assert.equal(dom.doc.body.querySelectorAll((e) => e.getAttribute && e.getAttribute('role') === 'dialog').length, 0, 'không mở drawer');
    assert.equal(writeCalls().length, 0, 'không có POST/PATCH/DELETE');
    assert.ok(fetchCalls.slice(before).every(([u]) => /\/customers\/0b9f1c52|\/contacts|\/lookups|owner-candidates/.test(String(u))), 'chỉ đọc chi tiết của đúng khách');
  } finally { await l.unmount(); }
});

test('OFF (demo): giữ nguyên nút Sửa/Xoá tại dòng, không có nút "Mở chi tiết để sửa"', async () => {
  const l = await mount(false, '#/customers');
  try {
    assert.equal(byLabel(l.container, /^Mở chi tiết để sửa$/).length, 0);
    assert.ok(byLabel(l.container, /^Sửa$/).length > 0 && byLabel(l.container, /^Xoá$/).length > 0, 'demo vẫn có Sửa/Xoá tại dòng');
  } finally { await l.unmount(); }
});


test('CT-FV4-1: tìm đầu trang debounce và phản hồi cũ', async () => {
  const pending = [];
  fetchImpl = (url) => { const u = new URL(url); if (u.searchParams.has('search')) return new Promise((resolve) => pending.push({ q: u.searchParams.get('search'), resolve })); return okServer(url); };
  document.querySelector = (s) => s === '.sg-search' ? { getBoundingClientRect: () => ({ left: 0, bottom: 40, width: 400 }) } : null;
  const l = await mount(true, '#/dashboard');
  try {
    const input = byTag(l.container, 'input').find((e) => e.getAttribute('aria-label') === 'Tìm kiếm toàn hệ thống');
    await act(async () => { type(input, 'ab'); type(input, 'abc'); await new Promise((r) => setTimeout(r, 300)); });
    assert.deepEqual(pending.map((x) => x.q), ['abc']);
    await act(async () => { type(input, 'abcd'); await new Promise((r) => setTimeout(r, 300)); });
    assert.deepEqual(pending.map((x) => x.q), ['abc', 'abcd']);
    await act(async () => { pending[1].resolve(res(200, { data: { items: [ROW], page: 1, pageSize: 6, total: 1, totalPages: 1 } })); });
    await act(async () => { pending[0].resolve(res(200, { data: { items: [{ ...ROW, shortName: 'Kết quả cũ' }], page: 1, pageSize: 6, total: 1, totalPages: 1 } })); });
    assert.match(text(l.container), /Máy Chủ/); assert.doesNotMatch(text(l.container), /Kết quả cũ/);
    const hit = l.container.querySelectorAll((e) => (e.getAttribute('class') || '') === 'sg-menu__item')[0];
    await act(async () => { const ev = { type: 'mousedown', target: hit, bubbles: true, preventDefault() {}, stopPropagation() {}, timeStamp: Date.now() }; for (let n = hit; n; n = n.parentNode) for (const f of (n.listeners && n.listeners.mousedown || [])) f(ev); });
    assert.equal(location.hash, '/customers/' + ID);
    await act(async () => { type(input, 'loi'); });
    assert.match(text(l.container), /Đang tìm…/, 'đang chờ gõ xong: không báo "không tìm thấy" sai');
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); pending[2].resolve(res(403, { error: { code: 'FORBIDDEN', message: 'Không có quyền' } })); });
    assert.match(text(l.container), /Không tìm được khách hàng\. Vui lòng thử lại\./);
  } finally { await l.unmount(); document.querySelector = () => null; }
});

test('CT-FV4-1: nút Xuất (API) gom đủ các trang theo bộ lọc hiện tại -> CSV UTF-8 có BOM, chặn công thức; lỗi giữa chừng -> không tải file', async () => {
  // Toast tự ẩn sau 4,5 s và downloadCsv thu hồi URL sau 1 s: gom các hẹn giờ dài để huỷ khi kết thúc (không chạy sau khi DOM giả đã gỡ).
  const longTimers = []; const origST = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...a) => { const t = origST(fn, ms, ...a); if (ms >= 1000) longTimers.push(t); return t; };
  const blobs = []; const origURL = globalThis.URL.createObjectURL; const origRevoke = globalThis.URL.revokeObjectURL;
  globalThis.URL.createObjectURL = (b) => { blobs.push(b); return 'blob:x'; }; globalThis.URL.revokeObjectURL = () => {};
  const page = (p, n, total) => ({ data: { items: Array.from({ length: n }, (_, i) => ({ ...ROW, id: ID.slice(0, -3) + String(p * 100 + i).padStart(3, '0').slice(-3), code: 'KH-' + p + '-' + i, name: i === 0 ? '=HYPERLINK("x")' : 'Cty ' + i })), page: p, pageSize: 100, total, totalPages: Math.ceil(total / 100) } });
  let failPage2 = false;
  fetchImpl = async (url) => {
    const u = new URL(url);
    if (u.pathname.endsWith('/customers') && u.searchParams.get('pageSize') === '100') {
      const p = Number(u.searchParams.get('page'));
      if (p === 2 && failPage2) return res(500, { error: { code: 'INTERNAL', message: 'lỗi' } });
      return res(200, page(p, p === 1 ? 100 : 50, 150));
    }
    return okServer(url);
  };
  // Phiên có customer.read (máy chủ cấp) => được xuất; không có quyền thì khoá (apiModePermissionFailClosed).
  const ST = { status: 'AUTHENTICATED', employeeId: 'e1', me: { employeeId: 'e1', fullName: 'Sale A', roles: ['sales'], permissions: { 'customer.read': 'OWN', 'lookup.read': 'ALL' }, mustChangePassword: false } };
  const session = { getState: () => ST, subscribe: () => () => {} };
  const l = await mount(true, '#/customers', { session });
  try {
    const btn = () => byTag(l.container, 'button').find((b) => /^Xuất$/.test(text(b).trim()));
    assert.ok(btn() && !btn().disabled, 'nút Xuất bật ở chế độ API');
    await act(async () => { click(btn()); }); await settle();
    const pages = fetchCalls.map(([u]) => new URL(u)).filter((u) => u.pathname.endsWith('/customers') && u.searchParams.get('pageSize') === '100').map((u) => u.searchParams.get('page'));
    assert.deepEqual(pages, ['1', '2']);
    assert.equal(blobs.length, 1);
    const bytes = new Uint8Array(await blobs[0].arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], 'có BOM UTF-8');
    assert.match(blobs[0].type, /^text\/csv;charset=utf-8/);
    const lines = (await blobs[0].text()).replace(/^﻿/, '').split('\r\n');
    assert.match(lines[0], /^Mã KH,Tên công ty,Mã số thuế/);
    assert.equal(lines.length, 151, 'tiêu đề + 150 dòng');
    assert.ok(lines.some((x) => x.includes(`"'=HYPERLINK(""x"")"`)), 'ô bắt đầu bằng = được thêm dấu \'');
    assert.equal(writeCalls().length, 0);
    failPage2 = true; blobs.length = 0;
    await act(async () => { click(btn()); }); await settle();
    assert.equal(blobs.length, 0, 'lỗi trang 2: không tải file dở');
    assert.match(text(dom.doc.body), /Không xuất được khách hàng/);
  } finally { await l.unmount(); for (const t of longTimers) clearTimeout(t); globalThis.setTimeout = origST; globalThis.URL.createObjectURL = origURL; globalThis.URL.revokeObjectURL = origRevoke; }
});
