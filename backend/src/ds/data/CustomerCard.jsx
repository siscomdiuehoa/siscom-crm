import React from 'react';
import { Icon } from '../core/Icon.jsx';
import { Avatar } from '../core/Avatar.jsx';
import { Badge } from '../core/Badge.jsx';
import { IconButton } from '../core/IconButton.jsx';

const TIER = { 'Chiến lược': 'blue', VIP: 'cyan', 'Tiềm năng': 'warning', 'Thường': 'neutral' };

export function CustomerCard({ name, code, industry, tier, status, contact, address, revenue, opportunities, lastActivity, owner, tags = [], onClick, selected = false, variant = 'glass' }) {
  return (
    <article className={'sg-card ' + (variant === 'solid' ? 'sg-solid' : 'sg-glass') + (onClick ? ' sg-card--interactive' : '')} onClick={onClick} style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16, boxShadow: selected ? 'var(--focus-ring), var(--shadow-glass)' : undefined }}>
      <header style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <Avatar name={name} square size={44} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: 0, font: 'var(--type-h4)', letterSpacing: 'var(--tracking-snug)', textWrap: 'pretty' }}>{name}</h3>
          <div style={{ font: 'var(--type-caption)', color: 'var(--text-3)', marginTop: 2 }}>{[code, industry].filter(Boolean).join(' · ')}</div>
        </div>
        {tier ? <Badge tone={TIER[tier] || 'neutral'}>{tier}</Badge> : null}
      </header>
      {contact || address ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, font: 'var(--type-sm)', color: 'var(--text-2)' }}>
          {contact ? <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Icon name="user-round" size={15} color="var(--text-3)" /><span><b style={{ color: 'var(--text-1)', fontWeight: 500 }}>{contact.name}</b>{contact.title ? ' — ' + contact.title : ''}</span></div> : null}
          {contact && contact.phone ? <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Icon name="phone" size={15} color="var(--text-3)" /><span className="sg-num">{contact.phone}</span></div> : null}
          {contact && contact.email ? <div style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}><Icon name="mail" size={15} color="var(--text-3)" /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{contact.email}</span></div> : null}
          {address ? <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Icon name="map-pin" size={15} color="var(--text-3)" /><span>{address}</span></div> : null}
        </div>
      ) : null}
      {revenue != null || opportunities != null || lastActivity ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 8 }}>
          {[['Doanh thu luỹ kế', revenue], ['Cơ hội mở', opportunities], ['Tương tác', lastActivity]].map(([l, v]) => (
            <div key={l} style={{ padding: '8px 10px', borderRadius: 10, background: 'var(--surface-sunken)' }}>
              <div style={{ font: 'var(--type-micro, 400 11px/14px var(--font-sans))', fontSize: 11, color: 'var(--text-3)' }}>{l}</div>
              <div className="sg-num" style={{ font: 'var(--fw-semibold) var(--fs-sm)/20px var(--font-sans)', color: 'var(--text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v == null ? '—' : v}</div>
            </div>
          ))}
        </div>
      ) : null}
      {tags.length ? <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{tags.map((t) => <Badge key={t} tone="outline" size="sm">{t}</Badge>)}</div> : null}
      <footer style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 12, borderTop: '1px solid var(--border-subtle)' }}>
        {owner ? <><Avatar name={owner} size={24} /><span style={{ font: 'var(--type-caption)', color: 'var(--text-3)', flex: 1 }}>Phụ trách: <span style={{ color: 'var(--text-2)', fontWeight: 500 }}>{owner}</span></span></> : <span style={{ flex: 1 }} />}
        {status ? <Badge tone={status === 'Đang giao dịch' ? 'success' : status === 'Ngừng' ? 'neutral' : 'blue'} dot size="sm">{status}</Badge> : null}
        <span onClick={(e) => e.stopPropagation()} style={{ display: 'flex', gap: 2 }}>
          <IconButton icon="phone" label="Gọi điện" size="sm" />
          <IconButton icon="mail" label="Gửi email" size="sm" />
          <IconButton icon="ellipsis" label="Thêm thao tác" size="sm" />
        </span>
      </footer>
    </article>
  );
}
