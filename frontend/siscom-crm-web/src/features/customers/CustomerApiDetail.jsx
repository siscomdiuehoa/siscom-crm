import React from 'react';
import { Badge, Button, Avatar, Icon, Tabs, Modal, Input, Checkbox, IconButton } from '../../ds/index.js';
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

// FV-3: hộp thêm / sửa người liên hệ. Sửa gửi CHỈ trường người dùng đã đổi + updatedAt của bản đang dựa vào (khoá lạc quan).
// 409 CONTACT_VERSION_CONFLICT: giữ hộp + nội dung đã gõ, báo "Dữ liệu đã thay đổi", đọc lại; người dùng chọn "Giữ nội dung của tôi"
// (lưu lại trên bản mới nhất, chỉ các trường mình đổi) hoặc "Dùng giá trị mới" (nạp bản mới nhất). Máy chủ luôn kiểm quyền theo khách.
const CONTACT_FIELDS = ['fullName', 'title', 'phone', 'email', 'note'];
const norm = (v) => (v == null ? '' : String(v).trim());
const fromContact = (c) => ({ fullName: norm(c && c.fullName), title: norm(c && c.title), phone: norm(c && c.phone), email: norm(c && c.email), note: norm(c && c.note), isPrimary: !!(c && c.isPrimary) });
const contactMessages = (e) => [...new Set([...Object.values(e.fieldErrors || {}), ...(e.extra || [])].filter(Boolean))];

function ContactDialog({ ui, customerId, record, onClose, onSaved, reload }) {
  const ctl = ui.customerApi;
  const [f, setF] = React.useState(() => fromContact(record));
  const [orig, setOrig] = React.useState(record); // bản lúc mở (xác định trường người dùng đã đổi)
  const [cur, setCur] = React.useState(record); // bản mới nhất đã biết (updatedAt gửi đi + so sánh)
  const [tried, setTried] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [conflict, setConflict] = React.useState(null); // { latest }
  const [error, setError] = React.useState(null);
  const editing = !!record;
  const nameErr = !f.fullName.trim() ? 'Vui lòng nhập họ tên người liên hệ' : '';
  const setField = (k) => (x) => setF((p) => ({ ...p, [k]: x && x.target ? x.target.value : x }));
  const editBody = () => {
    const o = fromContact(orig); const c = fromContact(cur); const body = {};
    for (const k of CONTACT_FIELDS) { const v = f[k].trim(); if (v !== o[k] && v !== c[k]) body[k] = v; }
    if (f.isPrimary !== o.isPrimary && f.isPrimary !== c.isPrimary) body.isPrimary = f.isPrimary;
    return body;
  };
  const save = async () => {
    setTried(true); setError(null);
    if (nameErr || busy || conflict) return;
    let body;
    if (editing) {
      const changes = editBody();
      if (!Object.keys(changes).length) { onClose(); return; }
      body = { updatedAt: cur.updatedAt, ...changes };
    } else {
      body = { fullName: f.fullName.trim() };
      for (const k of ['title', 'phone', 'email', 'note']) if (f[k].trim()) body[k] = f[k].trim();
      body.isPrimary = f.isPrimary;
    }
    setBusy(true);
    const r = await ctl.saveContact(customerId, editing ? record.id : null, body);
    setBusy(false);
    if (r.ok) { ui.toast({ tone: 'success', title: editing ? 'Đã cập nhật người liên hệ' : 'Đã thêm người liên hệ', message: f.fullName.trim() }); onSaved(); return; }
    if (r.error.contactConflict) {
      const items = await reload();
      const latest = (items || []).find((x) => x.id === record.id);
      if (!latest) { ui.toast({ tone: 'error', title: 'Người liên hệ không còn', message: 'Người liên hệ đã bị xoá bởi người khác.' }); onClose(); return; }
      setConflict({ latest }); return;
    }
    if (r.error.contactGone) { ui.toast({ tone: 'error', title: 'Người liên hệ không còn', message: r.error.message }); await reload(); onClose(); return; }
    setError(r.error);
  };
  const keepMine = () => { setCur(conflict.latest); setConflict(null); };
  const useLatest = () => { setOrig(conflict.latest); setCur(conflict.latest); setF(fromContact(conflict.latest)); setConflict(null); };
  const msgs = error ? contactMessages(error) : [];
  return (
    <Modal open onClose={busy ? () => {} : onClose} icon="contact" title={editing ? 'Sửa người liên hệ' : 'Thêm người liên hệ'}
      footer={<><Button variant="secondary" disabled={busy} onClick={onClose}>Huỷ</Button><Button icon="check" loading={busy} disabled={busy || !!conflict} onClick={save}>Lưu</Button></>}>
      {conflict ? (
        <div role="alert" style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 10, background: 'var(--warning-soft)', border: '1px solid var(--warning-border)', font: 'var(--type-sm)' }}>
          <b>Dữ liệu đã thay đổi</b> — người khác vừa sửa người liên hệ này. Nội dung bạn đang nhập vẫn được giữ.
          <div style={{ color: 'var(--text-2)', marginTop: 4 }}>Bản mới nhất: {[conflict.latest.fullName, conflict.latest.title, conflict.latest.phone, conflict.latest.email].filter(Boolean).join(' · ')}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <Button size={ui.mobile ? 'md' : 'sm'} onClick={keepMine}>Giữ nội dung của tôi</Button>
            <Button size={ui.mobile ? 'md' : 'sm'} variant="secondary" onClick={useLatest}>Dùng giá trị mới</Button>
          </div>
        </div>
      ) : null}
      {error ? (
        <div role="alert" style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 10, background: 'var(--error-soft)', border: '1px solid var(--error-border)', color: 'var(--error-text)', font: 'var(--type-sm)' }}>
          <b>{error.title}</b>{msgs.length ? <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{msgs.map((m) => <li key={m}>{m}</li>)}</ul> : <div>{error.message}</div>}
        </div>
      ) : null}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 14 }}>
        <Input label="Họ tên" required value={f.fullName} onChange={setField('fullName')} error={tried ? nameErr : ''} maxLength={200} />
        <Input label="Chức danh" value={f.title} onChange={setField('title')} maxLength={120} />
        <Input label="Điện thoại" icon="phone" inputMode="tel" value={f.phone} onChange={setField('phone')} maxLength={40} />
        <Input label="Email" icon="mail" inputMode="email" value={f.email} onChange={setField('email')} maxLength={254} />
        <div style={{ gridColumn: '1 / -1' }}><Input label="Ghi chú" multiline rows={2} value={f.note} onChange={setField('note')} maxLength={5000} /></div>
        <div style={{ gridColumn: '1 / -1' }}><Checkbox label="Liên hệ chính" checked={f.isPrimary} onChange={setField('isPrimary')} /></div>
      </div>
    </Modal>
  );
}

// Customer detail + edit when the customer API flag is ON. Data comes ONLY from GET /customers/:id (no demo/localStorage records)
// plus, B1.4, the primary contact (GET /customers/:id/contacts) when the server granted contact.read; quotes/... are not shown.
// B3 A7: tab Người liên hệ = danh sách liên hệ của khách (GET /customers/:id/contacts).
// FV-3: thêm (contact.create + customer.update), sửa / xoá mềm (customer.update) — giao diện ẩn nút theo quyền (fail-closed), máy chủ kiểm theo khách.
function ContactsPanel({ ui, id, canUpdate, canAdd }) {
  const actl = ui.customerApi.activities;
  const s = useCustomerApiState(actl);
  const [dlg, setDlg] = React.useState(null); // null | { record } (record null = thêm)
  React.useEffect(() => { actl.loadContacts(id); }, [actl, id]);
  const reload = async () => { await actl.loadContacts(id); const c = actl.getState().contacts; return c.customerId === id && c.status === 'ready' ? c.items : null; };
  const cs = s.contacts.customerId === id ? s.contacts : { status: 'loading', items: [], error: null };
  const btnSize = ui.mobile ? 'md' : 'sm';
  const del = (c) => ui.confirm({
    title: 'Xoá người liên hệ ' + c.fullName + '?', icon: 'trash-2', tone: 'error', confirmLabel: 'Xoá',
    message: 'Người liên hệ sẽ bị ẩn khỏi danh sách (xoá mềm, vẫn lưu trong nhật ký).',
    onConfirm: async () => {
      const r = await ui.customerApi.deleteContact(id, c.id, c.updatedAt);
      if (r.ok) ui.toast({ tone: 'success', title: 'Đã xoá người liên hệ', message: c.fullName });
      else ui.toast({ tone: 'error', title: r.error.contactConflict ? 'Dữ liệu đã thay đổi' : r.error.title, message: r.error.contactConflict ? 'Người khác vừa sửa người liên hệ này; danh sách đã được tải lại. Kiểm tra rồi thử lại.' : r.error.message });
      await reload();
    },
  });
  return (
    <section className="sg-card sg-solid" style={{ padding: '16px 20px 8px' }}>
      {canAdd ? <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}><Button size={btnSize} icon="plus" onClick={() => setDlg({ record: null })}>Thêm người liên hệ</Button></div> : null}
      {cs.status === 'loading' || cs.status === 'idle' ? <div role="status" style={{ color: 'var(--text-2)', padding: '8px 0 12px' }}>Đang tải người liên hệ…</div> : null}
      {cs.status === 'error' ? <ApiErrorBox error={cs.error} onRetry={() => actl.loadContacts(id)} /> : null}
      {cs.status === 'ready' && !cs.items.length ? <div style={{ color: 'var(--text-3)', padding: '8px 0 12px' }}>Chưa có người liên hệ.</div> : null}
      {cs.status === 'ready' ? cs.items.map((c) => (
        <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--border-subtle)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '20px minmax(0,1fr)', gap: 10, alignItems: 'start', padding: '9px 0', font: 'var(--type-sm)' }}>
              <Icon name="contact" size={15} color="var(--text-3)" style={{ marginTop: 3 }} />
              <span style={{ overflowWrap: 'anywhere' }}><span style={{ color: 'var(--text-3)' }}>{c.isPrimary ? 'Liên hệ chính · ' : ''}</span><b style={{ fontWeight: 500 }}>{c.fullName}</b>{[c.title, c.phone, c.email].filter(Boolean).map((v) => ' · ' + v).join('')}</span>
            </div>
          </div>
          {canUpdate ? <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            <IconButton icon="pencil" size={btnSize} label={'Sửa người liên hệ ' + c.fullName} onClick={() => setDlg({ record: c })} />
            <IconButton icon="trash-2" size={btnSize} label={'Xoá người liên hệ ' + c.fullName} onClick={() => del(c)} />
          </div> : null}
        </div>
      )) : null}
      <div style={{ height: 8 }} />
      {dlg ? <ContactDialog ui={ui} customerId={id} record={dlg.record} reload={reload} onClose={() => setDlg(null)} onSaved={async () => { setDlg(null); await reload(); }} /> : null}
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
  const canUpdateContact = typeof ui.can === 'function' && !!ui.can('customer.update', c); // FV-3 phương án A: sửa/xoá liên hệ theo customer.update (máy chủ kiểm theo khách)
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
      {canReadActivity ? <Tabs variant="line" value={tab} onChange={setTab} items={[{ id: 'info', label: 'Thông tin', icon: 'building-2' }, { id: 'activities', label: 'Hoạt động', icon: 'list-checks', count: actCount }].concat(canReadContact ? [{ id: 'contacts', label: 'Người liên hệ', icon: 'contact' }] : []).map((t) => (ui.mobile ? { ...t, icon: undefined, label: t.id === 'contacts' ? 'Liên hệ' : t.label } : t))} /> : null}
      {canReadActivity && tab === 'activities' ? <ActivitiesPanel ui={ui} customerId={id} /> : null}
      {canReadActivity && tab === 'contacts' && canReadContact ? <ContactsPanel ui={ui} id={id} canUpdate={canUpdateContact} canAdd={canUpdateContact && !!ui.can('contact.create', c)} /> : null}
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
