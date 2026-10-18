import React from 'react';

export function Tooltip({ content, placement = 'top', kbd, open, children }) {
  const cls = 'sg-tip' + (placement !== 'top' ? ' sg-tip--' + placement : '');
  return (
    <span className={cls} data-open={open ? 'true' : undefined}>
      {children}
      <span className="sg-tip__bubble" role="tooltip">
        {content}
        {kbd ? <span className="sg-tip__kbd">{kbd}</span> : null}
      </span>
    </span>
  );
}
