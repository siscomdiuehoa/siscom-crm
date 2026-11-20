import React from 'react';
import { Avatar, Badge, Button, Checkbox, EmptyState, Icon, Input, Modal, Radio, Select, Tabs } from '../../ds/index.js';
import * as U from '../../data/util.js';
import { ApiErrorBox } from '../customers/ApiListStatus.jsx';
import { useCustomerApiState } from '../customers/useCustomerApi.js';
import {
  STATUS_META, STATUS_FILTERS, statusLabel, moneyVN, dateVN, isCloseOverdue, canCreate, canRestore, opportunityActions, EMPTY_CREATE, TYPE_HINT, typeRequiresProject, projectLinked, WON_DOC_TYPES,
} from './opportunitiesModel.js';
import { OpportunityActions, scopeOfUi, useStageMove } from './OpportunityActions.jsx';
import { OpportunityTabs } from './OpportunityDetailTabs.jsx';
import { OpportunityKanban } from './OpportunityKanban.jsx';
import { AmountInput } from './AmountInput.jsx';

// Sales S10b + S10c: danh sách Cơ hội (#/pipeline, kèm danh sách đã xoá + Khôi phục), biểu mẫu Tạo cơ hội (§8.3) và chi tiết (#/pipeline/view/:id, §8.2,
// ba tab ở OpportunityDetailTabs.jsx). Dữ liệu CHỈ từ API Sales;
// phạm vi và trường được trả do máy chủ quyết định (đường đầy đủ / bản kỹ thuật). Giá trị trống hiển thị "Chưa rõ" — không bao giờ là 0.
const SORTS = [
  { value: 'updatedAt:desc', label: 'Mới cập nhật' }, { value: 'createdAt:desc', label: 'Mới tạo' },
  { value: 'expectedCloseDate:asc', label: 'Dự kiến chốt gần nhất' }, { value: 'code:asc', label: 'Theo mã' },
];
const cell = { padding: '10px 8px', borderBottom: '1px solid var(--border-subtle)', verticalAlign: 'top', font: 'var(--type-sm)' };
const dash = <span style={{ color: 'var(--text-3)' }}>—</span>;
const isFull = (o) => o.access === 'FULL';
const openOpp = (ui, o) => ui.navigate('/pipeline/view/' + encodeURIComponent(o.id));
const hrefOf = (o) => '#/pipeline/view/' + encodeURIComponent(o.id);

function StatusBadge({ o }) {
  if (!isFull(o)) return <Badge size="sm" tone="neutral" title="Bạn xem cơ hội này qua công việc được giao">Theo việc</Badge>;
  const m = STATUS_META[o.status] || { tone: 'neutral' };
  return <Badge size="sm" dot tone={m.tone}>{statusLabel(o.status)}</Badge>;
}
function CloseDate({ o }) {
  if (!o.expectedCloseDate) return dash;
  const late = isCloseOverdue(o);
  return <span style={{ whiteSpace: 'nowrap', color: late ? 'var(--error-text)' : undefined }}>{dateVN(o.expectedCloseDate)}{late ? <span style={{ display: 'block', font: 'var(--type-caption)' }}>Quá hạn chốt</span> : null}</span>;
}
const Amount = ({ o }) => (isFull(o) ? <span style={{ whiteSpace: 'nowrap', color: o.expectedAmountVnd === null ? 'var(--text-3)' : undefined }}>{moneyVN(o.expectedAmountVnd)}</span> : dash);
const Owner = ({ o }) => (o.owner ? <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><Avatar name={o.owner.fullName} size={20} />{o.owner.fullName}</span> : dash);

// ───── Biểu mẫu Tạo cơ hội ─────
function CustomerPicker({ ui, value, onPick, error, disabled }) {
  const [q, setQ] = React.useState('');
  const [found, setFound] = React.useState({ status: 'idle', items: [] });
  React.useEffect(() => {
    const term = q.trim();
    if (value || term.length < 2) { setFound({ status: 'idle', items: [] }); return undefined;
    }
    let live = true; setFound({ status: 'loading', items: [] });
    const timer = setTimeout(() => {
      ui.customerApi.queryList({ search: term, pageSize: 8 }).then((r) => { if (live) setFound({ status: 'ready', items: ((r && r.items) || []).slice(0, 8) }); }).catch(() => { if (live) setFound({ status: 'error', items: [] }); });
    }, 250);
    return () => { live = false; clearTimeout(timer); };
  }, [ui.customerApi, q, value]);
  if (value) return (
    <div className="sg-field">
      <span className="sg-label">Khách hàng<span className="sg-label__req">*</span></span>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '8px 12px', borderRadius: 10, border: '1px solid var(--border-subtle)', background: 'var(--surface-sunken)' }}>
        <Icon name="building-2" size={16} color="var(--text-3)" />
        <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}><b>{value.code || ''}</b>{value.code ? ' · ' : ''}{value.name}</span>
        <Button size="sm" variant="ghost" onClick={() => onPick(null)} disabled={disabled}>Đổi</Button>
      </div>
    </div>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Input label="Khách hàng" required icon="search" placeholder="Gõ tên, mã hoặc MST (ít nhất 2 ký tự)…" value={q} onChange={(e) => setQ(e.target.value)} error={error} disabled={disabled} />
      {found.status === 'loading' ? <div role="status" style={{ font: 'var(--type-sm)', color: 'var(--text-3)' }}>Đang tìm…</div> : null}
      {found.status === 'error' ? <div role="alert" style={{ font: 'var(--type-sm)', color: 'var(--error-text)' }}>Không tìm được khách hàng. Vui lòng thử lại.</div> : null}
      {found.status === 'ready' && !found.items.length ? <div role="status" style={{ font: 'var(--type-sm)', color: 'var(--text-3)' }}>Không có khách hàng phù hợp trong phạm vi của bạn.</div> : null}
      {found.items.length ? (
        <ul role="listbox" aria-label="Khách hàng tìm thấy" style={{ listStyle: 'none', margin: 0, padding: 4, border: '1px solid var(--border-subtle)', borderRadius: 10, maxHeight: 200, overflow: 'auto' }}>
          {found.items.map((c) => (
            <li key={c.id}><button type="button" role="option" aria-selected="false" className="sg-menu__item" style={{ width: '100%', textAlign: 'left', border: 0, background: 'transparent' }} onClick={() => onPick({ id: c.id, code: c.code, name: c.short || c.name })}>
              <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}><b>{c.code || ''}</b>{c.code ? ' · ' : ''}{c.short || c.name}</span>
            </button></li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function CreateDialog({ ui, onClose, customer = null }) {
  const opps = ui.customerApi.opportunities;
  const s = useCustomerApiState(opps);
  const meta = s.meta.data;
  const [f, setF] = React.useState(EMPTY_CREATE);
  const [cust, setCust] = React.useState(customer); // customer: khách chọn sẵn và khoá (mở từ chi tiết khách)
  const [errs, setErrs] = React.useState({});
  const [error, setError] = React.useState(null);
  React.useEffect(() => { opps.loadMeta(); }, [opps]);
  const busy = s.busy === 'create';
  const clear = (k) => setErrs((x) => { if (!x[k]) return x; const n = { ...x }; delete n[k]; return n; });
  const set = (k) => (v) => { setF((x) => ({ ...x, [k]: v && v.target ? v.target.value : v })); clear(k); };
  const forced = typeRequiresProject(meta, f.typeId);
  const linked = projectLinked(f, meta);
  const submit = async () => {
    const r = await opps.create({ ...f, customerId: cust ? cust.id : '' });
    if (r.duplicate) return;
    if (r.ok) { ui.toast({ tone: 'success', title: 'Đã tạo cơ hội', message: r.data.code + ' · ' + r.data.title }); onClose(); openOpp(ui, r.data); return; }
    setErrs(r.fieldErrors || {}); setError(r.invalid ? null : r.error);
  };
  return (
    <Modal open onClose={busy ? undefined : onClose} size="lg" icon="target" title="Tạo cơ hội" description="Giai đoạn bắt đầu là Tiếp cận; người phụ trách mặc định là người phụ trách khách hàng."
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Huỷ</Button><Button loading={busy} disabled={!meta} onClick={submit}>Tạo cơ hội</Button></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {error ? <ApiErrorBox error={error} /> : null}
        <CustomerPicker ui={ui} value={cust} onPick={(c) => { setCust(c); clear('customerId'); }} error={errs.customerId} disabled={busy || !!customer} />
        <Input label="Tiêu đề" required maxLength={200} value={f.title} onChange={set('title')} error={errs.title} disabled={busy} />
        <div className="sg-field" role="radiogroup" aria-label="Loại cơ hội">
          <span className="sg-label">Loại cơ hội<span className="sg-label__req">*</span></span>
          {s.meta.status === 'error' ? <ApiErrorBox error={s.meta.error} onRetry={() => opps.loadMeta(true)} />
            : !meta ? <div role="status" style={{ color: 'var(--text-2)', font: 'var(--type-sm)' }}>Đang tải danh mục…</div>
            : <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>{(meta.types || []).map((x) => <Radio key={x.id} name="opp-type" value={x.id} label={x.label} checked={f.typeId === x.id} onChange={set('typeId')} disabled={busy} />)}</div>}
          <span className="sg-hint" role="note"><Icon name="info" size={13} />{TYPE_HINT}</span>
          {errs.typeId ? <span className="sg-hint sg-hint--error"><Icon name="circle-alert" size={13} />{errs.typeId}</span> : null}
        </div>
        <div className="sg-field">
          <Checkbox label="Gắn với dự án/công trình" checked={linked} disabled={busy || forced} onChange={(v) => set('isProjectLinked')(v)} />
          {forced ? <span className="sg-hint">Loại có thi công luôn gắn với dự án/công trình.</span> : null}
          {errs.isProjectLinked ? <span className="sg-hint sg-hint--error">{errs.isProjectLinked}</span> : null}
        </div>
        {linked ? <>
          <Input label="Tên dự án/công trình" required maxLength={200} value={f.projectName} onChange={set('projectName')} error={errs.projectName} disabled={busy} />
          <Input label="Phạm vi SISCOM đang chào" required multiline rows={2} placeholder='Ví dụ: "cung cấp 120 FCU"' value={f.offerScope} onChange={set('offerScope')} error={errs.offerScope} disabled={busy} />
        </> : null}
        <Input label="Nhu cầu của khách" multiline rows={3} hint="Bắt buộc trước khi rời giai đoạn Tiếp cận." value={f.needSummary} onChange={set('needSummary')} error={errs.needSummary} disabled={busy} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <AmountInput label="Giá trị dự kiến (VNĐ, chưa VAT)" suffix="đ" hint='Để trống nếu chưa rõ — hệ thống ghi "Chưa rõ", không ghi 0.' value={f.expectedAmount} onChange={set('expectedAmount')} error={errs.expectedAmount} disabled={busy} />
          <Input label="Dự kiến chốt" type="date" value={f.expectedCloseDate} onChange={set('expectedCloseDate')} error={errs.expectedCloseDate} disabled={busy} />
        </div>
      </div>
    </Modal>
  );
}

// S10c: khôi phục cơ hội đã xoá mềm (chỉ người có opportunity.restore phạm vi ALL — máy chủ kiểm lại; khách còn bị xoá => máy chủ từ chối).
function RestoreDialog({ ui, o, onClose }) {
  const opps = ui.customerApi.opportunities;
  const s = useCustomerApiState(opps);
  const [error, setError] = React.useState(null);
  const busy = !!s.busy;
  const submit = async () => {
    const r = await opps.restore(o);
    if (r.duplicate) return;
    if (r.ok) { ui.toast({ tone: 'success', title: 'Đã khôi phục cơ hội', message: o.code + ' · ' + o.title }); onClose(); return; }
    setError(r.error);
  };
  return (
    <Modal open onClose={busy ? undefined : onClose} size="md" icon="rotate-ccw" title="Khôi phục cơ hội" description={o.code + ' · ' + o.title}
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>{error ? 'Đóng' : 'Huỷ'}</Button><Button loading={busy} onClick={submit}>Khôi phục</Button></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ margin: 0, font: 'var(--type-sm)', color: 'var(--text-2)' }}>Cơ hội trở lại đúng trạng thái, giai đoạn, người phụ trách và giá trị như lúc bị xoá. Nếu khách hàng của cơ hội đang bị xoá thì phải khôi phục khách hàng trước.</p>
        {error ? <ApiErrorBox error={error.kind === 'conflict' && error.staleVersion !== false ? { ...error, hint: 'Danh sách đã được tải lại. Kiểm tra rồi thao tác lại nếu vẫn cần.' } : error} /> : null}
      </div>
    </Modal>
  );
}

// ───── Danh sách (#/pipeline) ─────
export default function OpportunitiesPage({ ui }) {
  const opps = ui.customerApi.opportunities;
  const s = useCustomerApiState(opps);
  const scopeOf = scopeOfUi(ui);
  const full = !!scopeOf('opportunity.read'); // bản kỹ thuật (chỉ read_assigned) không có bộ lọc theo trạng thái / danh mục
  const [f, setF] = React.useState({ status: '', stageId: '', typeId: '', q: '', sort: SORTS[0].value });
  const [kw, setKw] = React.useState('');
  const [creating, setCreating] = React.useState(false);
  const mayRestore = canRestore(scopeOf);
  const [deletedMode, setDeletedMode] = React.useState(false); // S10c: danh sách cơ hội ĐÃ XOÁ (deleted=only)
  const [restoring, setRestoring] = React.useState(null);
  const trash = mayRestore && deletedMode;
  // S11: kanban chỉ ở máy tính, cho người xem đầy đủ, ngoài chế độ "Đã xoá". Điện thoại: danh sách thẻ + thanh chọn giai đoạn + nút "Chuyển giai đoạn" (§8.5).
  const [view, setView] = React.useState('table');
  const [onHold, setOnHold] = React.useState(null); // T-04: số cơ hội Tạm hoãn (cùng bộ lọc loại / từ khoá) từ board-summary; null = chưa có / lỗi
  const board = full && !ui.mobile && !trash && view === 'kanban';
  const mover = useStageMove(ui);
  const actx = { scopeOf, meId: ui.me ? ui.me.employeeId : null };
  React.useEffect(() => { if (full) opps.loadMeta(); }, [opps, full]);
  React.useEffect(() => { if (board) return; const [sortBy, sortOrder] = f.sort.split(':'); opps.load({ status: f.status, stageId: f.stageId, typeId: f.typeId, q: f.q, sortBy, sortOrder, ...(trash ? { deleted: 'only' } : {}) }); }, [opps, f, trash, board]);
  React.useEffect(() => { const next = kw.trim().length >= 2 ? kw.trim() : ''; const id = setTimeout(() => setF((x) => (x.q === next ? x : { ...x, q: next })), 300); return () => clearTimeout(id); }, [kw]);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const l = board ? { ...s.list, status: 'board' } : s.list; // kanban: các khối của bảng không hiển thị
  const meta = s.meta.data; const mobile = !!ui.mobile;
  const techOnly = l.status === 'ready' && l.items.length > 0 && l.items.every((o) => !isFull(o));
  const filtered = !!(f.status || f.stageId || f.typeId || f.q);
  const lookupOptions = (list, all) => [{ value: '', label: all }, ...((list || []).map((x) => ({ value: x.id, label: x.label })))];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <section className="sg-card sg-solid" style={{ padding: mobile ? 12 : 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {full && !mobile && !trash ? <div role="group" aria-label="Kiểu hiển thị"><Tabs items={[{ id: 'table', label: 'Bảng', icon: 'table' }, { id: 'kanban', label: 'Kanban', icon: 'columns-3' }]} value={view} onChange={setView} /></div> : null}
          <div role="search" style={{ flex: '2 1 220px', minWidth: 0 }}><Input size="sm" icon="search" aria-label="Tìm cơ hội" placeholder="Tìm theo tiêu đề hoặc tên dự án…" value={kw} onChange={(e) => setKw(e.target.value)} /></div>
          {full && !board ? <div role="group" aria-label="Lọc theo trạng thái" style={{ flex: '1 1 140px', maxWidth: 220 }}><Select size="sm" value={f.status} onChange={set('status')} options={STATUS_FILTERS} /></div> : null}
          {full && meta && !board && !mobile ? <div role="group" aria-label="Lọc theo giai đoạn" style={{ flex: '1 1 140px', maxWidth: 220 }}><Select size="sm" value={f.stageId} onChange={set('stageId')} options={lookupOptions(meta.stages, 'Mọi giai đoạn')} /></div> : null}
          {full && meta ? <div role="group" aria-label="Lọc theo loại" style={{ flex: '1 1 160px', maxWidth: 240 }}><Select size="sm" value={f.typeId} onChange={set('typeId')} options={lookupOptions(meta.types, 'Mọi loại')} /></div> : null}
          {board ? null : <div role="group" aria-label="Sắp xếp" style={{ flex: '1 1 160px', maxWidth: 220 }}><Select size="sm" value={f.sort} onChange={set('sort')} options={SORTS} /></div>}
          {mayRestore ? <Button variant="secondary" icon="trash-2" aria-pressed={trash} onClick={() => setDeletedMode((x) => !x)}>{trash ? 'Về danh sách' : 'Đã xoá'}</Button> : null}
          {canCreate(scopeOf) && !trash ? <Button icon="plus" onClick={() => setCreating(true)}>Tạo cơ hội</Button> : null}
        </div>
        {trash ? <div role="status" style={{ font: 'var(--type-sm)', color: 'var(--warning-text)' }}>Đang xem các cơ hội đã xoá. Bấm "Khôi phục" để đưa cơ hội trở lại danh sách.</div> : null}
        {full && meta && mobile ? (
          <div role="group" aria-label="Lọc theo giai đoạn" style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
            {[{ id: '', label: 'Mọi giai đoạn' }].concat(meta.stages || []).map((x) => { const on = f.stageId === x.id; return <button key={x.id || 'all'} type="button" className="sg-chip" aria-pressed={on} onClick={() => set('stageId')(x.id)} style={{ flex: '0 0 auto', ...(on ? { background: 'var(--primary-soft)', borderColor: 'transparent', color: 'var(--primary-text)' } : {}) }}>{x.label}</button>; })}
          </div>
        ) : null}
        {kw.trim().length === 1 ? <div style={{ font: 'var(--type-caption)', color: 'var(--text-3)' }}>Gõ ít nhất 2 ký tự để tìm.</div> : null}
        {board && meta ? (
          <>
            <OpportunityKanban ui={ui} meta={meta} typeId={f.typeId} q={f.q} onSummary={(x) => setOnHold(x && Number.isInteger(x.onHoldCount) ? x.onHoldCount : null)} />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', font: 'var(--type-sm)', color: 'var(--text-3)' }}>
              <span>Kanban chỉ gồm cơ hội đang mở. Xem ở dạng bảng:</span>
              {[['ON_HOLD', 'Tạm hoãn'], ['WON', 'Đã Thắng'], ['LOST', 'Đã Thua']].map(([k, label]) => <Button key={k} size="sm" variant="ghost" aria-label={k === 'ON_HOLD' && onHold !== null ? label + ' (' + onHold + ' cơ hội)' : undefined} onClick={() => { setF((x) => ({ ...x, status: k, stageId: '' })); setView('table'); }}>{label}{k === 'ON_HOLD' && onHold !== null ? <Badge size="sm">{onHold}</Badge> : null}</Button>)}
            </div>
          </>
        ) : null}
        {full && s.meta.status === 'error' ? <ApiErrorBox error={s.meta.error} onRetry={() => opps.loadMeta(true)} /> : null}
        {l.status === 'loading' || l.status === 'idle' ? <div role="status" style={{ color: 'var(--text-2)', padding: '12px 0' }}>Đang tải cơ hội…</div> : null}
        {l.status === 'error' ? <ApiErrorBox error={l.error} onRetry={() => opps.reload()} /> : null}
        {l.status === 'ready' && l.refreshError ? <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', font: 'var(--type-sm)', color: 'var(--warning-text, var(--text-2))' }}><span>Không tải lại được danh sách — dữ liệu đang hiển thị có thể đã cũ.</span><Button size="sm" variant="secondary" onClick={() => opps.reload()}>Thử lại</Button></div> : null}
        {l.status === 'ready' && !l.items.length ? <EmptyState compact kind={filtered ? 'search' : 'empty'} icon={filtered ? undefined : 'target'} title={filtered ? 'Không có cơ hội khớp bộ lọc' : trash ? 'Không có cơ hội đã xoá' : 'Chưa có cơ hội nào'} description={filtered ? 'Thử bỏ bớt điều kiện lọc hoặc đổi từ khoá.' : trash ? undefined : 'Chưa có cơ hội nào trong phạm vi của bạn.'} action={!filtered && !trash && canCreate(scopeOf) ? <Button icon="plus" onClick={() => setCreating(true)}>Tạo cơ hội</Button> : undefined} /> : null}
        {l.status === 'ready' && l.items.length ? (
          <>
            <div style={{ font: 'var(--type-sm)', color: 'var(--text-3)' }}>{l.items.length + ' / ' + l.total + ' cơ hội'}{techOnly ? ' · bạn xem qua công việc được giao nên không hiển thị giá trị, xác suất' : ''}</div>
            {mobile ? (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {l.items.map((o) => (
                  <li key={o.id} className="sg-card sg-solid" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><span style={{ font: 'var(--type-mono)', color: 'var(--text-3)' }}>{o.code}</span><StatusBadge o={o} /><Badge size="sm">{o.stage ? o.stage.label : '—'}</Badge></div>
                    {trash ? <span style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{o.title}</span> : <a href={hrefOf(o)} onClick={(e) => { e.preventDefault(); openOpp(ui, o); }} style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{o.title}</a>}
                    <div style={{ font: 'var(--type-sm)', color: 'var(--text-2)', overflowWrap: 'anywhere' }}>{o.customer ? o.customer.name : '—'}{o.owner ? ' · ' + o.owner.fullName : ''}</div>
                    {isFull(o) ? <div style={{ font: 'var(--type-sm)', display: 'flex', gap: 10, flexWrap: 'wrap' }}><span>{moneyVN(o.expectedAmountVnd)}</span><span>{o.probability + '%'}</span>{o.expectedCloseDate ? <span style={{ color: isCloseOverdue(o) ? 'var(--error-text)' : 'var(--text-2)' }}>{(isCloseOverdue(o) ? 'Quá hạn chốt ' : 'Chốt ') + dateVN(o.expectedCloseDate)}</span> : null}</div> : null}
                    {!trash && opportunityActions(o, actx).includes('stage') ? <div><Button size="sm" variant="secondary" icon="arrow-right" loading={mover.pendingId === o.id} onClick={() => mover.start(o)}>Chuyển giai đoạn</Button></div> : null}
                    {trash ? <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}><span style={{ font: 'var(--type-caption)', color: 'var(--text-3)' }}>{'Xoá lúc ' + U.dtVN(o.deletedAt)}</span><Button size="sm" variant="secondary" icon="rotate-ccw" onClick={() => setRestoring(o)}>Khôi phục</Button></div> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr style={{ textAlign: 'left', color: 'var(--text-3)', font: 'var(--type-caption)' }}>{['Mã', 'Cơ hội', 'Khách hàng', 'Giai đoạn', 'Giá trị dự kiến', 'Xác suất', 'Dự kiến chốt', 'Phụ trách', 'Trạng thái'].concat(trash ? ['Đã xoá'] : []).map((h) => <th key={h} scope="col" style={{ ...cell, fontWeight: 600, textAlign: h === 'Giá trị dự kiến' || h === 'Xác suất' ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
                  <tbody>{l.items.map((o) => (
                    <tr key={o.id}>
                      <td style={{ ...cell, whiteSpace: 'nowrap', font: 'var(--type-mono)', color: 'var(--text-3)' }}>{o.code}</td>
                      <td style={{ ...cell, maxWidth: 320 }}>{trash ? <span style={{ fontWeight: 500, overflowWrap: 'anywhere' }}>{o.title}</span> : <a href={hrefOf(o)} onClick={(e) => { e.preventDefault(); openOpp(ui, o); }} style={{ fontWeight: 500, overflowWrap: 'anywhere' }}>{o.title}</a>}{o.projectName ? <div style={{ color: 'var(--text-3)', font: 'var(--type-caption)', overflowWrap: 'anywhere' }}>{o.projectName}</div> : null}{o.ownerLostAccess ? <div style={{ color: 'var(--warning-text)', font: 'var(--type-caption)' }}>Người phụ trách không còn quyền với cơ hội này</div> : null}</td>
                      <td style={{ ...cell, maxWidth: 220, overflowWrap: 'anywhere' }}>{o.customer ? o.customer.name : dash}</td>
                      <td style={cell}>{o.stage ? o.stage.label : dash}</td>
                      <td style={{ ...cell, textAlign: 'right' }}><Amount o={o} /></td>
                      <td style={{ ...cell, textAlign: 'right' }}>{isFull(o) ? o.probability + '%' : dash}</td>
                      <td style={cell}><CloseDate o={o} /></td>
                      <td style={cell}><Owner o={o} /></td>
                      <td style={cell}><StatusBadge o={o} />{o.status === 'ON_HOLD' && o.holdUntil ? <div style={{ font: 'var(--type-caption)', color: 'var(--text-3)' }}>{'Liên hệ lại ' + dateVN(o.holdUntil)}</div> : null}</td>
                      {trash ? <td style={cell}><div style={{ font: 'var(--type-caption)', color: 'var(--text-3)', whiteSpace: 'nowrap', marginBottom: 4 }}>{U.dtVN(o.deletedAt)}</div><Button size="sm" variant="secondary" icon="rotate-ccw" onClick={() => setRestoring(o)}>Khôi phục</Button></td> : null}
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
            {l.more === 'error' && l.moreError ? <ApiErrorBox error={l.moreError} /> : null}
            {l.page < l.totalPages ? <div style={{ display: 'flex', justifyContent: 'center' }}><Button variant="secondary" size="sm" loading={l.more === 'loading'} onClick={() => opps.loadMore()}>Tải thêm</Button></div> : null}
          </>
        ) : null}
      </section>
      {creating ? <CreateDialog ui={ui} onClose={() => setCreating(false)} /> : null}
      {restoring ? <RestoreDialog ui={ui} o={restoring} onClose={() => setRestoring(null)} /> : null}
      {mover.element}
    </div>
  );
}

// ───── Chi tiết (#/pipeline/view/:id) ─────
export function OpportunityView({ ui, id }) {
  const opps = ui.customerApi.opportunities;
  const s = useCustomerApiState(opps);
  const [st, setSt] = React.useState({ status: 'loading', o: null, error: null });
  const load = React.useCallback(async () => { const r = await opps.get(id); setSt(r.ok ? { status: 'ready', o: r.data, error: null } : { status: 'error', o: null, error: r.error }); }, [opps, id]);
  React.useEffect(() => { load(); }, [load]);
  const full = !!scopeOfUi(ui)('opportunity.read');
  React.useEffect(() => { if (full) opps.loadMeta(); }, [opps, full]);
  const back = <div><Button variant="ghost" size="sm" icon="arrow-left" onClick={() => ui.navigate('/pipeline')}>Cơ hội kinh doanh</Button></div>;
  if (st.status === 'loading') return <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>{back}<div role="status" className="sg-card sg-solid" style={{ padding: 20 }}>Đang tải cơ hội…</div></div>;
  if (st.status === 'error') return <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>{back}<ApiErrorBox error={st.error} onRetry={load} /></div>;
  const o = st.o; const fullView = isFull(o); const meta = s.meta.data;
  // Sau thao tác: xoá hoặc chuyển cho người khác mà mình không còn thấy => về danh sách; còn lại đọc lại chi tiết từ máy chủ.
  const onChanged = (data, kind) => { if (kind === 'delete' || (data && data.transferred)) ui.navigate('/pipeline'); else load(); };
  const row = (icon, label, v) => (v || v === 0 ? <div style={{ display: 'grid', gridTemplateColumns: '20px minmax(90px, 150px) minmax(0,1fr)', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border-subtle)', font: 'var(--type-sm)' }}><Icon name={icon} size={15} color="var(--text-3)" /><span style={{ color: 'var(--text-3)' }}>{label}</span><span style={{ overflowWrap: 'anywhere', whiteSpace: 'pre-line' }}>{v}</span></div> : null);
  const c = o.customer;
  const docType = (WON_DOC_TYPES.find((x) => x.value === o.wonDocType) || {}).label || o.wonDocType;
  const safeUrl = typeof o.wonDocUrl === 'string' && /^https:\/\//i.test(o.wonDocUrl) ? o.wonDocUrl : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {back}
      <section className="sg-card sg-glass" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><span style={{ font: 'var(--type-mono)', color: 'var(--text-3)' }}>{o.code}</span><StatusBadge o={o} />{o.type ? <Badge size="sm">{o.type.label}</Badge> : null}</div>
        <h2 style={{ margin: 0, font: 'var(--type-h2)', overflowWrap: 'anywhere' }}>{o.title}</h2>
        {meta && o.stage && meta.stages.some((x) => x.id === o.stage.id) ? (
          <ol aria-label="Giai đoạn" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {meta.stages.map((x) => { const cur = x.id === o.stage.id; return <li key={x.id} aria-current={cur ? 'step' : undefined} style={{ padding: '4px 12px', borderRadius: 999, font: 'var(--type-sm)', fontWeight: cur ? 600 : 400, border: '1px solid ' + (cur ? 'var(--primary)' : 'var(--border-subtle)'), background: cur ? 'var(--primary-soft)' : 'transparent', color: cur ? 'var(--primary-text)' : 'var(--text-3)' }}>{x.label}</li>; })}
          </ol>
        ) : <div style={{ font: 'var(--type-sm)', color: 'var(--text-2)' }}>{'Giai đoạn: ' + (o.stage ? o.stage.label : '—')}</div>}
        {o.ownerLostAccess ? <div role="status" style={{ font: 'var(--type-sm)', color: 'var(--warning-text)' }}>Người phụ trách không còn quyền với cơ hội này — cần chuyển người phụ trách.</div> : null}
      </section>
      {/* Nút thao tác nằm NGOÀI thẻ kính mờ: backdrop-filter của .sg-glass làm lớp phủ position:fixed của hộp thoại bị bó trong thẻ. */}
      <OpportunityActions ui={ui} o={o} onChanged={onChanged} onStale={load} />
      <section className="sg-card sg-solid" style={{ padding: '12px 20px' }}>
        {row('building-2', 'Khách hàng', c ? (fullView && o.customerReadable ? <a href={'#/customers/' + c.id} onClick={(e) => { e.preventDefault(); ui.navigate('/customers/' + c.id); }}>{(c.code ? c.code + ' · ' : '') + c.name}</a> : (c.code ? c.code + ' · ' : '') + c.name) : null)}
        {fullView && o.contact ? row('contact', 'Người liên hệ', [o.contact.fullName, o.contact.title, o.contact.phone].filter(Boolean).join(' · ')) : null}
        {row('hard-hat', 'Dự án/công trình', o.isProjectLinked ? o.projectName : null)}
        {row('package', 'Phạm vi SISCOM chào', o.offerScope)}
        {row('file-text', 'Nhu cầu của khách', o.needSummary)}
        {fullView ? row('banknote', 'Giá trị dự kiến', moneyVN(o.expectedAmountVnd) + (o.expectedAmountVnd === null ? '' : ' (chưa VAT)')) : null}
        {fullView ? row('percent', 'Xác suất', o.probability + '%' + (o.probabilityOverridden ? ' (nhập tay)' : '')) : null}
        {row('calendar', 'Dự kiến chốt', o.expectedCloseDate ? dateVN(o.expectedCloseDate) + (isCloseOverdue(o) ? ' — quá hạn chốt' : '') : null)}
        {fullView && o.owner ? row('user', 'Phụ trách', o.owner.fullName + ' (' + o.owner.code + ')') : null}
        {fullView && o.status === 'ON_HOLD' ? <>{row('calendar-clock', 'Liên hệ lại', dateVN(o.holdUntil))}{row('pause', 'Lý do tạm hoãn', o.holdReason)}</> : null}
        {fullView && o.status === 'WON' ? <>{row('trophy', 'Giá trị chốt', moneyVN(o.wonAmountVnd))}{row('file-check', 'Chứng từ', [docType, o.wonDocNo, o.wonDocDate ? dateVN(o.wonDocDate) : null].filter(Boolean).join(' · '))}{row('link', 'Tệp chứng từ', safeUrl ? <a href={safeUrl} target="_blank" rel="noopener noreferrer">{o.wonDocFileName || 'Mở chứng từ'}</a> : o.wonDocFileName)}</> : null}
        {fullView && o.status === 'LOST' ? <>{row('circle-x', 'Lý do thua', o.lostReason ? o.lostReason.label : null)}{row('message-square', 'Ghi chú', o.lostNote)}</> : null}
        {fullView && o.closedAt ? row('flag', 'Đóng lúc', U.dtVN(o.closedAt)) : null}
        {row('clock', 'Cập nhật', U.dtVN(o.updatedAt))}
        {!fullView ? <p style={{ margin: '8px 0 4px', font: 'var(--type-caption)', color: 'var(--text-3)' }}>Bạn xem cơ hội này qua công việc được giao: chỉ có thông tin kỹ thuật, không có giá trị, xác suất và chứng từ.</p> : null}
      </section>
      <OpportunityTabs ui={ui} o={o} meta={meta} />
    </div>
  );
}
