// Run: node --test tests/customerFormCreateContract.test.mjs   (Node >= 18; vite + react already in package.json). Injected fetch only; no network, no DB, no browser.
// OVN03: hợp đồng form "Thêm khách hàng" ở MỨC COMPONENT (CustomerFormDrawer, initial = null) trên một controller thật, chế độ API BẬT.
// Chỉ phủ phần CHƯA có ở customerApiUiComponents (chỉ form SỬA), customerApiUi/customerRepository (mức controller/repo), K05/M02 (trạng thái list, XSS):
//   bắt buộc tên + điện thoại · khoảng trắng/Unicode · trim ở thân POST · chống gửi trùng khi đang lưu · mất kết nối giữ nháp + gửi lại 1 lần · 400 theo trường · không localStorage.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import React from 'react';
import { installDom, text, buttonByText, inputByLabel, click, type } from './helpers/miniDom.mjs';

const BASE = 'http://127.0.0.1:3000/api/v1';
const ON = { VITE_CRM_API_ENABLED: 'true', VITE_CRM_API_BASE: BASE };
const ID = '0b9f1c52-3a0e-4c3e-9d6f-0a1b2c3d4e5f';
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const created = (over = {}) => res(201, { data: { id: ID, code: 'KH-00042', name: 'Công ty Mới', short: 'Mới', phone: '0901234567', version: 1, ...over } });

let vite; let dom; let createCustomerApiUi; let CustomerFormDrawer; let createRoot; let act;
before(async () => {
  dom = installDom();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vite = await createServer({ configFile: new URL('../vite.config.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom', logLevel: 'silent', clearScreen: false });
  ({ createCustomerApiUi } = await vite.ssrLoadModule('/src/features/customers/customerApiUi.js'));
  ({ CustomerFormDrawer } = await vite.ssrLoadModule('/src/features/customers/CustomerForm.jsx'));
  ({ createRoot } = await import('react-dom/client'));
  ({ act } = await import('react'));
});
after(async () => { if (vite) await vite.close(); if (dom) dom.restore(); delete globalThis.IS_REACT_ACT_ENVIRONMENT; });

// post(n): response | Error | Promise cho lần POST /customers thứ n (1-based). Lookups trả rỗng-hợp-lệ.
const server = ({ post }) => {
  const calls = []; let np = 0;
  const f = async (url, init = {}) => {
    const method = init.method || 'GET'; calls.push({ url, method, body: init.body ? JSON.parse(init.body) : null });
    if (new URL(url).pathname.endsWith('/lookups')) return res(200, { data: { customer_tier: [], customer_status: [], industry: [], source: [], province: [] } });
    if (method === 'POST') { const r = await post(++np); if (r instanceof Error) throw r; return r; }
    return res(200, { data: { items: [], page: 1, pageSize: 20, total: 0, totalPages: 1 } });
  };
  f.posts = () => calls.filter((c) => c.method === 'POST'); f.calls = calls;
  return f;
};
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const act_ = async (fn) => { await act(async () => { await fn(); }); await flush(); };
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

async function mountNew(fetchImpl, { onClose = () => {}, onSaved = () => {} } = {}) {
  const ctl = createCustomerApiUi({ env: ON, fetchImpl });
  const toasts = []; const confirms = [];
  const ui = { can: () => true, customerApi: ctl, toast: (t) => toasts.push(t), confirm: (c) => confirms.push(c), db: { customers: [] }, navigate: () => {} };
  const container = dom.doc.createElement('div'); dom.doc.body.appendChild(container); const root = createRoot(container);
  await act(async () => { root.render(React.createElement(CustomerFormDrawer, { open: true, initial: null, ui, onClose, onSaved })); });
  await flush();
  return { ctl, ui, toasts, confirms, container, unmount: () => act(async () => root.unmount()) };
}
const NAME = /^Tên công ty/; const PHONE = /^Điện thoại/; const ADD = /Thêm khách hàng$/; const val = (m, re) => inputByLabel(m.container, re).value;
const fill = async (m, name, phone) => { await act_(() => type(inputByLabel(m.container, NAME), name)); await act_(() => type(inputByLabel(m.container, PHONE), phone)); };
const saveBtn = (m) => buttonByText(m.container, ADD);

// Chặn mọi ghi localStorage trong cả bài (ON không được rơi về kho demo).
const withStorageSpy = async (fn) => {
  const writes = []; const prev = globalThis.localStorage;
  globalThis.localStorage = { setItem: (...a) => writes.push(a), removeItem: (...a) => writes.push(a), getItem: () => null, clear: () => writes.push('clear') };
  try { await fn(); } finally { if (prev === undefined) delete globalThis.localStorage; else globalThis.localStorage = prev; }
  assert.deepEqual(writes, [], 'không ghi localStorage khi API BẬT');
};

test('F1: form trống → Tên công ty + Điện thoại đều báo lỗi, KHÔNG POST, chỉ hai trường bắt buộc được đánh dấu *', async () => {
  const f = server({ post: () => created() }); const m = await mountNew(f);
  try {
    assert.match(text(m.container), /Chỉ Tên công ty và Điện thoại là bắt buộc/);
    const stars = Array.from(m.container.querySelectorAll((e) => e.tagName === 'LABEL')).filter((l) => /\*$/.test(text(l))).map((l) => text(l));
    assert.deepEqual(stars, ['Tên công ty*', 'Điện thoại*']);
    await act_(() => click(saveBtn(m)));
    const t = text(m.container);
    assert.match(t, /Vui lòng nhập tên công ty/); assert.match(t, /Vui lòng nhập số điện thoại/); assert.match(t, /2 trường cần sửa/);
    assert.equal(f.posts().length, 0);
    assert.equal(m.toasts.length, 1); assert.equal(m.toasts[0].tone, 'error'); assert.equal(m.toasts.some((x) => x.tone === 'success'), false);
  } finally { await m.unmount(); }
});

test('F2: chỉ thiếu một trong hai (tên có, điện thoại trống / ngược lại) → chỉ trường thiếu báo lỗi, không POST', async () => {
  const f = server({ post: () => created() }); const m = await mountNew(f);
  try {
    await fill(m, 'Công ty Phú An', ''); await act_(() => click(saveBtn(m)));
    assert.match(text(m.container), /Vui lòng nhập số điện thoại/); assert.doesNotMatch(text(m.container), /Vui lòng nhập tên công ty/); assert.match(text(m.container), /1 trường cần sửa/);
    await fill(m, '', '0901234567'); await act_(() => click(saveBtn(m)));
    assert.match(text(m.container), /Vui lòng nhập tên công ty/); assert.doesNotMatch(text(m.container), /Vui lòng nhập số điện thoại/);
    assert.equal(f.posts().length, 0);
  } finally { await m.unmount(); }
});

// Khoảng trắng JS coi là trống: space, tab, NBSP, ideographic space, BOM, line separator.
for (const [label, ws] of [['space', '   '], ['tab', '\t\t'], ['NBSP U+00A0', '   '], ['ideographic U+3000', '　　'], ['BOM U+FEFF', '﻿﻿'], ['hỗn hợp', ' \t   ']]) {
  test(`F3: tên và điện thoại chỉ gồm khoảng trắng (${label}) bị coi là trống: báo lỗi, không POST`, async () => {
    const f = server({ post: () => created() }); const m = await mountNew(f);
    try {
      await fill(m, ws, ws); await act_(() => click(saveBtn(m)));
      assert.match(text(m.container), /Vui lòng nhập tên công ty/); assert.match(text(m.container), /Vui lòng nhập số điện thoại/);
      assert.equal(f.posts().length, 0);
    } finally { await m.unmount(); }
  });
}

test('F4: tên 1 ký tự (sau trim) → "quá ngắn"; điện thoại sai định dạng/chữ số Unicode toàn-bề-rộng → chưa hợp lệ; không POST', async () => {
  const f = server({ post: () => created() }); const m = await mountNew(f);
  try {
    await fill(m, '  A  ', '０９０１２３４５６７'); // fullwidth digits
    await act_(() => click(saveBtn(m)));
    assert.match(text(m.container), /Tên công ty quá ngắn/); assert.match(text(m.container), /Số điện thoại chưa hợp lệ/);
    await fill(m, 'Công ty A', '12345'); await act_(() => click(saveBtn(m)));
    assert.match(text(m.container), /Số điện thoại chưa hợp lệ/);
    assert.equal(f.posts().length, 0);
    assert.equal(val(m, NAME), 'Công ty A'); assert.equal(val(m, PHONE), '12345'); // nháp được giữ
  } finally { await m.unmount(); }
});

test('F5: tên chỉ gồm ký tự độ rộng bằng 0 (U+200B) không được coi là tên hợp lệ', async () => {
  const f = server({ post: () => created() }); const m = await mountNew(f);
  try {
    await fill(m, '​​​', '0901234567'); await act_(() => click(saveBtn(m)));
    assert.equal(f.posts().length, 0, 'tên toàn ký tự vô hình không được gửi lên máy chủ');
    assert.match(text(m.container), /Vui lòng nhập tên công ty|Tên công ty quá ngắn/);
  } finally { await m.unmount(); }
});

test('F6: trim + Unicode ở thân POST: tên/điện thoại/viết tắt được cắt khoảng trắng; tiếng Việt (NFC lẫn NFD) giữ nguyên từng điểm mã; chỉ POST đúng 1 lần', async () => {
  await withStorageSpy(async () => {
    const f = server({ post: () => created() }); const m = await mountNew(f);
    try {
      const nfd = 'Cô̂ng ty Đầu tư Phú An'.normalize('NFD'); const nfc = 'Công ty Đầu tư Phú An';
      await fill(m, '  ' + nfd + ' \t', '  0901 234 567  ');
      await act_(() => type(inputByLabel(m.container, /^Tên viết tắt/), '  Phú An 　'));
      await act_(() => click(saveBtn(m)));
      assert.equal(f.posts().length, 1);
      const b = f.posts()[0].body;
      assert.equal(b.name, nfd, 'tên chỉ bị cắt khoảng trắng, không đổi dạng chuẩn hoá (NFD giữ NFD)');
      assert.notEqual(b.name, nfc); assert.equal(b.phone, b.phone.trim(), 'điện thoại không còn khoảng trắng đầu/cuối');
      assert.equal(b.shortName, 'Phú An');
      assert.equal(b.owner, undefined); assert.equal(b.id, undefined); assert.equal(b.code, undefined);
    } finally { await m.unmount(); }
  });
});

test('F7: thành công → toast thành công kèm mã KH của MÁY CHỦ, onSaved gọi đúng 1 lần với bản ghi máy chủ, không localStorage', async () => {
  await withStorageSpy(async () => {
    const saved = []; const f = server({ post: () => created({ code: 'KH-00099', name: 'Công ty X' }) }); const m = await mountNew(f, { onSaved: (c) => saved.push(c) });
    try {
      await fill(m, 'Công ty X', '0901234567'); await act_(() => click(saveBtn(m)));
      assert.equal(saved.length, 1); assert.equal(saved[0].code, 'KH-00099');
      const ok = m.toasts.filter((t) => t.tone === 'success'); assert.equal(ok.length, 1); assert.match(ok[0].title, /KH-00099/);
      assert.equal(m.toasts.some((t) => t.tone === 'error'), false);
    } finally { await m.unmount(); }
  });
});

test('F8: chống gửi trùng — bấm Lưu nhiều lần khi POST còn treo chỉ gửi 1 POST; nút Huỷ khoá/không đóng khi đang lưu; xong thì onSaved đúng 1 lần', async () => {
  await withStorageSpy(async () => {
    const gate = deferred(); const saved = []; let closed = 0;
    const f = server({ post: () => gate.promise }); const m = await mountNew(f, { onSaved: (c) => saved.push(c), onClose: () => { closed += 1; } });
    try {
      await fill(m, 'Công ty Treo', '0901234567');
      await act_(() => click(saveBtn(m))); await act_(() => click(saveBtn(m))); await act_(() => click(saveBtn(m)));
      assert.equal(f.posts().length, 1, 'chỉ một POST dù bấm 3 lần');
      assert.match(text(m.container), /Đang lưu khách hàng/);
      assert.equal(buttonByText(m.container, /^Huỷ$/).disabled, true);
      await act_(() => click(buttonByText(m.container, /^Huỷ$/))); assert.equal(closed, 0, 'không đóng khi đang lưu');
      assert.equal(m.toasts.length, 0, 'lần bấm trùng không sinh toast lỗi');
      await act(async () => { gate.resolve(created()); await new Promise((r) => setTimeout(r, 0)); }); await flush();
      assert.equal(saved.length, 1); assert.equal(f.posts().length, 1);
      assert.equal(m.toasts.filter((t) => t.tone === 'success').length, 1);
    } finally { await m.unmount(); }
  });
});

test('F9: mất kết nối khi lưu → báo "Lỗi kết nối", giữ nguyên nháp, KHÔNG báo thành công/KHÔNG rơi về kho cục bộ; bấm Lưu lại gửi đúng 1 POST mới và thành công', async () => {
  await withStorageSpy(async () => {
    const saved = []; const f = server({ post: (n) => (n === 1 ? new TypeError('Failed to fetch') : created()) }); const m = await mountNew(f, { onSaved: (c) => saved.push(c) });
    try {
      await fill(m, 'Công ty Mạng', '0901234567'); await act_(() => click(saveBtn(m)));
      assert.equal(f.posts().length, 1); assert.match(text(m.container), /Lỗi kết nối/); assert.match(text(m.container), /Kiểm tra kết nối mạng/);
      assert.equal(val(m, NAME), 'Công ty Mạng'); assert.equal(val(m, PHONE), '0901234567');
      assert.equal(saved.length, 0); assert.equal(m.toasts.some((t) => t.tone === 'success'), false);
      await flush(); assert.equal(f.posts().length, 1, 'không tự thử lại');
      assert.equal(saveBtn(m).disabled, false, 'có thể bấm Lưu lại');
      await act_(() => click(saveBtn(m)));
      assert.equal(f.posts().length, 2); assert.equal(saved.length, 1);
      assert.doesNotMatch(text(m.container), /Lỗi kết nối/, 'thông báo lỗi biến mất sau khi lưu được');
    } finally { await m.unmount(); }
  });
});

test('F10: máy chủ 400 theo trường (phone) → lỗi hiện dưới đúng ô, nháp giữ nguyên, gõ lại ô đó thì lỗi máy chủ biến mất; không POST thừa', async () => {
  const f = server({ post: () => res(400, { error: { code: 'VALIDATION_ERROR', message: 'Dữ liệu không hợp lệ', details: ['phone must match /^0/ regular expression'] } }) });
  const m = await mountNew(f);
  try {
    await fill(m, 'Công ty Lỗi', '0901234567'); await act_(() => click(saveBtn(m)));
    assert.equal(f.posts().length, 1); assert.match(text(m.container), /phone must match/);
    assert.equal(val(m, NAME), 'Công ty Lỗi'); assert.equal(val(m, PHONE), '0901234567');
    await act_(() => type(inputByLabel(m.container, PHONE), '0907654321'));
    assert.doesNotMatch(text(m.container), /phone must match/); assert.equal(f.posts().length, 1);
  } finally { await m.unmount(); }
});

test('F11: 500 khi lưu → giữ nháp, báo lỗi máy chủ, không thành công giả, không đóng form (onClose/onSaved không gọi)', async () => {
  await withStorageSpy(async () => {
    let closed = 0; const saved = [];
    const f = server({ post: () => res(500, { error: { code: 'INTERNAL', message: 'boom' } }) }); const m = await mountNew(f, { onClose: () => { closed += 1; }, onSaved: (c) => saved.push(c) });
    try {
      await fill(m, 'Công ty 500', '0901234567'); await act_(() => click(saveBtn(m)));
      assert.match(text(m.container), /Lỗi máy chủ/); assert.equal(val(m, NAME), 'Công ty 500');
      assert.equal(closed, 0); assert.equal(saved.length, 0); assert.equal(m.toasts.some((t) => t.tone === 'success'), false);
    } finally { await m.unmount(); }
  });
});
