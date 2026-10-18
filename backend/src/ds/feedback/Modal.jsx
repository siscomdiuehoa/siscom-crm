import React, { useEffect } from 'react';
import { Icon } from '../core/Icon.jsx';
import { IconButton } from '../core/IconButton.jsx';

export function Modal({ open, onClose, title, description, icon, tone = 'blue', size = 'md', footer, children, inline = false, surface = 'solid' }) {
  useEffect(() => {
    if (!open || inline) return;
    const h = (e) => { if (e.key === 'Escape') onClose && onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, inline, onClose]);
  if (!open) return null;
  const tones = { blue: ['var(--primary-soft)', 'var(--primary)'], error: ['var(--error-soft)', 'var(--error)'], ai: ['var(--accent-soft)', 'var(--accent)'], success: ['var(--success-soft)', 'var(--success)'], warning: ['var(--warning-soft)', 'var(--warning)'] };
  const t = tones[tone] || tones.blue;
  const panel = (
    <div className={'sg-modal ' + (surface === 'glass' ? 'sg-glass-strong' : 'sg-solid') + (size !== 'md' ? ' sg-modal--' + size : '')} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} onClick={(e) => e.stopPropagation()} style={{ boxShadow: 'var(--shadow-lg)', ...(inline ? { animation: 'none' } : null) }}>
      <div className="sg-modal__head">
        {icon ? <span style={{ width: 40, height: 40, borderRadius: 12, background: t[0], color: t[1], display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Icon name={icon} size={20} /></span> : null}
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 className="sg-modal__title">{title}</h2>
          {description ? <p className="sg-modal__desc">{description}</p> : null}
        </div>
        {onClose ? <IconButton icon="x" label="Đóng" size="sm" onClick={onClose} /> : null}
      </div>
      {children ? <div className="sg-modal__body">{children}</div> : <div style={{ height: 20 }} />}
      {footer ? <div className="sg-modal__foot">{footer}</div> : null}
    </div>
  );
  if (inline) return panel;
  return <div className="sg-overlay" onClick={onClose}>{panel}</div>;
}
