import React, { useEffect, useRef } from 'react';
import { Icon } from '../core/Icon.jsx';
import { IconButton } from '../core/IconButton.jsx';
import { CountBadge } from '../core/Badge.jsx';
import { Avatar } from '../core/Avatar.jsx';
import { Button } from '../core/Button.jsx';

export function GlobalSearch({ value, onChange, onSubmit, placeholder = 'Tìm khách hàng, dự án, hợp đồng…', className = '' }) {
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); ref.current && ref.current.focus(); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  return (
    <form className={'sg-control sg-search ' + className} role="search" onSubmit={(e) => { e.preventDefault(); onSubmit && onSubmit(value); }}>
      <Icon name="search" size={16} />
      <input ref={ref} className="sg-input" value={value} onChange={(e) => onChange && onChange(e.target.value)} placeholder={placeholder} aria-label="Tìm kiếm toàn hệ thống" />
      <span className="sg-kbd">⌘K</span>
    </form>
  );
}

export function Topbar({ title, breadcrumbs = [], search, onSearch, notifications = 0, onNotifications, theme = 'light', onToggleTheme, onAskAI, onMenu, user, actions, className = '' }) {
  return (
    <header className={'sg-topbar sg-glass ' + className}>
      {onMenu ? <IconButton icon="menu" label="Mở menu" onClick={onMenu} /> : null}
      <div className="sg-topbar__title">
        {breadcrumbs.length ? (
          <div className="sg-crumbs">
            {breadcrumbs.map((b, i) => (
              <React.Fragment key={i}>{i ? <Icon name="chevron-right" size={12} /> : null}<span>{b}</span></React.Fragment>
            ))}
          </div>
        ) : null}
        <h1 className="sg-topbar__h">{title}</h1>
      </div>
      <GlobalSearch value={search} onChange={onSearch} />
      <div className="sg-topbar__actions">
        {actions}
        {onAskAI ? <Button variant="ai" size="sm" icon="sparkles" onClick={onAskAI}><span className="sg-ai-label">Trợ lý AI</span></Button> : null}
        {onToggleTheme ? <IconButton icon={theme === 'dark' ? 'sun' : 'moon'} label={theme === 'dark' ? 'Giao diện sáng' : 'Giao diện tối'} onClick={onToggleTheme} tooltip="bottom" /> : null}
        <span className="sg-bell"><IconButton icon="bell" label="Thông báo" onClick={onNotifications} tooltip="bottom" /><CountBadge count={notifications} /></span>
        {user ? <Avatar name={user.name} src={user.avatar} size={34} style={{ marginLeft: 6 }} /> : null}
      </div>
    </header>
  );
}
