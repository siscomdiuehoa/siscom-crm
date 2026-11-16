// Run: node --test tests/modalFocus.test.mjs   (Node >= 18; vite + react đã có). Không mạng, không trình duyệt.
// F-A8-02 (#218, trợ năng WCAG 2.4.3 / 2.1.2): component Modal dùng chung quản lý focus — mở => focus vào trong hộp thoại;
// Tab ở phần tử cuối => về đầu, Shift+Tab ở đầu => về cuối; Escape bắt trên chính hộp thoại; đóng => trả focus về phần tử đã mở.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import React from 'react';
import { installDom, findAll, buttonByText, click, keydown } from './helpers/miniDom.mjs';

let vite; let dom; let Modal; let createRoot; let act;
before(async () => {
  dom = installDom();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vite = await createServer({ configFile: new URL('../vite.config.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom', logLevel: 'silent', clearScreen: false });
  ({ Modal } = await vite.ssrLoadModule('/src/ds/feedback/Modal.jsx'));
  ({ createRoot } = await import('react-dom/client'));
  ({ act } = await import('react'));
});
after(async () => { if (vite) await vite.close(); if (dom) dom.restore(); delete globalThis.IS_REACT_ACT_ENVIRONMENT; });

const h = React.createElement;
const flush = () => act(async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); });
const doAct = async (fn) => { await act(async () => { await fn(); }); await flush(); };
const dialog = (root) => findAll(root, (e) => e.attributes.role === 'dialog')[0];
const tabbable = (root) => findAll(root, (e) => ['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT'].includes(e.tagName) && !e.disabled && e.attributes.tabindex !== '-1' && e.attributes.type !== 'hidden');

// Trang thử: nút "Mở" + nút phía sau + Modal có thân và chân (Huỷ / Lưu). body: 'inputs' | 'text' | 'none' | mảng phần tử tuỳ ý.
function Harness({ props = {}, body = 'inputs', onCloseSpy }) {
  const [open, setOpen] = React.useState(false);
  const close = () => { if (onCloseSpy) onCloseSpy(); setOpen(false); };
  const kids = Array.isArray(body) ? body
    : body === 'inputs' ? [h('input', { key: 'a', 'aria-label': 'Ô A' }), h('input', { key: 'h', type: 'hidden' }), h('textarea', { key: 'b', 'aria-label': 'Ô B' })]
    : body === 'none' ? null : h('p', null, 'Chỉ chữ');
  return h('div', null,
    h('button', { type: 'button', onClick: () => setOpen(true) }, 'Mở'),
    h('button', { type: 'button' }, 'Nút phía sau'),
    h(Modal, { open, onClose: close, title: 'Hộp thử', footer: h(React.Fragment, null, h('button', { type: 'button', onClick: close }, 'Huỷ'), h('button', { type: 'button' }, 'Lưu')), ...props }, kids));
}
async function mount(el) {
  const container = dom.doc.createElement('div'); dom.doc.body.appendChild(container); const root = createRoot(container);
  await act(async () => { root.render(el); }); await flush();
  return { container, unmount: () => act(async () => { root.unmount(); container.parentNode && container.parentNode.removeChild(container); }) };
}
async function openFrom(m) {
  const opener = buttonByText(m.container, /^Mở$/);
  opener.focus(); assert.equal(dom.doc.activeElement, opener);
  await doAct(() => click(opener));
  const d = dialog(m.container); assert.ok(d, 'hộp thoại phải mở');
  return { opener, d };
}

test('mở => focus vào phần tử đầu của THÂN hộp thoại (không phải nút Đóng ở đầu, không phải nút phía sau)', async () => {
  const m = await mount(h(Harness));
  try {
    const { d } = await openFrom(m);
    const a = dom.doc.activeElement;
    assert.ok(d.contains(a), 'focus phải nằm trong hộp thoại');
    assert.equal(a.attributes['aria-label'], 'Ô A');
  } finally { await m.unmount(); }
});

test('thân không có ô nhập => focus vào nút đầu ở chân; không có chân => nút Đóng', async () => {
  let m = await mount(h(Harness, { body: 'text' }));
  try { const { d } = await openFrom(m); assert.ok(d.contains(dom.doc.activeElement)); assert.equal(dom.doc.activeElement, buttonByText(d, /^Huỷ$/)); } finally { await m.unmount(); }
  m = await mount(h(Harness, { body: 'none', props: { footer: null } }));
  try { const { d } = await openFrom(m); assert.ok(d.contains(dom.doc.activeElement)); assert.equal(dom.doc.activeElement.attributes['aria-label'], 'Đóng'); } finally { await m.unmount(); }
});

test('Tab ở phần tử cuối => về đầu; Shift+Tab ở đầu => về cuối; Tab ở giữa để trình duyệt tự chuyển; bỏ qua input hidden', async () => {
  const m = await mount(h(Harness));
  try {
    const { d } = await openFrom(m);
    const list = tabbable(d);
    const first = list[0]; const last = list[list.length - 1];
    assert.equal(first.attributes['aria-label'], 'Đóng', 'phần tử đầu theo thứ tự DOM là nút Đóng ở đầu hộp');
    assert.equal(last, buttonByText(d, /^Lưu$/));
    last.focus(); let ev;
    await doAct(() => { ev = keydown(last, 'Tab'); });
    assert.equal(dom.doc.activeElement, first); assert.equal(ev.defaultPrevented, true);
    await doAct(() => { ev = keydown(first, 'Tab', { shiftKey: true }); });
    assert.equal(dom.doc.activeElement, last); assert.equal(ev.defaultPrevented, true);
    const mid = list[1]; mid.focus();
    await doAct(() => { ev = keydown(mid, 'Tab'); });
    assert.equal(ev.defaultPrevented, false); assert.equal(dom.doc.activeElement, mid);
  } finally { await m.unmount(); }
});

test('focus không nằm trong danh sách (vd. đang ở chính khung hộp thoại) rồi Tab => kéo về phần tử đầu/cuối của hộp thoại', async () => {
  const m = await mount(h(Harness));
  try {
    const { d } = await openFrom(m);
    const list = tabbable(d);
    const outside = buttonByText(m.container, /^Nút phía sau$/); outside.focus();
    let ev; await doAct(() => { ev = keydown(d, 'Tab'); });
    assert.equal(dom.doc.activeElement, list[0]); assert.equal(ev.defaultPrevented, true);
    outside.focus();
    await doAct(() => { ev = keydown(d, 'Tab', { shiftKey: true }); });
    assert.equal(dom.doc.activeElement, list[list.length - 1]); assert.equal(ev.defaultPrevented, true);
  } finally { await m.unmount(); }
});

test('Escape trên hộp thoại => đóng đúng MỘT lần, không nổi bọt ra ngoài; đóng => focus trả về nút mở', async () => {
  let n = 0; const outer = [];
  const m = await mount(h('div', { onKeyDown: (e) => outer.push(e.key) }, h(Harness, { onCloseSpy: () => { n++; } })));
  try {
    const { opener } = await openFrom(m);
    let ev; await doAct(() => { ev = keydown(dom.doc.activeElement, 'Escape'); });
    assert.equal(n, 1, 'onClose đúng 1 lần');
    assert.equal(ev.cancelBubble, true, 'chặn nổi bọt (listener Escape trên window của drawer/form phía dưới không chạy)');
    assert.deepEqual(outer, [], 'phần tử cha không nhận Escape');
    assert.equal(dialog(m.container), undefined);
    assert.equal(dom.doc.activeElement, opener, 'đóng => focus về nút mở');
  } finally { await m.unmount(); }
});

test('đóng bằng nút Huỷ / nút Đóng => focus trả về nút mở', async () => {
  const m = await mount(h(Harness));
  try {
    let { opener, d } = await openFrom(m);
    await doAct(() => click(buttonByText(d, /^Huỷ$/)));
    assert.equal(dialog(m.container), undefined); assert.equal(dom.doc.activeElement, opener);
    ({ opener, d } = await openFrom(m));
    await doAct(() => click(findAll(d, (e) => e.attributes['aria-label'] === 'Đóng')[0]));
    assert.equal(dialog(m.container), undefined); assert.equal(dom.doc.activeElement, opener);
  } finally { await m.unmount(); }
});

test('đang bận (onClose = undefined): Escape không đóng nhưng vẫn không nổi bọt', async () => {
  const outer = [];
  const m = await mount(h('div', { onKeyDown: (e) => outer.push(e.key) }, h(Modal, { open: true, title: 'Bận', footer: h('button', { type: 'button' }, 'Lưu') }, h('input', { 'aria-label': 'Ô' }))));
  try {
    const d = dialog(m.container);
    assert.ok(d.contains(dom.doc.activeElement));
    await doAct(() => { keydown(dom.doc.activeElement, 'Escape'); });
    assert.ok(dialog(m.container), 'vẫn mở'); assert.deepEqual(outer, []);
  } finally { await m.unmount(); }
});

test('phần tử có autoFocus trong hộp thoại thì giữ nguyên, không bị kéo sang phần tử đầu', async () => {
  const m = await mount(h(Harness, { body: [h('input', { key: 'a', 'aria-label': 'Ô A' }), h('input', { key: 'b', 'aria-label': 'Ô B', autoFocus: true })] }));
  try {
    await openFrom(m);
    assert.equal(dom.doc.activeElement.attributes['aria-label'], 'Ô B');
  } finally { await m.unmount(); }
});

test('inline (trang mẫu design system) => không bắt focus, không bẫy Tab', async () => {
  const m = await mount(h('div', null, h('button', { type: 'button' }, 'Ngoài'), h(Modal, { open: true, inline: true, title: 'Mẫu', footer: h('button', { type: 'button' }, 'Lưu') })));
  try {
    const out = buttonByText(m.container, /^Ngoài$/); out.focus(); await flush();
    assert.equal(dom.doc.activeElement, out);
    const last = buttonByText(m.container, /^Lưu$/); last.focus();
    let ev; await doAct(() => { ev = keydown(last, 'Tab'); }); assert.equal(ev.defaultPrevented, false);
  } finally { await m.unmount(); }
});
