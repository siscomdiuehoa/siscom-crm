import React from 'react';
import { Icon } from './Icon.jsx';
import { Tooltip } from './Tooltip.jsx';

export function IconButton({ icon, label, variant = 'ghost', size = 'md', tooltip = false, className = '', ...rest }) {
  const btn = (
    <button type="button" aria-label={label} className={['sg-btn', 'sg-iconbtn', 'sg-btn--' + variant, size !== 'md' && 'sg-btn--' + size, className].filter(Boolean).join(' ')} {...rest}>
      <Icon name={icon} size={size === 'sm' ? 16 : size === 'lg' ? 20 : 18} />
    </button>
  );
  if (!tooltip) return btn;
  return <Tooltip content={label} placement={typeof tooltip === 'string' ? tooltip : 'top'}>{btn}</Tooltip>;
}
