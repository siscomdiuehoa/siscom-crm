import React from 'react';
import { Avatar, Badge, Button, EmptyState, Icon, Input, Select } from '../../ds/index.js';
import * as U from '../../data/util.js';
import { ApiErrorBox } from '../customers/ApiListStatus.jsx';
import { useCustomerApiState } from '../customers/useCustomerApi.js';
import { TYPE_META, ALL_TYPES, STATUS_META, OVERDUE_LABEL, allowedTypes, activityVisual, isOverdue } from './activityModel.js';
import { ActivityDrawer } from './ActivityDrawer.jsx';
import { TaskActions } from './TaskActions.jsx';

const TONE = {
  blue: ['var(--primary-soft)', 'var(--primary)'], success: ['var(--success-soft)', 'var(--success)'], warning: ['var(--warning-soft)', 'var(--warning)'],
  error: ['var(--error-soft)', 'var(--error)'], neutral: ['var(--neutral-soft)', 'var(--text-2)'],
};
const TYPE_OPTIONS = [{ value: '', label: 'Tất cả loại' }].concat(ALL_TYPES.map((t) => ({ value: t, label: TYPE_META[t].label, icon: TYPE_META[t].icon })));
const STATUS_OPTIONS = [{ value: '', label: 'Mọi trạng thái' }].concat(Object.keys(STATUS_META).map((k) => ({ value: k, label: STATUS_META[k].label })));
const clamp = { display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere' };

function ActivityItem({ a, now, ui }) {
  const v = activityVisual(a, now); const t = TONE[v.tone] || TONE.neutral; const m = TYPE_META[a.type] || { label: a.type };
  const overdue = isOverdue(a, now);
  const when = a.type === 'TASK' ? 'Hạn ' + U.dtVN(a.dueAt) : U.dtVN(a.occurredAt);
  return (
    <li className="sg-feed__item">
      <span className="sg-feed__icon" style={{ background: t[0], color: t[1] }}><Icon name={v.icon} size={16} /></span>
      <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <b style={{ font: 'var(--type-sm)', fontWeight: 600 }}>{m.label}</b>
          {a.title ? <span style={{ font: 'var(--type-sm)', color: 'var(--text-1)', overflowWrap: 'anywhere' }}>{'· ' + a.title}</span> : null}
          {a.type === 'TASK' ? <Badge size="sm" dot tone={overdue ? 'error' : (STATUS_META[a.status] || {}).tone}>{overdue ? OVERDUE_LABEL : (STATUS_META[a.status] || { label: a.status }).label}</Badge> : null}
        </div>
        <p className="sg-feed__text" style={{ ...clamp, margin: 0, whiteSpace: 'pre-line' }}>{a.content}</p>
        {a.outcome ? <p style={{ ...clamp, margin: 0, font: 'var(--type-sm)', color: 'var(--text-2)' }}><span style={{ color: 'var(--text-3)' }}>Kết quả: </span>{a.outcome}</p> : null}
        <div className="sg-feed__meta" style={{ flexWrap: 'wrap', rowGap: 4 }}>
          {a.performedBy ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Avatar name={a.performedBy.fullName} size={18} />{a.performedBy.fullName}</span> : null}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: overdue ? 'var(--error-text)' : undefined }}><Icon name="clock" size={12} />{when}</span>
          {a.contact ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="contact" size={12} />{a.contact.fullName}</span> : null}
        </div>
        {ui && ui.customerApi && ui.customerApi.tasks ? <div><TaskActions ui={ui} a={a} /></div> : null}
      </div>
    </li>
  );
}

// B3 A7: tab Hoạt động của khách (§8). Danh sách do CustomerApiDetail tải (để tab hiện số); panel lọc/tải thêm/ghi nhận.
export function ActivitiesPanel({ ui, customerId }) {
  const actl = ui.customerApi.activities;
  const s = useCustomerApiState(actl);
  const l = s.list.customerId === customerId ? s.list : { status: 'idle', filters: {}, items: [], page: 0, totalPages: 0, total: 0, more: 'idle' };
  const [drawer, setDrawer] = React.useState(false);
  const canCreate = allowedTypes(ui.can).length > 0; // mờ nếu !(activity.create || activity.create_tech); máy chủ luôn kiểm lại
  const f = l.filters || {};
  const setFilter = (k) => (v) => {
    const val = v && v.target ? v.target.value : v; const next = { ...f, [k]: val };
    if (next.from && next.to && next.from > next.to) { actl.load(customerId, { ...next, [k === 'from' ? 'to' : 'from']: '' }); return; } // khoảng ngày ngược: bỏ đầu kia, không gửi khoảng sai
    actl.load(customerId, next);
  };
  const now = Date.now();
  const mobile = !!ui.mobile;
  const createBtn = mobile
    ? <button type="button" aria-label="Ghi nhận hoạt động" disabled={!canCreate} className="sg-glass-strong" onClick={() => canCreate && setDrawer(true)}
        style={{ position: 'fixed', right: 16, bottom: 'calc(16px + env(safe-area-inset-bottom))', width: 56, height: 56, borderRadius: '50%', border: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)', zIndex: 40, opacity: canCreate ? 1 : 0.5, cursor: canCreate ? 'pointer' : 'not-allowed' }}><Icon name="plus" size={24} /></button>
    : <Button icon="plus" aria-label="Ghi nhận hoạt động" disabled={!canCreate} onClick={() => canCreate && setDrawer(true)}>Ghi nhận hoạt động</Button>;
  return (
    <section className="sg-card sg-solid" style={{ padding: mobile ? '12px 14px' : '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div role="group" aria-label="Lọc theo loại" style={{ minWidth: 0, flex: '1 1 170px' }}><Select size="sm" value={f.type || ''} onChange={setFilter('type')} options={TYPE_OPTIONS} /></div>
        <div role="group" aria-label="Lọc theo trạng thái" style={{ minWidth: 0, flex: '1 1 150px' }}><Select size="sm" value={f.status || ''} onChange={setFilter('status')} options={STATUS_OPTIONS} /></div>
        <div style={{ minWidth: 0, flex: '1 1 140px' }}><Input size="sm" type="date" aria-label="Từ ngày" value={f.from || ''} onChange={setFilter('from')} /></div>
        <div style={{ minWidth: 0, flex: '1 1 140px' }}><Input size="sm" type="date" aria-label="Đến ngày" value={f.to || ''} onChange={setFilter('to')} /></div>
        {mobile ? null : <div style={{ marginLeft: 'auto' }}>{createBtn}</div>}
      </div>
      {l.status === 'loading' || l.status === 'idle' ? <div role="status" aria-live="polite" style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-2)', padding: '12px 0' }}><span className="sg-btn__spin" />Đang tải hoạt động…</div> : null}
      {l.status === 'error' ? <ApiErrorBox error={l.error} onRetry={() => actl.reload()} /> : null}
      {l.status === 'ready' && !l.items.length ? <EmptyState compact icon="list-checks" title="Chưa có hoạt động" description={f.type || f.status || f.from || f.to ? 'Không có hoạt động khớp bộ lọc.' : canCreate ? 'Bấm "Ghi nhận hoạt động" để thêm cuộc gọi, ghi chú, công việc…' : undefined} /> : null}
      {l.status === 'ready' && l.refreshError ? <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', font: 'var(--type-sm)', color: 'var(--warning-text, var(--text-2))' }}><span>Không tải lại được dòng thời gian — dữ liệu đang hiển thị có thể đã cũ.</span><Button size="sm" variant="secondary" onClick={() => actl.reload()}>Thử lại</Button></div> : null}
      {l.status === 'ready' && l.items.length ? (
        <>
          <div style={{ font: 'var(--type-sm)', color: 'var(--text-3)' }}>{l.items.length + ' / ' + l.total + ' hoạt động · giờ Việt Nam'}</div>
          <ul className="sg-feed" style={{ margin: 0 }}>{l.items.map((a) => <ActivityItem key={a.id} a={a} now={now} ui={ui} />)}</ul>
          {l.more === 'error' && l.moreError ? <ApiErrorBox error={l.moreError} /> : null}
          {l.page < l.totalPages ? <div style={{ display: 'flex', justifyContent: 'center' }}><Button variant="secondary" size="sm" loading={l.more === 'loading'} onClick={() => actl.loadMore()}>Tải thêm</Button></div> : null}
        </>
      ) : null}
      {mobile ? createBtn : null}
      <ActivityDrawer open={drawer && canCreate} ui={ui} customerId={customerId} onClose={() => setDrawer(false)} onSaved={() => setDrawer(false)} />
    </section>
  );
}
