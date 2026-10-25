import React from 'react';
import { Badge, Button, Avatar, Icon } from '../../ds/index.js';
import * as U from '../../data/util.js';
import { useCustomerApiState } from './useCustomerApi.js';
import { customerDisplayCode } from './customerApiUi.js';
import { ApiErrorBox } from './ApiListStatus.jsx';
import { CustomerFormDrawer } from './CustomerForm.jsx';

function InfoRow({ icon, label, children }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '20px 120px minmax(0,1fr)', gap: 10, alignItems: 'start', padding: '9px 0', borderBottom: '1px solid var(--border-subtle)', font: 'var(--type-sm)' }}>
      <Icon name={icon} size={15} color="var(--text-3)" style={{ marginTop: 3 }} />
      <span style={{ color: 'var(--text-3)' }}>{label}</span>
      <span style={{ color: 'var(--text-1)', overflowWrap: 'anywhere' }}>{children || <span style={{ color: 'var(--text-3)' }}>—</span>}</span>
    </div>
  );
}

// Customer detail + edit when the customer API flag is ON. Data comes ONLY from GET /customers/:id (no demo/localStorage records);
// related modules (contacts, quotes, ...) are not part of the customer API yet and are intentionally not shown.
export default function CustomerApiDetail({ ui, id }) {
  const ctl = ui.customerApi;
  const s = useCustomerApiState(ctl);
  const [edit, setEdit] = React.useState(false);
  const load = React.useCallback(() => ctl.loadDetail(id), [ctl, id]);
  React.useEffect(() => { setEdit(false); load(); }, [load]);
  const back = <div><Button variant="ghost" size="sm" icon="arrow-left" onClick={() => ui.navigate('/customers')}>Danh sách khách hàng</Button></div>;
  const d = s.detail;
  if (d.id !== id || d.status === 'idle' || d.status === 'loading') {
    return <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>{back}<div className="sg-card sg-solid" role="status" aria-live="polite" style={{ padding: 24, display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-2)' }}><span className="sg-btn__spin" />Đang tải thông tin khách hàng…</div></div>;
  }
  if (d.status === 'error') {
    const e = d.error;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {back}
        <ApiErrorBox error={e} onRetry={load} />
        {e.kind === 'not_found' ? <div style={{ font: 'var(--type-sm)', color: 'var(--text-2)' }}>Khách hàng không tồn tại hoặc không còn truy cập được.</div> : null}
      </div>
    );
  }
  const c = d.customer;
  const canEdit = typeof ui.can === 'function' && !!ui.can('customer.update', c); // fail-closed: no `can` / no server grant => no edit
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {back}
      <section className="sg-card sg-glass" style={{ padding: 20, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <Avatar name={c.short || c.name} square size={56} />
        <div style={{ flex: '1 1 280px', minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}><span style={{ font: 'var(--type-mono)', color: 'var(--text-3)' }}>{customerDisplayCode(c)}</span>{c.tier ? <Badge tone={U.TIER_TONE[c.tier]}>{c.tier}</Badge> : null}{c.status ? <Badge dot tone={U.STATUS_TONE[c.status]}>{c.status}</Badge> : null}</div>
          <h2 style={{ margin: '4px 0 2px', font: 'var(--type-h2)', letterSpacing: 'var(--tracking-snug)', textWrap: 'pretty' }}>{c.name}</h2>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', font: 'var(--type-sm)', color: 'var(--text-2)' }}>{[c.industry, c.city].filter(Boolean).map((v, i) => <span key={i}>{(i ? '· ' : '') + v}</span>)}<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{c.owner ? <><Avatar name={c.owner} size={20} />Phụ trách: <b style={{ fontWeight: 500, color: 'var(--text-1)' }}>{c.owner}</b></> : 'Chưa phân công phụ trách'}</span></div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="secondary" icon="refresh-cw" onClick={load}>Tải lại</Button>
          <Button icon="pencil" disabled={!canEdit} onClick={() => canEdit && setEdit(true)}>Sửa thông tin</Button>
        </div>
      </section>
      <section className="sg-card sg-solid" style={{ padding: '16px 20px 8px' }}>
        <h3 style={{ margin: '0 0 4px', font: 'var(--type-h4)' }}>Thông tin doanh nghiệp</h3>
        <InfoRow icon="hash" label="Mã số thuế">{c.taxId ? <span style={{ font: 'var(--type-mono)' }}>{c.taxId}</span> : null}</InfoRow>
        <InfoRow icon="map-pin" label="Địa chỉ">{[c.address, c.city].filter(Boolean).join(', ') || null}</InfoRow>
        <InfoRow icon="phone" label="Điện thoại">{c.phone}</InfoRow>
        <InfoRow icon="mail" label="Email">{c.email ? <a href={'mailto:' + c.email}>{c.email}</a> : null}</InfoRow>
        <InfoRow icon="globe" label="Website">{c.website ? <a href={'https://' + c.website.replace(/^https?:\/\//, '')} target="_blank" rel="noreferrer">{c.website}</a> : null}</InfoRow>
        <InfoRow icon="briefcase" label="Ngành nghề">{c.industry || null}</InfoRow>
        <InfoRow icon="megaphone" label="Nguồn">{c.source || null}</InfoRow>
        <InfoRow icon="calendar" label="Ngày tạo">{c.createdAt ? U.dmy(String(c.createdAt).slice(0, 10)) : null}</InfoRow>
        {c.note ? <InfoRow icon="sticky-note" label="Ghi chú">{c.note}</InfoRow> : null}
        <div style={{ height: 8 }} />
      </section>
      <CustomerFormDrawer open={edit && canEdit} initial={c} ui={ui} onClose={() => setEdit(false)} onSaved={() => setEdit(false)} />
    </div>
  );
}
