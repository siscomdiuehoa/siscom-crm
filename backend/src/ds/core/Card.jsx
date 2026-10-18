import React from 'react';

export function Card({ variant = 'glass', title, subtitle, actions, interactive = false, padded = true, className = '', style, children, ...rest }) {
  const surf = variant === 'solid' ? 'sg-solid' : variant === 'strong' ? 'sg-glass-strong' : variant === 'ai' ? 'sg-glass-ai' : 'sg-glass';
  const cls = ['sg-card', surf, interactive && 'sg-card--interactive', className].filter(Boolean).join(' ');
  const hasHead = title || actions;
  return (
    <section className={cls} style={style} {...rest}>
      {hasHead ? (
        <header className="sg-card__head">
          <div style={{ minWidth: 0 }}>
            {title ? <h3 className="sg-card__title">{title}</h3> : null}
            {subtitle ? <p className="sg-card__sub">{subtitle}</p> : null}
          </div>
          {actions ? <div style={{ display: 'flex', gap: 6, alignItems: 'center', flex: 'none' }}>{actions}</div> : null}
        </header>
      ) : null}
      {padded ? <div className="sg-card__body">{children}</div> : children}
    </section>
  );
}
