import React from 'react';
import { Button, Icon, IconButton, Input, Modal, Select, Switch } from '../../ds/index.js';
import * as U from '../../data/util.js';
import { ApiErrorBox } from '../customers/ApiListStatus.jsx';
import { useCustomerApiState } from '../customers/useCustomerApi.js';
import { taskActions, ACTION_LABEL, ACTION_ICON, validateTransfer } from './tasksModel.js';

const has = (ui, p) => typeof ui.can === 'function' && !!ui.can(p);
const cid = (a) => a.customerId || (a.customer && a.customer.id);
const ACTION_TEXT = { create: 'Tạo', update: 'Sửa', assign: 'Giao việc', complete: 'Hoàn thành', reopen: 'Mở lại', cancel: 'Huỷ', delete: 'Xoá', transfer_request: 'Đề xuất chuyển', transfer_approve: 'Duyệt chuyển', transfer_reject: 'Từ chối chuyển', access_revoke: 'Thu hồi quyền theo việc' };
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
  const [error, setError] = React.useState(null);
  const [tried, setTried] = React.useState(false);
  const [hist, setHist] = React.useState({ status: 'idle', items: [], error: null });
  const canExternal = kind === 'reassign' && has(ui, 'activity.assign_external');
  const cands = useCandidates(ui, a, kind === 'reassign' || kind === 'transfer', kind === 'reassign' && f.external, kind === 'reassign' || has(ui, 'activity.assign'));
  React.useEffect(() => { if (kind === 'history') ui.customerApi.tasks.history(a.id).then((r) => setHist(r.ok ? { status: 'ready', items: r.items, error: null } : { status: 'error', items: [], error: r.error })); }, [kind, a.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (v) => { setError(null); setF((x) => ({ ...x, [k]: v && v.target ? v.target.value : v, ...(k === 'external' ? { performedById: '' } : {}) })); };
  const terr = kind === 'transfer' && tried ? validateTransfer(f) : {};
  const fe = (k) => terr[k] || (error && error.fieldErrors && error.fieldErrors[k]) || '';
  const run = async () => {
    setTried(true);
    if (kind === 'transfer' && Object.keys(validateTransfer(f)).length) return;
    if (kind === 'reassign' && !f.performedById) { setError({ title: 'Chưa chọn người', message: 'Chọn người phụ trách mới.', fieldErrors: {} }); return; }
    const payload = kind === 'complete' ? { outcome: f.outcome.trim() } : kind === 'reassign' ? { performedById: f.performedById, external: f.external } : kind === 'transfer' ? { toEmployeeId: f.toEmployeeId, reason: f.reason.trim() } : kind === 'delete' ? { reason: f.reason.trim() } : {};
    const r = await tasks.act(kind, a, payload);
    if (r.duplicate) return;
    if (r.ok) { ui.toast({ tone: 'success', title: 'Đã ' + ACTION_LABEL[kind].toLowerCase(), message: a.code || a.title || '' }); onClose(); }
    else setError(r.error);
  };
  const others = (items) => items.filter((e) => !a.performedBy || e.id !== a.performedBy.id);
  const nonField = error && !Object.keys(error.fieldErrors || {}).length ? error : null;
  const title = { complete: 'Hoàn thành công việc', reassign: 'Giao lại công việc', transfer: 'Đề xuất chuyển người phụ trách', delete: 'Xoá hoạt động', history: 'Lịch sử thay đổi' }[kind];
  const footer = kind === 'history' ? <Button variant="secondary" onClick={onClose}>Đóng</Button>
    : <><Button variant="secondary" disabled={busy} onClick={onClose}>Huỷ</Button><Button variant={kind === 'delete' ? 'danger' : 'primary'} icon={ACTION_ICON[kind]} loading={busy} onClick={run}>{kind === 'transfer' ? 'Gửi đề xuất' : ACTION_LABEL[kind]}</Button></>;
  return (
    <Modal open onClose={busy ? undefined : onClose} size={kind === 'history' ? 'lg' : 'md'} icon={ACTION_ICON[kind]} tone={kind === 'delete' ? 'error' : 'blue'} title={title} description={(a.code ? a.code + ' · ' : '') + (a.title || a.content || '').slice(0, 80)} footer={footer}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {nonField ? <ApiErrorBox error={nonField} /> : null}
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
                    <div className="sg-feed__meta"><span>{U.dtVN(h.occurredAt)}</span>{h.changes && typeof h.changes === 'object' && Object.keys(h.changes).length ? <span>{'Trường: ' + Object.keys(h.changes).join(', ')}</span> : null}</div></div></li>))}</ul>
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
