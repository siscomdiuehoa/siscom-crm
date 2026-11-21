import React from 'react';
import { Badge, Button, EmptyState } from '../../ds/index.js';
import { ApiErrorBox } from '../customers/ApiListStatus.jsx';
import { STATUS_META, statusLabel, moneyVN, dateVN, isCloseOverdue, canCreate, customerLacksOwner, CUSTOMER_NO_OWNER_MESSAGE } from './opportunitiesModel.js';
import { scopeOfUi } from './OpportunityActions.jsx';
import { CreateDialog } from './OpportunitiesPage.jsx';

// Sales S11: tab "Cơ hội" trong chi tiết khách hàng (§8.4) — GET /customers/:id/opportunities. Máy chủ lọc theo phạm vi của người xem
// (chỉ cơ hội người đó thấy được; không phải mọi cơ hội của khách). Giá trị trống hiển thị "Chưa rõ". Tạo cơ hội mở biểu mẫu với khách chọn sẵn.
export function CustomerOpportunitiesPanel({ ui, customer }) {
  const opps = ui.customerApi.opportunities;
  const [l, setL] = React.useState({ status: 'loading', items: [], page: 0, total: 0, totalPages: 0, error: null, more: 'idle', moreError: null });
  const [creating, setCreating] = React.useState(false);
  const seq = React.useRef(0);
  const load = React.useCallback(() => {
    const my = ++seq.current;
    opps.byCustomer(customer.id, 1).then((r) => {
      if (my !== seq.current) return;
      setL(r.ok ? { status: 'ready', items: r.data.items, page: r.data.page || 1, total: r.data.total, totalPages: r.data.totalPages, error: null, more: 'idle', moreError: null } : { status: 'error', items: [], page: 0, total: 0, totalPages: 0, error: r.error, more: 'idle', moreError: null });
    });
  }, [opps, customer.id]);
  React.useEffect(() => { setL((x) => ({ ...x, status: 'loading', items: [] })); load(); }, [load]);
  const loadMore = async () => {
    if (l.status !== 'ready' || l.more === 'loading' || l.page >= l.totalPages) return;
    const my = seq.current; setL((x) => ({ ...x, more: 'loading', moreError: null }));
    const r = await opps.byCustomer(customer.id, l.page + 1);
    if (my !== seq.current) return;
    if (!r.ok) { setL((x) => ({ ...x, more: 'error', moreError: r.error })); return; }
    setL((x) => { const seen = new Set(x.items.map((o) => o.id)); return { ...x, items: x.items.concat(r.data.items.filter((o) => !seen.has(o.id))), page: r.data.page || x.page + 1, total: r.data.total, totalPages: r.data.totalPages, more: 'idle' }; });
  };
  const mayCreate = canCreate(scopeOfUi(ui));
  // T-08: khách chưa có người phụ trách => máy chủ từ chối tạo cơ hội (đúng thiết kế). Khoá nút và nói rõ cần làm gì trước.
  const noOwner = mayCreate && customerLacksOwner(customer);
  const open = (o) => ui.navigate('/pipeline/view/' + encodeURIComponent(o.id));
  const createBtn = mayCreate ? <Button size="sm" icon="plus" disabled={noOwner} onClick={() => { if (!noOwner) setCreating(true); }}>Tạo cơ hội</Button> : null;
  return (
    <section className="sg-card sg-solid" style={{ padding: ui.mobile ? '12px 14px' : '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ flex: 1, minWidth: 0, font: 'var(--type-sm)', color: 'var(--text-3)' }}>{l.status === 'ready' && l.items.length ? l.items.length + ' / ' + l.total + ' cơ hội trong phạm vi của bạn' : 'Cơ hội kinh doanh của khách hàng này'}</span>
        {createBtn}
      </div>
      {noOwner ? <p role="note" style={{ margin: 0, font: 'var(--type-sm)', color: 'var(--warning-text)' }}>{CUSTOMER_NO_OWNER_MESSAGE}</p> : null}
      {l.status === 'loading' ? <div role="status" aria-live="polite" style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-2)', padding: '12px 0' }}><span className="sg-btn__spin" />Đang tải cơ hội…</div> : null}
      {l.status === 'error' ? <ApiErrorBox error={l.error} onRetry={load} /> : null}
      {l.status === 'ready' && !l.items.length ? <EmptyState compact icon="target" title="Chưa có cơ hội nào" description={mayCreate && !noOwner ? 'Bấm "Tạo cơ hội" để bắt đầu theo dõi một nhu cầu của khách hàng này.' : 'Chưa có cơ hội nào của khách hàng này trong phạm vi của bạn.'} /> : null}
      {l.status === 'ready' && l.items.length ? (
        <ul aria-label="Cơ hội của khách hàng" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {l.items.map((o) => {
            const full = o.access === 'FULL'; const late = isCloseOverdue(o);
            return (
              <li key={o.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap', padding: '10px 0', borderBottom: '1px solid var(--border-subtle)', font: 'var(--type-sm)' }}>
                <div style={{ flex: '2 1 240px', minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><span style={{ font: 'var(--type-mono)', color: 'var(--text-3)' }}>{o.code}</span>{full ? <Badge size="sm" dot tone={(STATUS_META[o.status] || { tone: 'neutral' }).tone}>{statusLabel(o.status)}</Badge> : <Badge size="sm" tone="neutral">Theo việc</Badge>}<Badge size="sm">{o.stage ? o.stage.label : '—'}</Badge></div>
                  <a href={'#/pipeline/view/' + encodeURIComponent(o.id)} onClick={(e) => { e.preventDefault(); open(o); }} style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{o.title}</a>
                  {o.projectName ? <div style={{ font: 'var(--type-caption)', color: 'var(--text-3)', overflowWrap: 'anywhere' }}>{o.projectName}</div> : null}
                </div>
                <div style={{ flex: '1 1 160px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2, color: 'var(--text-2)' }}>
                  {full ? <span><span style={{ color: o.expectedAmountVnd === null ? 'var(--text-3)' : 'var(--text-1)' }}>{moneyVN(o.expectedAmountVnd)}</span>{' · ' + o.probability + '%'}</span> : null}
                  {o.expectedCloseDate ? <span style={{ color: late ? 'var(--error-text)' : undefined }}>{(late ? 'Quá hạn chốt ' : 'Dự kiến chốt ') + dateVN(o.expectedCloseDate)}</span> : null}
                  {full && o.owner ? <span>{'Phụ trách: ' + o.owner.fullName}</span> : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
      {l.more === 'error' && l.moreError ? <ApiErrorBox error={l.moreError} /> : null}
      {l.status === 'ready' && l.page < l.totalPages ? <div style={{ display: 'flex', justifyContent: 'center' }}><Button variant="secondary" size="sm" loading={l.more === 'loading'} onClick={loadMore}>Tải thêm</Button></div> : null}
      {creating ? <CreateDialog ui={ui} customer={customer} onClose={() => setCreating(false)} /> : null}
    </section>
  );
}
