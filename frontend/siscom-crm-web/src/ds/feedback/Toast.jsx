import React from 'react';
import { Icon } from '../core/Icon.jsx';
import { IconButton } from '../core/IconButton.jsx';

const T = {
  success: ['circle-check', 'var(--success-soft)', 'var(--success)'],
  error: ['circle-alert', 'var(--error-soft)', 'var(--error)'],
  warning: ['triangle-alert', 'var(--warning-soft)', 'var(--warning)'],
  info: ['info', 'var(--primary-soft)', 'var(--primary)'],
  ai: ['sparkles', 'var(--accent-soft)', 'var(--accent)'],
};

export function Toast({ tone = 'info', title, message, action, onClose, icon }) {
  const t = T[tone] || T.info;
  return (
    <div className="sg-toast sg-glass-strong" role="status">
      <span className="sg-toast__icon" style={{ background: t[1], color: t[2] }}><Icon name={icon || t[0]} size={16} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p className="sg-toast__title">{title}</p>
        {message ? <p className="sg-toast__msg">{message}</p> : null}
        {action ? <div style={{ marginTop: 8 }}>{action}</div> : null}
      </div>
      {onClose ? <IconButton icon="x" label="Đóng" size="sm" onClick={onClose} style={{ marginTop: -4, marginRight: -4 }} /> : null}
    </div>
  );
}
