import React from 'react';
import { Icon } from './Icon.jsx';

export function Button({ variant = 'primary', size = 'md', icon, iconRight, loading = false, block = false, disabled, className = '', type = 'button', children, ...rest }) {
  const cls = ['sg-btn', 'sg-btn--' + variant, size !== 'md' && 'sg-btn--' + size, block && 'sg-btn--block', className].filter(Boolean).join(' ');
  const is = size === 'sm' ? 15 : size === 'lg' ? 19 : 17;
  return (
    <button type={type} className={cls} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <span className="sg-btn__spin" /> : icon ? <Icon name={icon} size={is} /> : null}
      {children}
      {iconRight ? <Icon name={iconRight} size={is} /> : null}
    </button>
  );
}
