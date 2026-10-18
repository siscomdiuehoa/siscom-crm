import React from 'react';

/** Lucide icon (icon-font rendering, stroke 2). name = Lucide kebab-case id, e.g. "layout-dashboard". */
export function Icon({ name, size = 18, color, label, className = '', style, ...rest }) {
  return (
    <i
      className={'sg-icon icon-' + name + (className ? ' ' + className : '')}
      style={{ fontSize: size, width: size, height: size, color, ...style }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      {...rest}
    />
  );
}
