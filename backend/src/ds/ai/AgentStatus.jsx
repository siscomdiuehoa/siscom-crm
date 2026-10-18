import React from 'react';

export const AGENT_STATUS = {
  active: { label: 'Đang hoạt động', color: 'var(--success)', text: 'var(--success-text)', bg: 'var(--success-soft)', pulse: true },
  processing: { label: 'Đang xử lý', color: 'var(--accent)', text: 'var(--accent-text)', bg: 'var(--accent-soft)', pulse: true },
  waiting: { label: 'Chờ phê duyệt', color: 'var(--warning)', text: 'var(--warning-text)', bg: 'var(--warning-soft)' },
  paused: { label: 'Tạm dừng', color: 'var(--slate-400)', text: 'var(--text-2)', bg: 'var(--neutral-soft)' },
  error: { label: 'Gặp lỗi', color: 'var(--error)', text: 'var(--error-text)', bg: 'var(--error-soft)' },
  offline: { label: 'Ngoại tuyến', color: 'var(--slate-400)', text: 'var(--text-3)', bg: 'var(--neutral-soft)' },
};

export function AgentStatus({ status = 'active', label, pill = false }) {
  const s = AGENT_STATUS[status] || AGENT_STATUS.active;
  return (
    <span className="sg-status" style={pill ? { background: s.bg, color: s.text, height: 24, padding: '0 10px', borderRadius: 999 } : { color: s.text }}>
      <span className={'sg-status__dot' + (s.pulse ? ' sg-status__dot--pulse' : '')} style={{ background: s.color, color: s.color }} />
      {label || s.label}
    </span>
  );
}
