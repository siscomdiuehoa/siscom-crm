import React from 'react';
import { Icon } from './Icon.jsx';

export function Badge({ tone = 'neutral', size = 'md', dot = false, icon, className = '', children, ...rest }) {
  const cls = ['sg-badge', tone !== 'neutral' && 'sg-badge--' + tone, size === 'sm' && 'sg-badge--sm', className].filter(Boolean).join(' ');
  return (
    <span className={cls} {...rest}>
      {dot ? <span className="sg-badge__dot" /> : null}
      {icon ? <Icon name={icon} size={12} /> : null}
      {children}
    </span>
  );
}

export function CountBadge({ count, max = 99 }) {
  if (!count) return null;
  return <span className="sg-count">{count > max ? max + '+' : count}</span>;
}
