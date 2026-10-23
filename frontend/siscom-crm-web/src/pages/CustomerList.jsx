import React from 'react';
import { DataTable, CustomerCard, KpiCard, Badge, Button, IconButton, Tabs, Avatar, Select, Icon, Input, EmptyState } from '../ds/index.js';
import * as U from '../data/util.js';
import { APP_DATA } from '../data/demoData.js';
import { CustomerFormDrawer } from '../features/customers/CustomerForm.jsx';
import { CustomerExportModal, CustomerImportModal } from '../features/customers/CustomerIO.jsx';
import { useCustomerApiState } from '../features/customers/useCustomerApi.js';
import { customerDisplayCode, searchCustomers } from '../features/customers/customerApiUi.js';
import { ApiListStatus, ApiModeNote, ApiSearchBar, ApiPager } from '../features/customers/ApiListStatus.jsx';

function CustomerListPage({ ui }) {
  const D = APP_DATA;
  // Flag OFF: ui.customerApi is null and every API branch below is inert (original localStorage behaviour). Flag ON: list comes from the async repository only.
  const apiCtl = ui.customerApi; const apiS = useCustomerApiState(apiCtl); const apiOn = !!apiCtl;
  React.useEffect(() => { if (apiCtl && apiCtl.getState().list.status === 'idle') apiCtl.load(); }, [apiCtl]);
  const codeOf = (r) => (apiOn ? customerDisplayCode(r) : r.id);
  const all = apiOn ? apiS.list.items : ui.db.customers;
  const [view, setView] = React.useState(ui.mobile ? 'grid' : 'table');
  const [tier, setTier] = React.useState('all');
  const [industry, setIndustry] = React.useState('all');
  const [owner, setOwner] = React.useState('all');
  const [city, setCity] = React.useState('all');
  const [q, setQ] = React.useState('');
  const [sel, setSel] = React.useState([]);
  const [ver, setVer] = React.useState(0);
  const [form, setForm] = React.useState(null);
  const [io, setIo] = React.useState(null);
  const rows = all.filter((c) => (tier === 'all' || c.tier === tier) && (industry === 'all' || c.industry === industry) && (owner === 'all' || c.owner === owner) && (city === 'all' || c.city === city));
  const gridRows = apiOn ? searchCustomers(rows, q) : q.trim() ? rows.filter((c) => [c.name, c.short, c.id, c.taxId, c.owner].some((v) => U.norm(v).includes(U.norm(q.trim())))) : rows;
  const nFilters = [industry, owner, city].filter((x) => x !== 'all').length;
  const clear = () => { setIndustry('all'); setOwner('all'); setCity('all'); setTier('all'); };
  const cnt = (t) => all.filter((c) => c.tier === t).length;
  const del = (ids) => {
    const names = all.filter((c) => ids.includes(c.id));
    if (!names.length) return;
    if (names.some((c) => !ui.can('customer.delete', c))) { ui.toast({ tone: 'error', title: 'Không đủ quyền', message: 'Vai trò hiện tại không được xoá khách hàng.' }); return; }
    const l = ui.api.activeLinks(ids);
    if (l.total) { ui.confirm({ title: 'Không thể xoá khách hàng', icon: 'circle-alert', tone: 'warning', confirmLabel: 'Đã hiểu', description: 'Còn ' + l.text + '. Hãy xử lý các bản ghi này trước khi xoá.', onConfirm: () => {} }); return; }
    ui.confirm({
      title: ids.length > 1 ? 'Xoá ' + ids.length + ' khách hàng?' : 'Xoá khách hàng ' + names[0].short + '?', icon: 'trash-2', tone: 'error', confirmLabel: 'Xoá',
      description: 'Khách hàng sẽ được ẩn khỏi danh sách (xoá mềm). Dữ liệu được giữ trong nhật ký thay đổi và bản sao lưu.',
      onConfirm: () => { if (ui.api.deleteCustomers(ids).ok) { setSel([]); setVer((v) => v + 1); ui.toast({ tone: 'success', title: 'Đã xoá ' + ids.length + ' khách hàng' }); } },
    });
  };
  const fmtRev = (v) => (v ? U.ty(v) + ' tỷ' : '—');
  const cols = [
    { key: 'name', label: 'Khách hàng', sortable: true, sortValue: (r) => r.short, render: (r) => (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 240 }}>
        <Avatar name={r.short} square size={34} />
        <div style={{ minWidth: 0, maxWidth: 280 }}><div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.short}</div><div style={{ font: 'var(--type-caption)', color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.taxId ? codeOf(r) + ' · MST ' + r.taxId : codeOf(r)}</div></div>
      </div>) },
    { key: 'industry', label: 'Ngành nghề', sortable: true, render: (r) => <div><div>{r.industry || '—'}</div><div style={{ font: 'var(--type-caption)', color: 'var(--text-3)' }}>{r.city}</div></div> },
    { key: 'tier', label: 'Phân hạng', sortable: true, render: (r) => <Badge tone={U.TIER_TONE[r.tier]}>{r.tier}</Badge> },
    ...(apiOn ? [] : [{ key: 'revenue', label: 'Doanh thu luỹ kế', align: 'right', sortable: true, render: (r) => fmtRev(r.revenue) }]),
    { key: 'owner', label: 'Phụ trách', sortable: true, render: (r) => <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{r.owner ? <><Avatar name={r.owner} size={24} />{r.owner}</> : <span style={{ color: 'var(--text-3)' }}>Chưa phân công</span>}</div> },
    { key: 'status', label: 'Trạng thái', sortable: true, render: (r) => <Badge dot tone={U.STATUS_TONE[r.status]}>{r.status}</Badge> },
    { key: 'act', label: <span className="sr-only">Thao tác</span>, width: 96, render: (r) => (
      <span style={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }} onClick={(e) => e.stopPropagation()}>
        <IconButton icon="pencil" label="Sửa" size="sm" disabled={apiOn || !ui.can('customer.update', r)} onClick={() => setForm(r)} />
        <IconButton icon="trash-2" label="Xoá" size="sm" disabled={apiOn || !ui.can('customer.delete', r)} onClick={() => del([r.id])} />
      </span>) },
  ];
  const fsel = (label, value, set, opts, w = 190) => <div style={{ width: w, maxWidth: '100%' }}><Select size="sm" value={value} onChange={set} options={[{ value: 'all', label: label }, ...opts.map((o) => ({ value: o, label: o }))]} /></div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 16 }}>
        <KpiCard label="Tổng khách hàng" value={String(apiOn && apiS.list.paging ? apiS.list.paging.total : all.length)} unit={apiOn ? "khách hàng (máy chủ)" : "khách hàng"} icon="users" />
        <KpiCard label="Đang giao dịch" value={String(all.filter((c) => c.status === 'Đang giao dịch').length)} unit={apiOn ? "khách hàng (trang này)" : "khách hàng"} icon="handshake" tone="success" />
        <KpiCard label="Tiềm năng mới (30 ngày)" value={String(all.filter((c) => c.createdAt >= '2026-09-10').length)} unit={apiOn ? "khách hàng (trang này)" : "khách hàng"} icon="user-plus" tone="cyan" />
        {apiOn ? null : <KpiCard label="Doanh thu luỹ kế" value={U.ty(all.reduce((a, c) => a + (c.revenue || 0), 0))} unit="tỷ VNĐ" icon="wallet" tone="navy" />}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ maxWidth: '100%', overflowX: 'auto' }}><Tabs value={tier} onChange={setTier} items={[{ id: 'all', label: 'Tất cả', count: all.length }, ...D.TIERS.map((t) => ({ id: t, label: t, count: cnt(t) }))]} /></div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Tabs value={view} onChange={setView} items={[{ id: 'table', label: 'Bảng', icon: 'list' }, { id: 'grid', label: 'Thẻ', icon: 'layout-grid' }]} />
          <Button variant="secondary" icon="upload" disabled={apiOn || !ui.can('customer.import')} onClick={() => setIo('import')}>Nhập</Button>
          <Button variant="secondary" icon="download" disabled={apiOn} onClick={() => setIo('export')}>Xuất</Button>
          <Button icon="plus" disabled={!apiOn && !ui.can('customer.create')} onClick={() => setForm('new')}>Thêm khách hàng</Button>
        </div>
      </div>
      <div className="sg-solid" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 10, borderRadius: 14, flexWrap: 'wrap' }}>
        <Icon name="sliders-horizontal" size={16} color="var(--text-3)" style={{ marginLeft: 6 }} />
        {fsel('Tất cả ngành nghề', industry, setIndustry, D.INDUSTRIES, 210)}
        {fsel('Tất cả nhân viên', owner, setOwner, apiOn ? [] : D.OWNERS)}
        {fsel('Tất cả tỉnh/thành', city, setCity, D.CITIES)}
        {nFilters ? <Button size="sm" variant="ghost" icon="x" onClick={clear}>Xoá bộ lọc ({nFilters})</Button> : null}
        <span style={{ flex: 1 }} />
        {sel.length ? (<>
          <span style={{ font: 'var(--type-sm)', color: 'var(--primary-text)', fontWeight: 600 }}>Đã chọn {sel.length}</span>
          <Button size="sm" variant="secondary" icon="download" disabled={apiOn} onClick={() => setIo('export')}>Xuất đã chọn</Button>
          <Button size="sm" variant="danger" icon="trash-2" disabled={apiOn || !ui.can('customer.delete')} onClick={() => del(sel)}>Xoá</Button>
        </>) : null}
      </div>
      {apiOn ? <ApiModeNote /> : null}
      {apiOn ? <ApiSearchBar key={(apiS.list.params && apiS.list.params.search) || ''} value={(apiS.list.params && apiS.list.params.search) || ''} busy={apiS.list.status === 'loading'} onSearch={(t) => apiCtl.search(t)} /> : null}
      {apiOn && apiS.list.status !== 'ready' ? <ApiListStatus s={apiS.list} onRetry={() => apiCtl.reload()} /> : view === 'table' ? (
        <DataTable key={ver + tier + industry + owner + city} itemLabel={apiOn ? 'khách hàng (trang này)' : 'khách hàng'} selectable onSelectionChange={setSel} pageSize={apiOn ? 100 : 10} rows={rows} columns={cols}
          searchable={!apiOn} searchKeys={['name', 'short', 'id', 'code', 'taxId', 'owner', 'city', 'phone', 'email']} searchPlaceholder="Tìm tên, mã KH, MST, SĐT…"
          filter={{ key: 'status', options: D.STATUSES }} onRowClick={(r) => ui.navigate('/customers/' + r.id)} emptyTitle="Chưa có khách hàng" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ maxWidth: 360 }}><Input icon="search" placeholder="Tìm tên, mã KH, MST…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          {gridRows.length ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,320px),1fr))', gap: 16 }}>
              {gridRows.map((c) => { const ct = ui.db.contacts.find((x) => x.customerId === c.id && x.primary); return <CustomerCard key={c.id} variant="solid" name={c.name} code={codeOf(c)} industry={c.industry} tier={c.tier} status={c.status === 'Ngừng giao dịch' ? 'Ngừng' : c.status} contact={ct} address={c.city} revenue={fmtRev(c.revenue)} opportunities={apiOn ? 0 : APP_DATA.opportunities.filter((o) => o.customerId === c.id).length} lastActivity={U.dmy(c.createdAt)} owner={c.owner} tags={c.tags} onClick={() => ui.navigate('/customers/' + c.id)} />; })}
            </div>
          ) : <div className="sg-card sg-solid"><EmptyState kind="search" title="Không tìm thấy khách hàng" description="Thử từ khoá khác hoặc bỏ bớt bộ lọc." action={<Button variant="secondary" onClick={() => { clear(); setQ(''); }}>Xoá bộ lọc</Button>} /></div>}
        </div>
      )}
      {apiOn && apiS.list.status === 'ready' ? <ApiPager paging={apiS.list.paging} busy={false} onPrev={() => apiCtl.prevPage()} onNext={() => apiCtl.nextPage()} /> : null}
      <CustomerFormDrawer open={!!form} initial={form === 'new' ? null : form} ui={ui} onClose={() => setForm(null)} onSaved={(c) => { const wasNew = form === 'new'; setForm(null); if (wasNew && !apiOn) ui.navigate('/customers/' + c.id); }} />
      <CustomerExportModal open={io === 'export'} onClose={() => setIo(null)} rows={rows} selected={sel} ui={ui} />
      <CustomerImportModal open={io === 'import'} onClose={() => setIo(null)} ui={ui} />
    </div>
  );
}
export default CustomerListPage;
