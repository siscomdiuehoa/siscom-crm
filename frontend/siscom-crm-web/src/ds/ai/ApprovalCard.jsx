import React from 'react';
import { Icon } from '../core/Icon.jsx';
import { Avatar } from '../core/Avatar.jsx';
import { Badge } from '../core/Badge.jsx';
import { Button } from '../core/Button.jsx';

function confTone(c) { return c >= 85 ? 'var(--success)' : c >= 65 ? 'var(--warning)' : 'var(--error)'; }

export function ApprovalCard({ agent = 'AI Agent', agentIcon = 'bot', title, summary, confidence, fields = [], steps = [], assignee, time, status = 'pending', onApprove, onReject, onEdit }) {
  return (
    <article className="sg-card sg-glass sg-approval">
      <header style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <Avatar ai square icon={agentIcon} size={36} name={agent} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: 'var(--type-caption)', color: 'var(--text-3)' }}><b style={{ color: 'var(--accent-text)', fontWeight: 600 }}>{agent}</b> đề xuất{time ? ' · ' + time : ''}</div>
          <h3 style={{ margin: '2px 0 0', font: 'var(--type-h4)', letterSpacing: 'var(--tracking-snug)', textWrap: 'pretty' }}>{title}</h3>
        </div>
        {status === 'approved' ? <Badge tone="success" icon="check">Đã duyệt</Badge> : status === 'rejected' ? <Badge tone="error" icon="x">Từ chối</Badge> : <Badge tone="warning" dot>Chờ duyệt</Badge>}
      </header>
      {summary ? <div className="sg-approval__summary"><Icon name="sparkles" size={14} color="var(--accent)" style={{ marginRight: 6, verticalAlign: -2 }} />{summary}</div> : null}
      {fields.length ? (
        <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 12, margin: 0 }}>
          {fields.map((f) => (
            <div key={f.label}><dt style={{ font: 'var(--type-caption)', color: 'var(--text-3)' }}>{f.label}</dt><dd className="sg-num" style={{ margin: '2px 0 0', font: 'var(--fw-semibold) var(--fs-sm)/20px var(--font-sans)' }}>{f.value}</dd></div>
          ))}
        </dl>
      ) : null}
      {confidence != null ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, font: 'var(--type-caption)', color: 'var(--text-3)' }}>
          <span style={{ whiteSpace: 'nowrap' }}>Độ tin cậy</span>
          <div className="sg-progress" style={{ flex: 1 }}><div className="sg-progress__bar" style={{ width: confidence + '%', background: confTone(confidence) }} /></div>
          <b className="sg-num" style={{ color: 'var(--text-1)' }}>{confidence}%</b>
        </div>
      ) : null}
      {steps.length ? (
        <div className="sg-steps">
          {steps.map((s, i) => (
            <React.Fragment key={i}>
              {i ? <Icon name="chevron-right" size={12} /> : null}
              <span className="sg-steps__s" data-state={s.state}><span className="sg-steps__n">{s.state === 'done' ? <Icon name="check" size={11} /> : i + 1}</span>{s.label}</span>
            </React.Fragment>
          ))}
        </div>
      ) : null}
      <footer style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 12, borderTop: '1px solid var(--border-subtle)', flexWrap: 'wrap' }}>
        {assignee ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, font: 'var(--type-caption)', color: 'var(--text-3)', flex: 1, minWidth: 140 }}><Avatar name={assignee} size={22} />Người duyệt: <b style={{ color: 'var(--text-2)', fontWeight: 500 }}>{assignee}</b></span> : <span style={{ flex: 1 }} />}
        {status === 'pending' ? (
          <>
            {onEdit ? <Button variant="ghost" size="sm" icon="pencil" onClick={onEdit}>Chỉnh sửa</Button> : null}
            <Button variant="secondary" size="sm" onClick={onReject}>Từ chối</Button>
            <Button size="sm" icon="check" onClick={onApprove}>Phê duyệt</Button>
          </>
        ) : null}
      </footer>
    </article>
  );
}
