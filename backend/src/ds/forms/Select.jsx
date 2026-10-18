import React, { useEffect, useRef, useState } from 'react';
import { Icon } from '../core/Icon.jsx';
import { Field } from './Input.jsx';

export function Select({ options = [], value, defaultValue, onChange, placeholder = 'Chọn…', label, hint, error, required, icon, size = 'md', disabled, className = '' }) {
  const [inner, setInner] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const cur = value !== undefined ? value : inner;
  const opts = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
  const sel = opts.find((o) => o.value === cur);
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const pick = (v) => { if (value === undefined) setInner(v); onChange && onChange(v); setOpen(false); };
  const cls = ['sg-control', 'sg-select__trigger', size === 'sm' && 'sg-control--sm', error && 'sg-control--error', disabled && 'sg-control--disabled'].filter(Boolean).join(' ');
  const ctl = (
    <div className={'sg-select ' + className} ref={ref}>
      <button type="button" className={cls} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)} onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}>
        {icon ? <Icon name={icon} size={16} /> : null}
        {sel && sel.icon ? <Icon name={sel.icon} size={16} color="var(--text-3)" /> : null}
        <span className={'sg-select__value' + (sel ? '' : ' sg-select__value--ph')}>{sel ? sel.label : placeholder}</span>
        <Icon name="chevron-down" size={16} color="var(--text-3)" style={{ transition: 'transform var(--dur-fast)', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      {open ? (
        <div className="sg-menu sg-glass-strong" role="listbox">
          {opts.map((o) => (
            <div key={o.value} role="option" aria-selected={o.value === cur} className="sg-menu__item" onClick={() => pick(o.value)}>
              {o.icon ? <Icon name={o.icon} size={16} color="var(--text-3)" /> : null}
              <span>{o.label}</span>
              {o.value === cur ? <Icon name="check" size={16} className="sg-menu__check" /> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
  if (!label && !hint && !error) return ctl;
  return <Field label={label} required={required} hint={hint} error={error}>{ctl}</Field>;
}
