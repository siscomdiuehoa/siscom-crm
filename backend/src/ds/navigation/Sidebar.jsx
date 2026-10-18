import React from 'react';
import { Icon } from '../core/Icon.jsx';
import { Badge, CountBadge } from '../core/Badge.jsx';
import { Avatar } from '../core/Avatar.jsx';
import { IconButton } from '../core/IconButton.jsx';
import { Tooltip } from '../core/Tooltip.jsx';

export function Sidebar({ items = [], active, onSelect, collapsed = false, onToggle, logoSrc, user, footer, className = '' }) {
  return (
    <aside className={'sg-sidebar sg-glass ' + className} data-collapsed={collapsed}>
      <div className="sg-sidebar__brand" style={collapsed ? { justifyContent: 'center', padding: 0 } : undefined}>
        {logoSrc ? (
          collapsed ? <span className="sg-sidebar__mark"><img src={logoSrc} alt="SISCOM" /></span> : <img className="sg-sidebar__logo" src={logoSrc} alt="SISCOM" />
        ) : (
          <span style={{ font: 'var(--fw-bold) 18px/1 var(--font-sans)', letterSpacing: '.04em', color: 'var(--brand-green)' }}>{collapsed ? 'S' : 'SISCOM'}</span>
        )}
        {!collapsed && onToggle ? <IconButton icon="panel-left-close" label="Thu gọn" size="sm" onClick={onToggle} /> : null}
      </div>
      {collapsed && onToggle ? <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 4 }}><IconButton icon="panel-left-open" label="Mở rộng" size="sm" onClick={onToggle} /></div> : null}
      <nav className="sg-sidebar__nav sg-scroll" aria-label="Điều hướng chính">
        {items.map((it, i) => {
          if (it.section) return <div key={'s' + i} className="sg-sidebar__section">{it.section}</div>;
          const btn = (
            <button key={it.id} type="button" className="sg-nav-item" aria-current={active === it.id ? 'page' : undefined} onClick={() => onSelect && onSelect(it.id)}>
              <Icon name={it.icon} size={18} />
              <span className="sg-nav-item__label">{it.label}</span>
              {it.badge != null ? (
                <span className="sg-nav-item__badge">{typeof it.badge === 'number' ? <CountBadge count={it.badge} /> : <Badge tone="cyan" size="sm">{it.badge}</Badge>}</span>
              ) : null}
            </button>
          );
          return collapsed ? <Tooltip key={it.id} content={it.label} placement="right">{btn}</Tooltip> : btn;
        })}
      </nav>
      {footer}
      {user ? (
        <div className="sg-sidebar__foot" style={collapsed ? { justifyContent: 'center' } : undefined}>
          <Avatar name={user.name} src={user.avatar} status="online" size={34} />
          {!collapsed ? (
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ font: 'var(--fw-semibold) var(--fs-sm)/18px var(--font-sans)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.name}</div>
              <div style={{ font: 'var(--type-caption)', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{user.role}</div>
            </div>
          ) : null}
          {!collapsed ? <IconButton icon="settings" label="Cài đặt" size="sm" /> : null}
        </div>
      ) : null}
    </aside>
  );
}

/** Default SISCOM CRM module map (Vietnamese labels, Lucide icons). */
export const SISCOM_NAV = [
  { section: 'Tổng quan' },
  { id: 'dashboard', label: 'Tổng quan điều hành', icon: 'layout-dashboard' },
  { id: 'reports', label: 'Báo cáo & Phân tích', icon: 'chart-pie' },
  { section: 'Kinh doanh' },
  { id: 'customers', label: 'Quản lý khách hàng', icon: 'users' },
  { id: 'pipeline', label: 'Cơ hội kinh doanh', icon: 'target', badge: 8 },
  { id: 'quotes', label: 'Báo giá', icon: 'file-text' },
  { id: 'contracts', label: 'Hợp đồng', icon: 'file-pen-line' },
  { section: 'Vận hành' },
  { id: 'projects', label: 'Quản lý dự án', icon: 'building-2' },
  { id: 'inventory', label: 'Mua hàng & Kho', icon: 'package' },
  { id: 'finance', label: 'Tài chính', icon: 'wallet' },
  { id: 'hr', label: 'Nhân sự', icon: 'id-card' },
  { section: 'AI' },
  { id: 'agents', label: 'Quản lý AI Agent', icon: 'bot', badge: 'Mới' },
  { id: 'office', label: 'Văn phòng AI 3D', icon: 'box' },
];
