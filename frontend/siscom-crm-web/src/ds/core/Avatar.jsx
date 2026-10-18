import React from 'react';
import { Icon } from './Icon.jsx';

const STATUS = { online: 'var(--success)', busy: 'var(--warning)', offline: 'var(--slate-400)', ai: 'var(--accent)' };

export function initials(name = '') {
  const w = String(name).trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '?';
  if (w.length === 1) return w[0].slice(0, 2).toUpperCase();
  return (w[0][0] + w[w.length - 1][0]).toUpperCase();
}

export function Avatar({ name, src, size = 32, square = false, ai = false, icon, status, className = '', style }) {
  const cls = ['sg-avatar', square && 'sg-avatar--square', ai && 'sg-avatar--ai', className].filter(Boolean).join(' ');
  return (
    <span className={cls} title={name} style={{ width: size, height: size, fontSize: Math.round(size * 0.38), ...style }}>
      {src ? <img src={src} alt={name || ''} /> : icon ? <Icon name={icon} size={Math.round(size * 0.5)} /> : initials(name)}
      {status ? <span className="sg-avatar__status" style={{ background: STATUS[status] }} /> : null}
    </span>
  );
}
