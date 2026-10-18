import React from 'react';
import { Icon } from '../core/Icon.jsx';
import { Badge } from '../core/Badge.jsx';
import { Button } from '../core/Button.jsx';
import { Switch } from '../forms/Checkbox.jsx';
import { AgentStatus } from './AgentStatus.jsx';

export function AgentCard({ name, role, icon = 'bot', status = 'active', model, department, tasks, accuracy, latency, currentTask, progress, enabled = true, onToggle, onOpen, selected = false }) {
  const idle = status === 'paused' || status === 'offline' || !enabled;
  return (
    <article className={'sg-card sg-glass sg-agent' + (onOpen ? ' sg-card--interactive' : '')} onClick={onOpen} style={selected ? { boxShadow: 'var(--focus-ring), var(--shadow-glass)' } : undefined}>
      <header style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <span className={'sg-agent__tile' + (idle ? ' sg-agent__tile--idle' : '')}><Icon name={icon} size={22} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: 0, font: 'var(--type-h4)', letterSpacing: 'var(--tracking-snug)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</h3>
          <div style={{ font: 'var(--type-caption)', color: 'var(--text-3)', marginTop: 2 }}>{role}</div>
        </div>
        {onToggle ? <span onClick={(e) => e.stopPropagation()}><Switch checked={enabled} onChange={onToggle} /></span> : null}
      </header>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <AgentStatus status={enabled ? status : 'paused'} />
        {department ? <Badge size="sm" tone="outline">{department}</Badge> : null}
      </div>
      {currentTask ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, font: 'var(--type-caption)' }}>
            <span style={{ color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{currentTask}</span>
            {progress != null ? <span className="sg-num" style={{ color: 'var(--text-3)' }}>{progress}%</span> : null}
          </div>
          {progress != null ? <div className="sg-progress sg-progress--ai"><div className="sg-progress__bar" style={{ width: progress + '%' }} /></div> : null}
        </div>
      ) : null}
      <div className="sg-agent__stats">
        <div className="sg-agent__stat"><b>{tasks ?? '—'}</b><span>Tác vụ hôm nay</span></div>
        <div className="sg-agent__stat"><b>{accuracy != null ? accuracy + '%' : '—'}</b><span>Độ chính xác</span></div>
        <div className="sg-agent__stat"><b>{latency ?? '—'}</b><span>Phản hồi TB</span></div>
      </div>
      <footer style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        {model ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: 'var(--type-caption)', color: 'var(--text-3)' }}><Icon name="cpu" size={13} />{model}</span> : <span />}
        {onOpen ? <Button variant="ghost" size="sm" iconRight="arrow-up-right">Chi tiết</Button> : null}
      </footer>
    </article>
  );
}
