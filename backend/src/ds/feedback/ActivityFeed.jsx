import React from 'react';
import { Icon } from '../core/Icon.jsx';
import { Badge } from '../core/Badge.jsx';

const TONE = {
  blue: ['var(--primary-soft)', 'var(--primary)'], success: ['var(--success-soft)', 'var(--success)'], warning: ['var(--warning-soft)', 'var(--warning)'],
  error: ['var(--error-soft)', 'var(--error)'], ai: ['var(--accent-soft)', 'var(--accent)'], neutral: ['var(--neutral-soft)', 'var(--text-2)'],
};

export function ActivityFeed({ items = [], dense = false }) {
  return (
    <ul className="sg-feed">
      {items.map((it, i) => {
        const t = TONE[it.ai ? 'ai' : it.tone || 'neutral'];
        return (
          <li key={it.id || i} className="sg-feed__item" style={{ animationDelay: i * 40 + 'ms', padding: dense ? '8px 0' : undefined }}>
            <span className="sg-feed__icon" style={{ background: it.ai ? 'var(--ai-gradient)' : t[0], color: it.ai ? '#fff' : t[1] }}><Icon name={it.icon || (it.ai ? 'bot' : 'circle')} size={16} /></span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <p className="sg-feed__text">{it.text}</p>
              <div className="sg-feed__meta">
                <span>{it.time}</span>
                {it.ai ? <Badge tone="cyan" size="sm">AI</Badge> : null}
                {it.tag ? <Badge size="sm">{it.tag}</Badge> : null}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
