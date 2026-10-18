import React from 'react';
import { Icon } from '../core/Icon.jsx';

export function Checkbox({ label, checked, defaultChecked, onChange, disabled, name, value, ...rest }) {
  return (
    <label className={'sg-check' + (disabled ? ' sg-check--disabled' : '')}>
      <input type="checkbox" checked={checked} defaultChecked={defaultChecked} onChange={(e) => onChange && onChange(e.target.checked, e)} disabled={disabled} name={name} value={value} {...rest} />
      <span className="sg-check__box"><Icon name="check" size={13} /></span>
      {label}
    </label>
  );
}

export function Radio({ label, checked, defaultChecked, onChange, disabled, name, value }) {
  return (
    <label className={'sg-check' + (disabled ? ' sg-check--disabled' : '')}>
      <input type="radio" checked={checked} defaultChecked={defaultChecked} onChange={(e) => onChange && onChange(value, e)} disabled={disabled} name={name} value={value} />
      <span className="sg-check__box sg-check__box--radio" />
      {label}
    </label>
  );
}

export function Switch({ label, checked, defaultChecked, onChange, disabled }) {
  return (
    <label className={'sg-check' + (disabled ? ' sg-check--disabled' : '')}>
      <input type="checkbox" role="switch" checked={checked} defaultChecked={defaultChecked} onChange={(e) => onChange && onChange(e.target.checked, e)} disabled={disabled} />
      <span className="sg-switch__track" />
      {label}
    </label>
  );
}
