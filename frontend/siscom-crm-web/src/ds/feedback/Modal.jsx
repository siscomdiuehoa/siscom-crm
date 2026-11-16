import React, { useEffect, useRef } from 'react';
import { Icon } from '../core/Icon.jsx';
import { IconButton } from '../core/IconButton.jsx';

// F-A8-02 (#218, trợ năng WCAG 2.4.3 / 2.1.2): phần tử nhận focus bằng Tab trong hộp thoại — duyệt cây DOM (không phụ thuộc selector CSS),
// cùng quy tắc với drawer A7 (PR #210 F-1).
const TABBABLE = { BUTTON: 1, INPUT: 1, SELECT: 1, TEXTAREA: 1 };
export function tabbables(root) {
  const out = [];
  const walk = (n) => {
    for (const c of n.childNodes || []) {
      if (c.nodeType !== 1) continue;
      const ti = c.getAttribute('tabindex');
      const native = TABBABLE[c.tagName] ? !(c.tagName === 'INPUT' && c.getAttribute('type') === 'hidden') : (c.tagName === 'A' && c.getAttribute('href') != null);
      if (ti !== '-1' && !c.disabled && (native || ti != null)) out.push(c);
      walk(c);
    }
  };
  if (root) walk(root);
  return out;
}

// Phần tử có focus gần nhất trong trang. Bấm vào mục menu dạng <div> (không nhận focus) làm trình duyệt chuyển focus về <body>;
// khi đó hộp thoại trả focus về phần tử này (vd. nút "Thao tác khác") thay vì làm mất focus.
let lastFocused = null;
let tracking = false;
function trackFocus() {
  if (tracking || typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
  tracking = true;
  document.addEventListener('focusin', (e) => { lastFocused = e.target; }, true);
}
const usable = (el) => !!el && el !== document.body && el.isConnected !== false && typeof el.focus === 'function';

// Ngăn xếp hộp thoại đang mở (hộp mở sau ở trên cùng). Nghiệm thu trình duyệt thật (R2) phát hiện: bấm nút lưu => nút bị disabled khi đang bận
// => trình duyệt đẩy focus về <body> => phím Tab tiếp theo đi ra trang phía sau (onKeyDown của hộp không nhận được vì phím không phát từ trong hộp).
// Listener keydown cấp document (pha capture): Tab khi focus KHÔNG nằm trong hộp TRÊN CÙNG => kéo về phần tử đầu (Shift+Tab: cuối) của hộp đó,
// hộp không còn phần tử nào nhận Tab (mọi nút disabled) => focus khung hộp (tabIndex -1).
const openStack = [];
let keyGuard = false;
function guardTabOutside() {
  if (keyGuard || typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
  keyGuard = true;
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || !openStack.length) return;
    const panel = openStack[openStack.length - 1].current;
    if (!panel || panel.isConnected === false || panel.contains(document.activeElement)) return;
    e.preventDefault();
    const list = tabbables(panel);
    (list.length ? (e.shiftKey ? list[list.length - 1] : list[0]) : panel).focus();
  }, true);
}

export function Modal({ open, onClose, title, description, icon, tone = 'blue', size = 'md', footer, children, inline = false, surface = 'solid' }) {
  const panelRef = useRef(null);
  const bodyRef = useRef(null);
  const footRef = useRef(null);
  const openerRef = useRef(null);
  const wasOpen = useRef(false);
  trackFocus(); guardTabOutside();
  // Ghi phần tử đã mở hộp thoại NGAY lúc render lần mở (trước khi React gắn hộp thoại và autoFocus chuyển focus vào trong).
  if (open && !inline && !wasOpen.current) {
    const a = typeof document !== 'undefined' ? document.activeElement : null;
    openerRef.current = usable(a) ? a : (usable(lastFocused) ? lastFocused : null);
  }
  // Escape khi focus KHÔNG nằm trong hộp thoại (vd. đã bấm ra nền). Khi focus ở trong, onKeyDown của hộp thoại xử lý và chặn nổi bọt
  // (để listener Escape trên window của drawer/form phía dưới không bị kích hoạt theo).
  useEffect(() => {
    if (!open || inline) return undefined;
    const h = (e) => { if (e.key === 'Escape') onClose && onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, inline, onClose]);
  // Mở => focus vào phần tử đầu của thân (ô nhập), không có thì nút đầu ở chân, cuối cùng là phần tử đầu của cả hộp (nút Đóng).
  // Phần tử đã tự nhận focus trong hộp (autoFocus) giữ nguyên. Đóng (open = false hoặc gỡ component) => trả focus về phần tử đã mở nếu còn trong trang.
  // PR236-R1-UI-01: StrictMode (dev) chạy thêm chu kỳ setup → cleanup → setup ngay khi gắn. Cleanup KHÔNG xoá phần tử mở và KHÔNG trả focus
  // ngay: hẹn trả ở microtask; nếu setup chạy lại liền sau (chu kỳ kiểm tra của StrictMode, hộp vẫn mở) thì huỷ hẹn => giữ opener cho lần đóng thật.
  const pendingRestore = useRef(null);
  useEffect(() => {
    if (!open || inline) return undefined;
    if (pendingRestore.current) { pendingRestore.current.cancelled = true; pendingRestore.current = null; }
    wasOpen.current = true;
    const panel = panelRef.current;
    openStack.push(panelRef);
    if (panel && !panel.contains(document.activeElement)) {
      const start = tabbables(bodyRef.current)[0] || tabbables(footRef.current)[0] || tabbables(panel)[0];
      if (start) start.focus();
    }
    return () => {
      const i = openStack.lastIndexOf(panelRef); if (i >= 0) openStack.splice(i, 1);
      const job = { cancelled: false }; pendingRestore.current = job;
      Promise.resolve().then(() => {
        if (job.cancelled) return;
        pendingRestore.current = null;
        const opener = openerRef.current; wasOpen.current = false; openerRef.current = null;
        if (usable(opener) && !(panel && panel.contains(opener))) opener.focus();
      });
    };
  }, [open, inline]);
  if (!open) return null;
  // Bắt phím trên CHÍNH hộp thoại: Escape đóng (một lần, không nổi bọt); Tab ở cuối => về đầu, Shift+Tab ở đầu => về cuối;
  // focus đang không ở phần tử nào trong danh sách (vd. khung hộp thoại) => kéo về đầu/cuối. Tab ở giữa để trình duyệt tự chuyển.
  const onKey = inline ? undefined : (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); if (onClose) onClose(); return; }
    if (e.key !== 'Tab') return;
    const list = tabbables(panelRef.current);
    if (!list.length) { e.preventDefault(); return; }
    const a = document.activeElement; const first = list[0]; const last = list[list.length - 1];
    if (list.indexOf(a) < 0 || (e.shiftKey ? a === first : a === last)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
  };
  const tones = { blue: ['var(--primary-soft)', 'var(--primary)'], error: ['var(--error-soft)', 'var(--error)'], ai: ['var(--accent-soft)', 'var(--accent)'], success: ['var(--success-soft)', 'var(--success)'], warning: ['var(--warning-soft)', 'var(--warning)'] };
  const t = tones[tone] || tones.blue;
  const panel = (
    // tabIndex -1 (không vào thứ tự Tab): bấm vào vùng chữ/khoảng trống trong hộp thì focus ở lại khung hộp (thay vì rơi về <body>), nên phím Tab
    // tiếp theo vẫn xuất phát trong hộp và được onKeyDown kéo về phần tử đầu/cuối.
    <div ref={panelRef} tabIndex={inline ? undefined : -1} onKeyDown={onKey} className={'sg-modal ' + (surface === 'glass' ? 'sg-glass-strong' : 'sg-solid') + (size !== 'md' ? ' sg-modal--' + size : '')} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} onClick={(e) => e.stopPropagation()} style={{ boxShadow: 'var(--shadow-lg)', outline: 'none', ...(inline ? { animation: 'none' } : null) }}>
      <div className="sg-modal__head">
        {icon ? <span style={{ width: 40, height: 40, borderRadius: 12, background: t[0], color: t[1], display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Icon name={icon} size={20} /></span> : null}
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 className="sg-modal__title">{title}</h2>
          {description ? <p className="sg-modal__desc">{description}</p> : null}
        </div>
        {onClose ? <IconButton icon="x" label="Đóng" size="sm" onClick={onClose} /> : null}
      </div>
      {children ? <div ref={bodyRef} className="sg-modal__body">{children}</div> : <div style={{ height: 20 }} />}
      {footer ? <div ref={footRef} className="sg-modal__foot">{footer}</div> : null}
    </div>
  );
  if (inline) return panel;
  return <div className="sg-overlay" onClick={onClose}>{panel}</div>;
}
