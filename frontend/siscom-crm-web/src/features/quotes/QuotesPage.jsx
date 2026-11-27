import React from 'react';
import { Badge, Button, EmptyState, Input, Select } from '../../ds/index.js';
import { ApiErrorBox } from '../customers/ApiListStatus.jsx';
import { QuotesSubnav } from './QuoteSetup.jsx';
import { LIST_SORTS,LIST_STATE_FILTERS, STATE_META, buildQuoteListQuery, fmtVnd, validityLabel } from './quotesModel.js';

// Báo giá Q8a: trang "Báo giá" (#/quotes) — danh sách mọi báo giá trong phạm vi xem của người dùng (mục 9, 10). Dữ liệu CHỈ từ GET /quotes;
// lọc, tìm (không dấu), sắp xếp và phân trang đều do máy chủ làm. Không có giá vốn ở đây (máy chủ không trả). Không lưu gì vào bộ nhớ trình duyệt.
const dmy = (s) => (s ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : '—');
const cell = { padding: '10px 8px', borderBottom: '1px solid var(--border-subtle)', verticalAlign: 'top', font: 'var(--type-sm)' };
const dash = <span style={{ color: 'var(--text-3)' }}>—</span>;
const TONE = { neutral: 'var(--text-3)', warning: 'var(--warning-text)', error: 'var(--error-text)' };
const hrefOf = (q) => '#/quotes/' + encodeURIComponent(q.id);

function StateBadge({ latest }) {
  if (!latest) return <span style={{ color: 'var(--text-3)' }}>Chưa có phiên bản</span>;
  const m = STATE_META[latest.state] || { label: latest.state, tone: 'neutral' };
  return <Badge size="sm" dot tone={m.tone}>{m.label}</Badge>;
}
function Validity({ latest }) {
  if (!latest || !latest.validUntil) return dash;
  const l = validityLabel(latest);
  return <span style={{ whiteSpace: 'nowrap' }}>{dmy(latest.validUntil)}{l ? <span style={{ display: 'block', font: 'var(--type-caption)', color: TONE[l.tone] }}>{l.text}</span> : null}</span>;
}

export function QuotesPage({ ui }) {
  const ctl = ui.customerApi.quotes;
  const [f, setF] = React.useState({ state: '', templateId: '', q: '', sort: LIST_SORTS[0].value });
  const [term, setTerm] = React.useState('');
  const [l, setL] = React.useState({ status: 'loading', items: [], page: 0, total: 0, totalPages: 0, error: null, more: 'idle', moreError: null });
  const [tpl, setTpl] = React.useState([]);
  const seq = React.useRef(0);
  const load = React.useCallback(() => {
    const my = ++seq.current;
    setL((x) => ({ ...x, status: 'loading', error: null, more: 'idle', moreError: null }));
    ctl.list(buildQuoteListQuery({ ...f, page: 1 })).then((r) => {
      if (my !== seq.current) return;
      setL(r.ok ? { status: 'ready', items: r.data.items || [], page: r.data.page, total: r.data.total, totalPages: r.data.totalPages, error: null, more: 'idle', moreError: null } : { status: 'error', items: [], page: 0, total: 0, totalPages: 0, error: r.error, more: 'idle', moreError: null });
    });
  }, [ctl, f]);
  React.useEffect(() => { load(); }, [load]);
  // Danh sách loại để lọc: thiếu cũng không sao (ô lọc chỉ còn "Mọi loại").
  React.useEffect(() => { let live = true; ctl.templates().then((r) => { if (live && r.ok) setTpl(r.data.items || []); }); return () => { live = false; }; }, [ctl]);
  const loadMore = () => {
    if (l.more === 'loading') return;
    const my = seq.current;
    setL((x) => ({ ...x, more: 'loading', moreError: null }));
    ctl.list(buildQuoteListQuery({ ...f, page: l.page + 1 })).then((r) => {
      if (my !== seq.current) return;
      setL((x) => (r.ok ? { ...x, items: x.items.concat(r.data.items || []), page: r.data.page, total: r.data.total, totalPages: r.data.totalPages, more: 'idle' } : { ...x, more: 'error', moreError: r.error }));
    });
  };
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const t = term.trim(); const short = t.length > 0 && t.length < 2;
  const search = () => { if (!short) set('q')(t); };
  const filtered = !!(f.state || f.templateId || f.q);
  const open = (q) => ui.navigate('/quotes/' + q.id);
  const print = (q) => ui.navigate('/quotes/' + q.id + '/print/' + q.latest.versionNo);
  const code = (q) => <a href={hrefOf(q)} onClick={(e) => { e.preventDefault(); open(q); }} style={{ font: 'var(--type-mono)', fontWeight: 600 }}>{q.code}</a>;
  const printBtn = (q) => (q.latest ? <Button size="sm" variant="ghost" icon="printer" aria-label={'Xem bản in ' + q.code} onClick={() => print(q)}>Bản in</Button> : null);
  const primary = (q) => (q.isPrimary ? <Badge size="sm" tone="blue" icon="star">Đang theo đuổi</Badge> : null);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <section className="sg-card sg-solid" style={{ padding: ui.mobile ? 14 : 20, display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 260px', minWidth: 0 }}>
            <Input label="Tìm báo giá" icon="search" size="sm" placeholder="Mã, hạng mục hoặc tên khách (gõ không dấu cũng được)" value={term} maxLength={100} onChange={(e) => setTerm(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') search(); }} />
          </div>
          <Button size="sm" variant="secondary" disabled={short || l.status === 'loading'} onClick={search}>Tìm</Button>
          {f.q ? <Button size="sm" variant="ghost" icon="x" onClick={() => { setTerm(''); set('q')(''); }}>Bỏ tìm</Button> : null}
          <div style={{ minWidth: 190 }}><Select size="sm" ariaLabel="Trạng thái" value={f.state} onChange={set('state')} options={LIST_STATE_FILTERS} /></div>
          <div style={{ minWidth: 170 }}><Select size="sm" ariaLabel="Loại báo giá" value={f.templateId} onChange={set('templateId')} options={[{ value: '', label: 'Mọi loại' }].concat(tpl.map((x) => ({ value: x.id, label: x.name })))} /></div>
          <div style={{ minWidth: 150 }}><Select size="sm" ariaLabel="Sắp xếp" value={f.sort} onChange={set('sort')} options={LIST_SORTS} /></div>
        </div>
        {short ? <span role="status" style={{ font: 'var(--type-caption)', color: 'var(--text-3)' }}>Nhập ít nhất 2 ký tự để tìm.</span> : null}
        {l.status === 'loading' ? <div role="status" style={{ color: 'var(--text-2)', padding: '12px 0' }}>Đang tải báo giá…</div> : null}
        {l.status === 'error' ? <ApiErrorBox error={l.error} onRetry={load} /> : null}
        {l.status === 'ready' && !l.items.length ? (
          <EmptyState compact kind={filtered ? 'search' : 'empty'} icon={filtered ? undefined : 'file-text'} title={filtered ? 'Không có báo giá khớp bộ lọc' : 'Chưa có báo giá nào'}
            description={filtered ? 'Thử bỏ bớt điều kiện lọc hoặc đổi từ khoá.' : 'Báo giá được lập từ tab "Báo giá" trong chi tiết của từng cơ hội ở mục Cơ hội kinh doanh.'}
            action={filtered ? undefined : <Button onClick={() => ui.navigate('/pipeline')}>Mở Cơ hội kinh doanh</Button>} />
        ) : null}
        {l.status === 'ready' && l.items.length ? (
          <>
            <div style={{ font: 'var(--type-sm)', color: 'var(--text-3)' }}>{l.items.length + ' / ' + l.total + ' báo giá'}</div>
            {ui.mobile ? (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {l.items.map((q) => (
                  <li key={q.id} className="sg-card sg-solid" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>{code(q)}{q.latest ? <span style={{ color: 'var(--text-3)', font: 'var(--type-caption)' }}>{'v' + q.latest.versionNo}</span> : null}<StateBadge latest={q.latest} />{primary(q)}</div>
                    <div style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{q.itemName}</div>
                    <div style={{ font: 'var(--type-sm)', color: 'var(--text-2)', overflowWrap: 'anywhere' }}>{(q.customer ? q.customer.name : '—') + (q.template ? ' · ' + q.template.name : '')}</div>
                    {q.latest ? <div style={{ font: 'var(--type-sm)', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}><span>{fmtVnd(q.latest.subtotalVnd) + ' đ (chưa VAT)'}</span>{q.latest.validUntil ? <span style={{ color: 'var(--text-2)' }}>{'Hạn ' + dmy(q.latest.validUntil)}</span> : null}{validityLabel(q.latest) ? <span style={{ color: TONE[validityLabel(q.latest).tone] }}>{validityLabel(q.latest).text}</span> : null}</div> : null}
                    <div>{printBtn(q)}</div>
                  </li>
                ))}
              </ul>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr style={{ textAlign: 'left', color: 'var(--text-3)', font: 'var(--type-caption)' }}>{['Mã', 'Hạng mục', 'Khách hàng', 'Loại', 'Bản', 'Trạng thái', 'Tổng trước VAT', 'Hạn hiệu lực', ''].map((h, i) => <th key={i} scope="col" style={{ ...cell, fontWeight: 600, textAlign: h === 'Tổng trước VAT' ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
                  <tbody>{l.items.map((q) => (
                    <tr key={q.id}>
                      <td style={{ ...cell, whiteSpace: 'nowrap' }}>{code(q)}</td>
                      <td style={{ ...cell, maxWidth: 300 }}><div style={{ fontWeight: 500, overflowWrap: 'anywhere' }}>{q.itemName}</div>{q.opportunity ? <div style={{ color: 'var(--text-3)', font: 'var(--type-caption)', overflowWrap: 'anywhere' }}>{q.opportunity.code + ' · ' + q.opportunity.title}</div> : null}{q.isPrimary ? <div style={{ marginTop: 4 }}>{primary(q)}</div> : null}</td>
                      <td style={{ ...cell, maxWidth: 220, overflowWrap: 'anywhere' }}>{q.customer ? q.customer.name : dash}</td>
                      <td style={cell}>{q.template ? q.template.name : dash}</td>
                      <td style={{ ...cell, whiteSpace: 'nowrap' }}>{q.latest ? 'v' + q.latest.versionNo : dash}</td>
                      <td style={cell}><StateBadge latest={q.latest} /></td>
                      <td style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{q.latest ? fmtVnd(q.latest.subtotalVnd) : dash}</td>
                      <td style={cell}><Validity latest={q.latest} /></td>
                      <td style={{ ...cell, whiteSpace: 'nowrap' }}>{printBtn(q)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
            {l.more === 'error' && l.moreError ? <ApiErrorBox error={l.moreError} /> : null}
            {l.page < l.totalPages ? <div style={{ display: 'flex', justifyContent: 'center' }}><Button variant="secondary" size="sm" loading={l.more === 'loading'} onClick={loadMore}>Tải thêm</Button></div> : null}
          </>
        ) : null}
      </section>
    </div>
  );
}

// Trang "không có quyền" dùng chung cho các route báo giá: KHÔNG gọi máy chủ (mục 10, ca C4).
export function QuoteNoAccess({ ui }) {
  return <div className="sg-card sg-solid"><EmptyState icon="lock" title="Không có quyền xem báo giá" description="Tài khoản của bạn không được xem báo giá." action={<Button onClick={() => ui.navigate('/customers')}>Về danh sách khách hàng</Button>} /></div>;
}
export function QuotesListRoute({ ui, allowed }) {
  // Q8b: thanh trang con (Danh sách / Loại báo giá / Mặc định của tôi) chỉ hiện khi người dùng có thêm quyền tương ứng.
  return allowed ? <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}><QuotesSubnav ui={ui} current="list" /><QuotesPage ui={ui} /></div> : <QuoteNoAccess ui={ui} />;
}
