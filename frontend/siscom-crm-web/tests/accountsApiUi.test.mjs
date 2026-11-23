// Run: node --test tests/accountsApiUi.test.mjs   (Node >= 18; vite + react đã có). Fetch giả lập; không mạng, không DB, không trình duyệt.
// P1: trang Tài khoản (danh sách + 6 thao tác) trên API /accounts. Máy chủ giả trả đúng hình dạng của backend (AccountRow, mã lỗi).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import React from 'react';
import { installDom, text, findAll, buttonByText, inputByLabel, click, type, keydown } from './helpers/miniDom.mjs';

const BASE = 'http://127.0.0.1:3000/api/v1';
const ON = { VITE_CRM_API_ENABLED: 'true', VITE_CRM_API_BASE: BASE };
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const fail = (status, code, message, details) => res(status, { error: { code, message, ...(details ? { details } : {}) } });
const TEMP = 'Tam-Thoi#2026-xyz'; // giá trị thử, chỉ dùng trong tệp test này
const T0 = '2026-11-23T03:00:00.000Z'; const T1 = '2026-11-23T04:00:00.000Z';
const SYS = { id: '00000000-0000-4000-8000-000000000001', code: 'NV-0001', fullName: 'Quản trị hệ thống', email: 'sys@thu.local', departmentId: 'd-bgd', departmentName: 'Ban giám đốc', positionTitle: null, roles: ['admin'], login: 'ACTIVE', isSystem: true, isSelf: false, updatedAt: T0 };
const ME = { id: '00000000-0000-4000-8000-000000000002', code: 'NV-0002', fullName: 'Quản trị CRM', email: 'qt@thu.local', departmentId: 'd-bgd', departmentName: 'Ban giám đốc', positionTitle: null, roles: ['crm_admin'], login: 'ACTIVE', isSystem: false, isSelf: true, updatedAt: T0 };
const EMP = { id: '00000000-0000-4000-8000-000000000006', code: 'NV-0006', fullName: 'Trần Thị Mẫu', email: 'mau@thu.local', departmentId: 'd-kd', departmentName: 'Kinh doanh', positionTitle: 'Nhân viên kinh doanh', roles: ['sales'], login: 'MUST_CHANGE', isSystem: false, isSelf: false, updatedAt: T0 };
const OFF = { id: '00000000-0000-4000-8000-000000000007', code: 'NV-0007', fullName: 'Lê Văn Thử', email: 'thu@thu.local', departmentId: 'd-kt', departmentName: 'Kỹ thuật', positionTitle: null, roles: ['technician'], login: 'DISABLED', isSystem: false, isSelf: false, updatedAt: T0 };
const ROLES = [{ code: 'admin', name: 'Admin', grantable: false }, { code: 'crm_admin', name: 'CRM Admin', grantable: true }, { code: 'sales', name: 'Sales', grantable: true }, { code: 'technician', name: 'Technician', grantable: true }, { code: 'accountant', name: 'Accountant', grantable: true }];
const DEPTS = [{ id: 'd-bgd', name: 'Ban giám đốc' }, { id: 'd-kd', name: 'Kinh doanh' }, { id: 'd-kt', name: 'Kỹ thuật' }];

// write(p, method, body, rows) => phản hồi tuỳ biến (hoặc undefined => mặc định 200 với dòng đầu).
const server = ({ rows = [SYS, ME, EMP, OFF], list, write } = {}) => {
  const calls = []; const db = rows.map((r) => ({ ...r }));
  const f = async (url, init = {}) => {
    const method = init.method || 'GET'; const u = new URL(url); const p = u.pathname.replace('/api/v1', ''); const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ p, method, q: u.searchParams, body });
    if (p === '/accounts/roles') return res(200, { data: ROLES });
    if (p === '/accounts/departments') return res(200, { data: DEPTS });
    if (p === '/accounts' && method === 'GET') { const r = list && list(u.searchParams, db); if (r) return r; return res(200, { data: { items: db, page: 1, pageSize: 100, total: db.length, totalPages: db.length ? 1 : 0 } }); }
    if (method !== 'GET') { const r = write && write(p, method, body, db); if (r) return r; return res(method === 'POST' && p === '/accounts' ? 201 : 200, { data: db[2] }); }
    return res(404, { error: { code: 'NOT_FOUND', message: 'không có' } });
  };
  f.calls = calls; f.db = db;
  f.lists = () => calls.filter((c) => c.method === 'GET' && c.p === '/accounts');
  f.writes = () => calls.filter((c) => c.method !== 'GET');
  return f;
};

let vite; let dom; let createCustomerApiUi; let AccountsPage; let AccountsRoute; let createRoot; let act;
before(async () => {
  dom = installDom();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vite = await createServer({ configFile: new URL('../vite.config.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom', logLevel: 'silent', clearScreen: false });
  ({ createCustomerApiUi } = await vite.ssrLoadModule('/src/features/customers/customerApiUi.js'));
  ({ default: AccountsPage, AccountsRoute } = await vite.ssrLoadModule('/src/features/accounts/AccountsPage.jsx'));
  ({ createRoot } = await import('react-dom/client'));
  ({ act } = await import('react'));
});
after(async () => { if (vite) await vite.close(); if (dom) dom.restore(); delete globalThis.IS_REACT_ACT_ENVIRONMENT; });

const flush = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); });
const doAct = async (fn) => { await act(async () => { await fn(); }); await flush(); };
const wait = (ms) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

async function mount(fetchImpl, el = (ui) => React.createElement(AccountsPage, { ui }), over = {}) {
  const ctl = createCustomerApiUi({ env: ON, fetchImpl }); const toasts = [];
  const ui = { customerApi: ctl, toast: (t) => toasts.push(t), navigate: () => {}, mobile: false, me: { employeeId: ME.id, permissions: { 'access.approve': 'ALL' } }, ...over };
  const container = dom.doc.createElement('div'); dom.doc.body.appendChild(container); const root = createRoot(container);
  await act(async () => { root.render(el(ui)); }); await flush(); await flush();
  return { ctl, ui, toasts, container, unmount: async () => { await act(async () => root.unmount()); dom.doc.body.removeChild(container); } };
}
const modal = (root) => findAll(root, (e) => e.attributes.role === 'dialog')[0];
const alertText = (root) => findAll(root, (e) => e.attributes.role === 'alert').map((e) => text(e)).join(' | ');
const kebab = (root, name) => findAll(root, (e) => e.tagName === 'BUTTON' && e.attributes['aria-label'] === 'Thao tác với ' + name)[0];
const items = (root) => findAll(root, (e) => e.attributes.role === 'menuitem');
async function openMenu(root, name) { const k = kebab(root, name); assert.ok(k, 'có nút thao tác của ' + name); await doAct(() => click(k)); return items(root); }
async function choose(root, name, re) { const list = await openMenu(root, name); const it = list.find((e) => re.test(text(e))); assert.ok(it, 'có mục ' + re); await doAct(() => click(it)); return modal(root); }
async function pick(root, labelRe, optionRe) {
  // Ô chọn có nhãn (Field) hoặc ô lọc không nhãn bọc trong role=group có aria-label.
  const field = findAll(root, (e) => (e.attributes.class === 'sg-field' && findAll(e, (l) => l.tagName === 'LABEL' && labelRe.test(text(l))).length) || (e.attributes.role === 'group' && labelRe.test(e.attributes['aria-label'] || '')))[0];
  assert.ok(field, 'có ô chọn ' + labelRe);
  await doAct(() => click(findAll(field, (e) => e.tagName === 'BUTTON' && e.attributes['aria-haspopup'] === 'listbox')[0]));
  await doAct(() => click(findAll(root, (e) => e.attributes.role === 'option' && optionRe.test(text(e)))[0]));
}
const fill = async (root, labelRe, value) => { const el = inputByLabel(root, labelRe); assert.ok(el, 'có ô ' + labelRe); await doAct(() => type(el, value)); };
const press = async (root, re) => { const b = buttonByText(root, re); assert.ok(b, 'có nút ' + re); await doAct(() => click(b)); };
// Mục menu bị tắt dùng aria-disabled (vẫn nhận focus để người dùng bàn phím / trình đọc màn hình nghe được lý do), không dùng thuộc tính disabled.
const isOff = (e) => e.attributes['aria-disabled'] === 'true';
const holdsSecret = () => findAll(dom.doc.body, (e) => e.value === TEMP || text(e).includes(TEMP)).length;

test('mở trang: GET /accounts (pageSize=100) + vai trò + phòng ban; bảng 6 cột; dòng hệ thống không có nút; dòng của mình có nhãn "bạn"', async () => {
  const f = server(); const m = await mount(f);
  try {
    assert.equal(f.lists().length, 1);
    assert.equal(f.lists()[0].q.get('pageSize'), '100'); assert.equal(f.lists()[0].q.get('page'), '1'); assert.equal(f.lists()[0].q.get('q'), null);
    assert.equal(f.calls.filter((c) => c.p === '/accounts/roles').length, 1); assert.equal(f.calls.filter((c) => c.p === '/accounts/departments').length, 1);
    const t = text(m.container);
    assert.match(t, /Thêm nhân viên, đổi thông tin, vai trò và mật khẩu\. Mọi thay đổi có hiệu lực ngay và được ghi nhật ký\./);
    assert.match(t, /4 \/ 4 tài khoản/);
    assert.deepEqual(findAll(m.container, (e) => e.tagName === 'TH').map((e) => text(e)), ['Mã', 'Nhân viên', 'Phòng ban', 'Vai trò', 'Đăng nhập', 'Thao tác']);
    const rows = findAll(m.container, (e) => e.tagName === 'TR').slice(1).map((e) => text(e));
    assert.equal(rows.length, 4);
    assert.match(rows[0], /NV-0001.*Quản trị hệ thống.*sys@thu\.local.*Ban giám đốc.*Hệ thống.*Đang dùng.*Tài khoản hệ thống/);
    assert.match(rows[1], /NV-0002.*Quản trị CRM\s*bạn.*Quản trị CRM.*Đang dùng/);
    assert.match(rows[2], /NV-0006.*Trần Thị Mẫu.*mau@thu\.local.*Kinh doanh.*Nhân viên kinh doanh.*Kinh doanh.*Chờ đổi mật khẩu/);
    assert.match(rows[3], /NV-0007.*Lê Văn Thử.*Kỹ thuật.*Đã khoá/);
    assert.equal(kebab(m.container, SYS.fullName), undefined);
    assert.ok(kebab(m.container, ME.fullName)); assert.ok(kebab(m.container, EMP.fullName));
    assert.equal(f.writes().length, 0);
  } finally { await m.unmount(); }
});

test('menu của chính mình: sửa bật; đổi vai trò / cấp lại mật khẩu / khoá tắt kèm lý do, bấm không mở hộp thoại', async () => {
  const f = server(); const m = await mount(f);
  try {
    const list = await openMenu(m.container, ME.fullName);
    const by = (re) => list.find((e) => re.test(text(e)));
    assert.equal(isOff(by(/Sửa thông tin/)), false);
    for (const [re, why] of [[/Đổi vai trò/, /Không tự đổi vai trò của mình/], [/Cấp lại mật khẩu/, /Dùng "Đổi mật khẩu" của bạn/], [/Khoá tài khoản/, /Không tự khoá chính mình/]]) {
      assert.equal(isOff(by(re)), true, String(re)); assert.equal(by(re).disabled, false, 'vẫn nhận focus'); assert.match(text(by(re)), why);
      await doAct(() => click(by(re)));
      assert.equal(modal(dom.doc.body), undefined);
    }
    assert.equal(f.writes().length, 0);
  } finally { await m.unmount(); }
});

test('menu theo trạng thái: tài khoản đã khoá có "Mở lại tài khoản" (không có "Khoá"), cấp lại mật khẩu tắt; tài khoản đang dùng có "Khoá tài khoản"', async () => {
  const f = server(); const m = await mount(f);
  try {
    let list = await openMenu(m.container, OFF.fullName);
    assert.ok(list.some((e) => /Mở lại tài khoản/.test(text(e)))); assert.ok(!list.some((e) => /Khoá tài khoản/.test(text(e))));
    assert.equal(isOff(list.find((e) => /Cấp lại mật khẩu/.test(text(e)))), true);
    await doAct(() => click(kebab(m.container, OFF.fullName))); // đóng
    list = await openMenu(m.container, EMP.fullName);
    assert.ok(list.some((e) => /Khoá tài khoản/.test(text(e)))); assert.ok(!list.some((e) => /Mở lại tài khoản/.test(text(e))));
  } finally { await m.unmount(); }
});

test('bàn phím — menu thao tác: mở thì focus vào mục đầu; mũi tên xuống / lên đi vòng; Home / End; Escape đóng và trả focus về nút "⋯"', async () => {
  const f = server(); const m = await mount(f);
  try {
    const k = kebab(m.container, EMP.fullName);
    await doAct(() => click(k));
    const list = items(m.container); assert.equal(list.length, 4);
    const at = () => list.indexOf(dom.doc.activeElement);
    assert.equal(at(), 0, 'mở menu => focus mục đầu (Sửa thông tin)');
    await doAct(() => keydown(dom.doc.activeElement, 'ArrowDown')); assert.equal(at(), 1);
    await doAct(() => keydown(dom.doc.activeElement, 'ArrowDown')); assert.equal(at(), 2);
    await doAct(() => keydown(dom.doc.activeElement, 'End')); assert.equal(at(), 3);
    await doAct(() => keydown(dom.doc.activeElement, 'ArrowDown')); assert.equal(at(), 0, 'cuối danh sách => vòng về đầu');
    await doAct(() => keydown(dom.doc.activeElement, 'ArrowUp')); assert.equal(at(), 3, 'đầu danh sách => vòng về cuối');
    await doAct(() => keydown(dom.doc.activeElement, 'Home')); assert.equal(at(), 0);
    const ev = keydown(dom.doc.activeElement, 'ArrowDown'); await flush();
    assert.equal(ev.defaultPrevented, true, 'mũi tên không cuộn trang');
    await doAct(() => keydown(dom.doc.activeElement, 'Escape'));
    assert.equal(items(m.container).length, 0, 'Escape đóng menu');
    assert.equal(dom.doc.activeElement, k, 'focus trở về nút đã mở menu');
    assert.equal(k.attributes['aria-expanded'], 'false');
  } finally { await m.unmount(); }
});

test('bàn phím — mũi tên xuống trên nút "⋯" mở menu; mục bị tắt vẫn tới được bằng mũi tên nhưng Enter / bấm không mở hộp thoại; Tab đóng menu', async () => {
  const f = server(); const m = await mount(f);
  try {
    const k = kebab(m.container, ME.fullName);
    k.focus();
    await doAct(() => keydown(k, 'ArrowDown'));
    let list = items(m.container); assert.equal(list.length, 4, 'ArrowDown mở menu');
    assert.equal(dom.doc.activeElement, list[0]);
    await doAct(() => keydown(dom.doc.activeElement, 'ArrowDown'));
    assert.equal(dom.doc.activeElement, list[1]); assert.equal(isOff(list[1]), true); assert.match(text(list[1]), /Không tự đổi vai trò của mình/);
    await doAct(() => click(list[1]));
    assert.equal(modal(dom.doc.body), undefined, 'mục bị tắt không mở hộp thoại');
    assert.equal(items(m.container).length, 4, 'menu vẫn mở để đọc lý do');
    await doAct(() => keydown(dom.doc.activeElement, 'Tab'));
    assert.equal(items(m.container).length, 0, 'Tab đóng menu');
  } finally { await m.unmount(); }
});

test('bàn phím — chọn một mục rồi đóng hộp thoại: focus trở về nút "⋯" của đúng dòng đó', async () => {
  const f = server(); const m = await mount(f);
  try {
    const k = kebab(m.container, EMP.fullName);
    k.focus();
    await doAct(() => keydown(k, 'ArrowDown'));
    await doAct(() => click(dom.doc.activeElement)); // Sửa thông tin
    assert.ok(modal(dom.doc.body));
    await press(modal(dom.doc.body), /Huỷ/);
    await flush();
    assert.equal(modal(dom.doc.body), undefined);
    assert.equal(dom.doc.activeElement, kebab(m.container, EMP.fullName));
  } finally { await m.unmount(); }
});

test('thêm nhân viên: POST đúng thân, danh sách đọc lại, thông báo có tên người mới, hộp thoại đóng và DOM không còn mật khẩu tạm', async () => {
  const created = { ...EMP, id: '00000000-0000-4000-8000-000000000008', code: 'NV-0008', fullName: 'Nguyễn Văn A', email: 'a@thu.local', departmentId: null, departmentName: null, positionTitle: null };
  const f = server({ write: (p, method, body, db) => { if (p === '/accounts' && method === 'POST') { db.push(created); return res(201, { data: created }); } return undefined; } });
  const m = await mount(f);
  try {
    await press(m.container, /Thêm nhân viên/);
    const d = modal(dom.doc.body); assert.ok(d); assert.match(text(d), /Thêm nhân viên/);
    const pw = inputByLabel(d, /Mật khẩu tạm/);
    assert.equal(pw.attributes.type, 'password'); assert.equal(pw.attributes.autocomplete || pw.attributes.autoComplete, 'new-password'); // React client đặt tên thuộc tính theo dạng camelCase trên DOM giả
    await fill(d, /Họ tên/, '  Nguyễn Văn A ');
    await fill(d, /Email đăng nhập/, 'a@thu.local');
    await fill(d, /Mật khẩu tạm/, TEMP);
    await press(d, /Tạo tài khoản/);
    const w = f.writes(); assert.equal(w.length, 1);
    assert.deepEqual({ p: w[0].p, method: w[0].method, body: w[0].body }, { p: '/accounts', method: 'POST', body: { fullName: 'Nguyễn Văn A', email: 'a@thu.local', departmentId: null, positionTitle: null, role: 'sales', tempPassword: TEMP } });
    assert.equal(f.lists().length, 2);
    assert.match(text(m.container), /5 \/ 5 tài khoản/); assert.match(text(m.container), /NV-0008/);
    assert.equal(modal(dom.doc.body), undefined);
    assert.equal(m.toasts.length, 1); assert.equal(m.toasts[0].tone, 'success');
    assert.match(m.toasts[0].message, /Hãy đưa mật khẩu tạm trực tiếp cho Nguyễn Văn A\. Họ sẽ phải đổi khi đăng nhập lần đầu\./);
    assert.equal(JSON.stringify(m.toasts).includes(TEMP), false);
    assert.equal(holdsSecret(), 0);
    assert.equal(JSON.stringify(m.ctl.accounts.getState()).includes(TEMP), false);
  } finally { await m.unmount(); }
});

test('thêm nhân viên: chọn phòng ban + vai trò + chức danh => gửi đúng departmentId / role / positionTitle', async () => {
  const f = server(); const m = await mount(f);
  try {
    await press(m.container, /Thêm nhân viên/);
    const d = modal(dom.doc.body);
    await fill(d, /Họ tên/, 'Phạm Thị B'); await fill(d, /Email đăng nhập/, 'b@thu.local'); await fill(d, /Chức danh/, ' Kế toán viên ');
    await pick(d, /Phòng ban/, /Kỹ thuật/); await pick(d, /Vai trò/, /Kế toán/);
    await fill(d, /Mật khẩu tạm/, TEMP);
    await press(d, /Tạo tài khoản/);
    assert.deepEqual(f.writes()[0].body, { fullName: 'Phạm Thị B', email: 'b@thu.local', departmentId: 'd-kt', positionTitle: 'Kế toán viên', role: 'accountant', tempPassword: TEMP });
  } finally { await m.unmount(); }
});

test('thêm nhân viên: dữ liệu sai => báo ngay, KHÔNG gọi máy chủ; máy chủ từ chối (409 EMAIL_TAKEN, 400 chi tiết) => hộp thoại vẫn mở, đúng câu', async () => {
  let n = 0;
  const f = server({ write: () => { n += 1; return n === 1 ? fail(409, 'EMAIL_TAKEN', 'Email này đã có người dùng.') : fail(400, 'VALIDATION_FAILED', 'Dữ liệu gửi lên không hợp lệ.', ['Mật khẩu phải có ít nhất 3 trong 4 nhóm ký tự.']); } });
  const m = await mount(f);
  try {
    await press(m.container, /Thêm nhân viên/);
    const d = modal(dom.doc.body);
    await press(d, /Tạo tài khoản/);
    assert.match(alertText(d), /Chưa nhập họ tên\..*Email không hợp lệ\..*Mật khẩu tạm cần ít nhất 12 ký tự\./);
    assert.equal(f.writes().length, 0);
    await fill(d, /Họ tên/, 'Trùng Email'); await fill(d, /Email đăng nhập/, 'mau@thu.local'); await fill(d, /Mật khẩu tạm/, TEMP);
    await press(d, /Tạo tài khoản/);
    assert.equal(f.writes().length, 1); assert.ok(modal(dom.doc.body));
    assert.match(alertText(modal(dom.doc.body)), /Email này đã có người dùng\./);
    await press(modal(dom.doc.body), /Tạo tài khoản/);
    assert.match(alertText(modal(dom.doc.body)), /Mật khẩu phải có ít nhất 3 trong 4 nhóm ký tự\./);
    assert.equal(m.toasts.length, 0); assert.equal(f.lists().length, 1);
    await press(modal(dom.doc.body), /Huỷ/);
    assert.equal(modal(dom.doc.body), undefined); assert.equal(holdsSecret(), 0);
  } finally { await m.unmount(); }
});

test('sửa thông tin: PATCH kèm updatedAt đã tải; 409 VERSION_CONFLICT => hộp thoại vẫn mở + đúng câu; "Tải lại" lấy updatedAt mới, GIỮ nội dung đang gõ; lưu lại thành công', async () => {
  let n = 0;
  const f = server({ write: (p, method, body, db) => {
    if (method !== 'PATCH') return undefined; n += 1;
    if (n === 1) { db[2] = { ...db[2], updatedAt: T1, positionTitle: 'Người khác vừa sửa' }; return fail(409, 'VERSION_CONFLICT', 'Thông tin vừa được người khác sửa.'); }
    db[2] = { ...db[2], fullName: body.fullName, updatedAt: '2026-11-23T05:00:00.000Z' }; return res(200, { data: db[2] });
  } });
  const m = await mount(f);
  try {
    const d = await choose(m.container, EMP.fullName, /Sửa thông tin/);
    assert.match(text(d), /Sửa thông tin — NV-0006/);
    assert.equal(inputByLabel(d, /Họ tên/).value, 'Trần Thị Mẫu'); assert.equal(inputByLabel(d, /Email đăng nhập/).value, 'mau@thu.local');
    assert.equal(inputByLabel(d, /Mật khẩu tạm/), null);
    await fill(d, /Họ tên/, 'Trần Thị Mẫu Mới');
    await press(d, /^Lưu$/);
    assert.deepEqual(f.writes()[0].body, { updatedAt: T0, fullName: 'Trần Thị Mẫu Mới', email: 'mau@thu.local', departmentId: 'd-kd', positionTitle: 'Nhân viên kinh doanh' });
    assert.equal(f.writes()[0].p, '/accounts/' + EMP.id);
    let open = modal(dom.doc.body); assert.ok(open, 'hộp thoại vẫn mở sau 409');
    assert.match(alertText(open), /Thông tin vừa được người khác sửa\. Tải lại rồi thử lại\./);
    const before = f.lists().length;
    await press(open, /Tải lại/);
    assert.equal(f.lists().length, before + 1);
    open = modal(dom.doc.body);
    assert.equal(inputByLabel(open, /Họ tên/).value, 'Trần Thị Mẫu Mới', 'nội dung đang gõ được giữ');
    assert.equal(inputByLabel(open, /Chức danh/).value, 'Người khác vừa sửa', 'ô mình CHƯA đụng nhận giá trị mới của máy chủ (không ghi đè ngược lại)');
    await press(open, /^Lưu$/);
    assert.equal(f.writes().length, 2); assert.equal(f.writes()[1].body.updatedAt, T1); assert.equal(f.writes()[1].body.fullName, 'Trần Thị Mẫu Mới'); assert.equal(f.writes()[1].body.positionTitle, 'Người khác vừa sửa');
    assert.equal(modal(dom.doc.body), undefined);
    assert.match(m.toasts[0].message, /NV-0006/);
  } finally { await m.unmount(); }
});

test('sửa thông tin sau 409 — KHÔNG mất sửa đổi của người khác: người kia đổi email, mình chỉ đổi chức danh => "Tải lại" nạp email mới, lưu gửi email mới', async () => {
  let n = 0;
  const f = server({ write: (p, method, body, db) => {
    if (method !== 'PATCH') return undefined; n += 1;
    if (n === 1) { db[2] = { ...db[2], updatedAt: T1, email: 'mau.moi@thu.local' }; return fail(409, 'VERSION_CONFLICT', 'x'); }
    db[2] = { ...db[2], ...body, updatedAt: '2026-11-23T05:00:00.000Z' }; return res(200, { data: db[2] });
  } });
  const m = await mount(f);
  try {
    const d = await choose(m.container, EMP.fullName, /Sửa thông tin/);
    await fill(d, /Chức danh/, 'Trưởng nhóm');
    await press(d, /^Lưu$/);
    await press(modal(dom.doc.body), /Tải lại/);
    const open = modal(dom.doc.body);
    assert.equal(inputByLabel(open, /Email đăng nhập/).value, 'mau.moi@thu.local');
    assert.equal(inputByLabel(open, /Chức danh/).value, 'Trưởng nhóm');
    await press(open, /^Lưu$/);
    assert.deepEqual(f.writes()[1].body, { updatedAt: T1, fullName: 'Trần Thị Mẫu', email: 'mau.moi@thu.local', departmentId: 'd-kd', positionTitle: 'Trưởng nhóm' });
  } finally { await m.unmount(); }
});

test('sửa thông tin sau 409 — cùng sửa MỘT ô: giữ nội dung của mình nhưng báo rõ người khác vừa đổi ô đó thành gì', async () => {
  let n = 0;
  const f = server({ write: (p, method, body, db) => {
    if (method !== 'PATCH') return undefined; n += 1;
    if (n === 1) { db[2] = { ...db[2], updatedAt: T1, fullName: 'Trần Thị Mẫu (A sửa)' }; return fail(409, 'VERSION_CONFLICT', 'x'); }
    return undefined;
  } });
  const m = await mount(f);
  try {
    const d = await choose(m.container, EMP.fullName, /Sửa thông tin/);
    await fill(d, /Họ tên/, 'Trần Thị Mẫu (B sửa)');
    await press(d, /^Lưu$/);
    await press(modal(dom.doc.body), /Tải lại/);
    const open = modal(dom.doc.body);
    assert.equal(inputByLabel(open, /Họ tên/).value, 'Trần Thị Mẫu (B sửa)');
    assert.match(text(open), /Người khác vừa đổi Họ tên thành “Trần Thị Mẫu \(A sửa\)”/);
    assert.match(text(open), /lưu sẽ ghi đè/i);
  } finally { await m.unmount(); }
});

test('sửa thông tin — xung đột HAI LẦN liên tiếp (người kia lưu tiếp trong lúc mình xem lại): lần 2 vẫn 409, "Tải lại" lần nữa nạp tiếp bản mới, lưu lần 3 gửi mốc mới nhất', async () => {
  let n = 0; const T2 = '2026-11-23T04:30:00.000Z';
  const f = server({ write: (p, method, body, db) => {
    if (method !== 'PATCH') return undefined; n += 1;
    if (n === 1) { db[2] = { ...db[2], updatedAt: T1, email: 'lan1@thu.local' }; return fail(409, 'VERSION_CONFLICT', 'x'); }
    if (n === 2) { db[2] = { ...db[2], updatedAt: T2, email: 'lan2@thu.local' }; return fail(409, 'VERSION_CONFLICT', 'x'); }
    db[2] = { ...db[2], ...body, updatedAt: '2026-11-23T05:00:00.000Z' }; return res(200, { data: db[2] });
  } });
  const m = await mount(f);
  try {
    const d = await choose(m.container, EMP.fullName, /Sửa thông tin/);
    await fill(d, /Chức danh/, 'Trưởng nhóm');
    await press(d, /^Lưu$/);
    await press(modal(dom.doc.body), /Tải lại/);
    assert.equal(inputByLabel(modal(dom.doc.body), /Email đăng nhập/).value, 'lan1@thu.local');
    await press(modal(dom.doc.body), /^Lưu$/);
    assert.equal(f.writes()[1].body.updatedAt, T1);
    assert.ok(modal(dom.doc.body), 'lần 2 vẫn xung đột => hộp thoại còn mở');
    assert.match(alertText(modal(dom.doc.body)), /Thông tin vừa được người khác sửa/);
    await press(modal(dom.doc.body), /Tải lại/);
    assert.equal(inputByLabel(modal(dom.doc.body), /Email đăng nhập/).value, 'lan2@thu.local');
    assert.equal(inputByLabel(modal(dom.doc.body), /Chức danh/).value, 'Trưởng nhóm');
    await press(modal(dom.doc.body), /^Lưu$/);
    assert.deepEqual(f.writes()[2].body, { updatedAt: T2, fullName: 'Trần Thị Mẫu', email: 'lan2@thu.local', departmentId: 'd-kd', positionTitle: 'Trưởng nhóm' });
    assert.equal(modal(dom.doc.body), undefined);
  } finally { await m.unmount(); }
});

test('sửa thông tin — tài khoản bị người khác xoá / lọc mất trong lúc đang sửa: "Tải lại" báo rõ, không gửi thêm gì', async () => {
  let n = 0;
  const f = server({ write: (p, method, body, db) => { if (method !== 'PATCH') return undefined; n += 1; db.splice(2, 1); return fail(409, 'VERSION_CONFLICT', 'x'); } });
  const m = await mount(f);
  try {
    const d = await choose(m.container, EMP.fullName, /Sửa thông tin/);
    await fill(d, /Chức danh/, 'X');
    await press(d, /^Lưu$/);
    await press(modal(dom.doc.body), /Tải lại/);
    assert.match(alertText(modal(dom.doc.body)), /Không còn thấy tài khoản này trong danh sách/);
    assert.equal(f.writes().length, 1);
  } finally { await m.unmount(); }
});

test('đổi vai trò: hiện vai trò hiện tại; chọn lại đúng vai trò cũ => báo, không gọi; chọn vai trò mới => POST /role', async () => {
  const f = server({ write: (p, method, body, db) => { db[2] = { ...db[2], roles: [body.role] }; return res(200, { data: db[2] }); } });
  const m = await mount(f);
  try {
    const d = await choose(m.container, EMP.fullName, /Đổi vai trò/);
    assert.match(text(d), /Đổi vai trò — Trần Thị Mẫu/); assert.match(text(d), /Hiện tại: Kinh doanh/);
    assert.match(text(d), /Quyền mới có hiệu lực ngay\. Vai trò Quản trị CRM được quản lý tài khoản và xem toàn bộ dữ liệu\./);
    await press(d, /^Đổi vai trò$/);
    assert.match(alertText(d), /Tài khoản đang giữ đúng vai trò này\./); assert.equal(f.writes().length, 0);
    await pick(d, /Vai trò mới/, /Kế toán/);
    await press(modal(dom.doc.body), /^Đổi vai trò$/);
    assert.deepEqual({ p: f.writes()[0].p, body: f.writes()[0].body }, { p: '/accounts/' + EMP.id + '/role', body: { role: 'accountant' } });
    assert.equal(modal(dom.doc.body), undefined);
    assert.match(m.toasts[0].message, /Đã đổi vai trò của Trần Thị Mẫu thành Kế toán\./);
  } finally { await m.unmount(); }
});

test('cấp lại mật khẩu: cảnh báo đăng xuất; POST /reset-password; thông báo dặn đưa mật khẩu trực tiếp; DOM không còn mật khẩu', async () => {
  const f = server(); const m = await mount(f);
  try {
    const d = await choose(m.container, EMP.fullName, /Cấp lại mật khẩu/);
    assert.match(text(d), /Người này sẽ bị đăng xuất khỏi mọi thiết bị ngay\./);
    await fill(d, /Mật khẩu tạm/, 'ngan');
    await press(d, /^Cấp lại mật khẩu$/);
    assert.match(alertText(d), /Mật khẩu tạm cần ít nhất 12 ký tự\./); assert.equal(f.writes().length, 0);
    await fill(d, /Mật khẩu tạm/, TEMP);
    await press(d, /^Cấp lại mật khẩu$/);
    assert.deepEqual({ p: f.writes()[0].p, body: f.writes()[0].body }, { p: '/accounts/' + EMP.id + '/reset-password', body: { tempPassword: TEMP } });
    assert.match(m.toasts[0].message, /Hãy đưa mật khẩu tạm trực tiếp cho Trần Thị Mẫu\. Họ sẽ phải đổi khi đăng nhập lần đầu\./);
    assert.equal(modal(dom.doc.body), undefined); assert.equal(holdsSecret(), 0);
  } finally { await m.unmount(); }
});

test('khoá: câu cảnh báo đã duyệt + nút kiểu nguy hiểm; lý do bắt buộc; POST /disable; 409 LAST_APPROVER => đúng câu, hộp thoại vẫn mở', async () => {
  let n = 0;
  const f = server({ write: () => { n += 1; return n === 1 ? fail(409, 'LAST_APPROVER', 'x') : undefined; } });
  const m = await mount(f);
  try {
    const d = await choose(m.container, EMP.fullName, /Khoá tài khoản/);
    assert.match(text(d), /Người này bị đăng xuất ngay và không đăng nhập được nữa\. Khách hàng, cơ hội và lịch sử của họ giữ nguyên\. Có thể mở lại sau\./);
    assert.match(buttonByText(d, /^Khoá tài khoản$/).attributes.class, /sg-btn--danger/);
    await press(d, /^Khoá tài khoản$/);
    assert.match(alertText(d), /Chưa nhập lý do\./); assert.equal(f.writes().length, 0);
    await fill(d, /Lý do/, '  Nghỉ việc từ 01/12 ');
    await press(d, /^Khoá tài khoản$/);
    assert.deepEqual({ p: f.writes()[0].p, body: f.writes()[0].body }, { p: '/accounts/' + EMP.id + '/disable', body: { reason: 'Nghỉ việc từ 01/12' } });
    assert.match(alertText(modal(dom.doc.body)), /Không thể khoá hoặc gỡ quyền của Quản trị CRM cuối cùng\./);
    await press(modal(dom.doc.body), /^Khoá tài khoản$/);
    assert.equal(modal(dom.doc.body), undefined);
    assert.match(m.toasts[0].message, /Đã khoá tài khoản Trần Thị Mẫu\./);
  } finally { await m.unmount(); }
});

test('mở lại tài khoản đã khoá: POST /enable kèm mật khẩu tạm mới; thông báo dặn đưa mật khẩu', async () => {
  const f = server(); const m = await mount(f);
  try {
    const d = await choose(m.container, OFF.fullName, /Mở lại tài khoản/);
    await fill(d, /Mật khẩu tạm/, TEMP);
    await press(d, /^Mở lại$/);
    assert.deepEqual({ p: f.writes()[0].p, body: f.writes()[0].body }, { p: '/accounts/' + OFF.id + '/enable', body: { tempPassword: TEMP } });
    assert.match(m.toasts[0].message, /Hãy đưa mật khẩu tạm trực tiếp cho Lê Văn Thử\./);
    assert.equal(holdsSecret(), 0);
  } finally { await m.unmount(); }
});

test('lọc: vai trò + trạng thái gửi ngay; ô tìm chờ gõ xong, dưới 2 ký tự không gửi q; không khớp => "Không có tài khoản nào khớp."', async () => {
  const f = server({ list: (q) => (q.get('q') === 'zz' ? res(200, { data: { items: [], page: 1, pageSize: 100, total: 0, totalPages: 0 } }) : undefined) });
  const m = await mount(f);
  try {
    await pick(m.container, /Lọc vai trò/, /Kỹ thuật/);
    assert.equal(f.lists().at(-1).q.get('role'), 'technician');
    await pick(m.container, /Lọc trạng thái/, /Đã khoá/);
    assert.equal(f.lists().at(-1).q.get('status'), 'DISABLED'); assert.equal(f.lists().at(-1).q.get('role'), 'technician');
    const box = findAll(m.container, (e) => e.tagName === 'INPUT' && e.attributes['aria-label'] === 'Tìm tài khoản')[0]; assert.ok(box);
    const n = f.lists().length;
    await doAct(() => type(box, 'z')); await wait(320); await flush();
    assert.equal(f.lists().length, n, 'một ký tự: không gọi máy chủ');
    await doAct(() => type(box, 'zz')); await wait(320); await flush();
    assert.equal(f.lists().at(-1).q.get('q'), 'zz');
    assert.match(text(m.container), /Không có tài khoản nào khớp\./);
  } finally { await m.unmount(); }
});

test('máy chủ chưa bật chức năng (503 ACCOUNT_ADMIN_UNAVAILABLE): hiện câu "chưa được bật", có nút thử lại, không có nút thêm', async () => {
  let on = false;
  const f = server({ list: () => (on ? undefined : fail(503, 'ACCOUNT_ADMIN_UNAVAILABLE', 'Chức năng quản lý tài khoản chưa được bật trên máy chủ.')) });
  const m = await mount(f);
  try {
    assert.match(alertText(m.container), /Chức năng quản lý tài khoản chưa được bật trên máy chủ\./);
    assert.equal(buttonByText(m.container, /Thêm nhân viên/), undefined);
    on = true;
    await press(m.container, /Thử lại/);
    assert.match(text(m.container), /4 \/ 4 tài khoản/); assert.ok(buttonByText(m.container, /Thêm nhân viên/));
  } finally { await m.unmount(); }
});

test('không có access.approve: AccountsRoute hiện trang không có quyền và KHÔNG gọi máy chủ', async () => {
  const f = server();
  const m = await mount(f, (ui) => React.createElement(AccountsRoute, { ui, allowed: false }));
  try {
    assert.match(text(m.container), /Không có quyền quản lý tài khoản/);
    assert.equal(f.calls.length, 0);
    assert.equal(buttonByText(m.container, /Thêm nhân viên/), undefined);
  } finally { await m.unmount(); }
});

test('có quyền: AccountsRoute mở trang thật', async () => {
  const f = server();
  const m = await mount(f, (ui) => React.createElement(AccountsRoute, { ui, allowed: true }));
  try { assert.match(text(m.container), /4 \/ 4 tài khoản/); } finally { await m.unmount(); }
});

test('điện thoại (ui.mobile): thẻ thay cho bảng, vẫn đủ nút thao tác và dòng hệ thống không có nút', async () => {
  const f = server(); const m = await mount(f, undefined, { mobile: true });
  try {
    assert.equal(findAll(m.container, (e) => e.tagName === 'TABLE').length, 0);
    assert.match(text(m.container), /NV-0006.*|Trần Thị Mẫu/);
    assert.ok(kebab(m.container, EMP.fullName)); assert.equal(kebab(m.container, SYS.fullName), undefined);
    assert.match(text(m.container), /Tài khoản hệ thống/);
  } finally { await m.unmount(); }
});
