import React from 'react';
import { Card, Badge, Button, IconButton, Tabs, Avatar, Select, Icon, Input, Modal, Checkbox, ActivityFeed, DataTable, EmptyState } from '../ds/index.js';
import * as U from '../data/util.js';
import { uid } from '../data/repository/ids.js';
import { APP_DATA } from '../data/demoData.js';
import { CustomerFormDrawer } from '../features/customers/CustomerForm.jsx';

const ITYPE = { 'Cuộc gọi': ['phone', 'blue'], 'Email': ['mail', 'neutral'], 'Gặp mặt': ['users', 'success'], 'Khảo sát hiện trường': ['hard-hat', 'warning'], 'Ghi chú': ['sticky-note', 'neutral'] };

function InfoRow({ icon, label, children }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '20px 120px minmax(0,1fr)', gap: 10, alignItems: 'start', padding: '9px 0', borderBottom: '1px solid var(--border-subtle)', font: 'var(--type-sm)' }}>
      <Icon name={icon} size={15} color="var(--text-3)" style={{ marginTop: 3 }} />
      <span style={{ color: 'var(--text-3)' }}>{label}</span>
      <span style={{ color: 'var(--text-1)', overflowWrap: 'anywhere' }}>{children || <span style={{ color: 'var(--text-3)' }}>—</span>}</span>
    </div>
  );
}

function ContactModal({ open, initial, customerId, onClose, ui }) {
  const blank = { name: '', title: '', phone: '', email: '', primary: false };
  const [f, setF] = React.useState(blank);
  const [tried, setTried] = React.useState(false);
  React.useEffect(() => { setF(initial ? { ...initial } : blank); setTried(false); }, [open, initial]);
  const e = {};
  if (!f.name.trim()) e.name = 'Vui lòng nhập họ tên';
  if (!f.phone.trim() && !f.email.trim()) e.phone = 'Nhập ít nhất điện thoại hoặc email';
  if (f.phone.trim() && !U.isPhone(f.phone)) e.phone = 'Số điện thoại chưa hợp lệ';
  if (f.email.trim() && !U.isEmail(f.email)) e.email = 'Email chưa đúng định dạng';
  const save = () => { setTried(true); if (Object.keys(e).length) return; if (!ui.api.saveContact({ ...f, id: f.id || uid('LH'), customerId }).ok) return; ui.toast({ tone: 'success', title: initial ? 'Đã cập nhật người liên hệ' : 'Đã thêm người liên hệ', message: f.name }); onClose(); };
  return (
    <Modal open={open} onClose={onClose} icon="contact" title={initial ? 'Sửa người liên hệ' : 'Thêm người liên hệ'} footer={<><Button variant="secondary" onClick={onClose}>Huỷ</Button><Button icon="check" onClick={save}>Lưu</Button></>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 14 }}>
        <Input label="Họ và tên" required value={f.name} onChange={(x) => setF({ ...f, name: x.target.value })} error={tried ? e.name : ''} />
        <Input label="Chức vụ" value={f.title} onChange={(x) => setF({ ...f, title: x.target.value })} />
        <Input label="Điện thoại" icon="phone" value={f.phone} onChange={(x) => setF({ ...f, phone: x.target.value })} error={tried ? e.phone : ''} />
        <Input label="Email" icon="mail" value={f.email} onChange={(x) => setF({ ...f, email: x.target.value })} error={tried ? e.email : ''} />
        <div style={{ gridColumn: '1 / -1' }}><Checkbox label="Đặt làm người liên hệ chính" checked={f.primary} onChange={(v) => setF({ ...f, primary: v })} /></div>
      </div>
    </Modal>
  );
}

function LogInteraction({ c, ui }) {
  const [type, setType] = React.useState('Cuộc gọi');
  const [date, setDate] = React.useState(U.today());
  const [text, setText] = React.useState('');
  const [tried, setTried] = React.useState(false);
  const save = () => { setTried(true); if (text.trim().length < 5) return; if (!ui.api.addInteraction({ customerId: c.id, type, date, content: text.trim(), by: ui.user.name }).ok) return; setText(''); setTried(false); ui.toast({ tone: 'success', title: 'Đã ghi nhận tương tác', message: type + ' · ' + U.dmy(date) }); };
  return (
    <div className="sg-solid" style={{ borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12 }}>
        <Select label="Loại tương tác" value={type} onChange={setType} options={Object.keys(ITYPE).map((k) => ({ value: k, label: k, icon: ITYPE[k][0] }))} />
        <Input label="Ngày" type="date" value={date} max={U.today()} onChange={(e) => setDate(e.target.value)} />
      </div>
      <Input label="Nội dung" required multiline rows={2} placeholder="Tóm tắt nội dung trao đổi, kết quả, bước tiếp theo…" value={text} onChange={(e) => setText(e.target.value)} error={tried && text.trim().length < 5 ? 'Nội dung tối thiểu 5 ký tự' : ''} />
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><Button size="sm" icon="plus" onClick={save}>Ghi nhận</Button></div>
    </div>
  );
}

function CustomerProfilePage({ ui, c }) {
  const D = APP_DATA;
  const [tab, setTab] = React.useState('overview');
  const [edit, setEdit] = React.useState(false);
  const [contactDlg, setContactDlg] = React.useState(null);
  const contacts = ui.db.contacts.filter((x) => x.customerId === c.id).sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0));
  const inter = ui.db.interactions.filter((x) => x.customerId === c.id).sort((a, b) => (b.date > a.date ? 1 : -1));
  const quotes = ui.db.quotes.filter((x) => x.customerId === c.id);
  const contracts = ui.db.contracts.filter((x) => x.customerId === c.id);
  const projects = ui.db.projects.filter((x) => x.customerId === c.id);
  const opps = ui.db.opportunities.filter((x) => x.customerId === c.id);
  const debt = ui.db.overdue.filter((x) => x.customerId === c.id).reduce((a, x) => a + x.amount, 0);
  const primary = contacts.find((x) => x.primary);
  const delCustomer = () => {
    if (!ui.can('customer.delete', c)) { ui.toast({ tone: 'error', title: 'Không đủ quyền', message: 'Vai trò hiện tại không được xoá khách hàng.' }); return; }
    const l = ui.api.activeLinks([c.id]);
    if (l.total) { ui.confirm({ title: 'Không thể xoá khách hàng', icon: 'circle-alert', tone: 'warning', confirmLabel: 'Đã hiểu', description: 'Còn ' + l.text + '. Hãy xử lý các bản ghi này trước khi xoá.', onConfirm: () => {} }); return; }
    ui.confirm({ title: 'Xoá khách hàng ' + c.short + '?', icon: 'trash-2', tone: 'error', confirmLabel: 'Xoá', description: 'Khách hàng sẽ được ẩn khỏi danh sách (xoá mềm). Dữ liệu được giữ trong nhật ký thay đổi và bản sao lưu.', onConfirm: () => { if (ui.api.deleteCustomers([c.id]).ok) { ui.toast({ tone: 'success', title: 'Đã xoá ' + c.short }); ui.navigate('/customers'); } } });
  };
  const feed = (list) => list.map((it) => ({ icon: (ITYPE[it.type] || ITYPE['Ghi chú'])[0], tone: (ITYPE[it.type] || ITYPE['Ghi chú'])[1], text: <><b>{it.by}</b> · {it.type}: {it.content}</>, time: U.dmy(it.date) }));
  const stat = (label, value, icon, tone) => (
    <div className="sg-card sg-glass" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
      <span className="sg-kpi__icon" style={{ background: 'var(--' + tone + '-soft)', color: 'var(--' + tone + ')' }}><Icon name={icon} size={18} /></span>
      <div style={{ minWidth: 0 }}><div style={{ font: 'var(--type-caption)', color: 'var(--text-3)' }}>{label}</div><div className="sg-num" style={{ font: 'var(--fw-semibold) 18px/26px var(--font-sans)', whiteSpace: 'nowrap' }}>{value}</div></div>
    </div>
  );
  const tbl = (rows, cols, label) => rows.length ? <DataTable searchable={false} compact pageSize={6} itemLabel={label} rows={rows} rowKey="code" columns={cols} /> : <div className="sg-card sg-solid"><EmptyState compact title={'Chưa có ' + label} description="Dữ liệu liên quan sẽ hiển thị tại đây khi được tạo ở module tương ứng." /></div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div><Button variant="ghost" size="sm" icon="arrow-left" onClick={() => ui.navigate('/customers')}>Danh sách khách hàng</Button></div>
      <section className="sg-card sg-glass" style={{ padding: 20, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <Avatar name={c.short} square size={56} />
        <div style={{ flex: '1 1 280px', minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}><span style={{ font: 'var(--type-mono)', color: 'var(--text-3)' }}>{c.id}</span><Badge tone={U.TIER_TONE[c.tier]}>{c.tier}</Badge><Badge dot tone={U.STATUS_TONE[c.status]}>{c.status}</Badge></div>
          <h2 style={{ margin: '4px 0 2px', font: 'var(--type-h2)', letterSpacing: 'var(--tracking-snug)', textWrap: 'pretty' }}>{c.name}</h2>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', font: 'var(--type-sm)', color: 'var(--text-2)' }}>{[c.industry, c.city].filter(Boolean).map((v, i) => <span key={i}>{(i ? '· ' : '') + v}</span>)}<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{c.owner ? <><Avatar name={c.owner} size={20} />Phụ trách: <b style={{ fontWeight: 500, color: 'var(--text-1)' }}>{c.owner}</b></> : 'Chưa phân công phụ trách'}</span></div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="secondary" icon="phone" onClick={() => ui.toast({ tone: 'info', title: 'Gọi ' + c.phone, message: 'Tích hợp tổng đài cần backend.' })}>Gọi</Button>
          <Button variant="secondary" icon="mail" onClick={() => { if (c.email) location.href = 'mailto:' + c.email; }}>Email</Button>
          <Button icon="pencil" disabled={!ui.can('customer.update', c)} onClick={() => setEdit(true)}>Sửa thông tin</Button>
          <IconButton icon="trash-2" label="Xoá khách hàng" variant="secondary" tooltip disabled={!ui.can('customer.delete', c)} onClick={delCustomer} />
        </div>
      </section>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 16 }}>
        {stat('Doanh thu luỹ kế', c.revenue ? U.ty(c.revenue) + ' tỷ' : '—', 'wallet', 'primary')}
        {stat('Công nợ quá hạn', debt ? U.money(debt) : 'Không có', 'receipt', debt ? 'warning' : 'success')}
        {stat('Cơ hội đang mở', opps.length + ' · ' + U.ty(opps.reduce((a, o) => a + o.value, 0)) + ' tỷ', 'target', 'accent')}
        {stat('Hợp đồng / Dự án', contracts.length + ' / ' + projects.length, 'file-pen-line', 'primary')}
      </div>
      <div className="dash-profile">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <section className="sg-card sg-solid" style={{ padding: '16px 20px 8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}><h3 style={{ margin: 0, font: 'var(--type-h4)', flex: 1 }}>Thông tin doanh nghiệp</h3><IconButton icon="pencil" label="Sửa" size="sm" onClick={() => setEdit(true)} /></div>
            <InfoRow icon="hash" label="Mã số thuế">{c.taxId ? <span style={{ font: 'var(--type-mono)' }}>{c.taxId}</span> : null}</InfoRow>
            <InfoRow icon="map-pin" label="Địa chỉ">{[c.address, c.city].filter(Boolean).join(', ') || null}</InfoRow>
            <InfoRow icon="phone" label="Điện thoại">{c.phone}</InfoRow>
            <InfoRow icon="mail" label="Email">{c.email ? <a href={'mailto:' + c.email}>{c.email}</a> : null}</InfoRow>
            <InfoRow icon="globe" label="Website">{c.website ? <a href={'https://' + c.website.replace(/^https?:\/\//, '')} target="_blank" rel="noreferrer">{c.website}</a> : null}</InfoRow>
            <InfoRow icon="briefcase" label="Ngành nghề">{c.industry || null}</InfoRow>
            <InfoRow icon="megaphone" label="Nguồn">{c.source || null}</InfoRow>
            <InfoRow icon="calendar" label="Ngày tạo">{U.dmy(c.createdAt)}</InfoRow>
            {c.note ? <InfoRow icon="sticky-note" label="Ghi chú">{c.note}</InfoRow> : null}
            {c.tags && c.tags.length ? <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '12px 0' }}>{c.tags.map((t) => <Badge key={t} tone="outline" size="sm">{t}</Badge>)}</div> : <div style={{ height: 8 }} />}
          </section>
          {primary ? (
            <Card title="Người liên hệ chính" variant="glass">
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}><Avatar name={primary.name} size={40} /><div style={{ minWidth: 0 }}><div style={{ fontWeight: 600 }}>{primary.name}</div><div style={{ font: 'var(--type-caption)', color: 'var(--text-3)' }}>{primary.title}</div><div style={{ font: 'var(--type-sm)', color: 'var(--text-2)', marginTop: 4 }}>{primary.phone}{primary.email ? ' · ' + primary.email : ''}</div></div></div>
            </Card>
          ) : null}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <div style={{ overflowX: 'auto' }}><Tabs variant="line" value={tab} onChange={setTab} items={[{ id: 'overview', label: 'Tổng quan' }, { id: 'contacts', label: 'Người liên hệ', count: contacts.length }, { id: 'history', label: 'Lịch sử tương tác', count: inter.length }, { id: 'quotes', label: 'Báo giá', count: quotes.length }, { id: 'contracts', label: 'Hợp đồng', count: contracts.length }, { id: 'projects', label: 'Dự án', count: projects.length }]} /></div>
          {tab === 'overview' ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,300px),1fr))', gap: 16 }}>
              <Card title="Tương tác gần đây" actions={<Button size="sm" variant="ghost" onClick={() => setTab('history')}>Tất cả</Button>}>{inter.length ? <ActivityFeed dense items={feed(inter.slice(0, 4))} /> : <EmptyState compact title="Chưa có tương tác" />}</Card>
              <Card title="Cơ hội kinh doanh" subtitle={opps.length + ' cơ hội'}>
                {opps.length ? opps.map((o) => <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}><Icon name="target" size={16} color="var(--primary)" /><div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 500 }}>{o.name}</div><div style={{ font: 'var(--type-caption)', color: 'var(--text-3)' }}>{o.stage} · dự kiến {U.dmy(o.close)}</div></div><b className="sg-num" style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{U.ty(o.value, 2)} tỷ</b></div>) : <EmptyState compact title="Chưa có cơ hội" />}
              </Card>
            </div>
          ) : null}
          {tab === 'contacts' ? (
            <section className="sg-card sg-solid" style={{ overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', padding: '14px 16px', borderBottom: '1px solid var(--border-subtle)' }}><span style={{ flex: 1, font: 'var(--type-h4)' }}>Người liên hệ</span><Button size="sm" icon="plus" onClick={() => setContactDlg('new')}>Thêm</Button></div>
              {contacts.length ? contacts.map((ct) => (
                <div key={ct.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)', flexWrap: 'wrap' }}>
                  <Avatar name={ct.name} size={36} />
                  <div style={{ flex: '1 1 180px', minWidth: 0 }}><div style={{ display: 'flex', gap: 6, alignItems: 'center' }}><b style={{ fontWeight: 600 }}>{ct.name}</b>{ct.primary ? <Badge size="sm" tone="blue">Liên hệ chính</Badge> : null}</div><div style={{ font: 'var(--type-caption)', color: 'var(--text-3)' }}>{ct.title || '—'}</div></div>
                  <div style={{ flex: '1 1 200px', font: 'var(--type-sm)', color: 'var(--text-2)', minWidth: 0 }}><div className="sg-num">{ct.phone || '—'}</div><div style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{ct.email}</div></div>
                  <div style={{ display: 'flex', gap: 2 }}>
                    {!ct.primary ? <IconButton icon="star" label="Đặt làm liên hệ chính" size="sm" tooltip onClick={() => { if (ui.api.saveContact({ ...ct, primary: true }).ok) ui.toast({ tone: 'success', title: ct.name + ' là liên hệ chính' }); }} /> : null}
                    <IconButton icon="pencil" label="Sửa" size="sm" onClick={() => setContactDlg(ct)} />
                    <IconButton icon="trash-2" label="Xoá" size="sm" onClick={() => ui.confirm({ title: 'Xoá người liên hệ ' + ct.name + '?', icon: 'trash-2', tone: 'error', confirmLabel: 'Xoá', onConfirm: () => { if (ui.api.deleteContact(ct.id).ok) ui.toast({ tone: 'success', title: 'Đã xoá người liên hệ' }); } })} />
                  </div>
                </div>
              )) : <EmptyState compact title="Chưa có người liên hệ" action={<Button size="sm" icon="plus" onClick={() => setContactDlg('new')}>Thêm người liên hệ</Button>} />}
            </section>
          ) : null}
          {tab === 'history' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <LogInteraction c={c} ui={ui} />
              <section className="sg-card sg-solid" style={{ padding: '8px 20px' }}>{inter.length ? <ActivityFeed items={feed(inter)} /> : <EmptyState compact title="Chưa có tương tác" />}</section>
            </div>
          ) : null}
          {tab === 'quotes' ? tbl(quotes, [{ key: 'code', label: 'Số BG', sortable: true, render: (r) => <span style={{ font: 'var(--type-mono)' }}>{r.code}</span> }, { key: 'title', label: 'Nội dung' }, { key: 'value', label: 'Giá trị', align: 'right', sortable: true, render: (r) => U.money(r.value) }, { key: 'status', label: 'Trạng thái', render: (r) => <Badge dot tone={U.Q_TONE[r.status]}>{r.status}</Badge> }, { key: 'date', label: 'Ngày lập', sortable: true, render: (r) => U.dmy(r.date) }], 'báo giá') : null}
          {tab === 'contracts' ? tbl(contracts, [{ key: 'code', label: 'Số HĐ', sortable: true, render: (r) => <span style={{ font: 'var(--type-mono)' }}>{r.code}</span> }, { key: 'title', label: 'Nội dung' }, { key: 'value', label: 'Giá trị', align: 'right', sortable: true, render: (r) => U.money(r.value) }, { key: 'paid', label: 'Đã thanh toán', render: (r) => <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 110 }}><div className="sg-progress" style={{ flex: 1 }}><div className="sg-progress__bar" style={{ width: r.paid + '%', background: r.paid === 100 ? 'var(--success)' : undefined }} /></div><span className="sg-num" style={{ font: 'var(--type-caption)' }}>{r.paid}%</span></div> }, { key: 'status', label: 'Trạng thái', render: (r) => <Badge dot tone={U.C_TONE[r.status]}>{r.status}</Badge> }, { key: 'end', label: 'Kết thúc', sortable: true, render: (r) => U.dmy(r.end) }], 'hợp đồng') : null}
          {tab === 'projects' ? (projects.length ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,280px),1fr))', gap: 16 }}>
              {projects.map((p) => (
                <Card key={p.code} variant="glass">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span style={{ font: 'var(--type-mono)', color: 'var(--text-3)' }}>{p.code}</span><Badge size="sm" dot tone={/Trễ/.test(p.status) ? 'warning' : 'success'}>{p.status}</Badge></div>
                    <div style={{ font: 'var(--type-h4)' }}>{p.name}</div>
                    <div style={{ font: 'var(--type-caption)', color: 'var(--text-3)' }}>{p.scope} · Chỉ huy trưởng: {p.manager}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><div className="sg-progress" style={{ flex: 1 }}><div className="sg-progress__bar" style={{ width: p.progress + '%' }} /></div><span className="sg-num" style={{ font: 'var(--type-caption)' }}>{p.progress}%</span></div>
                  </div>
                </Card>
              ))}
            </div>) : <div className="sg-card sg-solid"><EmptyState compact title="Chưa có dự án" description="Dự án sẽ hiển thị khi hợp đồng được chuyển sang thi công." /></div>) : null}
        </div>
      </div>
      <CustomerFormDrawer open={edit} initial={c} ui={ui} onClose={() => setEdit(false)} onSaved={() => setEdit(false)} />
      <ContactModal open={!!contactDlg} initial={contactDlg === 'new' ? null : contactDlg} customerId={c.id} ui={ui} onClose={() => setContactDlg(null)} />
    </div>
  );
}
export default CustomerProfilePage;
