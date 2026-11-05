import React from 'react';
import { Badge, Button, Avatar, Icon, Tabs } from '../../ds/index.js';
import * as U from '../../data/util.js';
import { useCustomerApiState } from './useCustomerApi.js';
import { customerDisplayCode } from './customerApiUi.js';
import { ApiErrorBox } from './ApiListStatus.jsx';
import { CustomerFormDrawer } from './CustomerForm.jsx';
import { ActivitiesPanel } from '../activities/ActivitiesPanel.jsx';

function InfoRow({ icon, label, children }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '20px 120px minmax(0,1fr)', gap: 10, alignItems: 'start', padding: '9px 0', borderBottom: '1px solid var(--border-subtle)', font: 'var(--type-sm)' }}>
      <Icon name={icon} size={15} color="var(--text-3)" style={{ marginTop: 3 }} />
      <span style={{ color: 'var(--text-3)' }}>{label}</span>
      <span style={{ color: 'var(--text-1)', overflowWrap: 'anywhere' }}>{children || <span style={{ color: 'var(--text-3)' }}>—</span>}</span>
    </div>
  );
}

// B1.4: một người liên hệ (người chính) từ GET /customers/:id/contacts; SĐT hiển thị là SĐT CÔNG TY (không có trường SĐT riêng cho người liên hệ).
function ContactValue({ st, phone }) {
  if (st.status === 'idle' || st.status === 'loading') return <span style={{ color: 'var(--text-3)' }}>Đang tải…</span>;
  if (st.status === 'error') return <span style={{ color: 'var(--text-3)' }}>{st.error && st.error.denied ? 'Không có quyền xem người liên hệ' : 'Chưa tải được người liên hệ'}</span>;
  if (!st.item) return null;
  return <span><b style={{ fontWeight: 500 }}>{st.item.fullName}</b>{phone ? <span style={{ color: 'var(--text-2)' }}>{' · ' + phone + ' (SĐT công ty)'}</span> : null}</span>;
}

// Customer detail + edit when the customer API flag is ON. Data comes ONLY from GET /customers/:id (no demo/localStorage records)
// plus, B1.4, the primary contact (GET /customers/:id/contacts) when the server granted contact.read; quotes/... are not shown.
// B3 A7: tab Người liên hệ = danh sách liên hệ của khách (GET /customers/:id/contacts, đã có), chỉ đọc.
function ContactsPanel({ ui, id }) {
  const actl = ui.customerApi.activities;
  const s = useCustomerApiState(actl);
  React.useEffect(() => { actl.loadContacts(id); }, [actl, id]);
  const cs = s.contacts.customerId === id ? s.contacts : { status: 'loading', items: [], error: null };
  return (
    <section className="sg-card sg-solid" style={{ padding: '16px 20px 8px' }}>
      {cs.status === 'loading' || cs.status === 'idle' ? <div role="status" style={{ color: 'var(--text-2)', padding: '8px 0 12px' }}>Đang tải người liên hệ…</div> : null}
      {cs.status === 'error' ? <ApiErrorBox error={cs.error} onRetry={() => actl.loadContacts(id)} /> : null}
      {cs.status === 'ready' && !cs.items.length ? <div style={{ color: 'var(--text-3)', padding: '8px 0 12px' }}>Chưa có người liên hệ.</div> : null}
      {cs.status === 'ready' ? cs.items.map((c) => (
        <InfoRow key={c.id} icon="contact" label={c.isPrimary ? 'Liên hệ chính' : 'Liên hệ'}>
          <span><b style={{ fontWeight: 500 }}>{c.fullName}</b>{[c.title, c.phone, c.email].filter(Boolean).map((v) => ' · ' + v).join('')}</span>
        </InfoRow>
      )) : null}
      <div style={{ height: 8 }} />
    </section>
  );
}

export default function CustomerApiDetail({ ui, id }) {
  const ctl = ui.customerApi;
  const s = useCustomerApiState(ctl);
  const [edit, setEdit] = React.useState(false);
  const load = React.useCallback(() => ctl.loadDetail(id), [ctl, id]);
  React.useEffect(() => { setEdit(false); load(); }, [load]);
  const back = <div><Button variant="ghost" size="sm" icon="arrow-left" onClick={() => ui.navigate('/customers')}>Danh sách khách hàng</Button></div>;
  const d = s.detail;
  const canReadContact = typeof ui.can === 'function' && !!ui.can('contact.read'); // fail-closed; server still checks scope (OWN/DEPARTMENT/ALL)
  const detailReady = d.id === id && d.status === 'ready';
  React.useEffect(() => { if (canReadContact && detailReady) ctl.loadContact(id); }, [ctl, id, canReadContact, detailReady]);
  const ct = s.contact && s.contact.id === id ? s.contact : { status: 'idle', item: null, error: null };
  const contactName = ct.status === 'ready' && ct.item ? ct.item.fullName : '';
  // B3 A7: tab Hoạt động chỉ khi server cấp activity.read (fail-closed); không quyền => trang như trước, không gọi /activities.
  const actl = ctl.activities;
  const canReadActivity = !!actl && typeof ui.can === 'function' && !!ui.can('activity.read');
  const acts = useCustomerApiState(canReadActivity ? actl : null);
  const [tab, setTab] = React.useState('info');
  React.useEffect(() => { setTab('info'); }, [id]);
  React.useEffect(() => { if (canReadActivity && detailReady) actl.load(id, {}); }, [actl, id, canReadActivity, detailReady]);
  const actCount = acts && acts.list.customerId === id && acts.list.status === 'ready' ? acts.list.total : null;
  const formInitial = React.useMemo(() => (d.customer ? { ...d.customer, contactName } : null), [d.customer, contactName]);
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
  // QA I-1: với contact.read, chỉ mở sửa khi người liên hệ đã tải xong (ready/error) — tên về muộn sẽ khởi tạo lại biểu mẫu và mất bản nháp.
  const contactSettled = !canReadContact || ct.status === 'ready' || ct.status === 'error';
  const canEdit = typeof ui.can === 'function' && !!ui.can('customer.update', c) && contactSettled; // fail-closed: no `can` / no server grant => no edit
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
      {canReadActivity ? <Tabs variant="line" value={tab} onChange={setTab} items={[{ id: 'info', label: 'Thông tin', icon: 'building-2' }, { id: 'activities', label: 'Hoạt động', icon: 'list-checks', count: actCount }].concat(canReadContact ? [{ id: 'contacts', label: 'Người liên hệ', icon: 'contact' }] : [])} /> : null}
      {canReadActivity && tab === 'activities' ? <ActivitiesPanel ui={ui} customerId={id} /> : null}
      {canReadActivity && tab === 'contacts' && canReadContact ? <ContactsPanel ui={ui} id={id} /> : null}
      {!canReadActivity || tab === 'info' ? <section className="sg-card sg-solid" style={{ padding: '16px 20px 8px' }}>
        <h3 style={{ margin: '0 0 4px', font: 'var(--type-h4)' }}>Thông tin doanh nghiệp</h3>
        <InfoRow icon="hash" label="Mã số thuế">{c.taxId ? <span style={{ font: 'var(--type-mono)' }}>{c.taxId}</span> : null}</InfoRow>
        <InfoRow icon="map-pin" label="Địa chỉ">{[c.address, c.city].filter(Boolean).join(', ') || null}</InfoRow>
        {canReadContact ? <InfoRow icon="contact" label="Người liên hệ">{ct.status === 'ready' && !ct.item ? null : <ContactValue st={ct} phone={c.phone} />}</InfoRow> : null}
        <InfoRow icon="phone" label="Điện thoại">{c.phone}</InfoRow>
        <InfoRow icon="mail" label="Email">{c.email ? <a href={'mailto:' + c.email}>{c.email}</a> : null}</InfoRow>
        <InfoRow icon="globe" label="Website">{c.website ? <a href={'https://' + c.website.replace(/^https?:\/\//, '')} target="_blank" rel="noreferrer">{c.website}</a> : null}</InfoRow>
        <InfoRow icon="briefcase" label="Ngành nghề">{c.industry || null}</InfoRow>
        <InfoRow icon="megaphone" label="Nguồn">{c.source || null}</InfoRow>
        <InfoRow icon="calendar" label="Ngày tạo">{c.createdAt ? U.dmyVN(c.createdAt) : null}</InfoRow>
        {c.note ? <InfoRow icon="sticky-note" label="Ghi chú">{c.note}</InfoRow> : null}
        <div style={{ height: 8 }} />
      </section> : null}
      <CustomerFormDrawer open={edit && canEdit} initial={formInitial} ui={ui} onClose={() => setEdit(false)} onSaved={() => setEdit(false)} />
    </div>
  );
}
