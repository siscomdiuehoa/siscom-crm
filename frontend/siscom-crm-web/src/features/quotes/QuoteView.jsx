import React from 'react';
import { Badge, Button, EmptyState } from '../../ds/index.js';
import { ApiErrorBox } from '../customers/ApiListStatus.jsx';
import { useCustomerApiState } from '../customers/useCustomerApi.js';
import { QuoteEditor } from './QuoteEditor.jsx';
import { fmtQty, fmtVnd, STATE_META } from './quotesModel.js';

// Báo giá Q7: trang một báo giá (#/quotes/:id). Bản nháp mới nhất + có quyền sửa => màn hình soạn; còn lại => xem nội dung phiên bản (chỉ đọc) và
// nút "Tạo bản mới". Chọn được phiên bản cũ để xem. Mọi số liệu đọc từ máy chủ; không lưu gì vào bộ nhớ trình duyệt.
const dmy = (s) => (s ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : '—');
const th = { padding: '6px 4px', textAlign: 'left', font: 'var(--type-caption)', color: 'var(--text-3)', fontWeight: 600 };
const td = { padding: '6px 4px', verticalAlign: 'top', font: 'var(--type-sm)' };

function VersionRead({ v, mobile }) {
  const cols = Array.isArray(v.columns) ? v.columns : [];
  const lineMode = v.vatMode === 'LINE';
  const n = (i) => v.lines.slice(0, i + 1).filter((x) => x.kind === 'ITEM').length;
  const row = (label, val, strong) => <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, fontWeight: strong ? 700 : 400 }}><span>{label}</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtVnd(val)}</span></div>;
  const c = v.client || {}; const q = v.quoter || {};
  const kv = (k, val) => (val ? <div style={{ font: 'var(--type-sm)' }}><span style={{ color: 'var(--text-3)' }}>{k + ': '}</span>{val}</div> : null);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <section className="sg-card sg-solid" style={{ padding: mobile ? 14 : 20, display: 'grid', gridTemplateColumns: mobile ? '1fr' : '1fr 1fr', gap: 12 }}>
        <div>{kv('Khách hàng', c.name)}{kv('Công ty', c.company)}{kv('Dự án', v.projectName)}{kv('Điện thoại', c.phone)}{kv('Email', c.email)}{kv('Địa chỉ', c.address)}</div>
        <div>{kv('Báo giá bởi', q.name)}{kv('Chức vụ', q.title)}{kv('Điện thoại', q.phone)}{kv('Email', q.email)}{kv('Ngày báo giá', dmy(v.quoteDate))}{kv('Hiệu lực đến', dmy(v.validUntil))}</div>
      </section>
      <section className="sg-card sg-solid" style={{ padding: mobile ? 14 : 20, display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
        <div style={{ fontWeight: 600, textAlign: 'center' }}>{v.title}</div>
        {v.lines.length === 0 ? <div style={{ font: 'var(--type-sm)', color: 'var(--text-3)' }}>Chưa có dòng nào.</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <th style={th}>TT</th><th style={th}>Nội dung công việc</th>{cols.map((x) => <th key={x.key} style={th}>{x.label + (x.unit ? ' (' + x.unit + ')' : '')}</th>)}
                <th style={th}>ĐVT</th><th style={{ ...th, textAlign: 'right' }}>SL</th><th style={{ ...th, textAlign: 'right' }}>Đơn giá</th>{lineMode ? <th style={th}>VAT</th> : null}
                <th style={{ ...th, textAlign: 'right' }}>Thành tiền</th>{v.costVisible ? <th style={{ ...th, textAlign: 'right' }}>Giá vốn / đv</th> : null}<th style={th}>Ghi chú</th>
              </tr></thead>
              <tbody>
                {v.lines.map((l, i) => (l.kind === 'SECTION'
                  ? <tr key={l.lineNo} style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--surface-sunken)' }}><td style={td} /><td style={{ ...td, fontWeight: 600 }} colSpan={5 + cols.length + (lineMode ? 1 : 0) + (v.costVisible ? 1 : 0)}>{l.description}</td></tr>
                  : <tr key={l.lineNo} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={td}>{n(i)}</td><td style={{ ...td, overflowWrap: 'anywhere' }}>{l.description}</td>
                    {cols.map((x) => <td key={x.key} style={td}>{(l.extra || {})[x.key] || ''}</td>)}
                    <td style={td}>{l.unit}</td><td style={{ ...td, textAlign: 'right' }}>{fmtQty(l.quantity)}</td><td style={{ ...td, textAlign: 'right' }}>{fmtVnd(l.unitPriceVnd)}</td>
                    {lineMode ? <td style={td}>{l.vatPercent + ' %'}</td> : null}
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtVnd(l.amountVnd)}</td>
                    {v.costVisible ? <td style={{ ...td, textAlign: 'right' }}>{l.costPriceVnd == null ? '—' : fmtVnd(l.costPriceVnd)}</td> : null}
                    <td style={td}>{l.note || ''}</td>
                  </tr>))}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ alignSelf: mobile ? 'stretch' : 'flex-end', minWidth: mobile ? 0 : 320, display: 'flex', flexDirection: 'column', gap: 4, font: 'var(--type-sm)', paddingTop: 8, borderTop: '1px solid var(--border-subtle)' }}>
          {row('Tổng giá trị trước VAT', v.subtotalVnd)}
          {v.base8Vnd !== '0' ? row('VAT 8 %', v.vat8Vnd) : null}
          {v.base10Vnd !== '0' ? row('VAT 10 %', v.vat10Vnd) : null}
          {row('Tổng giá trị sau VAT', v.totalVnd, true)}
          {v.costVisible && v.margin ? <div style={{ marginTop: 6, color: 'var(--text-2)' }}>{v.margin.costedLines === 0 ? 'Lãi gộp tạm tính: chưa nhập giá vốn dòng nào.' : 'Lãi gộp tạm tính: ' + fmtVnd(v.margin.grossProfitVnd) + ' đ trên ' + v.margin.costedLines + ' / ' + v.margin.itemLines + ' dòng đã nhập giá vốn'}</div> : null}
        </div>
      </section>
      {v.intro || v.terms || v.paymentInfo ? <section className="sg-card sg-solid" style={{ padding: mobile ? 14 : 20, font: 'var(--type-sm)', whiteSpace: 'pre-line', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {v.intro ? <div>{v.intro}</div> : null}{v.terms ? <div><b>Ghi chú: </b>{v.terms}</div> : null}{v.paymentInfo ? <div><b>Thông tin tài khoản: </b>{v.paymentInfo}</div> : null}
      </section> : null}
      {v.status === 'REJECTED' && v.rejectReason ? <div role="note" style={{ font: 'var(--type-sm)', color: 'var(--text-2)' }}>{'Lý do khách từ chối: ' + v.rejectReason}</div> : null}
    </div>
  );
}

export function QuoteView({ ui, id }) {
  const ctl = ui.customerApi.quotes;
  const s = useCustomerApiState(ctl);
  const [st, setSt] = React.useState({ status: 'loading', q: null, error: null });
  const [sel, setSel] = React.useState(null);
  // VAT mặc định của loại báo giá (cho bản nháp chưa có dòng hàng). Không tải được => 10 %; người soạn vẫn chọn lại được.
  const [defaultVat, setDefaultVat] = React.useState(null);
  const load = React.useCallback(() => { ctl.detail(id).then((r) => setSt(r.ok ? { status: 'ready', q: r.data, error: null } : { status: 'error', q: null, error: r.error })); }, [ctl, id]);
  React.useEffect(() => { load(); }, [load]);
  const tplId = st.q && st.q.template ? st.q.template.id : null;
  React.useEffect(() => {
    if (!tplId) return undefined;
    let live = true;
    ctl.templates().then((r) => { if (!live) return; const t = r.ok ? (r.data.items || []).find((x) => x.id === tplId) : null; setDefaultVat(t && (t.defaultVat === 8 || t.defaultVat === 10) ? t.defaultVat : 10); });
    return () => { live = false; };
  }, [ctl, tplId]);
  if (st.status === 'loading') return <div role="status" className="sg-card sg-solid" style={{ padding: 20 }}>Đang tải báo giá…</div>;
  if (st.status === 'error') return <ApiErrorBox error={st.error} onRetry={load} />;
  const q = st.q; const vs = q.versions || [];
  if (!vs.length) return <EmptyState title="Báo giá chưa có phiên bản" />;
  const latest = vs[vs.length - 1];
  const shown = vs.find((v) => v.versionNo === sel) || latest;
  const editing = shown === latest && latest.status === 'DRAFT' && q.can && q.can.update;
  if (editing && defaultVat === null) return <div role="status" className="sg-card sg-solid" style={{ padding: 20 }}>Đang tải báo giá…</div>;
  const accepted = vs.some((v) => v.status === 'ACCEPTED');
  const newVersion = async () => {
    const r = await ctl.newVersion(q);
    if (r.duplicate) return;
    if (r.ok) { ui.toast({ tone: 'success', title: 'Đã tạo bản mới', message: q.code }); setSel(null); setSt({ status: 'ready', q: r.data, error: null }); }
    else ui.toast({ tone: 'error', title: r.error.title, message: r.error.message });
  };
  const meta = STATE_META[shown.state] || { label: shown.state, tone: 'neutral' };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div><Button variant="ghost" size="sm" icon="arrow-left" onClick={() => ui.navigate('/pipeline/view/' + q.opportunity.id)}>{'Cơ hội ' + q.opportunity.code}</Button></div>
      <section className="sg-card sg-glass" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ font: 'var(--type-mono)', color: 'var(--text-3)' }}>{q.code + ' v' + shown.versionNo}</span>
          <Badge size="sm" tone={meta.tone}>{meta.label}</Badge>
          {q.template ? <Badge size="sm">{q.template.name}</Badge> : null}
          {q.isPrimary ? <Badge size="sm" tone="blue" icon="star">Đang theo đuổi</Badge> : null}
        </div>
        <h2 style={{ margin: 0, font: 'var(--type-h2)', overflowWrap: 'anywhere' }}>{q.itemName}</h2>
        <div style={{ font: 'var(--type-sm)', color: 'var(--text-2)' }}>{(q.customer ? q.customer.name + ' · ' : '') + q.opportunity.title}</div>
        {vs.length > 1 ? (
          <div role="group" aria-label="Chọn phiên bản" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {vs.map((v) => <button key={v.versionNo} type="button" className="sg-chip" aria-pressed={v === shown} onClick={() => setSel(v.versionNo)} style={v === shown ? { background: 'var(--primary-soft)', borderColor: 'transparent', color: 'var(--primary-text)' } : undefined}>{'v' + v.versionNo + ' · ' + (STATE_META[v.state] || { label: v.state }).label}</button>)}
          </div>
        ) : null}
        {!editing && q.can && q.can.update && latest.status !== 'DRAFT' && !accepted ? <div><Button size="sm" icon="copy-plus" loading={!!s.busy} onClick={newVersion}>Tạo bản mới</Button></div> : null}
        {latest.status === 'DRAFT' && !(q.can && q.can.update) ? <div style={{ font: 'var(--type-caption)', color: 'var(--text-3)' }}>Bạn chỉ xem được bản nháp này.</div> : null}
      </section>
      {editing ? <QuoteEditor ui={ui} q={q} v={latest} defaultVat={defaultVat} onSaved={(data) => setSt({ status: 'ready', q: data, error: null })} /> : <VersionRead v={shown} mobile={ui.mobile} />}
    </div>
  );
}

// Cổng của route #/quotes/:id: không có quote.read (gõ thẳng địa chỉ) => trang "không có quyền", KHÔNG gọi máy chủ (mục 10, ca C4).
export function QuoteRoute({ ui, id, allowed }) {
  if (!allowed) return <div className="sg-card sg-solid"><EmptyState icon="lock" title="Không có quyền xem báo giá" description="Tài khoản của bạn không được xem báo giá." action={<Button onClick={() => ui.navigate('/customers')}>Về danh sách khách hàng</Button>} /></div>;
  return <QuoteView ui={ui} id={id} />;
}
