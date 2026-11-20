import React from 'react';
import { Avatar, Button, Icon } from '../../ds/index.js';
import { ApiErrorBox } from '../customers/ApiListStatus.jsx';
import { moneyVN, dateVN, isCloseOverdue, opportunityActions, columnTotalLabel, summaryTotalLabel, summaryOf } from './opportunitiesModel.js';
import { scopeOfUi, useStageMove } from './OpportunityActions.jsx';

// Sales S11: kanban theo giai đoạn (§8.1). Mỗi cột = cơ hội ĐANG MỞ của một giai đoạn, do máy chủ lọc theo phạm vi (GET /opportunities?status=OPEN&stageId=…).
// Tạm hoãn và đã đóng nằm ngoài kanban. T-04: tổng của cột lấy từ GET /opportunities/board-summary — CHÍNH XÁC trên mọi cơ hội đang mở của cột (không
// chỉ thẻ đã tải), tách riêng số "chưa rõ giá trị" (không cộng như 0); kèm số Tạm hoãn (báo lên trang qua onSummary). Không đọc được tổng => quay về
// tổng trên các thẻ ĐÃ TẢI và ghi rõ "x / y thẻ" như trước. Kéo thả hoặc nút "Chuyển giai đoạn" đều mở hộp thoại xác nhận (máy chủ kiểm quy tắc).
const idle = { status: 'loading', items: [], total: 0, page: 0, totalPages: 0, error: null, more: 'idle' };

export function OpportunityKanban({ ui, meta, typeId = '', q = '', onSummary }) {
  const opps = ui.customerApi.opportunities;
  const stages = (meta && meta.stages) || [];
  const [cols, setCols] = React.useState({});
  const [tick, setTick] = React.useState(0);
  const [over, setOver] = React.useState(null);
  const [summary, setSummary] = React.useState(null); // T-04: { stages, onHoldCount } hoặc null (đang tải / lỗi => dùng tổng trên thẻ đã tải)
  const report = React.useRef(onSummary); report.current = onSummary;
  const drag = React.useRef(null);
  const seq = React.useRef(0);
  const lastKey = React.useRef(null);
  const key = typeId + '|' + q + '|' + stages.map((x) => x.id).join(',');
  React.useEffect(() => {
    const my = ++seq.current;
    if (lastKey.current !== key) { lastKey.current = key; setCols({}); setSummary(null); } // bộ lọc đổi => tải lại từ đầu; chỉ tick đổi => giữ thẻ tới khi có dữ liệu mới
    if (typeof opps.boardSummary === 'function') {
      opps.boardSummary({ typeId, q }).then((r) => {
        if (my !== seq.current) return;
        const s = r.ok && r.data && Array.isArray(r.data.stages) ? r.data : null;
        setSummary(s);
        if (typeof report.current === 'function') report.current(s);
      });
    }
    stages.forEach((st) => {
      opps.board(st.id, { typeId, q }, 1).then((r) => {
        if (my !== seq.current) return;
        setCols((x) => ({ ...x, [st.id]: r.ok ? { ...idle, status: 'ready', items: r.data.items, total: r.data.total, page: r.data.page || 1, totalPages: r.data.totalPages } : { ...idle, status: 'error', error: r.error } }));
      });
    });
  }, [opps, key, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const reload = () => setTick((t) => t + 1);
  const mover = useStageMove(ui, reload);
  const loadMore = async (st) => {
    const c = cols[st.id]; if (!c || c.status !== 'ready' || c.more === 'loading' || c.page >= c.totalPages) return;
    const my = seq.current; setCols((x) => ({ ...x, [st.id]: { ...x[st.id], more: 'loading' } }));
    const r = await opps.board(st.id, { typeId, q }, c.page + 1);
    if (my !== seq.current) return;
    setCols((x) => { const cur = x[st.id]; if (!cur) return x; if (!r.ok) return { ...x, [st.id]: { ...cur, more: 'error', moreError: r.error } }; const seen = new Set(cur.items.map((o) => o.id)); return { ...x, [st.id]: { ...cur, items: cur.items.concat(r.data.items.filter((o) => !seen.has(o.id))), total: r.data.total, page: r.data.page || cur.page + 1, totalPages: r.data.totalPages, more: 'idle' } }; });
  };
  const actx = { scopeOf: scopeOfUi(ui), meId: ui.me ? ui.me.employeeId : null };
  const canMove = (o) => opportunityActions(o, actx).includes('stage');
  const open = (o) => ui.navigate('/pipeline/view/' + encodeURIComponent(o.id));
  const dropOn = (st) => { const o = drag.current; drag.current = null; setOver(null); if (o && o.stage && o.stage.id !== st.id && canMove(o)) mover.start(o, st.id); };
  return (
    <>
      <div role="list" aria-label="Kanban theo giai đoạn" style={{ display: 'grid', gridTemplateColumns: 'repeat(' + Math.max(stages.length, 1) + ', minmax(230px, 1fr))', gap: 12, overflowX: 'auto', alignItems: 'start', paddingBottom: 4 }}>
        {stages.map((st) => {
          const c = cols[st.id] || idle;
          const exact = summary ? summaryOf(summary, st.id) : null;
          const total = exact ? summaryTotalLabel(exact) : c.status === 'ready' ? columnTotalLabel(c.items) : '';
          const partial = !exact && c.status === 'ready' && c.items.length < c.total;
          return (
            <section key={st.id} role="listitem" aria-label={'Giai đoạn ' + st.label}
              onDragOver={(e) => { const o = drag.current; if (o && o.stage && o.stage.id !== st.id) { e.preventDefault(); if (over !== st.id) setOver(st.id); } }}
              onDragLeave={() => { if (over === st.id) setOver(null); }} onDrop={(e) => { e.preventDefault(); dropOn(st); }}
              style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, padding: 10, borderRadius: 14, background: 'var(--surface-sunken)', border: '1px solid ' + (over === st.id ? 'var(--primary)' : 'var(--border-subtle)') }}>
              <header style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}><b style={{ font: 'var(--type-sm)', fontWeight: 600 }}>{st.label}</b><span style={{ font: 'var(--type-caption)', color: 'var(--text-3)' }}>{c.status === 'ready' ? '· ' + c.total : ''}</span></div>
                <div style={{ font: 'var(--type-caption)', color: 'var(--text-2)', minHeight: 16 }}>{total}{partial ? (total ? ' · ' : '') + 'tính trên ' + c.items.length + ' / ' + c.total + ' thẻ đã tải' : ''}</div>
              </header>
              {c.status === 'loading' ? <div role="status" style={{ font: 'var(--type-sm)', color: 'var(--text-3)', padding: '8px 0' }}>Đang tải…</div> : null}
              {c.status === 'error' ? <ApiErrorBox error={c.error} onRetry={reload} /> : null}
              {c.status === 'ready' && !c.items.length ? <div style={{ font: 'var(--type-sm)', color: 'var(--text-3)', padding: '8px 0' }}>Không có cơ hội đang mở.</div> : null}
              {c.items.map((o) => {
                const movable = canMove(o); const late = isCloseOverdue(o);
                return (
                  <article key={o.id} className="sg-card sg-solid" draggable={movable} aria-label={o.code + ' ' + o.title}
                    onDragStart={(e) => { drag.current = o; try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', o.code); } catch (err) { /* trình duyệt cũ */ } }}
                    onDragEnd={() => { drag.current = null; setOver(null); }}
                    style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, cursor: movable ? 'grab' : 'default' }}>
                    <span style={{ font: 'var(--type-mono)', color: 'var(--text-3)' }}>{o.code}</span>
                    <a href={'#/pipeline/view/' + encodeURIComponent(o.id)} onClick={(e) => { e.preventDefault(); open(o); }} style={{ fontWeight: 600, font: 'var(--type-sm)', overflowWrap: 'anywhere' }}>{o.title}</a>
                    <span style={{ font: 'var(--type-caption)', color: 'var(--text-2)', overflowWrap: 'anywhere' }}>{o.customer ? o.customer.name : '—'}</span>
                    {o.access === 'FULL' ? <span style={{ font: 'var(--type-sm)' }}><span style={{ color: o.expectedAmountVnd === null ? 'var(--text-3)' : undefined }}>{moneyVN(o.expectedAmountVnd)}</span>{' · ' + o.probability + '%'}</span> : null}
                    <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', font: 'var(--type-caption)', color: late ? 'var(--error-text)' : 'var(--text-3)' }}>
                      {o.expectedCloseDate ? <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>{late ? <Icon name="triangle-alert" size={12} /> : null}{(late ? 'Quá hạn chốt ' : 'Chốt ') + dateVN(o.expectedCloseDate)}</span> : null}
                      {o.owner ? <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', color: 'var(--text-3)' }}><Avatar name={o.owner.fullName} size={16} />{o.owner.fullName}</span> : null}
                    </span>
                    {movable ? <div><Button size="sm" variant="ghost" icon="arrow-right" loading={mover.pendingId === o.id} onClick={() => mover.start(o)}>Chuyển giai đoạn</Button></div> : null}
                  </article>
                );
              })}
              {c.more === 'error' && c.moreError ? <ApiErrorBox error={c.moreError} /> : null}
              {c.status === 'ready' && c.page < c.totalPages ? <Button size="sm" variant="secondary" loading={c.more === 'loading'} onClick={() => loadMore(st)}>Tải thêm</Button> : null}
            </section>
          );
        })}
      </div>
      {mover.element}
    </>
  );
}
