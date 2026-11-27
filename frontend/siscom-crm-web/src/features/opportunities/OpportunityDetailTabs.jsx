import React from 'react';
import { Avatar, Badge, Button, EmptyState, Icon, IconButton, Input, Modal, Select, Switch, Tabs } from '../../ds/index.js';
import * as U from '../../data/util.js';
import { ApiErrorBox } from '../customers/ApiListStatus.jsx';
import { useCustomerApiState } from '../customers/useCustomerApi.js';
import { ActivityItem } from '../activities/ActivitiesPanel.jsx';
import { TYPE_META, ALL_TYPES, STATUS_META as ACTIVITY_STATUS, allowedTypes, hasTitle, hasDue, hasOutcome, hasOccurred } from '../activities/activityModel.js';
import { holdsUpdate, describeChange, DOC_KINDS, EMPTY_DOC, safeHttps, pagedReloadStart, pagedCanLoadMore } from './opportunitiesModel.js';
import { QuotesTab } from '../quotes/QuotesTab.jsx';

// Sales S10c: ba tab ở chi tiết cơ hội (§8.2) — Hoạt động & công việc (§5.5), Lịch sử thay đổi, Tài liệu (§6.14).
// Mọi dữ liệu do máy chủ lọc theo ĐƯỜNG TRUY CẬP: bản kỹ thuật chỉ thấy việc của chính mình và tài liệu nhóm Kỹ thuật, không có tab Lịch sử.
// Nút ghi chỉ là tiện ích giao diện theo me.permissions (fail-closed); máy chủ luôn kiểm lại. Thẻ ở đây là .sg-solid (không kính mờ) vì có hộp thoại.
const ctxOf = (ui) => ({ scopeOf: (p) => (ui && ui.me && ui.me.permissions ? ui.me.permissions[p] || null : null), meId: ui && ui.me ? ui.me.employeeId : null });
const TYPE_OPTIONS = [{ value: '', label: 'Tất cả loại' }].concat(ALL_TYPES.map((t) => ({ value: t, label: TYPE_META[t].label })));
const STATUS_OPTIONS = [{ value: '', label: 'Mọi trạng thái' }].concat(Object.keys(ACTIVITY_STATUS).map((k) => ({ value: k, label: ACTIVITY_STATUS[k].label })));
const loadingLine = (text) => <div role="status" aria-live="polite" style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-2)', padding: '12px 0' }}><span className="sg-btn__spin" />{text}</div>;
const emptyDraft = (type) => ({ type, title: '', content: '', outcome: '', occurredAt: '', dueAt: '', remindAt: '', contactId: '', performedById: '', external: false });
const canUi = (ui, p) => !!ui && typeof ui.can === 'function' && !!ui.can(p); // fail-closed
const personLabel = (e) => e.fullName + ' · ' + e.code + (e.departmentCode ? ' · ' + e.departmentCode : '');

// ───── Ghi nhận hoạt động gắn với cơ hội ─────
function ActivityDialog({ ui, o, types, onClose }) {
  const opps = ui.customerApi.opportunities;
  const s = useCustomerApiState(opps);
  const [f, setF] = React.useState(() => emptyDraft(types[0]));
  const [errs, setErrs] = React.useState({});
  const [error, setError] = React.useState(null);
  const busy = !!s.busy;
  // T-05: chọn "Người phụ trách" như drawer Ghi nhận ở khách (ActivityDrawer) — chỉ khi có activity.assign; ứng viên từ máy chủ theo KHÁCH của cơ hội
  // (GET /activities/assignee-candidates?customerId=…). Bật "Giao cho người phòng khác" (activity.assign_external, chỉ Công việc) => ứng viên external.
  const tasks = ui.customerApi.tasks;
  const customerId = o.customer ? o.customer.id : null;
  const canAssign = canUi(ui, 'activity.assign') && !!tasks && !!customerId;
  const canExternal = canAssign && canUi(ui, 'activity.assign_external');
  const extOn = canExternal && f.external === true && f.type === 'TASK';
  const [cands, setCands] = React.useState({ status: 'idle', items: [], error: null });
  React.useEffect(() => {
    if (!canAssign) return undefined;
    let live = true; setCands({ status: 'loading', items: [], error: null });
    tasks.candidates(customerId, extOn).then((r) => { if (live) setCands(r.ok ? { status: 'ready', items: r.items || [], error: null } : { status: 'error', items: [], error: r.error }); });
    return () => { live = false; };
  }, [tasks, customerId, canAssign, extOn]);
  const set = (k) => (v) => {
    const val = v && v.target ? v.target.value : v;
    // Đổi "phòng khác" hoặc rời loại Công việc khi đang giao ra ngoài => bỏ người đã chọn (danh sách ứng viên khác).
    setF((x) => ({ ...x, [k]: val, ...(k === 'external' || (k === 'type' && x.external && val !== 'TASK') ? { performedById: '' } : {}), ...(k === 'type' && val !== 'TASK' ? { external: false } : {}) }));
    setErrs((x) => { if (!x[k]) return x; const n = { ...x }; delete n[k]; return n; });
  };
  const submit = async () => {
    const r = await opps.createActivity(o.id, f);
    if (r.duplicate) return;
    if (r.ok) { ui.toast({ tone: 'success', title: 'Đã ghi nhận ' + (TYPE_META[r.data.type] || TYPE_META[f.type]).label.toLowerCase(), message: r.data.code || o.code }); onClose(); return; }
    setErrs(r.fieldErrors || {});
    setError(r.invalid ? null : r.error && r.error.extra && r.error.extra.length ? { ...r.error, message: r.error.extra.join('; ') } : Object.keys(r.fieldErrors || {}).length ? null : r.error);
  };
  return (
    <Modal open onClose={busy ? undefined : onClose} size="lg" icon="plus" title="Ghi nhận hoạt động" description={o.code + ' · ' + o.title}
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Huỷ</Button><Button icon="check" loading={busy} onClick={submit}>Lưu</Button></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ margin: 0, font: 'var(--type-sm)', color: 'var(--text-2)' }}>{'Hoạt động được gắn với cơ hội này và khách hàng của nó; ' + (canAssign ? 'người thực hiện mặc định là bạn, có thể chọn người phụ trách khác.' : 'người thực hiện là bạn.') + ' Giờ nhập theo giờ Việt Nam.'}</p>
        {error ? <ApiErrorBox error={error} /> : null}
        <div role="radiogroup" aria-label="Loại hoạt động" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {types.map((t) => {
            const on = f.type === t;
            return <button key={t} type="button" role="radio" aria-checked={on} className="sg-chip" disabled={busy} onClick={() => set('type')(t)} style={on ? { background: 'var(--primary-soft)', borderColor: 'transparent', color: 'var(--primary-text)' } : undefined}><Icon name={TYPE_META[t].icon} size={14} />{TYPE_META[t].label}</button>;
          })}
        </div>
        {f.type === 'TASK' ? <p role="note" style={{ margin: 0, font: 'var(--type-caption)', color: 'var(--text-3)' }}>{canAssign
          ? 'Để trống "Người phụ trách" thì công việc giao cho chính bạn; chọn người khác để giao việc (máy chủ kiểm lại quyền của người nhận với khách hàng).'
          : 'Công việc tạo ở đây được giao cho chính bạn. Nếu bạn phụ trách cơ hội nhưng không phụ trách khách hàng này, máy chủ sẽ từ chối tự nhận công việc; hãy nhờ người phụ trách khách hàng hoặc Quản trị CRM giao việc.'}</p> : null}
        {hasTitle(f.type) ? <Input label="Tiêu đề" maxLength={200} value={f.title} onChange={set('title')} error={errs.title} disabled={busy} /> : null}
        <Input label="Nội dung" required multiline rows={4} maxLength={4000} value={f.content} onChange={set('content')} error={errs.content} disabled={busy} />
        {hasOutcome(f.type) ? <Input label="Kết quả" multiline rows={2} maxLength={2000} value={f.outcome} onChange={set('outcome')} error={errs.outcome} disabled={busy} /> : null}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          {hasOccurred(f.type) ? <Input label="Thời điểm diễn ra" type="datetime-local" hint="Để trống = lúc lưu" value={f.occurredAt} onChange={set('occurredAt')} error={errs.occurredAt} disabled={busy} /> : null}
          {hasDue(f.type) ? <Input label="Hạn" required={f.type === 'TASK'} type="datetime-local" value={f.dueAt} onChange={set('dueAt')} error={errs.dueAt} disabled={busy} /> : null}
          {hasDue(f.type) ? <Input label="Nhắc lúc" type="datetime-local" hint="Không sau hạn" value={f.remindAt} onChange={set('remindAt')} error={errs.remindAt} disabled={busy} /> : null}
        </div>
        {canExternal && f.type === 'TASK' ? <div><Switch label="Giao cho người phòng khác" checked={f.external} onChange={set('external')} disabled={busy} /><p style={{ margin: '4px 0 0', font: 'var(--type-caption)', color: 'var(--text-3)' }}>Người nhận chỉ xem thẻ việc, không xem hồ sơ khách.</p></div> : null}
        {canAssign ? (
          <Select label="Người phụ trách" value={f.performedById} onChange={set('performedById')} error={errs.performedById} disabled={busy || cands.status !== 'ready'}
            hint={cands.status === 'loading' ? 'Đang tải…' : cands.status === 'error' ? 'Chưa tải được danh sách; hoạt động sẽ ghi cho bạn' : extOn ? 'Người phòng khác, không đọc được khách; có quyền theo việc đến khi xong' : 'Chỉ người đọc được khách hàng của cơ hội này'}
            options={[{ value: '', label: extOn ? '— Chọn người —' : 'Tôi (người ghi nhận)' }].concat(cands.items.map((e) => ({ value: e.id, label: personLabel(e) })))} />
        ) : null}
      </div>
    </Modal>
  );
}

// ───── Tab Hoạt động & công việc ─────
function ActivitiesTab({ ui, o }) {
  const opps = ui.customerApi.opportunities;
  const s = useCustomerApiState(opps);
  const [f, setF] = React.useState({ type: '', status: '' });
  const [l, setL] = React.useState({ status: 'loading', items: [], page: 0, total: 0, totalPages: 0, error: null, more: 'idle', moreError: null, refreshError: null });
  const [creating, setCreating] = React.useState(false);
  const seq = React.useRef(0);
  const tick = s.activityTick;
  // Bộ lọc đổi => tải lại từ đầu. Chỉ "tick" đổi (vừa ghi nhận / vừa thao tác trên công việc) => đọc lại KHÔNG PHÁ: giữ dòng tới khi có dữ liệu mới.
  const last = React.useRef({ f: null });
  React.useEffect(() => {
    const my = ++seq.current; const soft = last.current.f === f; last.current.f = f;
    if (!soft) setL((x) => ({ ...x, status: 'loading', items: [], error: null, refreshError: null }));
    opps.activities(o.id, f, 1).then((r) => {
      if (my !== seq.current) return;
      if (r.ok) setL({ status: 'ready', items: r.data.items, page: r.data.page || 1, total: r.data.total, totalPages: r.data.totalPages, error: null, more: 'idle', moreError: null, refreshError: null });
      else setL((x) => (soft && x.status === 'ready' ? { ...x, refreshError: r.error } : { ...x, status: 'error', items: [], error: r.error }));
    });
  }, [opps, o.id, f, tick]);
  const reload = () => opps.touchActivities();
  const loadMore = async () => {
    if (l.status !== 'ready' || l.more === 'loading' || l.page >= l.totalPages) return;
    const my = seq.current; setL((x) => ({ ...x, more: 'loading', moreError: null }));
    const r = await opps.activities(o.id, f, l.page + 1);
    if (my !== seq.current) return;
    if (!r.ok) { setL((x) => ({ ...x, more: 'error', moreError: r.error })); return; }
    setL((x) => { const seen = new Set(x.items.map((a) => a.id)); return { ...x, items: x.items.concat(r.data.items.filter((a) => !seen.has(a.id))), page: r.data.page || x.page + 1, total: r.data.total, totalPages: r.data.totalPages, more: 'idle' }; });
  };
  const types = allowedTypes(ui.can);
  const canAdd = holdsUpdate(o, ctxOf(ui)) && types.length > 0;
  const filtered = !!(f.type || f.status);
  const now = Date.now();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div role="group" aria-label="Lọc hoạt động theo loại" style={{ minWidth: 0, flex: '1 1 170px', maxWidth: 240 }}><Select size="sm" value={f.type} onChange={(v) => setF((x) => ({ ...x, type: v }))} options={TYPE_OPTIONS} /></div>
        <div role="group" aria-label="Lọc hoạt động theo trạng thái" style={{ minWidth: 0, flex: '1 1 150px', maxWidth: 220 }}><Select size="sm" value={f.status} onChange={(v) => setF((x) => ({ ...x, status: v }))} options={STATUS_OPTIONS} /></div>
        {canAdd ? <div style={{ marginLeft: 'auto' }}><Button size="sm" icon="plus" onClick={() => setCreating(true)}>Ghi nhận hoạt động</Button></div> : null}
      </div>
      {o.access !== 'FULL' ? <p style={{ margin: 0, font: 'var(--type-caption)', color: 'var(--text-3)' }}>Bạn xem qua công việc được giao: chỉ hiện công việc của chính bạn trong cơ hội này.</p> : null}
      {l.status === 'loading' ? loadingLine('Đang tải hoạt động…') : null}
      {l.status === 'error' ? <ApiErrorBox error={l.error} onRetry={reload} /> : null}
      {l.status === 'ready' && l.refreshError ? <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', font: 'var(--type-sm)', color: 'var(--warning-text, var(--text-2))' }}><span>Không tải lại được hoạt động — dữ liệu đang hiển thị có thể đã cũ.</span><Button size="sm" variant="secondary" onClick={reload}>Thử lại</Button></div> : null}
      {l.status === 'ready' && !l.items.length ? <EmptyState compact icon="list-checks" title={filtered ? 'Không có hoạt động khớp bộ lọc' : 'Chưa có hoạt động nào'} description={filtered ? undefined : canAdd ? 'Bấm "Ghi nhận hoạt động" để thêm cuộc gọi, ghi chú, công việc… cho cơ hội này.' : undefined} /> : null}
      {l.status === 'ready' && l.items.length ? (
        <>
          <div style={{ font: 'var(--type-sm)', color: 'var(--text-3)' }}>{l.items.length + ' / ' + l.total + ' hoạt động · giờ Việt Nam'}</div>
          <ul className="sg-feed" style={{ margin: 0 }}>{l.items.map((a) => <ActivityItem key={a.id} a={a} now={now} ui={ui} />)}</ul>
          {l.more === 'error' && l.moreError ? <ApiErrorBox error={l.moreError} /> : null}
          {l.page < l.totalPages ? <div style={{ display: 'flex', justifyContent: 'center' }}><Button variant="secondary" size="sm" loading={l.more === 'loading'} onClick={loadMore}>Tải thêm</Button></div> : null}
        </>
      ) : null}
      {creating ? <ActivityDialog ui={ui} o={o} types={types} onClose={() => setCreating(false)} /> : null}
    </div>
  );
}

// ───── Tab Lịch sử thay đổi (chỉ đường đầy đủ) ─────
// T-02: lịch sử phân trang — trang đầu khi mở / khi version đổi, "Tải thêm" nối trang kế tiếp (bỏ dòng trùng theo id), như tab Hoạt động.
const HISTORY_IDLE = { status: 'loading', items: [], page: 0, total: 0, totalPages: 0, error: null, more: 'idle', moreError: null };
function HistoryTab({ ui, o, meta }) {
  const opps = ui.customerApi.opportunities;
  const [h, setH] = React.useState(HISTORY_IDLE);
  const seq = React.useRef(0);
  const load = React.useCallback(() => {
    const my = ++seq.current; setH((x) => pagedReloadStart(x, HISTORY_IDLE)); // review Astra #259: đang tải lại => chặn "Tải thêm"
    opps.changes(o.id, 1).then((r) => {
      if (my !== seq.current) return;
      setH(r.ok ? { ...HISTORY_IDLE, status: 'ready', items: r.data.items || [], page: r.data.page || 1, total: r.data.total || 0, totalPages: r.data.totalPages || 0 } : { ...HISTORY_IDLE, status: 'error', error: r.error });
    });
    return () => { if (my === seq.current) seq.current += 1; };
  }, [opps, o.id, o.version]); // version đổi (vừa sửa / chuyển giai đoạn…) => đọc lại
  React.useEffect(() => load(), [load]);
  const loadMore = async () => {
    if (!pagedCanLoadMore(h)) return;
    const my = seq.current; setH((x) => ({ ...x, more: 'loading', moreError: null }));
    const r = await opps.changes(o.id, h.page + 1);
    if (my !== seq.current) return;
    if (!r.ok) { setH((x) => ({ ...x, more: 'error', moreError: r.error })); return; }
    setH((x) => { const seen = new Set(x.items.map((c) => c.id)); return { ...x, items: x.items.concat((r.data.items || []).filter((c) => !seen.has(c.id))), page: r.data.page || x.page + 1, total: r.data.total, totalPages: r.data.totalPages, more: 'idle' }; });
  };
  if (h.status === 'loading') return loadingLine('Đang tải lịch sử…');
  if (h.status === 'error') return <ApiErrorBox error={h.error} onRetry={load} />;
  if (!h.items.length) return <EmptyState compact icon="history" title="Chưa có thay đổi nào được ghi lại" description="Lịch sử ghi các lần đổi giai đoạn, trạng thái, giá trị, xác suất, ngày dự kiến chốt và người phụ trách." />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
    {h.total > h.items.length ? <div style={{ font: 'var(--type-sm)', color: 'var(--text-3)' }}>{h.items.length + ' / ' + h.total + ' thay đổi'}</div> : null}
    <ol aria-label="Lịch sử thay đổi" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
      {h.items.map((c) => {
        const d = describeChange(c, { meta, o });
        return (
          <li key={c.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: 4, font: 'var(--type-sm)' }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}><b style={{ fontWeight: 600 }}>{d.label}</b><span style={{ overflowWrap: 'anywhere' }}>{d.text}</span></div>
            {c.reason ? <div style={{ color: 'var(--text-2)', overflowWrap: 'anywhere', whiteSpace: 'pre-line' }}><span style={{ color: 'var(--text-3)' }}>Lý do: </span>{c.reason}</div> : null}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', color: 'var(--text-3)', font: 'var(--type-caption)' }}>
              {c.changedBy ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Avatar name={c.changedBy.fullName} size={18} />{c.changedBy.fullName}</span> : null}
              <span>{U.dtVN(c.changedAt)}</span>
            </div>
          </li>
        );
      })}
    </ol>
    {h.more === 'error' && h.moreError ? <ApiErrorBox error={h.moreError} /> : null}
    {h.page < h.totalPages ? <div style={{ display: 'flex', justifyContent: 'center' }}><Button variant="secondary" size="sm" loading={h.more === 'loading'} disabled={!!h.reloading} onClick={loadMore}>Tải thêm</Button></div> : null}
    </div>
  );
}

// ───── Tab Tài liệu ─────
function DocumentDialog({ ui, o, onClose, onSaved }) {
  const opps = ui.customerApi.opportunities;
  const s = useCustomerApiState(opps);
  const [f, setF] = React.useState(EMPTY_DOC);
  const [errs, setErrs] = React.useState({});
  const [error, setError] = React.useState(null);
  const busy = !!s.busy;
  const set = (k) => (v) => { const val = v && v.target ? v.target.value : v; setF((x) => ({ ...x, [k]: val })); setErrs((x) => { if (!x[k]) return x; const n = { ...x }; delete n[k]; return n; }); };
  const submit = async () => {
    const r = await opps.addDocument(o.id, f);
    if (r.duplicate) return;
    if (r.ok) { ui.toast({ tone: 'success', title: 'Đã thêm tài liệu', message: r.data.fileName }); onSaved(); return; }
    setErrs(r.fieldErrors || {}); setError(r.invalid ? null : r.error);
  };
  return (
    <Modal open onClose={busy ? undefined : onClose} size="md" icon="paperclip" title="Thêm tài liệu" description={o.code + ' · ' + o.title}
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Huỷ</Button><Button loading={busy} onClick={submit}>Thêm tài liệu</Button></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ margin: 0, font: 'var(--type-sm)', color: 'var(--text-2)' }}>CRM chỉ lưu đường dẫn và tên tệp, không lưu tệp. Nhóm Thương mại không hiển thị cho người xem qua công việc được giao.</p>
        {error ? <ApiErrorBox error={error} /> : null}
        <Select label="Nhóm tài liệu" required options={DOC_KINDS} value={f.kind} onChange={set('kind')} error={errs.kind} disabled={busy} />
        <Input label="Tên tệp" required maxLength={255} placeholder="Ví dụ: ban-ve-mat-bang-tang-3.pdf" value={f.fileName} onChange={set('fileName')} error={errs.fileName} disabled={busy} />
        <Input label="Đường dẫn (https)" required maxLength={1000} placeholder="https://…" value={f.url} onChange={set('url')} error={errs.url} disabled={busy} />
      </div>
    </Modal>
  );
}
function RemoveDocumentDialog({ ui, o, doc, onClose, onSaved }) {
  const opps = ui.customerApi.opportunities;
  const s = useCustomerApiState(opps);
  const [reason, setReason] = React.useState('');
  const [errs, setErrs] = React.useState({});
  const [error, setError] = React.useState(null);
  const busy = !!s.busy;
  const submit = async () => {
    const r = await opps.removeDocument(o.id, doc.id, reason);
    if (r.duplicate) return;
    if (r.ok) { ui.toast({ tone: 'success', title: 'Đã xoá tài liệu', message: doc.fileName }); onSaved(); return; }
    setErrs(r.fieldErrors || {}); setError(r.invalid ? null : r.error);
  };
  return (
    <Modal open onClose={busy ? undefined : onClose} size="md" icon="trash-2" tone="error" title="Xoá tài liệu" description={doc.fileName}
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Huỷ</Button><Button variant="danger" loading={busy} onClick={submit}>Xoá tài liệu</Button></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ margin: 0, font: 'var(--type-sm)', color: 'var(--text-2)' }}>Tài liệu được xoá mềm khỏi danh sách; tệp gốc ở nơi lưu trữ không bị ảnh hưởng.</p>
        {error ? <ApiErrorBox error={error} /> : null}
        <Input label="Lý do xoá" required multiline rows={3} maxLength={500} value={reason} onChange={(e) => { setReason(e.target.value); setErrs({}); }} error={errs.reason} disabled={busy} />
      </div>
    </Modal>
  );
}
function DocumentsTab({ ui, o }) {
  const opps = ui.customerApi.opportunities;
  const [d, setD] = React.useState({ status: 'loading', items: [], access: null, error: null });
  const [dlg, setDlg] = React.useState(null); // 'add' | { remove: doc }
  const seq = React.useRef(0);
  const load = React.useCallback(() => {
    const my = ++seq.current;
    opps.documents(o.id).then((r) => { if (my === seq.current) setD(r.ok ? { status: 'ready', items: r.data.items || [], access: r.data.access, error: null } : { status: 'error', items: [], access: null, error: r.error }); });
  }, [opps, o.id]);
  React.useEffect(() => { load(); }, [load]);
  const canWrite = holdsUpdate(o, ctxOf(ui));
  const done = () => { setDlg(null); load(); };
  // Nhóm hiển thị theo đường truy cập do máy chủ báo: bản kỹ thuật chỉ có nhóm Kỹ thuật (máy chủ cũng không trả nhóm Thương mại).
  const kinds = d.access === 'FULL' ? DOC_KINDS : DOC_KINDS.filter((k) => k.value === 'TECHNICAL');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ flex: 1, minWidth: 0, font: 'var(--type-caption)', color: 'var(--text-3)' }}>CRM chỉ lưu đường dẫn và tên tệp (ví dụ Google Drive), không lưu tệp.</span>
        {canWrite ? <Button size="sm" icon="plus" onClick={() => setDlg('add')}>Thêm tài liệu</Button> : null}
      </div>
      {d.status === 'loading' ? loadingLine('Đang tải tài liệu…') : null}
      {d.status === 'error' ? <ApiErrorBox error={d.error} onRetry={load} /> : null}
      {d.status === 'ready' && !d.items.length ? <EmptyState compact icon="paperclip" title="Chưa có tài liệu nào" description={d.access === 'FULL' ? undefined : 'Bạn chỉ xem được tài liệu nhóm Kỹ thuật.'} /> : null}
      {d.status === 'ready' && d.items.length ? kinds.map((k) => {
        const rows = d.items.filter((x) => x.kind === k.value);
        return (
          <section key={k.value} aria-label={'Tài liệu ' + k.label} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h3 style={{ margin: 0, font: 'var(--type-sm)', fontWeight: 600, display: 'flex', gap: 8, alignItems: 'center' }}>{k.label}<Badge size="sm">{rows.length}</Badge></h3>
            {!rows.length ? <div style={{ font: 'var(--type-sm)', color: 'var(--text-3)', padding: '4px 0' }}>Chưa có tài liệu.</div> : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {rows.map((x) => {
                  const href = safeHttps(x.url);
                  return (
                    <li key={x.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border-subtle)', font: 'var(--type-sm)' }}>
                      <Icon name="file-text" size={15} color="var(--text-3)" />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {href ? <a href={href} target="_blank" rel="noopener noreferrer" style={{ overflowWrap: 'anywhere', fontWeight: 500 }}>{x.fileName}</a> : <span style={{ overflowWrap: 'anywhere', fontWeight: 500 }}>{x.fileName}</span>}
                        <div style={{ font: 'var(--type-caption)', color: 'var(--text-3)' }}>{(x.createdBy ? x.createdBy.fullName + ' · ' : '') + U.dtVN(x.createdAt)}</div>
                      </div>
                      {canWrite ? <IconButton icon="trash-2" label={'Xoá tài liệu ' + x.fileName} size="sm" onClick={() => setDlg({ remove: x })} /> : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      }) : null}
      {dlg === 'add' ? <DocumentDialog ui={ui} o={o} onClose={() => setDlg(null)} onSaved={done} /> : null}
      {dlg && dlg.remove ? <RemoveDocumentDialog ui={ui} o={o} doc={dlg.remove} onClose={() => setDlg(null)} onSaved={done} /> : null}
    </div>
  );
}

// Báo giá Q7: tab "Báo giá" chỉ trên đường ĐẦY ĐỦ và khi có quote.read (fail-closed; không có mã => không có tab, không gọi API báo giá).
export function OpportunityTabs({ ui, o, meta, onReload }) {
  const full = o.access === 'FULL';
  const quotes = full && canUi(ui, 'quote.read') && !!(ui.customerApi && ui.customerApi.quotes);
  const items = [{ id: 'activities', label: 'Hoạt động & công việc', icon: 'list-checks' }].concat(quotes ? [{ id: 'quotes', label: 'Báo giá', icon: 'file-text' }] : [], full ? [{ id: 'history', label: 'Lịch sử thay đổi', icon: 'history' }] : [], [{ id: 'documents', label: 'Tài liệu', icon: 'paperclip' }]);
  const [tab, setTab] = React.useState('activities');
  const cur = items.some((x) => x.id === tab) ? tab : 'activities';
  return (
    <section className="sg-card sg-solid" style={{ padding: ui.mobile ? '12px 14px' : '16px 20px', display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
      <div style={{ overflowX: 'auto' }}><Tabs variant="line" items={items} value={cur} onChange={setTab} /></div>
      <div role="tabpanel" aria-label={(items.find((x) => x.id === cur) || {}).label}>
        {cur === 'activities' ? <ActivitiesTab ui={ui} o={o} /> : cur === 'quotes' ? <QuotesTab ui={ui} o={o} onReload={onReload} /> : cur === 'history' ? <HistoryTab ui={ui} o={o} meta={meta} /> : <DocumentsTab ui={ui} o={o} />}
      </div>
    </section>
  );
}
