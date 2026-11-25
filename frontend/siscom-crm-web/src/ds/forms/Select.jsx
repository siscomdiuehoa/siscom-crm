import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../core/Icon.jsx';
import { Field } from './Input.jsx';

// Danh sách xổ ra NỔI trên cùng màn hình (gắn vào <body>, position: fixed theo vị trí nút): không bị khung có thanh cuộn (thân hộp thoại,
// bảng) cắt mất. Bên dưới không đủ chỗ mà bên trên rộng hơn => lật lên trên nút; chiều cao tối đa 280px và không bao giờ vượt chỗ trống thực tế, mép luôn cách màn hình
// ít nhất 8px (thừa thì cuộn trong danh sách); rộng ít nhất 220px, luôn nằm gọn trong màn hình. Cuộn trang / đổi cỡ cửa sổ khi đang mở => đặt lại vị trí. Sự kiện React từ danh sách vẫn nổi bọt theo cây component
// (bấm chọn trong hộp thoại không đóng hộp thoại).
// Trợ năng: có `label` => nút được gọi tên bằng aria-labelledby = nhãn + giá trị đang chọn ("Phòng ban — Kinh doanh"). Ô không nhãn thì truyền `ariaLabel`
// => tên nút = "<ariaLabel>: <giá trị đang chọn>". Không truyền gì => như cũ (tên = nội dung nút).
const MENU_MAX = 280; const MENU_GAP = 6; const MENU_EDGE = 8; const MENU_MIN_W = 220;

export function Select({ options = [], value, defaultValue, onChange, placeholder = 'Chọn…', label, hint, error, required, icon, size = 'md', disabled, className = '', ariaLabel }) {
  const uid = useId(); const lid = 'sl' + uid.replace(/:/g, ''); const vid = lid + '-v';
  const [inner, setInner] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const ref = useRef(null); const btnRef = useRef(null); const menuRef = useRef(null);
  const [pos, setPos] = useState(null);
  const cur = value !== undefined ? value : inner;
  const opts = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
  const sel = opts.find((o) => o.value === cur);
  const place = useCallback(() => {
    const b = btnRef.current;
    if (!b || typeof b.getBoundingClientRect !== 'function') { setPos(null); return; }
    const r = b.getBoundingClientRect();
    const vh = window.innerHeight || (document.documentElement && document.documentElement.clientHeight) || 0;
    const m = menuRef.current; const natural = m && m.scrollHeight ? m.scrollHeight : MENU_MAX;
    const need = Math.min(MENU_MAX, natural);
    const below = vh - r.bottom - MENU_GAP - MENU_EDGE; const above = r.top - MENU_GAP - MENU_EDGE;
    const up = below < need && above > below;
    // Mép của danh sách kẹp trong [MENU_EDGE, vh - MENU_EDGE]; chiều cao = phần còn lại tới mép kia, tối đa MENU_MAX, KHÔNG có mức tối thiểu
    // (mức tối thiểu cũ 120px làm danh sách tràn khỏi màn hình khi chỗ trống nhỏ hơn — review R1 #270). Thiếu chỗ thì cuộn trong danh sách.
    const clampEdge = (v) => Math.min(Math.max(v, MENU_EDGE), Math.max(MENU_EDGE, vh - MENU_EDGE));
    const top = clampEdge(r.bottom + MENU_GAP); const bottom = clampEdge(vh - r.top + MENU_GAP);
    const room = Math.max(0, Math.min(MENU_MAX, vh - MENU_EDGE - (up ? bottom : top)));
    // Rộng ít nhất MENU_MIN_W (nút hẹp trên điện thoại làm chữ lựa chọn xuống dòng) nhưng không vượt màn hình; tràn phải => dịch sang trái.
    const vw = window.innerWidth || (document.documentElement && document.documentElement.clientWidth) || 0;
    let width = r.width; let left = r.left;
    if (vw > 0) {
      width = Math.min(Math.max(r.width, MENU_MIN_W), vw - 2 * MENU_EDGE);
      left = Math.max(MENU_EDGE, Math.min(r.left, vw - MENU_EDGE - width));
    }
    setPos(up ? { left, width, bottom, maxHeight: room, up: true } : { left, width, top, maxHeight: room, up: false });
  }, []);
  useLayoutEffect(() => { if (open) place(); else setPos(null); }, [open, place]);
  useEffect(() => {
    if (!open) return;
    const h = (e) => {
      const t = e.target;
      if ((ref.current && ref.current.contains(t)) || (menuRef.current && menuRef.current.contains(t))) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', h);
    document.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [open, place]);
  const pick = (v) => { if (value === undefined) setInner(v); onChange && onChange(v); setOpen(false); };
  const btnName = ariaLabel ? ariaLabel + ': ' + (sel ? sel.label : placeholder) : undefined;
  const cls = ['sg-control', 'sg-select__trigger', size === 'sm' && 'sg-control--sm', error && 'sg-control--error', disabled && 'sg-control--disabled'].filter(Boolean).join(' ');
  const ctl = (
    <div className={'sg-select ' + className} ref={ref}>
      <button ref={btnRef} type="button" className={cls} aria-haspopup="listbox" aria-expanded={open} aria-label={btnName} aria-labelledby={!btnName && label ? lid + ' ' + vid : undefined} disabled={disabled} onClick={() => setOpen(!open)} onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}>
        {icon ? <Icon name={icon} size={16} /> : null}
        {sel && sel.icon ? <Icon name={sel.icon} size={16} color="var(--text-3)" /> : null}
        <span id={vid} className={'sg-select__value' + (sel ? '' : ' sg-select__value--ph')}>{sel ? sel.label : placeholder}</span>
        <Icon name="chevron-down" size={16} color="var(--text-3)" style={{ transition: 'transform var(--dur-fast)', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      {open ? createPortal(
        <div ref={menuRef} className={'sg-menu sg-menu--float sg-glass-strong' + (pos && pos.up ? ' sg-menu--up' : '')} role="listbox"
          style={pos ? { position: 'fixed', left: pos.left + 'px', width: pos.width + 'px', top: pos.up ? undefined : pos.top + 'px', bottom: pos.up ? pos.bottom + 'px' : undefined, maxHeight: pos.maxHeight + 'px' } : { position: 'fixed' }}>
          {opts.map((o) => (
            <div key={o.value} role="option" aria-selected={o.value === cur} className="sg-menu__item" onClick={() => pick(o.value)}>
              {o.icon ? <Icon name={o.icon} size={16} color="var(--text-3)" /> : null}
              <span>{o.label}</span>
              {o.value === cur ? <Icon name="check" size={16} className="sg-menu__check" /> : null}
            </div>
          ))}
        </div>,
        document.body,
      ) : null}
    </div>
  );
  if (!label && !hint && !error) return ctl;
  return <Field label={label} labelId={lid} required={required} hint={hint} error={error}>{ctl}</Field>;
}
