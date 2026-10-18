import React, { useId } from 'react';
import { Icon } from '../core/Icon.jsx';

export function Field({ label, required, hint, error, success, htmlFor, children }) {
  return (
    <div className="sg-field">
      {label ? <label className="sg-label" htmlFor={htmlFor}>{label}{required ? <span className="sg-label__req">*</span> : null}</label> : null}
      {children}
      {error ? <span className="sg-hint sg-hint--error"><Icon name="circle-alert" size={13} />{error}</span>
        : success ? <span className="sg-hint sg-hint--success"><Icon name="circle-check" size={13} />{success}</span>
        : hint ? <span className="sg-hint">{hint}</span> : null}
    </div>
  );
}

export function Input({ label, hint, error, success, required, icon, kbd, suffix, size = 'md', multiline = false, rows = 3, disabled, id, className = '', ...rest }) {
  const auto = useId();
  const fid = id || 'f' + auto.replace(/:/g, '');
  const cls = ['sg-control', size === 'sm' && 'sg-control--sm', error && 'sg-control--error', !error && success && 'sg-control--success', disabled && 'sg-control--disabled', multiline && 'sg-control--multiline', className].filter(Boolean).join(' ');
  const ctl = (
    <div className={cls}>
      {icon ? <Icon name={icon} size={16} /> : null}
      {multiline
        ? <textarea id={fid} className="sg-input" rows={rows} disabled={disabled} aria-invalid={!!error} {...rest} />
        : <input id={fid} className="sg-input" disabled={disabled} aria-invalid={!!error} {...rest} />}
      {suffix ? <span style={{ color: 'var(--text-3)', font: 'var(--type-sm)' }}>{suffix}</span> : null}
      {kbd ? <span className="sg-kbd">{kbd}</span> : null}
    </div>
  );
  if (!label && !hint && !error && !success) return ctl;
  return <Field label={label} required={required} hint={hint} error={error} success={success} htmlFor={fid}>{ctl}</Field>;
}
