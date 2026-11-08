import React from 'react';
import { Button, Icon, IconButton, Input, Modal, Select, Switch } from '../../ds/index.js';
import * as U from '../../data/util.js';
import { ApiErrorBox } from '../customers/ApiListStatus.jsx';
import { useCustomerApiState } from '../customers/useCustomerApi.js';
import { taskActions, ACTION_LABEL, ACTION_ICON, validateTransfer } from './tasksModel.js';
import { VERSION_CONFLICT } from './tasksUi.js';
import { editDraftOf, buildPatchBody, validateDraft, hasTitle, hasDue, hasOutcome, hasOccurred } from './activityModel.js';

const has = (ui, p) => typeof ui.can === 'function' && !!ui.can(p);
const cid = (a) => a.customerId || (a.customer && a.customer.id);
const ACTION_TEXT = { create: 'Tạo', update: 'Sửa', assign: 'Giao việc', complete: 'Hoàn thành', reopen: 'Mở lại', cancel: 'Huỷ', delete: 'Xoá', transfer_request: 'Đề xuất chuyển', transfer_approve: 'Duyệt chuyển', transfer_reject: 'Từ chối chuyển', access_revoke: 'Thu hồi quyền theo việc' };
const FIELD_TEXT = { type: 'Loại', title: 'Tiêu đề', content: 'Nội dung', outcome: 'Kết quả', status: 'Trạng thái', dueAt: 'Hạn', remindAt: 'Nhắc lúc', occurredAt: 'Thời điểm', contactId: 'Người liên hệ', customerId: 'Khách hàng', performedById: 'Phụ trách', completedAt: 'Hoàn thành lúc', deletedAt: 'Xoá' };
const fieldText = (k) => FIELD_TEXT[k] || k;
const actionText = (k) => ACTION_TEXT[String(k).replace(/^activity\./, '').replace(/\./g, '_')] || String(k);

// Ứng viên (giao lại / đề xuất chuyển). external = người ngoài phạm vi khách (cần assign_external). Đọc tại chỗ, không lưu state chung.
function useCandidates(ui, a, open, external, enabled) {
  const [st, setSt] = React.useState({ status: 'idle', items: [], error: null });
  React.useEffect(() => {
    if (!open || !enabled) return undefined;
    let live = true; setSt({ status: 'loading', items: [], error: null });
    ui.customerApi.tasks.candidates(cid(a), external).then((r) => { if (live) setSt(r.ok ? { status: 'ready', items: r.items, error: null } : { status: 'error', items: [], error: r.error }); });
    return () => { live = false; };
  }, [open, external, enabled, a.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return st;
}

function Dialog({ kind, a, ui, onClose }) {
  const tasks = ui.customerApi.tasks;
  const s = useCustomerApiState(tasks);
  const busy = !!s.busy;
  const [f, setF] = React.useState({ outcome: '', performedById: '', external: false, toEmployeeId: '', reason: '' });
  const [ed, setEd] = React.useState(() => editDraftOf(a)); // bản nháp Sửa (chỉ dùng khi kind = edit)
  // FV13-01 (#220): bản hoạt động lúc MỞ hộp (gốc so sánh). Sau 409 danh sách đọc lại => `a` là bản mới (version mới), bản nháp giữ nguyên.
  const base = React.useRef(a).current;
  const [conflict, setConflict] = React.useState(false); // lần lưu gần nhất gặp 409 ACTIVITY_VERSION_CONFLICT
  const [overlap, setOverlap] = React.useState(null); // [{ k, theirs }]: trường mình sửa mà người khác cũng vừa sửa (chờ người dùng quyết)
  const [error, setError] = React.useState(null);
  const [tried, setTried] = React.useState(false);
  const [hist, setHist] = React.useState({ status: 'idle', items: [], error: null });
  const canExternal = kind === 'reassign' && has(ui, 'activity.assign_external');
  const cands = useCandidates(ui, a, kind === 'reassign' || kind === 'transfer', kind === 'reassign' && f.external, kind === 'reassign' || has(ui, 'activity.assign'));
  React.useEffect(() => { if (kind === 'history') ui.customerApi.tasks.history(a.id).then((r) => setHist(r.ok ? { status: 'ready', items: r.items, error: null } : { status: 'error', items: [], error: r.error })); }, [kind, a.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (v) => { setError(null); setConflict(false); setF((x) => ({ ...x, [k]: v && v.target ? v.target.value : v, ...(k === 'external' ? { performedById: '' } : {}) })); };
  const setE = (k) => (v) => { setError(null); setConflict(false); setOverlap(null); setEd((x) => ({ ...x, [k]: v && v.target ? v.target.value : v })); };
  const terr = kind === 'transfer' && tried ? validateTransfer(f) : kind === 'edit' && tried ? validateDraft(ed) : {};
  const fe = (k) => terr[k] || (error && error.fieldErrors && error.fieldErrors[k]) || '';
  // force = người dùng đã chọn "Giữ nội dung của tôi" cho các trường trùng.
  const run = async (force = false) => {
    setTried(true);
    if (kind === 'transfer' && Object.keys(validateTransfer(f)).length) return;
    let changes = null;
    if (kind === 'edit') {
      if (Object.keys(validateDraft(ed)).length) return;
      // Chỉ gửi trường NGƯỜI DÙNG đã đổi (so với lúc mở hộp) và còn khác bản hiện tại trên máy chủ (không đè trường người khác vừa sửa).
      const mine = buildPatchBody(base, ed);
      const vsNow = a.version === base.version ? mine : buildPatchBody(a, ed);
      changes = {}; for (const k of Object.keys(mine)) if (k in vsNow) changes[k] = mine[k];
      if (!Object.keys(changes).length) { setError({ title: 'Chưa có thay đổi', message: 'Chưa có thay đổi nào để lưu.', fieldErrors: {} }); return; }
      if (!force && a.version !== base.version) {
        const b0 = editDraftOf(base); const now = editDraftOf(a);
        const ov = Object.keys(changes).filter((k) => String(now[k] || '') !== String(b0[k] || ''));
        if (ov.length) { setError(null); setConflict(false); setOverlap(ov.map((k) => ({ k, theirs: now[k] || '' }))); return; }
      }
    }
    if (kind === 'reassign' && !f.performedById) { setError({ title: 'Chưa chọn người', message: 'Chọn người phụ trách mới.', fieldErrors: {} }); return; }
    const payload = kind === 'edit' ? { changes } : kind === 'complete' ? { outcome: f.outcome.trim() } : kind === 'reassign' ? { performedById: f.performedById, external: f.external } : kind === 'transfer' ? { toEmployeeId: f.toEmployeeId, reason: f.reason.trim() } : kind === 'delete' ? { reason: f.reason.trim() } : {};
    const r = await tasks.act(kind, a, payload);
    if (r.duplicate) return;
    if (r.ok) { ui.toast({ tone: 'success', title: kind === 'edit' ? 'Đã lưu thay đổi' : 'Đã ' + ACTION_LABEL[kind].toLowerCase(), message: a.code || a.title || '' }); onClose(); }
    else { setOverlap(null); setConflict(!!(r.error && r.error.code === VERSION_CONFLICT)); setError(r.error); }
  };
  const takeTheirs = () => { setEd((x) => { const y = { ...x }; for (const o of overlap || []) y[o.k] = o.theirs; return y; }); setOverlap(null); setError(null); };
  const others = (items) => items.filter((e) => !a.performedBy || e.id !== a.performedBy.id);
  const nonField = error && !Object.keys(error.fieldErrors || {}).length ? error : null;
  const title = { edit: 'Sửa hoạt động', complete: 'Hoàn thành công việc', reassign: 'Giao lại công việc', transfer: 'Đề xuất chuyển người phụ trách', delete: 'Xoá hoạt động', history: 'Lịch sử thay đổi' }[kind];
  const footer = kind === 'history' ? <Button variant="secondary" onClick={onClose}>Đóng</Button>
    : <><Button variant="secondary" disabled={busy} onClick={onClose}>Huỷ</Button><Button variant={kind === 'delete' ? 'danger' : 'primary'} icon={ACTION_ICON[kind]} loading={busy} onClick={() => run(false)}>{kind === 'transfer' ? 'Gửi đề xuất' : kind === 'edit' ? 'Lưu thay đổi' : ACTION_LABEL[kind]}</Button></>;
  return (
    <Modal open onClose={busy ? undefined : onClose} size={kind === 'history' ? 'lg' : 'md'} icon={ACTION_ICON[kind]} tone={kind === 'delete' ? 'error' : 'blue'} title={title} description={(a.code ? a.code + ' · ' : '') + (a.title || a.content || '').slice(0, 80)} footer={footer}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {conflict && nonField ? (
          <div role="alert" style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--warning-bg, rgba(245,158,11,.12))', border: '1px solid var(--warning-border, rgba(245,158,11,.45))', font: 'var(--type-sm)' }}>
            <b>Dữ liệu đã thay đổi</b>
            <div>Người khác vừa cập nhật việc này. Nội dung bạn nhập vẫn được giữ — kiểm tra lại rồi lưu lại, hoặc Huỷ.</div>
            {nonField.message ? <div style={{ color: 'var(--text-3)', font: 'var(--type-caption)', marginTop: 4 }}>{'Chi tiết: ' + nonField.message}</div> : null}
          </div>
        ) : nonField ? <ApiErrorBox error={nonField} /> : null}
        {overlap ? (
          <div role="alert" style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--warning-bg, rgba(245,158,11,.12))', border: '1px solid var(--warning-border, rgba(245,158,11,.45))', font: 'var(--type-sm)', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <b>Trùng trường với người khác</b>
            <div>Người khác vừa sửa chính các trường bạn đang sửa. Chọn giữ nội dung của bạn (ghi đè phần họ vừa sửa) hoặc dùng giá trị mới:</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>{overlap.map((o) => <li key={o.k}>{fieldText(o.k) + ': giá trị mới “' + (o.theirs ? String(o.theirs).replace('T', ' ') : '(trống)') + '”'}</li>)}</ul>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><Button size="sm" variant="secondary" disabled={busy} onClick={() => run(true)}>Giữ nội dung của tôi</Button><Button size="sm" variant="secondary" disabled={busy} onClick={takeTheirs}>Dùng giá trị mới</Button></div>
          </div>
        ) : null}
        {kind === 'edit' ? (
          <>
            {hasTitle(a.type) ? <Input label="Tiêu đề" maxLength={200} value={ed.title} onChange={setE('title')} error={fe('title')} /> : null}
            <Input label="Nội dung" required multiline rows={4} maxLength={4000} value={ed.content} onChange={setE('content')} error={fe('content')} />
            {hasOutcome(a.type) ? <Input label="Kết quả" multiline rows={2} maxLength={2000} value={ed.outcome} onChange={setE('outcome')} error={fe('outcome')} /> : null}
            {hasOccurred(a.type) ? <Input label="Thời điểm diễn ra" type="datetime-local" value={ed.occurredAt} onChange={setE('occurredAt')} error={fe('occurredAt')} /> : null}
            {hasDue(a.type) ? <Input label="Hạn" required={a.type === 'TASK'} type="datetime-local" value={ed.dueAt} onChange={setE('dueAt')} error={fe('dueAt')} /> : null}
            {hasDue(a.type) ? <Input label="Nhắc lúc" type="datetime-local" value={ed.remindAt} onChange={setE('remindAt')} error={fe('remindAt')} hint="Không sau hạn; để trống = bỏ nhắc" /> : null}
            <p style={{ margin: 0, font: 'var(--type-caption)', color: 'var(--text-3)' }}>Giờ theo giờ Việt Nam. Chỉ các ô đã đổi được gửi lên máy chủ.</p>
          </>
        ) : null}
        {kind === 'complete' ? <Input label="Kết quả" multiline rows={3} maxLength={2000} value={f.outcome} onChange={set('outcome')} error={fe('outcome')} placeholder="Đã làm gì, kết quả ra sao (không bắt buộc)" /> : null}
        {kind === 'reassign' ? (
          <>
            {canExternal ? <div><Switch label="Giao cho người phòng khác" checked={f.external} onChange={set('external')} /><p style={{ margin: '4px 0 0', font: 'var(--type-caption)', color: 'var(--text-3)' }}>Người nhận chỉ xem thẻ việc, không xem hồ sơ khách.</p></div> : null}
            <Select label="Người phụ trách mới" value={f.performedById} onChange={set('performedById')} error={fe('performedById')} disabled={cands.status !== 'ready'}
              hint={cands.status === 'loading' ? 'Đang tải…' : cands.status === 'error' ? 'Chưa tải được danh sách' : f.external ? 'Người không đọc được khách này; có quyền theo việc đến khi xong' : 'Người đọc được khách này'}
              options={[{ value: '', label: '— Chọn người —' }].concat(others(cands.items).map((e) => ({ value: e.id, label: e.fullName + ' · ' + e.code + (e.departmentCode ? ' · ' + e.departmentCode : '') })))} />
          </>
        ) : null}
        {kind === 'transfer' ? (
          <>
            {has(ui, 'activity.assign')
              ? <Select label="Chuyển cho" required value={f.toEmployeeId} onChange={set('toEmployeeId')} error={fe('toEmployeeId')} disabled={cands.status !== 'ready'} hint="Người cùng phòng; người có quyền giao việc sẽ duyệt"
                  options={[{ value: '', label: '— Chọn người —' }].concat(others(cands.items).map((e) => ({ value: e.id, label: e.fullName + ' · ' + e.code })))} />
              : <div role="note" style={{ font: 'var(--type-sm)', color: 'var(--warning-text)', background: 'var(--warning-soft)', padding: '10px 12px', borderRadius: 10 }}>Vai trò của bạn chưa có danh sách người cùng phòng để chọn (API hiện chỉ cấp cho người có quyền giao việc). Hãy nhờ trưởng nhóm giao lại.</div>}
            <Input label="Lý do" required multiline rows={2} maxLength={200} value={f.reason} onChange={set('reason')} error={fe('reason')} placeholder="Ví dụ: nghỉ phép, không đúng chuyên môn…" />
          </>
        ) : null}
        {kind === 'delete' ? <><p style={{ margin: 0, font: 'var(--type-sm)', color: 'var(--text-2)' }}>Hoạt động bị xoá mềm (quản trị khôi phục được). Người có quyền theo việc mất quyền ngay.</p><Input label="Lý do" maxLength={200} value={f.reason} onChange={set('reason')} error={fe('reason')} /></> : null}
        {kind === 'history' ? (
          hist.status === 'error' ? <ApiErrorBox error={hist.error} /> : hist.status !== 'ready' ? <div role="status" style={{ color: 'var(--text-2)' }}>Đang tải lịch sử…</div>
            : !hist.items.length ? <div style={{ color: 'var(--text-3)' }}>Chưa có thay đổi.</div>
              : <ul className="sg-feed" style={{ margin: 0 }}>{hist.items.map((h, i) => (
                <li key={i} className="sg-feed__item"><span className="sg-feed__icon"><Icon name="history" size={14} /></span>
                  <div style={{ minWidth: 0, flex: 1 }}><p className="sg-feed__text" style={{ margin: 0 }}><b>{actionText(h.action)}</b>{h.actor ? ' · ' + h.actor.fullName + ' (' + h.actor.code + ')' : ''}</p>
                    <div className="sg-feed__meta"><span>{U.dtVN(h.occurredAt)}</span>{h.changes && typeof h.changes === 'object' && Object.keys(h.changes).length ? <span>{'Trường: ' + Object.keys(h.changes).map(fieldText).join(', ')}</span> : null}</div></div></li>))}</ul>
        ) : null}
      </div>
    </Modal>
  );
}

// Nút thao tác cho một mục: hành động chính hiện thành nút, phần còn lại trong menu "Thao tác khác". Không quyền => không hiện gì.
export function TaskActions({ ui, a, size = 'sm' }) {
  const tasks = ui.customerApi && ui.customerApi.tasks;
  const [open, setOpen] = React.useState(null);
  const [menu, setMenu] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!menu) return undefined;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setMenu(false); };
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h);
  }, [menu]);
  if (!tasks) return null;
  const acts = taskActions(a, { can: ui.can, meId: ui.me && ui.me.employeeId });
  if (!acts.length) return null;
  const confirmAct = (kind) => ui.confirm({
    title: kind === 'cancel' ? 'Huỷ công việc này?' : 'Mở lại công việc này?', description: (a.title || a.content || '').slice(0, 120), icon: ACTION_ICON[kind], tone: kind === 'cancel' ? 'warning' : 'blue',
    confirmLabel: ACTION_LABEL[kind], cancelLabel: 'Không',
    onConfirm: async () => { const r = await tasks.act(kind, a); if (r.ok) ui.toast({ tone: 'success', title: 'Đã ' + ACTION_LABEL[kind].toLowerCase(), message: a.code || '' }); else if (!r.duplicate) ui.toast({ tone: 'error', title: r.error.title, message: r.error.message }); },
  });
  const start = (kind) => { setMenu(false); if (kind === 'cancel' || kind === 'reopen') confirmAct(kind); else setOpen(kind); };
  const primary = acts[0] === 'complete' || acts[0] === 'reopen' ? acts[0] : null;
  const rest = acts.filter((k) => k !== primary);
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', position: 'relative' }} ref={ref}>
      {primary ? <Button size={size} variant={primary === 'complete' ? 'primary' : 'secondary'} icon={ACTION_ICON[primary]} onClick={() => start(primary)}>{ACTION_LABEL[primary]}</Button> : null}
      {rest.length ? <IconButton icon="ellipsis" label="Thao tác khác" size="sm" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} /> : null}
      {menu ? (
        <div className="sg-menu sg-glass-strong" role="menu" style={{ right: 0, left: 'auto', top: '100%', minWidth: 190, zIndex: 30, textAlign: 'left', whiteSpace: 'normal' }}>
          {rest.map((k) => <div key={k} role="menuitem" className="sg-menu__item" onClick={() => start(k)} style={k === 'delete' ? { color: 'var(--error-text)' } : undefined}><Icon name={ACTION_ICON[k]} size={15} /><span>{ACTION_LABEL[k]}</span></div>)}
        </div>
      ) : null}
      {/* Hộp thoại có thể nằm trong ô bảng (canh phải, nowrap): đặt lại để không thừa hưởng. */}
      {open ? <div style={{ textAlign: 'left', whiteSpace: 'normal' }}><Dialog kind={open} a={a} ui={ui} onClose={() => setOpen(null)} /></div> : null}
    </span>
  );
}
