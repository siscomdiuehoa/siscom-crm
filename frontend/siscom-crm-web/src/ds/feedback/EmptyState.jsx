import React from 'react';
import { Icon } from '../core/Icon.jsx';

const PRESET = {
  empty: { icon: 'inbox' },
  search: { icon: 'search-x' },
  error: { icon: 'server-crash', bg: 'var(--error-soft)', fg: 'var(--error)' },
  offline: { icon: 'wifi-off', bg: 'var(--warning-soft)', fg: 'var(--warning)' },
  ai: { icon: 'sparkles', bg: 'var(--accent-soft)', fg: 'var(--accent)' },
};

export function EmptyState({ kind = 'empty', icon, title, description, action, secondaryAction, compact = false }) {
  const p = PRESET[kind] || PRESET.empty;
  return (
    <div className="sg-empty" style={compact ? { padding: '24px 16px' } : undefined} role={kind === 'error' ? 'alert' : undefined}>
      <span className="sg-empty__icon" style={p.bg ? { background: p.bg, color: p.fg, boxShadow: 'none' } : undefined}><Icon name={icon || p.icon} size={24} /></span>
      <h4 className="sg-empty__title">{title}</h4>
      {description ? <p className="sg-empty__desc">{description}</p> : null}
      {action || secondaryAction ? <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>{secondaryAction}{action}</div> : null}
    </div>
  );
}
