import React, { useState } from 'react';
import { Icon } from './Icon.jsx';

export function Tabs({ items = [], value, defaultValue, onChange, variant = 'segmented', className = '' }) {
  const [inner, setInner] = useState(defaultValue ?? (items[0] && items[0].id));
  const cur = value !== undefined ? value : inner;
  const pick = (id) => { if (value === undefined) setInner(id); onChange && onChange(id); };
  return (
    <div role="tablist" className={'sg-tabs' + (variant === 'line' ? ' sg-tabs--line' : '') + (className ? ' ' + className : '')}>
      {items.map((it) => (
        <button key={it.id} role="tab" type="button" aria-selected={cur === it.id} className="sg-tab" onClick={() => pick(it.id)}>
          {it.icon ? <Icon name={it.icon} size={15} /> : null}
          {it.label}
          {it.count != null ? <span className="sg-tab__count">{it.count}</span> : null}
        </button>
      ))}
    </div>
  );
}
