import React from 'react';
import { Avatar, Badge, Button, EmptyState, Icon, Select, Tabs } from '../../ds/index.js';
import * as U from '../../data/util.js';
import { ApiErrorBox } from '../customers/ApiListStatus.jsx';
import { useCustomerApiState } from '../customers/useCustomerApi.js';
import { TYPE_META, STATUS_META, OVERDUE_LABEL, isOverdue } from './activityModel.js';
import { scopeTabs, DUE_FILTERS, transferStatusLabel, TRANSFER_TONE } from './tasksModel.js';
import { TaskActions } from './TaskActions.jsx';

const STATUS_OPTIONS = [{ value: '', label: 'Mọi trạng thái' }, { value: 'OPEN', label: 'Đang mở' }, { value: 'DONE', label: 'Hoàn thành' }, { value: 'CANCELLED', label: 'Đã huỷ' }];
const TYPE_OPTIONS = [{ value: 'TASK', label: 'Công việc' }, { value: 'MEETING', label: 'Gặp mặt' }, { value: '', label: 'Mọi loại có hạn' }];
const cell = { padding: '10px 8px', borderBottom: '1px solid var(--border-subtle)', verticalAlign: 'top', font: 'var(--type-sm)' };

function StatusBadge({ a, now }) {
  const od = isOverdue(a, now); const m = STATUS_META[a.status] || { label: a.status, tone: 'neutral' };
  return <Badge size="sm" dot tone={od ? 'error' : m.tone}>{od ? OVERDUE_LABEL : m.label}</Badge>;
}
function CustomerLink({ ui, a }) {
  const c = a.customer; if (!c) return <span style={{ color: 'var(--text-3)' }}>—</span>;
  if (a.access === 'TASK') return <span title="Bạn chỉ có quyền theo việc: không mở được hồ sơ khách">{c.name}</span>;
  return <a href={'#/customers/' + encodeURIComponent(c.id)} onClick={(e) => { e.preventDefault(); ui.navigate('/customers/' + c.id); }}>{c.name}</a>;
}
const openTask = (ui, a) => ui.navigate('/activities/view/' + encodeURIComponent(a.id));
const titleOf = (a) => a.title || (a.content || '').slice(0, 80) || (TYPE_META[a.type] || {}).label;

function Kpi({ label, value, tone, active, onClick }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className="sg-card sg-solid"
      style={{ flex: '1 0 130px', minWidth: 0, padding: '12px 14px', textAlign: 'left', cursor: 'pointer', border: active ? '1px solid var(--primary)' : '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ font: 'var(--type-caption)', color: 'var(--text-3)' }}>{label}</span>
      <b style={{ font: 'var(--type-h3)', color: tone }}>{value == null ? '—' : value}</b>
    </button>
  );
}

function Transfers({ ui }) {
  const tasks = ui.customerApi.tasks; const s = useCustomerApiState(tasks); const t = s.transfers;
  React.useEffect(() => { tasks.loadTransfers(); }, [tasks]);
  const decide = async (kind, x) => {
    // F-A8-01: duyệt phải gửi phiên bản việc (máy chủ bắt buộc, khoá lạc quan); lấy từ hộp đến (activity.version).
    const r = await tasks.decide(kind, x, kind === 'approve' ? { version: x.activity && x.activity.version } : {});
    if (r.ok) ui.toast({ tone: 'success', title: kind === 'approve' ? 'Đã duyệt chuyển' : kind === 'reject' ? 'Đã từ chối' : 'Đã rút đề xuất', message: x.activity ? x.activity.code : '' });
    else if (!r.duplicate) ui.toast({ tone: 'error', title: r.error.title, message: r.error.message });
  };
  if (t.status === 'error') return <ApiErrorBox error={t.error} onRetry={() => tasks.loadTransfers()} />;
  if (t.status !== 'ready') return <div role="status" style={{ color: 'var(--text-2)', padding: 8 }}>Đang tải đề xuất chuyển…</div>;
  const canDecide = typeof ui.can === 'function' && ui.can('activity.assign');
  const row = (x, box) => (
    <li key={x.id} className="sg-feed__item" style={{ flexWrap: 'wrap' }}>
      <span className="sg-feed__icon"><Icon name="arrow-right-left" size={15} /></span>
      <div style={{ minWidth: 0, flex: '1 1 220px' }}>
        <p className="sg-feed__text" style={{ margin: 0 }}><b>{x.activity ? x.activity.code : ''}</b>{x.activity && x.activity.title ? ' · ' + x.activity.title : ''}{x.customer ? ' · ' + x.customer.name : ''}</p>
        <div className="sg-feed__meta" style={{ flexWrap: 'wrap' }}><span>{(x.from ? x.from.fullName : '?') + ' → ' + (x.to ? x.to.fullName : '?')}</span><span>{'Lý do: ' + (x.reason || '')}</span><span>{U.dtVN(x.createdAt)}</span><Badge size="sm" tone={TRANSFER_TONE[x.status]}>{transferStatusLabel(x.status)}</Badge></div>
      </div>
      {x.status === 'PENDING' && box === 'inbox' && canDecide ? <span style={{ display: 'inline-flex', gap: 6 }}><Button size="sm" icon="check" onClick={() => decide('approve', x)}>Duyệt</Button><Button size="sm" variant="secondary" icon="x" onClick={() => decide('reject', x)}>Từ chối</Button></span> : null}
      {x.status === 'PENDING' && box === 'outbox' ? <Button size="sm" variant="secondary" icon="undo-2" onClick={() => decide('withdraw', x)}>Rút đề xuất</Button> : null}
    </li>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h3 style={{ margin: 0, font: 'var(--type-h4)' }}>Chờ tôi duyệt ({t.inbox.filter((x) => x.status === 'PENDING').length})</h3>
      {t.inbox.length ? <ul className="sg-feed" style={{ margin: 0 }}>{t.inbox.map((x) => row(x, 'inbox'))}</ul> : <div style={{ color: 'var(--text-3)', font: 'var(--type-sm)' }}>Không có đề xuất nào.</div>}
      <h3 style={{ margin: '8px 0 0', font: 'var(--type-h4)' }}>Tôi đã đề xuất</h3>
      {t.outbox.length ? <ul className="sg-feed" style={{ margin: 0 }}>{t.outbox.map((x) => row(x, 'outbox'))}</ul> : <div style={{ color: 'var(--text-3)', font: 'var(--type-sm)' }}>Chưa có đề xuất.</div>}
    </div>
  );
}

// B3 A8: "Công việc của tôi" (#/activities[/:filter]). Dữ liệu chỉ từ API A6; phạm vi do máy chủ quyết định.
export default function TasksPage({ ui, filter = 'all' }) {
  const tasks = ui.customerApi.tasks;
  const s = useCustomerApiState(tasks);
  const tabs = scopeTabs((p) => ui.me && ui.me.permissions && ui.me.permissions[p]);
  const approvals = filter === 'approvals';
  const [f, setF] = React.useState(() => ({ tab: 'mine', due: approvals ? 'all' : filter, status: '', type: 'TASK' }));
  React.useEffect(() => { if (!approvals) setF((x) => ({ ...x, due: filter })); }, [filter, approvals]);
  React.useEffect(() => { tasks.loadSummary(); }, [tasks]);
  React.useEffect(() => { if (!approvals) tasks.load(f); }, [tasks, f, approvals]);
  const sum = s.summary.data; const l = s.list; const now = Date.now(); const mobile = !!ui.mobile;
  const go = (path) => ui.navigate(path);
  const setFilter = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  if (!tabs.length) return <div className="sg-card sg-solid"><EmptyState icon="lock" title="Không có quyền xem công việc" description="Tài khoản chưa được cấp quyền activity.read." /></div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 2 }} role="group" aria-label="Tóm tắt công việc">
        <Kpi label="Quá hạn" value={sum && sum.overdue} tone="var(--error-text)" active={!approvals && f.due === 'overdue'} onClick={() => go('/activities/overdue')} />
        <Kpi label="Hôm nay" value={sum && sum.today} tone="var(--warning-text)" active={!approvals && f.due === 'today'} onClick={() => go('/activities/today')} />
        <Kpi label="7 ngày tới" value={sum && sum.upcoming7d} tone="var(--primary-text)" active={!approvals && f.due === 'week'} onClick={() => go('/activities/week')} />
        <Kpi label="Chờ tôi duyệt" value={sum && sum.pendingApprovals} tone="var(--text-1)" active={approvals} onClick={() => go('/activities/approvals')} />
      </div>
      {s.summary.status === 'error' ? <ApiErrorBox error={s.summary.error} onRetry={() => tasks.loadSummary()} /> : null}
      {approvals ? <section className="sg-card sg-solid" style={{ padding: mobile ? 14 : 20 }}><div style={{ marginBottom: 10 }}><Button size="sm" variant="ghost" icon="arrow-left" onClick={() => go('/activities')}>Danh sách công việc</Button></div><Transfers ui={ui} /></section> : (
        <section className="sg-card sg-solid" style={{ padding: mobile ? 12 : 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
            <Tabs value={f.tab} onChange={setFilter('tab')} items={tabs} />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', flex: '1 1 300px', justifyContent: 'flex-end' }}>
              <div role="group" aria-label="Lọc theo hạn" style={{ flex: '1 1 130px', maxWidth: 200 }}><Select size="sm" value={f.due} onChange={(v) => go('/activities/' + v)} options={DUE_FILTERS} /></div>
              <div role="group" aria-label="Lọc theo trạng thái" style={{ flex: '1 1 150px', maxWidth: 200 }}><Select size="sm" value={f.status} onChange={setFilter('status')} options={STATUS_OPTIONS} /></div>
              <div role="group" aria-label="Lọc theo loại" style={{ flex: '1 1 130px', maxWidth: 200 }}><Select size="sm" value={f.type} onChange={setFilter('type')} options={TYPE_OPTIONS} /></div>
            </div>
          </div>
          {l.status === 'loading' || l.status === 'idle' ? <div role="status" style={{ color: 'var(--text-2)', padding: '12px 0' }}>Đang tải công việc…</div> : null}
          {l.status === 'error' ? <ApiErrorBox error={l.error} onRetry={() => tasks.reload()} /> : null}
          {l.status === 'ready' && l.refreshError ? <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', font: 'var(--type-sm)', color: 'var(--warning-text, var(--text-2))' }}><span>Không tải lại được danh sách — dữ liệu đang hiển thị có thể đã cũ.</span><Button size="sm" variant="secondary" onClick={() => tasks.reload()}>Thử lại</Button></div> : null}
          {l.status === 'ready' && !l.items.length ? <EmptyState compact icon="list-checks" title="Không có công việc" description="Không có việc khớp bộ lọc trong phạm vi của bạn." /> : null}
          {l.status === 'ready' && l.items.length ? (
            <>
              <div style={{ font: 'var(--type-sm)', color: 'var(--text-3)' }}>{l.items.length + ' / ' + l.total + ' việc · giờ Việt Nam'}</div>
              {mobile ? (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {l.items.map((a) => (
                    <li key={a.id} className="sg-card sg-solid" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><StatusBadge a={a} now={now} /><span style={{ font: 'var(--type-caption)', color: isOverdue(a, now) ? 'var(--error-text)' : 'var(--text-3)' }}>{'Hạn ' + U.dtVN(a.dueAt)}</span></div>
                      <a href={'#/activities/view/' + a.id} onClick={(e) => { e.preventDefault(); openTask(ui, a); }} style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{titleOf(a)}</a>
                      <div style={{ font: 'var(--type-sm)', color: 'var(--text-2)', overflowWrap: 'anywhere' }}><CustomerLink ui={ui} a={a} />{a.performedBy ? ' · ' + a.performedBy.fullName : ''}</div>
                      <div><TaskActions ui={ui} a={a} /></div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr style={{ textAlign: 'left', color: 'var(--text-3)', font: 'var(--type-caption)' }}>{['Hạn', 'Tiêu đề', 'Khách hàng', 'Phụ trách', 'Trạng thái', ''].map((h, i) => <th key={i} style={{ ...cell, fontWeight: 600 }}>{h}</th>)}</tr></thead>
                    <tbody>{l.items.map((a) => (
                      <tr key={a.id}>
                        <td style={{ ...cell, whiteSpace: 'nowrap', color: isOverdue(a, now) ? 'var(--error-text)' : undefined }}>{U.dtVN(a.dueAt)}</td>
                        <td style={{ ...cell, maxWidth: 320 }}><a href={'#/activities/view/' + a.id} onClick={(e) => { e.preventDefault(); openTask(ui, a); }} style={{ fontWeight: 500, overflowWrap: 'anywhere' }}>{titleOf(a)}</a>{a.assigneeLostAccess ? <div style={{ color: 'var(--warning-text)', font: 'var(--type-caption)' }}>Người phụ trách đã mất quyền xem khách</div> : null}</td>
                        <td style={cell}><CustomerLink ui={ui} a={a} /></td>
                        <td style={cell}>{a.performedBy ? <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><Avatar name={a.performedBy.fullName} size={20} />{a.performedBy.fullName}</span> : '—'}</td>
                        <td style={cell}><StatusBadge a={a} now={now} /></td>
                        <td style={{ ...cell, whiteSpace: 'nowrap', textAlign: 'right' }}><TaskActions ui={ui} a={a} /></td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
              {l.more === 'error' && l.moreError ? <ApiErrorBox error={l.moreError} /> : null}
              {l.page < l.totalPages ? <div style={{ display: 'flex', justifyContent: 'center' }}><Button variant="secondary" size="sm" loading={l.more === 'loading'} onClick={() => tasks.loadMore()}>Tải thêm</Button></div> : null}
            </>
          ) : null}
        </section>
      )}
    </div>
  );
}

// #/activities/view/:id — chi tiết một việc. Người chỉ có quyền theo việc thấy THẺ VIỆC tối giản (không link hồ sơ khách).
export function TaskView({ ui, id }) {
  const tasks = ui.customerApi.tasks;
  const s = useCustomerApiState(tasks);
  const [st, setSt] = React.useState({ status: 'loading', a: null, card: null, error: null });
  const load = React.useCallback(async () => {
    const r = await tasks.get(id);
    // Người chỉ có quyền theo việc: hoàn thành/được giao lại => quyền kết thúc, đọc lại trả 404. Đó là kết quả đúng, không phải lỗi.
    if (!r.ok) { setSt((prev) => (prev.a && prev.a.access === 'TASK' && r.error.kind === 'not_found' ? { status: 'gone', a: prev.a, card: null, error: null } : { status: 'error', a: null, card: null, error: r.error })); return; }
    const card = r.data.access === 'TASK' ? await tasks.workCard(id) : null;
    setSt({ status: 'ready', a: r.data, card: card && card.ok ? card.data : null, error: null });
  }, [tasks, id]);
  React.useEffect(() => { load(); }, [load, s.summary.data]); // đọc lại sau mỗi thao tác (chuông đổi)
  const back = <div><Button variant="ghost" size="sm" icon="arrow-left" onClick={() => ui.navigate('/activities')}>Công việc</Button></div>;
  if (st.status === 'loading') return <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>{back}<div role="status" className="sg-card sg-solid" style={{ padding: 20 }}>Đang tải công việc…</div></div>;
  if (st.status === 'gone') return <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>{back}<div role="status" className="sg-card sg-solid" style={{ padding: 20, display: 'flex', gap: 10, alignItems: 'center' }}><Icon name="circle-check" size={18} color="var(--success)" />{(st.a.code ? st.a.code + ': ' : '') + 'Việc đã được cập nhật; quyền theo việc của bạn đã kết thúc.'}</div></div>;
  if (st.status === 'error') return <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>{back}<ApiErrorBox error={st.error} onRetry={load} /></div>;
  const a = st.a; const c = st.card ? st.card.customer : a.customer; const now = Date.now();
  const row = (icon, label, v) => (v ? <div style={{ display: 'grid', gridTemplateColumns: '20px 110px minmax(0,1fr)', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border-subtle)', font: 'var(--type-sm)' }}><Icon name={icon} size={15} color="var(--text-3)" /><span style={{ color: 'var(--text-3)' }}>{label}</span><span style={{ overflowWrap: 'anywhere', whiteSpace: 'pre-line' }}>{v}</span></div> : null);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {back}
      <section className="sg-card sg-glass" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><span style={{ font: 'var(--type-mono)', color: 'var(--text-3)' }}>{a.code}</span><Badge size="sm">{(TYPE_META[a.type] || {}).label || a.type}</Badge><StatusBadge a={a} now={now} />{a.access === 'TASK' ? <Badge size="sm" tone="warning">Quyền theo việc{a.accessExpiresAt ? ' đến ' + U.dtVN(a.accessExpiresAt) : ''}</Badge> : null}</div>
        <h2 style={{ margin: 0, font: 'var(--type-h2)', overflowWrap: 'anywhere' }}>{titleOf(a)}</h2>
        <div><TaskActions ui={ui} a={a} size="md" /></div>
      </section>
      <section className="sg-card sg-solid" style={{ padding: '12px 20px' }}>
        {row('clock', 'Hạn', a.dueAt ? U.dtVN(a.dueAt) : null)}
        {row('bell', 'Nhắc lúc', a.remindAt ? U.dtVN(a.remindAt) : null)}
        {row('user', 'Phụ trách', a.performedBy ? a.performedBy.fullName + ' (' + a.performedBy.code + ')' : null)}
        {row('file-text', 'Nội dung', a.content)}
        {row('circle-check', 'Kết quả', a.outcome)}
        {row('calendar', 'Hoàn thành lúc', a.completedAt ? U.dtVN(a.completedAt) : null)}
      </section>
      {c ? (
        <section className="sg-card sg-solid" style={{ padding: '12px 20px' }}>
          <h3 style={{ margin: '4px 0', font: 'var(--type-h4)' }}>Khách hàng</h3>
          {row('building-2', 'Tên', a.access === 'TASK' ? c.name : <a href={'#/customers/' + c.id} onClick={(e) => { e.preventDefault(); ui.navigate('/customers/' + c.id); }}>{c.name}</a>)}
          {st.card ? <>{row('map-pin', 'Địa chỉ', [c.address, c.provinceName].filter(Boolean).join(', '))}{row('phone', 'Điện thoại', c.phone)}{st.card.contact ? row('contact', 'Liên hệ', [st.card.contact.fullName, st.card.contact.title, st.card.contact.phone].filter(Boolean).join(' · ')) : null}</> : null}
          {a.access === 'TASK' ? <p style={{ margin: '8px 0 4px', font: 'var(--type-caption)', color: 'var(--text-3)' }}>Bạn được giao việc này từ phòng khác: chỉ xem thẻ việc, không mở được hồ sơ khách.</p> : null}
        </section>
      ) : null}
      {Array.isArray(a.taskAccesses) && a.taskAccesses.length ? (
        <section className="sg-card sg-solid" style={{ padding: '12px 20px' }}>
          <h3 style={{ margin: '4px 0', font: 'var(--type-h4)' }}>Người có quyền theo việc</h3>
          {a.taskAccesses.map((t, i) => <div key={i} style={{ font: 'var(--type-sm)', padding: '6px 0' }}>{t.employee.fullName + ' (' + t.employee.code + ') · đến ' + U.dtVN(t.expiresAt)}</div>)}
        </section>
      ) : null}
    </div>
  );
}
