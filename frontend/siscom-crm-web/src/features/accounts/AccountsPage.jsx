import React from 'react';
import { Avatar, Badge, Button, EmptyState, Icon, IconButton, Input, Select } from '../../ds/index.js';
import { useCustomerApiState } from '../customers/useCustomerApi.js';
import { ACTION_ICON, ACTION_LABEL, LOGIN_LABEL, LOGIN_TONE, ROLE_FILTERS, STATUS_FILTERS, accountErrorMessage, roleLabel, rowActions } from './accountsModel.js';
import { AccountDialog } from './AccountDialogs.jsx';

// P1 (docs/P1_ACCOUNT_ADMIN_DESIGN.md §7): trang Tài khoản (#/accounts) cho Quản trị CRM. Bố cục theo bản xem thử Owner duyệt 23/11:
// dòng mô tả, hàng lọc (tìm / vai trò / trạng thái), nút thêm + số đếm, bảng 6 cột (điện thoại: thẻ). Dữ liệu chỉ từ API /accounts.
const cell = { padding: '10px 8px', borderBottom: '1px solid var(--border-subtle)', verticalAlign: 'middle', font: 'var(--type-sm)' };
const sub = { font: 'var(--type-caption)', color: 'var(--text-3)', overflowWrap: 'anywhere' };
const hidden = { position: 'absolute', left: -9999, width: 1, height: 1, overflow: 'hidden' };
const SEARCH_DELAY_MS = 250;

const RoleTags = ({ r }) => (r.roles.length ? <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>{r.roles.map((c) => <Badge key={c} size="sm" tone={c === 'crm_admin' || c === 'admin' ? 'info' : 'neutral'}>{roleLabel(c)}</Badge>)}</span> : <span style={sub}>Chưa có vai trò</span>);
const LoginBadge = ({ r }) => <Badge size="sm" dot tone={LOGIN_TONE[r.login] || 'neutral'}>{LOGIN_LABEL[r.login] || r.login}</Badge>;
const Who = ({ r, avatar = true }) => (
  <div style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0 }}>
    {avatar ? <Avatar name={r.fullName} size={32} /> : null}
    <div style={{ minWidth: 0 }}>
      <div style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{r.fullName}{r.isSelf ? <span style={{ marginLeft: 6, padding: '1px 6px', borderRadius: 6, font: 'var(--type-caption)', fontWeight: 500, color: 'var(--primary-text, var(--primary))', background: 'var(--primary-soft)' }}>bạn</span> : null}</div>
      <div style={sub}>{r.email || 'Chưa có email'}</div>
    </div>
  </div>
);

// Nút "⋯" + menu của MỘT dòng. Dòng hệ thống: chỉ ghi chú, không có nút. Mục bị tắt hiện kèm lý do (không ẩn) để người dùng hiểu vì sao.
// Bàn phím (WAI-ARIA menu button): mũi tên xuống trên nút "⋯" mở menu; mở => focus mục đầu; mũi tên lên / xuống đi vòng, Home / End;
// Escape đóng và trả focus về nút; Tab đóng. Mục bị tắt dùng aria-disabled (vẫn nhận focus để đọc được lý do), bấm / Enter không làm gì.
function RowMenu({ r, open, onToggle, onPick }) {
  const ref = React.useRef(null);
  const trigger = React.useRef(null); // khung bọc nút "⋯" (IconButton không chuyển tiếp ref)
  const itemEls = React.useRef([]);
  const focusTrigger = () => { const b = trigger.current && trigger.current.firstChild; if (b && typeof b.focus === 'function') b.focus(); };
  const close = (back) => { onToggle(false); if (back) focusTrigger(); };
  React.useEffect(() => {
    if (!open) return undefined;
    const first = itemEls.current.filter(Boolean)[0]; if (first) first.focus();
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) onToggle(false); };
    document.addEventListener('mousedown', h);
    return () => { document.removeEventListener('mousedown', h); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (r.isSystem) return <span style={sub}>Tài khoản hệ thống</span>;
  const a = rowActions(r);
  const kinds = ['edit', 'role', 'resetPassword', a.enable.enabled ? 'enable' : 'disable'];
  const onMenuKey = (e) => {
    const els = itemEls.current.filter(Boolean); if (!els.length) return;
    const i = els.indexOf(document.activeElement);
    const go = (j) => { e.preventDefault(); els[(j + els.length) % els.length].focus(); };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i < 0 ? els.length - 1 : i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(els.length - 1);
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === 'Tab') close(false);
  };
  // Chọn mục: trả focus về nút "⋯" TRƯỚC khi mở hộp thoại, để khi hộp thoại đóng focus quay lại đúng dòng này.
  const choose = (k) => { if (!a[k].enabled) return; focusTrigger(); onPick(k); };
  itemEls.current = [];
  return (
    <span style={{ display: 'inline-flex', position: 'relative' }} ref={ref}>
      <span ref={trigger} style={{ display: 'inline-flex' }}>
        <IconButton icon="ellipsis" label={'Thao tác với ' + r.fullName} size="sm" aria-haspopup="menu" aria-expanded={open} onClick={() => onToggle(!open)}
          onKeyDown={(e) => { if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); onToggle(true); } }} />
      </span>
      {open ? (
        <div className="sg-menu sg-glass-strong" role="menu" aria-label={'Thao tác với ' + r.fullName} onKeyDown={onMenuKey} style={{ right: 0, left: 'auto', top: '100%', minWidth: 220, zIndex: 30, textAlign: 'left', whiteSpace: 'normal' }}>
          {kinds.map((k, i) => (
            <button key={k} type="button" role="menuitem" className="sg-menu__item" aria-disabled={a[k].enabled ? undefined : 'true'} tabIndex={-1} ref={(el) => { itemEls.current[i] = el; }} onClick={() => choose(k)}
              style={{ width: '100%', border: 0, background: 'transparent', font: 'inherit', textAlign: 'left', cursor: a[k].enabled ? 'pointer' : 'not-allowed', opacity: a[k].enabled ? 1 : 0.6, color: k === 'disable' && a[k].enabled ? 'var(--error-text)' : 'inherit', borderTop: k === 'enable' || k === 'disable' ? '1px solid var(--border-subtle)' : 0 }}>
              <Icon name={ACTION_ICON[k]} size={15} />
              <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}><span>{ACTION_LABEL[k]}</span>{a[k].reason ? <small style={{ font: 'var(--type-caption)', color: 'var(--text-3)' }}>{a[k].reason}</small> : null}</span>
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}

export default function AccountsPage({ ui }) {
  const accounts = ui.customerApi.accounts;
  const s = useCustomerApiState(accounts);
  const [f, setF] = React.useState({ q: '', role: '', status: '' });
  const [text, setText] = React.useState('');
  const [menu, setMenu] = React.useState(null); // id của dòng đang mở menu
  const [dlg, setDlg] = React.useState(null); // { kind, row }
  React.useEffect(() => { accounts.loadMeta(); }, [accounts]);
  React.useEffect(() => { accounts.load(f); }, [accounts, f]);
  // Ô tìm: chờ gõ xong rồi mới gọi máy chủ; dưới 2 ký tự coi như không tìm (máy chủ từ chối từ khoá 1 ký tự).
  React.useEffect(() => {
    const t = setTimeout(() => { const q = text.trim().length >= 2 ? text.trim() : ''; setF((x) => (x.q === q ? x : { ...x, q })); }, SEARCH_DELAY_MS);
    return () => clearTimeout(t);
  }, [text]);
  const l = s.list; const mobile = !!ui.mobile;
  const setFilter = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const pick = (r) => (kind) => { setMenu(null); setDlg({ kind, row: r }); };
  const menuOf = (r) => <RowMenu r={r} open={menu === r.id} onToggle={(v) => setMenu(v ? r.id : null)} onPick={pick(r)} />;
  const short = text.trim().length === 1;
  return (
    <section className="sg-card sg-solid" style={{ padding: mobile ? 12 : 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ margin: 0, font: 'var(--type-sm)', color: 'var(--text-2)' }}>Thêm nhân viên, đổi thông tin, vai trò và mật khẩu. Mọi thay đổi có hiệu lực ngay và được ghi nhật ký.</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ flex: '2 1 240px', minWidth: 0 }}><Input icon="search" size="sm" type="search" placeholder="Tìm theo tên, email, mã…" aria-label="Tìm tài khoản" value={text} onChange={(e) => setText(e.target.value)} /></div>
        <div role="group" aria-label="Lọc vai trò" style={{ flex: '1 1 160px', maxWidth: mobile ? 'none' : 220 }}><Select size="sm" value={f.role} onChange={setFilter('role')} options={ROLE_FILTERS} /></div>
        <div role="group" aria-label="Lọc trạng thái" style={{ flex: '1 1 160px', maxWidth: mobile ? 'none' : 220 }}><Select size="sm" value={f.status} onChange={setFilter('status')} options={STATUS_FILTERS} /></div>
      </div>
      {short ? <div role="status" style={sub}>Nhập ít nhất 2 ký tự để tìm.</div> : null}
      {l.status !== 'error' ? (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <Button icon="plus" onClick={() => setDlg({ kind: 'create', row: null })}>Thêm nhân viên</Button>
          {l.status === 'ready' ? <span style={{ font: 'var(--type-sm)', color: 'var(--text-3)' }}>{l.items.length + ' / ' + l.total + ' tài khoản'}</span> : null}
        </div>
      ) : null}
      {l.status === 'loading' || l.status === 'idle' ? <div role="status" style={{ color: 'var(--text-2)', padding: '12px 0' }}>Đang tải danh sách tài khoản…</div> : null}
      {l.status === 'error' ? (
        <div role="alert" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '10px 14px', borderRadius: 12, background: 'var(--error-soft)', border: '1px solid var(--error-border)', color: 'var(--error-text)' }}>
          <Icon name="circle-alert" size={16} /><span style={{ flex: '1 1 220px', minWidth: 0 }}>{accountErrorMessage(l.error)}</span>
          <Button size="sm" variant="secondary" onClick={() => accounts.load(f)}>Thử lại</Button>
        </div>
      ) : null}
      {l.status === 'ready' && l.refreshError ? <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', font: 'var(--type-sm)', color: 'var(--warning-text, var(--text-2))' }}><span>Không tải lại được danh sách — dữ liệu đang hiển thị có thể đã cũ.</span><Button size="sm" variant="secondary" onClick={() => accounts.reload()}>Thử lại</Button></div> : null}
      {l.status === 'ready' && !l.items.length ? <EmptyState compact icon="users" title="Không có tài khoản nào khớp." description="Thử bỏ bớt điều kiện lọc hoặc từ khoá." /> : null}
      {l.status === 'ready' && l.items.length ? (
        mobile ? (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {l.items.map((r) => (
              <li key={r.id} className="sg-card sg-solid" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', justifyContent: 'space-between' }}><Who r={r} avatar={false} /><span style={{ flex: 'none' }}>{menuOf(r)}</span></div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><span style={{ font: 'var(--type-mono)', color: 'var(--text-3)' }}>{r.code}</span><RoleTags r={r} /><LoginBadge r={r} />{r.departmentName ? <span style={sub}>{r.departmentName}</span> : null}</div>
              </li>
            ))}
          </ul>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ textAlign: 'left', color: 'var(--text-3)', font: 'var(--type-caption)' }}>
              {['Mã', 'Nhân viên', 'Phòng ban', 'Vai trò', 'Đăng nhập'].map((h) => <th key={h} scope="col" style={{ ...cell, fontWeight: 600 }}>{h}</th>)}
              <th scope="col" style={{ ...cell, position: 'relative' }}><span style={hidden}>Thao tác</span></th>
            </tr></thead>
            <tbody>{l.items.map((r) => (
              <tr key={r.id}>
                <td style={{ ...cell, whiteSpace: 'nowrap', font: 'var(--type-mono)', color: 'var(--text-2)' }}>{r.code}</td>
                <td style={{ ...cell, maxWidth: 320 }}><Who r={r} /></td>
                <td style={cell}>{r.departmentName || <span style={sub}>—</span>}{r.positionTitle ? <div style={sub}>{r.positionTitle}</div> : null}</td>
                <td style={cell}><RoleTags r={r} /></td>
                <td style={cell}><LoginBadge r={r} /></td>
                <td style={{ ...cell, whiteSpace: 'nowrap', textAlign: 'right' }}>{menuOf(r)}</td>
              </tr>
            ))}</tbody>
          </table>
        )
      ) : null}
      {l.status === 'ready' && l.more === 'error' && l.moreError ? <div role="alert" style={{ font: 'var(--type-sm)', color: 'var(--error-text)' }}>{accountErrorMessage(l.moreError)}</div> : null}
      {l.status === 'ready' && l.page < l.totalPages ? <div style={{ display: 'flex', justifyContent: 'center' }}><Button variant="secondary" size="sm" loading={l.more === 'loading'} onClick={() => accounts.loadMore()}>Tải thêm</Button></div> : null}
      {dlg ? <AccountDialog key={dlg.kind + ':' + (dlg.row ? dlg.row.id : 'new')} ui={ui} kind={dlg.kind} row={dlg.row} onClose={() => setDlg(null)} /> : null}
    </section>
  );
}

// Cổng của route #/accounts: không có access.approve (gõ thẳng địa chỉ) => trang "không có quyền", KHÔNG gọi máy chủ.
export function AccountsRoute({ ui, allowed }) {
  if (!allowed) return <div className="sg-card sg-solid"><EmptyState icon="lock" title="Không có quyền quản lý tài khoản" description="Chỉ Quản trị CRM mới mở được trang này." action={<Button onClick={() => ui.navigate('/customers')}>Về danh sách khách hàng</Button>} /></div>;
  return <AccountsPage ui={ui} />;
}
